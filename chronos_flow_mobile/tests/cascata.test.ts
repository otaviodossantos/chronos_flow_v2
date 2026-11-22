import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { nodes, users } from '@db/schema';
import { bancoDeTeste, desligar } from './apoio/bancoDeTeste';
import {
  propagarDe,
  recalcularProprio,
  recontarFolhas,
  recalcularImpacto,
  recomputarTudo,
} from '../src/data/cascata';
import type { BD } from '../src/data/conexao';

let bd: BD;
const UID = 'u1';

beforeEach(async () => {
  bd = bancoDeTeste().bd;
  await bd.insert(users).values({ id: UID, name: 'Voce', birth_date: new Date(0) }).run();
});
afterEach(() => desligar());

/**
 *  raiz
 *   +- bloco A (peso 1)
 *   |    +- a1  peso 60
 *   |    +- a2  peso 180
 *   +- bloco B (peso 1)
 *        +- b1  peso 60
 */
async function arvore() {
  const no = (id: string, pai: string | null, caminho: string, extra = {}) =>
    bd.insert(nodes).values({
      id, user_id: UID, parent_id: pai, path: caminho, title: id,
      depth: caminho.split('/').length - 1, ...extra,
    }).run();

  await no('r', null, 'r');
  await no('A', 'r', 'r/A');
  await no('a1', 'A', 'r/A/a1', { weight: 60 });
  await no('a2', 'A', 'r/A/a2', { weight: 180 });
  await no('B', 'r', 'r/B');
  await no('b1', 'B', 'r/B/b1', { weight: 60 });
}

const ler = async (id: string) =>
  (await bd.select().from(nodes).where(eq(nodes.id, id)).get())!;

const concluir = (id: string) =>
  bd.update(nodes).set({ status: 'COMPLETED' }).where(eq(nodes.id, id)).run();

describe('cascata sobre SQLite', () => {
  it('concluir uma folha sobe o progresso ate a raiz', async () => {
    await arvore();
    await concluir('a2');
    const passos = await propagarDe(bd, 'a2');

    // a2 vale 180 de 240 no bloco A -> 75%; A vale 1 de 2 na raiz -> 37,5%.
    expect((await ler('A')).progress).toBeCloseTo(75, 6);
    expect((await ler('r')).progress).toBeCloseTo(37.5, 6);
    // Os passos saem de cima para baixo, para a tela narrar a subida.
    expect(passos.map((p) => p.id)).toEqual(['r', 'A']);
  });

  it('a folha concluida vale 100 por si', async () => {
    await arvore();
    await concluir('a1');
    expect(await recalcularProprio(bd, 'a1')).toBe(100);
  });

  it('para cedo quando o progresso de cima nao muda', async () => {
    await arvore();
    // Sem nada concluido, propagar nao deve mexer em ninguem.
    expect(await propagarDe(bd, 'a1')).toEqual([]);
  });

  it('o peso manda: 180 move mais que 60', async () => {
    await arvore();
    await concluir('a1');
    await propagarDe(bd, 'a1');
    const comLeve = (await ler('A')).progress;

    await bd.update(nodes).set({ status: 'PENDING' }).where(eq(nodes.id, 'a1')).run();
    await propagarDe(bd, 'a1');
    await concluir('a2');
    await propagarDe(bd, 'a2');

    expect((await ler('A')).progress).toBeGreaterThan(comLeve);
  });

  it('conta as folhas de cada ramo', async () => {
    await arvore();
    await recontarFolhas(bd, 'r');
    expect((await ler('r')).leaf_count).toBe(3);
    expect((await ler('A')).leaf_count).toBe(2);
    expect((await ler('b1')).leaf_count).toBe(1);
  });

  it('o impacto das folhas soma exatamente 1', async () => {
    await arvore();
    await recalcularImpacto(bd, 'r');
    const folhas = await Promise.all(['a1', 'a2', 'b1'].map(ler));
    const soma = folhas.reduce((s, n) => s + n.root_impact, 0);
    expect(soma).toBeCloseTo(1, 5);
    expect((await ler('r')).root_impact).toBeCloseTo(1, 5);
  });

  it('b1 sozinha no ramo vale mais que a1, que divide o seu', async () => {
    await arvore();
    await recalcularImpacto(bd, 'r');
    // B vale metade da raiz e tem uma folha so; A divide a outra metade em duas.
    expect((await ler('b1')).root_impact).toBeGreaterThan((await ler('a1')).root_impact);
  });

  it('recomputar tudo chega no mesmo resultado da propagacao incremental', async () => {
    await arvore();
    await concluir('a2');
    await propagarDe(bd, 'a2');
    const incremental = (await ler('r')).progress;

    // Suja o valor de proposito e manda recomputar do zero.
    await bd.update(nodes).set({ progress: 99 }).where(eq(nodes.id, 'r')).run();
    const saida = await recomputarTudo(bd, UID);

    expect(saida).toEqual({ nos: 6, raizes: 1 });
    expect((await ler('r')).progress).toBeCloseTo(incremental, 6);
  });

  it('a gravacao em lote nao embaralha os valores entre os nos', async () => {
    await arvore();
    await recalcularImpacto(bd, 'r');
    // a1 e b1 tem peso igual mas ramos de tamanhos diferentes: se o lote
    // agrupasse errado, os dois sairiam com o mesmo numero.
    expect((await ler('a1')).root_impact).not.toBeCloseTo((await ler('b1')).root_impact, 6);
  });
});
