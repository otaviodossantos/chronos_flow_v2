import { validarPacote, resumoDoPacote, type Pacote } from '@shared/transferencia';
import type { Desktop } from '@/native/chronos';
import { exportar, importar } from './transferencia';

/**
 * A conversa com o Chronos do computador, pela rede de casa.
 *
 * O celular nunca tem o `CHRONOS_ACCESS_TOKEN` do `.env` do desktop: ele
 * apresenta o codigo de seis digitos que aparece na tela do computador, e esse
 * codigo so abre as rotas de transferencia — nunca o resto da API.
 */
const base = (d: Desktop) => `http://${d.host}:${d.porta}/api/transfer`;

/**
 * Um Mac que dormiu continua anunciado no cache do mDNS, e um fetch sem prazo
 * ficaria pendurado nele ate o usuario desistir do app.
 */
async function comPrazo(url: string, init: RequestInit, ms: number): Promise<Response> {
  const corte = new AbortController();
  const id = setTimeout(() => corte.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: corte.signal, cache: 'no-store' });
  } catch (erro) {
    if ((erro as Error).name === 'AbortError') {
      throw new Error('O computador nao respondeu. Ele ainda esta ligado e na mesma rede?');
    }
    throw new Error('Nao foi possivel falar com o computador.');
  } finally {
    clearTimeout(id);
  }
}

/** A mensagem do servidor vale mais que um codigo HTTP solto na tela. */
async function erroDaResposta(res: Response): Promise<Error> {
  const corpo = (await res.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  return new Error(corpo?.error?.message ?? `O computador recusou (${res.status}).`);
}

export interface InfoDoDesktop {
  app: string;
  tipo: string;
  nome: string;
  formato: number;
  liberado: boolean;
  expiraEm: number;
}

/** Cartao de visita, sem codigo: e o que confirma que aquilo ali e um Chronos. */
export async function info(d: Desktop): Promise<InfoDoDesktop | null> {
  try {
    const res = await comPrazo(`${base(d)}/info`, {}, 2500);
    if (!res.ok) return null;
    const dados = (await res.json()) as InfoDoDesktop;
    return dados.app === 'chronos-flow' ? dados : null;
  } catch {
    return null;
  }
}

/** Traz o que esta no computador para este iPhone, substituindo tudo. */
export async function puxar(d: Desktop, codigo: string) {
  const res = await comPrazo(
    `${base(d)}/export`,
    { headers: { 'x-chronos-pair': codigo } },
    60_000,
  );
  if (!res.ok) throw await erroDaResposta(res);

  const pacote = validarPacote(await res.json());
  const contagem = await importar(pacote);
  return { contagem, resumo: resumoDoPacote(pacote) };
}

/** Manda o que esta neste iPhone para o computador, substituindo tudo la. */
export async function empurrar(d: Desktop, codigo: string, nomeDoAparelho = 'iPhone') {
  const pacote: Pacote = await exportar(nomeDoAparelho);
  const res = await comPrazo(
    `${base(d)}/import`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-chronos-pair': codigo },
      body: JSON.stringify(pacote),
    },
    120_000,
  );
  if (!res.ok) throw await erroDaResposta(res);

  return (await res.json()) as { importado: boolean; contagem: Record<string, number> };
}
