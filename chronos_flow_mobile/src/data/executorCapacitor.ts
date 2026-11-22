import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { Executor } from './conexao';

const BANCO = 'chronos';

/**
 * O executor do aparelho.
 *
 * `foreign_keys = ON` nao e detalhe: sem ele o SQLite aceita a declaracao das
 * chaves estrangeiras e simplesmente nao as aplica, entao apagar uma tarefa
 * mae deixaria filhas, dependencias e atividades orfas no banco.
 */
export async function executorDoAparelho(): Promise<Executor> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const existente = (await sqlite.isConnection(BANCO, false)).result;
  const conexao: SQLiteDBConnection = existente
    ? await sqlite.retrieveConnection(BANCO, false)
    : await sqlite.createConnection(BANCO, false, 'no-encryption', 1, false);

  await conexao.open();
  // `transaction: false`. O plugin envolve cada `execute` numa transacao
  // propria quando nao se diz o contrario — e um PRAGMA dentro de transacao
  // e silenciosamente ignorado pelo SQLite, o que deixaria as chaves
  // estrangeiras declaradas e nao aplicadas.
  await conexao.execute('PRAGMA foreign_keys = ON;', false);

  // O DDL nao entra aqui: quem decide o que ainda falta aplicar e
  // `aplicarMigrations`, em `partida.ts`, que olha o livro-caixa primeiro.

  return {
    async consultar(sql, params) {
      const r = await conexao.query(sql, params as never[]);
      // O plugin devolve objetos; o Drizzle espera a linha como array ordenado.
      return (r.values ?? []).map((linha) => Object.values(linha as object));
    },

    async executar(sql, params) {
      await conexao.run(sql, params as never[], false);
    },

    /**
     * O `false` em cada `execute` nao e detalhe: sem ele o plugin abre uma
     * transacao propria em volta do comando, e o nosso `BEGIN` cai dentro
     * dela — "cannot start a transaction within a transaction", e toda
     * criacao de tarefa falha.
     */
    async emTransacao(trabalho) {
      await conexao.execute('BEGIN;', false);
      try {
        const saida = await trabalho();
        await conexao.execute('COMMIT;', false);
        return saida;
      } catch (erro) {
        await conexao.execute('ROLLBACK;', false);
        throw erro;
      }
    },

    async fechar() {
      await conexao.close();
      await sqlite.closeConnection(BANCO, false);
    },
  };
}
