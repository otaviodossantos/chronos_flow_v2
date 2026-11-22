import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import * as schema from '@db/schema';

export type BD = SqliteRemoteDatabase<typeof schema>;

/**
 * Quem executa o SQL de verdade. No iPhone e o plugin do Capacitor; nos testes
 * e o better-sqlite3.
 *
 * Os dois drivers diretos do Drizzle nao serviriam: o do better-sqlite3 e
 * sincrono e o do Capacitor e assincrono, e a assinatura vaza para cada
 * consulta. Pelo proxy, todo o codigo de servico e assincrono nos dois mundos —
 * o que se testa aqui e exatamente o que roda la.
 */
export interface Executor {
  /** SELECT. Devolve as linhas como arrays de valores, na ordem das colunas. */
  consultar(sql: string, params: unknown[]): Promise<unknown[][]>;
  /** INSERT/UPDATE/DELETE/DDL. */
  executar(sql: string, params: unknown[]): Promise<void>;
  /** Roda tudo ou nada. */
  emTransacao<T>(trabalho: () => Promise<T>): Promise<T>;
  fechar(): Promise<void>;
}

let executorAtual: Executor | null = null;
let bdAtual: BD | null = null;

export function ligar(executor: Executor): BD {
  executorAtual = executor;

  bdAtual = drizzle(
    async (sql, params, method) => {
      // `run` nao devolve linhas; pedir resultado dele gastaria uma ida a toa.
      if (method === 'run') {
        await executor.executar(sql, params);
        return { rows: [] };
      }
      const linhas = await executor.consultar(sql, params);
      if (method !== 'get') return { rows: linhas };

      /**
       * `get` espera a linha solta, e `undefined` quando nao achou nada.
       *
       * Devolver `[]` no lugar de `undefined` parece inofensivo e nao e: o
       * Drizzle testa `if (!row)`, um array vazio e truthy, e ele monta um
       * objeto com todos os campos `undefined`. O resultado e um fantasma que
       * passa em qualquer `if (no)` — uma busca por id inexistente devolvia
       * "um no" e o codigo seguia em frente somando `undefined + 1`.
       */
      return { rows: linhas[0] as never };
    },
    { schema },
  );

  return bdAtual;
}

export function bd(): BD {
  if (!bdAtual) throw new Error('Banco nao foi aberto. Chame abrirBanco() na partida.');
  return bdAtual;
}

/**
 * Tudo ou nada.
 *
 * O desktop usava `prisma.$transaction`, e cada servico que o chamava contava
 * com isso: mover um no reescreve o caminho de toda a subarvore, e uma falha no
 * meio deixaria a arvore mentindo sobre si mesma. O proxy do Drizzle nao
 * implementa transacao, entao ela vem do executor.
 */
export async function emTransacao<T>(trabalho: (banco: BD) => Promise<T>): Promise<T> {
  if (!executorAtual || !bdAtual) throw new Error('Banco nao foi aberto.');
  const banco = bdAtual;
  return executorAtual.emTransacao(() => trabalho(banco));
}

export async function fechar(): Promise<void> {
  await executorAtual?.fechar();
  executorAtual = null;
  bdAtual = null;
}
