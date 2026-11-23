import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Senhas com scrypt, que ja vem no Node: nada de dependencia nativa para
 * compilar na imagem ARM da AWS. Os parametros vao gravados junto do hash,
 * entao da para endurece-los depois sem invalidar quem ja tem conta.
 */
const N = 16384;
const R = 8;
const P = 1;
const TAMANHO = 64;

function derivar(senha: string, sal: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((ok, falha) =>
    scrypt(senha.normalize('NFKC'), sal, TAMANHO, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, chave) =>
      err ? falha(err) : ok(chave),
    ),
  );
}

export async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const chave = await derivar(senha, sal, N, R, P);
  return ['scrypt', N, R, P, sal.toString('base64'), chave.toString('base64')].join('$');
}

export async function conferirSenha(senha: string, guardado: string | null | undefined): Promise<boolean> {
  if (!guardado) return false;
  const [tipo, n, r, p, sal, chave] = guardado.split('$');
  if (tipo !== 'scrypt' || !sal || !chave) return false;
  const esperado = Buffer.from(chave, 'base64');
  const obtido = await derivar(senha, Buffer.from(sal, 'base64'), Number(n), Number(r), Number(p));
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}

/** Segredo aleatorio para cookie de sessao ou token de API. */
export function novoSegredo(prefixo = ''): string {
  return prefixo + randomBytes(32).toString('base64url');
}

/** O que vai para o banco no lugar do segredo. */
export function hashSegredo(segredo: string): string {
  return createHash('sha256').update(segredo).digest('hex');
}

/**
 * Faz o mesmo trabalho de uma conferencia de verdade quando o e-mail nem
 * existe. Sem isso, "e-mail errado" responderia mais rapido que "senha
 * errada" e daria para descobrir quem tem conta medindo o tempo.
 */
let hashDeMentira: Promise<string> | null = null;
export async function gastarTempoDeConferencia(senha: string): Promise<void> {
  hashDeMentira ??= hashSenha('nao-e-senha-de-ninguem');
  await conferirSenha(senha, await hashDeMentira);
}
