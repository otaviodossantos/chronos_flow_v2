import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aplicarMigrations } from '../src/data/partida';
import type { Executor } from '../src/data/conexao';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dirMigrations = path.resolve(aqui, '..', 'db', 'migrations');

/** O mesmo Executor do aparelho, servido por better-sqlite3. */
function executorDeTeste(sqlite: Database.Database): Executor {
  return {
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
}

const tabelas = (sqlite: Database.Database) =>
  (sqlite.prepare("select name from sqlite_master where type='table'").all() as Array<{
    name: string;
  }>).map((r) => r.name);

/** Todas as migrations do bundle, na mesma ordem em que o app as aplica. */
const migrations = () =>
  readdirSync(dirMigrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((arquivo) => ({
      tag: arquivo.replace(/\.sql$/, ''),
      sql: readFileSync(path.join(dirMigrations, arquivo), 'utf8'),
    }));

/** A primeira: a que criou o banco, e a que a adocao da por aplicada. */
const ddlBruto = () => migrations()[0];

describe('migrations no aparelho', () => {
  it('o SQL gerado nao e idempotente — e por isso que existe um livro-caixa', () => {
    // Guarda-chuva contra a suposicao que causou o bug: se um dia o drizzle-kit
    // passar a gerar `IF NOT EXISTS`, este teste avisa que a nota mudou.
    expect(ddlBruto().sql).toMatch(/CREATE TABLE `/);
    expect(ddlBruto().sql).not.toMatch(/CREATE TABLE IF NOT EXISTS/i);
  });

  it('cria o banco na primeira abertura', async () => {
    const sqlite = new Database(':memory:');
    const aplicadas = await aplicarMigrations(executorDeTeste(sqlite));

    // Todas, e nao so a primeira: um banco novo nasce no schema de hoje.
    expect(aplicadas).toEqual(migrations().map((m) => m.tag));
    expect(tabelas(sqlite)).toEqual(expect.arrayContaining(['users', 'nodes', 'backlog_items']));
    expect(tabelas(sqlite)).toContain('__migrations');
  });

  it('a segunda abertura nao tenta criar nada de novo', async () => {
    // E exatamente o caso que quebrava: "table `backlog_items` already exists".
    const sqlite = new Database(':memory:');
    const executor = executorDeTeste(sqlite);

    await aplicarMigrations(executor);
    const naSegunda = await aplicarMigrations(executor);
    const naTerceira = await aplicarMigrations(executor);

    expect(naSegunda).toEqual([]);
    expect(naTerceira).toEqual([]);
  });

  it('nao apaga o que ja esta no banco ao reabrir', async () => {
    const sqlite = new Database(':memory:');
    const executor = executorDeTeste(sqlite);
    await aplicarMigrations(executor);

    sqlite.prepare(
      "insert into users (id, name, birth_date) values ('u1', 'Henrique', 0)",
    ).run();

    await aplicarMigrations(executor);

    const linhas = sqlite.prepare('select name from users').all() as Array<{ name: string }>;
    expect(linhas.map((l) => l.name)).toEqual(['Henrique']);
  });

  it('adota um banco que nasceu antes do livro-caixa, sem reinstalar nada', async () => {
    // O iPhone que ja tinha o app instalado: as tabelas existem e o livro nao.
    const sqlite = new Database(':memory:');
    for (const comando of ddlBruto().sql.split('--> statement-breakpoint')) sqlite.exec(comando);
    sqlite.prepare(
      "insert into users (id, name, birth_date) values ('u1', 'Henrique', 0)",
    ).run();
    expect(tabelas(sqlite)).not.toContain('__migrations');

    const executor = executorDeTeste(sqlite);
    const aplicadas = await aplicarMigrations(executor);

    // A primeira e dada como aplicada — ela ja esta la, em tabelas. O que roda
    // de verdade e so o que veio depois dela: e assim que um iPhone com o app
    // instalado ha meses ganha uma coluna nova sem reinstalar nada.
    expect(aplicadas).toEqual(migrations().slice(1).map((m) => m.tag));

    const linhas = sqlite.prepare('select name from users').all() as Array<{ name: string }>;
    expect(linhas.map((l) => l.name)).toEqual(['Henrique']);

    // E o livro fecha com todas registradas: a proxima abertura nao repete.
    const livro = sqlite.prepare('select tag from __migrations').all() as Array<{ tag: string }>;
    expect(livro.map((l) => l.tag).sort()).toEqual(migrations().map((m) => m.tag));

    // Nao basta registrar: o schema tem de ter mudado mesmo.
    const colunas = (
      sqlite.prepare('pragma table_info(backlog_items)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(colunas).toContain('max_tasks');
  });

  it('uma migration quebrada nao deixa o banco pela metade', async () => {
    const sqlite = new Database(':memory:');
    const executor = executorDeTeste(sqlite);

    await expect(
      executor.emTransacao(async () => {
        await executor.executar('create table meio_caminho (id text)', []);
        await executor.executar('isto nao e sql', []);
      }),
    ).rejects.toThrow();

    expect(tabelas(sqlite)).not.toContain('meio_caminho');
  });
});
