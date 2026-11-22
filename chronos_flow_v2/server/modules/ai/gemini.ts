import { AppError } from '../../lib/errors.js';
import { MAX_ATTEMPTS, shouldRetry, upstreamMessage, waitMs } from './geminiRetry.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface GeminiResponse {
  res: Response;
  /** Quantas idas ate aqui — entra na mensagem de erro para o usuario saber. */
  attempts: number;
}

/**
 * POST no modelo, repetindo enquanto o erro for de fila ou instabilidade.
 * Um 503 do Gemini costuma passar em segundos; sem isso, a unica saida do
 * usuario e clicar de novo e torcer.
 */
async function postToModel(
  config: GeminiConfig,
  payload: unknown,
  attempt = 1,
): Promise<GeminiResponse> {
  let res: Response;
  try {
    res = await fetch(
      `${BASE}/models/${encodeURIComponent(config.model)}:generateContent?key=${config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
  } catch (err) {
    // Queda de rede tambem merece nova tentativa: costuma ser o wifi piscando.
    if (attempt < MAX_ATTEMPTS) {
      await sleep(waitMs(null, attempt));
      return postToModel(config, payload, attempt + 1);
    }
    throw new AppError(
      'INTERNAL',
      `Nao foi possivel falar com a API do Gemini: ${(err as Error).message}`,
    );
  }

  if (shouldRetry(res.status, attempt)) {
    await sleep(waitMs(res.headers.get('retry-after'), attempt));
    return postToModel(config, payload, attempt + 1);
  }

  return { res, attempts: attempt };
}

/** Erro de upstream com texto util na frente e o corpo cru so nos detalhes. */
function upstreamError(status: number, attempts: number, detail: string): AppError {
  const code = status === 429 || status >= 500 ? 'UPSTREAM_BUSY' : 'INTERNAL';
  return new AppError(code, upstreamMessage(status, attempts), { status, attempts, detail });
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
}

/**
 * Nomes de modelo saem de linha. Em vez de fixar um e quebrar quando o Google
 * aposenta a familia, o app descobre um modelo Flash valido na propria chave e
 * lembra dele enquanto o processo viver.
 */
const discovered = new Map<string, string>();

export async function resolveModel(apiKey: string, preferred?: string | null): Promise<string> {
  const cached = discovered.get(apiKey);
  if (cached) return cached;

  const models = await listModels(apiKey);
  if (models.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Nenhum modelo disponivel para essa chave.');
  }

  // Se o preferido ainda existe, respeita a escolha do usuario.
  if (preferred && models.some((m) => m.name === preferred)) {
    discovered.set(apiKey, preferred);
    return preferred;
  }

  const flash = models.find(
    (m) => /flash/i.test(m.name) && !/(tts|image|live|embedding)/i.test(m.name),
  );
  const chosen = flash?.name ?? models[0].name;
  discovered.set(apiKey, chosen);
  return chosen;
}

export function forgetModel(apiKey: string) {
  discovered.delete(apiKey);
}

/**
 * Chamada ao Gemini pedindo JSON. `responseMimeType` mais o schema fazem o
 * modelo devolver estrutura em vez de prosa — sem isso, metade das respostas
 * vem embrulhada em markdown e quebra o parse.
 */
export async function generateJson<T>(
  config: GeminiConfig,
  prompt: string,
  responseSchema: Record<string, unknown>,
  systemInstruction?: string,
  retried = false,
): Promise<T> {
  if (!config.apiKey) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Nenhuma chave do Gemini configurada. Adicione a sua em Configuracoes.',
    );
  }

  const { res, attempts } = await postToModel(config, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const detail = body.slice(0, 400);
    if (res.status === 400 && detail.includes('API key')) {
      throw new AppError('VALIDATION_FAILED', 'A chave do Gemini foi recusada.');
    }
    if (res.status === 404 && !retried) {
      // O modelo salvo saiu de linha: descobre um valido e repete uma vez.
      forgetModel(config.apiKey);
      const model = await resolveModel(config.apiKey, null);
      return generateJson<T>({ ...config, model }, prompt, responseSchema, systemInstruction, true);
    }
    if (res.status === 404) {
      throw new AppError(
        'VALIDATION_FAILED',
        `O modelo "${config.model}" nao existe nessa chave. Escolha outro em Configuracoes.`,
      );
    }
    throw upstreamError(res.status, attempts, detail);
  }

  const body = (await res.json()) as any;
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason;
    throw new AppError('INTERNAL', `O modelo nao devolveu conteudo${reason ? ` (${reason})` : ''}.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError('INTERNAL', 'A resposta do modelo nao era JSON valido.');
  }
}

/** Modelos disponiveis na chave — evita chutar nome de modelo na interface. */
export async function listModels(apiKey: string): Promise<Array<{ name: string; label: string }>> {
  if (!apiKey) return [];
  const res = await fetch(`${BASE}/models?key=${apiKey}&pageSize=100`);
  if (!res.ok) {
    throw new AppError('VALIDATION_FAILED', 'Nao foi possivel listar os modelos com essa chave.');
  }
  const body = (await res.json()) as any;
  return (body.models ?? [])
    .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m: any) => ({
      name: String(m.name).replace(/^models\//, ''),
      label: m.displayName ?? String(m.name).replace(/^models\//, ''),
    }));
}


/**
 * Transcreve audio. Usado onde a API de fala do navegador nao existe —
 * no Electron, notadamente, que nao embute o servico de reconhecimento
 * do Chrome.
 */
export async function transcribeAudio(
  config: GeminiConfig,
  audioBase64: string,
  mimeType: string,
  retried = false,
): Promise<string> {
  if (!config.apiKey) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Nenhuma chave do Gemini configurada. Adicione a sua em Configuracoes.',
    );
  }

  const { res, attempts } = await postToModel(config, {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              'Transcreva este audio em portugues do Brasil. ' +
              'Devolva apenas a transcricao, sem comentarios, sem aspas e sem rotulos. ' +
              'Pontue naturalmente. Se o audio estiver vazio ou inaudivel, devolva uma string vazia.',
          },
          { inlineData: { mimeType, data: audioBase64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 404 && !retried) {
      forgetModel(config.apiKey);
      const model = await resolveModel(config.apiKey, null);
      return transcribeAudio({ ...config, model }, audioBase64, mimeType, true);
    }
    if (res.status === 400 && detail.includes('mime')) {
      throw new AppError(
        'VALIDATION_FAILED',
        `O modelo nao aceitou o formato do audio (${mimeType}).`,
      );
    }
    throw upstreamError(res.status, attempts, detail);
  }

  const body = (await res.json()) as any;
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? text.trim() : '';
}
