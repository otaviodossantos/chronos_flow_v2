/**
 * Politica de repeticao das chamadas ao Gemini. Funcoes puras, separadas do
 * cliente, porque a decisao de repetir e o que precisa estar certo: repetir
 * um 400 gasta tempo a toa, e nao repetir um 503 joga na cara do usuario um
 * erro que costuma passar sozinho em segundos.
 */

/** Status que valem uma nova tentativa: fila cheia ou instabilidade do lado deles. */
const RETRIABLE = new Set([429, 500, 502, 503, 504]);

export const MAX_ATTEMPTS = 3;

export function isRetriable(status: number): boolean {
  return RETRIABLE.has(status);
}

export function shouldRetry(status: number, attempt: number): boolean {
  return isRetriable(status) && attempt < MAX_ATTEMPTS;
}

/**
 * Espera antes da proxima tentativa: 1.2s, depois 2.4s, com ate 400ms de
 * jitter. O jitter existe porque varias abas repetindo no mesmo instante
 * recriam a propria fila que causou o 503.
 */
export function backoffMs(attempt: number, jitter = Math.random()): number {
  return Math.round(1200 * 2 ** (attempt - 1) + jitter * 400);
}

/**
 * O `Retry-After` do Google vem em segundos ou como data HTTP. Quando ele
 * existe, manda mais que o backoff: e o unico que sabe o tamanho da fila.
 */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);

  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - now), 30_000);
}

export function waitMs(header: string | null, attempt: number, jitter?: number): number {
  return retryAfterMs(header) ?? backoffMs(attempt, jitter);
}

/**
 * Mensagem para quem esta olhando a tela. O corpo cru da resposta do Google
 * vai em `details`, nao no texto: "UNAVAILABLE" nao diz a ninguem o que fazer.
 */
export function upstreamMessage(status: number, attempts: number): string {
  const tentativas = attempts > 1 ? ` Tentei ${attempts} vezes.` : '';

  if (status === 429) {
    return (
      'A chave do Gemini bateu no limite de uso.' +
      tentativas +
      ' Espere alguns minutos ou use uma chave com cota maior.'
    );
  }
  if (status === 503) {
    return (
      'O Gemini esta sobrecarregado agora — e temporario, do lado do Google.' +
      tentativas +
      ' Tente de novo em instantes.'
    );
  }
  if (status >= 500) {
    return `O Gemini falhou (erro ${status}).${tentativas} Tente de novo em instantes.`;
  }
  return `A API do Gemini respondeu ${status}.`;
}
