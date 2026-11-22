import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ligar, fechar, type Executor, type BD } from '../../src/data/conexao';

const aqui = path.dirname(fileURLToPath(import.meta.url));

/**
 * O mesmo Executor do aparelho, servido por better-sqlite3.
 *
 * E o que torna os testes honestos: o codigo de servico nao sabe em qual dos
 * dois esta rodando, entao o que passa aqui e o mesmo caminho que roda no
 * iPhone — menos o driver.
 */
/**
 * Todas as migrations, em ordem — nao so a primeira.
 *
 * Dois arquivos de teste montavam o banco pegando o primeiro `.sql` que
 * aparecesse. Funcionou enquanto havia uma migration so; da segunda em
 * diante, o banco de teste parava no schema inicial e a suite quebrava com
 * "no such column", acusando o codigo novo por um banco velho. Mora aqui para
 * nao haver um terceiro lugar com a mesma suposicao.
 */
export function aplicarODDL(sqlite: Database.Database): void {
  const dir = path.resolve(aqui, '..', '..', 'db', 'migrations');
  for (const arquivo of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const ddl = readFileSync(path.join(dir, arquivo), 'utf8');
    for (const comando of ddl.split('--> statement-breakpoint')) sqlite.exec(comando);
  }
}

export function bancoDeTeste(): { bd: BD; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  aplicarODDL(sqlite);

  const executor: Executor = {
    async consultar(sql, params) {
      return sqlite.prepare(sql).raw().all(params as never[]) as unknown[][];
    },
    async executar(sql, params) {
      sqlite.prepare(sql).run(params as never[]);
    },
    async emTransacao(trabalho) {
      sqlite.exec('BEGIN');
      try {
        const saida = await trabalho();
        sqlite.exec('COMMIT');
        return saida;
      } catch (erro) {
        sqlite.exec('ROLLBACK');
        throw erro;
      }
    },
    async fechar() {
      sqlite.close();
    },
  };

  return { bd: ligar(executor), sqlite };
}

export const desligar = fechar;
