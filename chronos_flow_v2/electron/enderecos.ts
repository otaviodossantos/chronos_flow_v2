/**
 * Enderecos de servidor do Chronos: o que se aceita e como se confere. Sem
 * nada do Electron, para dar para testar fora dele.
 */
const LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Endereco digitado -> origem (`https://host[:porta]`). So HTTPS, menos para
 * a propria maquina: a senha e o cookie de sessao atravessam essa conexao.
 */
export function normalizar(bruto: string): string {
  const texto = bruto.trim();
  if (!texto) throw new Error('Informe o endereco do servidor.');
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(texto) ? texto : `https://${texto}`);
  } catch {
    throw new Error('Endereco invalido.');
  }
  const local = LOCAIS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('Use https:// — so a propria maquina (localhost) pode ser http.');
  }
  return url.origin;
}

/** Confere que ali responde um Chronos, antes de guardar. */
export async function conferir(origem: string): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch(`${origem}/api/health`, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error('Nao foi possivel falar com esse endereco.');
  }
  const corpo = (await resposta.json().catch(() => null)) as { app?: string } | null;
  if (!resposta.ok || !corpo?.app?.startsWith('Chronos Flow')) {
    throw new Error('Esse endereco responde, mas nao e um servidor do Chronos Flow.');
  }
}

