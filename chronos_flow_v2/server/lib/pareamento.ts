import { randomInt, createHash, timingSafeEqual } from 'node:crypto';

/**
 * O codigo de pareamento da transferencia.
 *
 * O resto da API pede login. Fazer login no iPhone so para mandar os dados
 * seria atrito demais — e entregar a sessao ao celular daria a ele a API
 * inteira, nao so a transferencia. O codigo vale para a conta de quem o
 * liberou, e so para ela.
 *
 * Entao a transferencia tem a sua propria porta: seis digitos que o desktop
 * mostra na tela quando voce clica em liberar, valem poucos minutos, servem
 * uma vez e morrem em cinco tentativas erradas. Nao e criptografia; e o
 * suficiente para que abrir a porta na rede de casa seja um ato deliberado e
 * curto, em vez de um buraco permanente.
 */
const VALIDADE_MS = 5 * 60 * 1000;
const TENTATIVAS = 5;

interface Pareamento {
  codigo: string;
  expiraEm: number;
  restantes: number;
  /** Conta de quem clicou em liberar: o celular le e escreve so nela. */
  userId: string;
}

let atual: Pareamento | null = null;

const digests = (a: string, b: string) => [
  createHash('sha256').update(a).digest(),
  createHash('sha256').update(b).digest(),
];

/**
 * Um codigo por vez no servidor. Outra conta nao sobrescreve o codigo aberto
 * de alguem (devolve null) — so quem o liberou pode gerar outro ou fecha-lo.
 */
export function liberar(userId: string): { codigo: string; expiraEm: string } | null {
  if (liberado() && atual!.userId !== userId) return null;
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  atual = { codigo, expiraEm: Date.now() + VALIDADE_MS, restantes: TENTATIVAS, userId };
  return { codigo, expiraEm: new Date(atual.expiraEm).toISOString() };
}

/** Sem `userId`: fecha de qualquer jeito (uso interno, depois de transferir). */
export function fechar(userId?: string): void {
  if (userId && atual && atual.userId !== userId) return;
  atual = null;
}

/** Dono do codigo liberado agora, para quem acabou de passar em `conferir`. */
export function dono(): string | null {
  return atual?.userId ?? null;
}

export function liberado(): boolean {
  if (atual && Date.now() > atual.expiraEm) atual = null;
  return atual !== null;
}

export function segundosRestantes(): number {
  if (!liberado()) return 0;
  return Math.max(0, Math.round((atual!.expiraEm - Date.now()) / 1000));
}

export type Veredito = 'ok' | 'fechado' | 'expirado' | 'incorreto' | 'esgotado';

/**
 * Comparacao em tempo constante e contagem de tentativas: seis digitos sao
 * um milhao de possibilidades, que uma maquina na mesma rede varreria em
 * segundos se pudesse tentar a vontade.
 */
export function conferir(oferecido: string | undefined | null): Veredito {
  if (!atual) return 'fechado';
  if (Date.now() > atual.expiraEm) {
    atual = null;
    return 'expirado';
  }
  if (!oferecido) return 'incorreto';

  const [a, b] = digests(oferecido, atual.codigo);
  if (timingSafeEqual(a, b)) return 'ok';

  atual.restantes -= 1;
  if (atual.restantes <= 0) {
    atual = null;
    return 'esgotado';
  }
  return 'incorreto';
}

export const MENSAGEM: Record<Exclude<Veredito, 'ok'>, string> = {
  fechado: 'A transferencia nao esta liberada no computador. Abra Ajustes > Transferir e clique em Liberar.',
  expirado: 'O codigo expirou. Gere outro no computador.',
  incorreto: 'Codigo incorreto.',
  esgotado: 'Codigo bloqueado por tentativas erradas. Gere outro no computador.',
};
