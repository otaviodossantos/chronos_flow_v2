import { Capacitor } from '@capacitor/core';
import { users, spaces } from '@db/schema';
import { ligar, bd as banco, type Executor } from './conexao';
import { executorDoAparelho } from './executorCapacitor';

/**
 * Todas as migrations, na ordem do nome do arquivo.
 *
 * O desktop roda `prisma migrate` contra um Postgres que ja existe. Aqui o
 * banco nasce junto com o app na primeira abertura, entao o DDL viaja dentro
 * do bundle.
 */
const MIGRATIONS = import.meta.glob('../../db/migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** `0000_curious_penance.sql` -> `0000_curious_penance`. */
const tagDoArquivo = (caminho: string) =>
  caminho.split('/').pop()!.replace(/\.sql$/, '');

const LIVRO = '__migrations';

/**
 * O livro-caixa das migrations.
 *
 * O SQL que o drizzle-kit gera **nao** tem `IF NOT EXISTS` — e `CREATE TABLE`
 * puro. Aplicar o arquivo a cada abertura funcionava exatamente uma vez: na
 * segunda, o app morria em "table `backlog_items` already exists" antes de
 * desenhar qualquer coisa. Entao o que decide o que rodar nao e o arquivo, e
 * sim esta tabela: cada migration e aplicada uma vez e fica registrada.
 */
export async function aplicarMigrations(executor: Executor): Promise<string[]> {
  await executor.executar(
    `create table if not exists ${LIVRO} (
       tag text primary key not null,
       aplicada_em integer not null
     )`,
    [],
  );

  const registradas = new Set(
    (await executor.consultar(`select tag from ${LIVRO}`, [])).map((l) => String(l[0])),
  );

  const arquivos = Object.keys(MIGRATIONS).sort();
  const aplicadas: string[] = [];

  /**
   * Banco que nasceu antes de existir o livro-caixa.
   *
   * As tabelas estao todas la e o livro esta vazio: rodar a primeira migration
   * falharia, e pular sem registrar faria o mesmo na proxima abertura. Entao
   * ela e dada como aplicada — e o que o `prisma migrate baseline` faz do
   * outro lado, e o motivo de este app nao precisar que ninguem reinstale
   * nada depois desta correcao.
   */
  if (registradas.size === 0 && (await existeTabela(executor, 'users'))) {
    const primeira = arquivos[0];
    if (primeira) {
      await registrar(executor, tagDoArquivo(primeira));
      registradas.add(tagDoArquivo(primeira));
    }
  }

  for (const arquivo of arquivos) {
    const tag = tagDoArquivo(arquivo);
    if (registradas.has(tag)) continue;

    // Tudo ou nada: uma migration aplicada pela metade deixaria o banco num
    // estado que nenhuma abertura seguinte saberia consertar.
    await executor.emTransacao(async () => {
      for (const comando of MIGRATIONS[arquivo].split('--> statement-breakpoint')) {
        const sql = comando.trim();
        if (sql) await executor.executar(sql, []);
      }
      await registrar(executor, tag);
    });
    aplicadas.push(tag);
  }

  return aplicadas;
}

async function registrar(executor: Executor, tag: string): Promise<void> {
  await executor.executar(
    `insert into ${LIVRO} (tag, aplicada_em) values (?, ?)`,
    [tag, Date.now()],
  );
}

async function existeTabela(executor: Executor, nome: string): Promise<boolean> {
  const linhas = await executor.consultar(
    `select name from sqlite_master where type = 'table' and name = ?`,
    [nome],
  );
  return linhas.length > 0;
}

/**
 * No navegador o plugin do Capacitor depende do elemento `jeep-sqlite`, que so
 * existe quando o pacote esta instalado. Em vez de exigi-lo do aparelho, a
 * tentativa e opcional: no iPhone este caminho nunca roda.
 */
async function executorDoNavegador(): Promise<Executor> {
  const { defineCustomElements } = await import(
    /* @vite-ignore */ 'jeep-sqlite/loader'
  ).catch(() => {
    throw new Error(
      'Este app guarda tudo no proprio aparelho. Para abrir no navegador durante o ' +
        'desenvolvimento, instale o pacote jeep-sqlite.',
    );
  });
  defineCustomElements(window);

  if (!document.querySelector('jeep-sqlite')) {
    document.body.appendChild(document.createElement('jeep-sqlite'));
  }
  await customElements.whenDefined('jeep-sqlite');

  const { CapacitorSQLite } = await import('@capacitor-community/sqlite');
  await CapacitorSQLite.initWebStore();
  return executorDoAparelho();
}

let aberto: Promise<void> | null = null;

/** Abre o banco uma unica vez, mesmo sob o StrictMode do React. */
export function abrirBanco(): Promise<void> {
  aberto ??= (async () => {
    const executor =
      Capacitor.getPlatform() === 'web'
        ? await executorDoNavegador()
        : await executorDoAparelho();

    const novas = await aplicarMigrations(executor);
    if (novas.length > 0) console.log('[chronos] migrations aplicadas:', novas.join(', '));

    ligar(executor);
    await semear();
  })();
  return aberto;
}

/**
 * Nao ha login: o aparelho e de uma pessoa so, e a primeira linha da tabela de
 * usuarios e essa pessoa. Sem ela todo o resto falharia por chave estrangeira
 * na primeira tarefa criada.
 */
async function semear(): Promise<void> {
  const bd = banco();
  const existe = await bd.select({ id: users.id }).from(users).limit(1).get();
  if (existe) return;

  const userId = crypto.randomUUID();
  await bd.insert(users).values({
    id: userId,
    name: 'Voce',
    // Trocavel em Ajustes; sem uma data o mapa da vida nao tem de onde partir.
    birth_date: new Date(1990, 0, 1),
  }).run();

  await bd.insert(spaces).values([
    { id: crypto.randomUUID(), user_id: userId, name: 'Trabalho', color: '#2563eb', position: 0 },
    { id: crypto.randomUUID(), user_id: userId, name: 'Pessoal', color: '#16a34a', position: 1 },
  ]).run();
}
