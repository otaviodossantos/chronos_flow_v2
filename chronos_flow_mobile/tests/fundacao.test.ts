import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, like } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { aplicarODDL } from './apoio/bancoDeTeste.js';

// O dominio vem do desktop sem uma linha alterada. E a razao de existir do alias.
import { contributionMap } from '@core/impact.js';
import { weightedProgress } from '@core/cascade.js';
import { buildPath, ancestorIdsBottomUp } from '@core/path.js';
import { agendarExecucao, EXPEDIENTE_PADRAO } from '@core/agenda.js';

/** Sobe o schema de verdade, a partir da migration que o drizzle-kit gerou. */
function bancoNovo() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  aplicarODDL(sqlite);

  return { sqlite, db: drizzle(sqlite, { schema }) };
}

let bd: ReturnType<typeof bancoNovo>;
const UID = 'u1';

beforeEach(() => {
  bd = bancoNovo();
  bd.db.insert(schema.users).values({ id: UID, name: 'Voce', birth_date: new Date(0) }).run();
});

/** Monta raiz -> bloco -> duas folhas, com os pesos que a cascata usa. */
function arvoreDeTeste() {
  const no = (id: string, parent: string | null, caminho: string, extra = {}) =>
    bd.db
      .insert(schema.nodes)
      .values({ id, user_id: UID, parent_id: parent, path: caminho, title: id, ...extra })
      .run();

  no('r', null, 'r', { depth: 0 });
  no('b', 'r', buildPath('r', 'b'), { depth: 1 });
  no('f1', 'b', buildPath('r/b', 'f1'), { depth: 2, weight: 60, estimated_minutes: 60 });
  no('f2', 'b', buildPath('r/b', 'f2'), { depth: 2, weight: 180, estimated_minutes: 180 });
}

describe('fundacao do app mobile', () => {
  it('o schema SQLite aceita a arvore recursiva', () => {
    arvoreDeTeste();
    const todos = bd.db.select().from(schema.nodes).all();
    expect(todos).toHaveLength(4);
    expect(todos.find((n) => n.id === 'f2')?.path).toBe('r/b/f2');
  });

  it('apagar a mae leva as filhas, como o Postgres fazia', () => {
    arvoreDeTeste();
    bd.db.delete(schema.nodes).where(eq(schema.nodes.id, 'b')).run();
    // Sem a chave estrangeira na auto-referencia, f1 e f2 ficariam orfas aqui.
    expect(bd.db.select().from(schema.nodes).all().map((n) => n.id)).toEqual(['r']);
  });

  it('consultar um ramo por path funciona igual ao startsWith do Prisma', () => {
    arvoreDeTeste();
    const ramo = bd.db.select().from(schema.nodes).where(like(schema.nodes.path, 'r/b/%')).all();
    expect(ramo.map((n) => n.id).sort()).toEqual(['f1', 'f2']);
  });

  it('o invariante da cascata sobrevive ao ponto flutuante do SQLite', () => {
    arvoreDeTeste();
    const linhas = bd.db.select().from(schema.nodes).all();
    const contribuicoes = contributionMap(
      linhas.map((n) => ({
        id: n.id,
        parent_id: n.parent_id,
        weight: n.weight,
        status: n.status,
        isLeaf: !linhas.some((f) => f.parent_id === n.id),
      })),
    );
    const folhas = ['f1', 'f2'].map((id) => contribuicoes.get(id) ?? 0);
    // A soma das folhas de uma raiz e exatamente 1 — o invariante do app.
    expect(folhas.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    // E o peso maior leva a fatia maior: 180 contra 60.
    expect(folhas[1]).toBeGreaterThan(folhas[0]);
  });

  it('o progresso ponderado continua valendo sobre dados vindos do banco', () => {
    arvoreDeTeste();
    bd.db
      .update(schema.nodes)
      .set({ status: 'COMPLETED', progress: 100 })
      .where(eq(schema.nodes.id, 'f2'))
      .run();

    const filhas = bd.db
      .select()
      .from(schema.nodes)
      .where(eq(schema.nodes.parent_id, 'b'))
      .all()
      .map((n) => ({ weight: n.weight, progress: n.progress, status: n.status }));

    // 180 de 240 fechados = 75%.
    expect(weightedProgress(filhas)).toBeCloseTo(75, 6);
  });

  it('o agendador do backlog roda sem nenhuma adaptacao', () => {
    const janelas = agendarExecucao(
      [
        { id: 'a', minutos: 120, dependeDe: [], agenda: 'eu', ordem: 0 },
        { id: 'b', minutos: 60, dependeDe: ['a'], agenda: 'eu', ordem: 1 },
      ],
      new Date(2026, 8, 28, 9, 0, 0, 0),
      EXPEDIENTE_PADRAO,
    );
    expect(janelas.get('b')!.start_date).toEqual(janelas.get('a')!.due_date);
  });

  it('datas voltam do banco como Date, com o minuto preservado', () => {
    const quando = new Date(2026, 9, 20, 14, 37, 0, 0);
    bd.db
      .insert(schema.nodes)
      .values({ id: 'x', user_id: UID, path: 'x', title: 'x', start_date: quando })
      .run();

    const lido = bd.db.select().from(schema.nodes).where(eq(schema.nodes.id, 'x')).get();
    expect(lido?.start_date).toBeInstanceOf(Date);
    expect(lido?.start_date?.getTime()).toBe(quando.getTime());
  });

  it('o caminho materializado concorda com o helper do desktop', () => {
    arvoreDeTeste();
    const f1 = bd.db.select().from(schema.nodes).where(eq(schema.nodes.id, 'f1')).get()!;
    expect(ancestorIdsBottomUp(f1.path)).toEqual(['b', 'r']);
  });
});
