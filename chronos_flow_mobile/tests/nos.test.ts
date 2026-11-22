import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { nodeDependencies, nodes, spaces, users } from '@db/schema';
import { bancoDeTeste, desligar } from './apoio/bancoDeTeste';
import * as servico from '../src/data/nos';
import type { BD } from '../src/data/conexao';

let bd: BD;
const UID = 'u1';

beforeEach(async () => {
  bd = bancoDeTeste().bd;
  await bd.insert(users).values({ id: UID, name: 'Voce', birth_date: new Date(0) }).run();
});
afterEach(() => desligar());

const ler = async (id: string) => (await bd.select().from(nodes).where(eq(nodes.id, id)).get())!;

async function projeto() {
  const raiz = await servico.criar(UID, { title: 'Projeto' } as never);
  const bloco = await servico.criar(UID, { title: 'Bloco', parent_id: raiz.id } as never);
  const a = await servico.criar(UID, {
    title: 'A', parent_id: bloco.id, estimated_minutes: 60,
  } as never);
  const b = await servico.criar(UID, {
    title: 'B', parent_id: bloco.id, estimated_minutes: 180,
  } as never);
  return { raiz, bloco, a, b };
}

describe('criar', () => {
  it('a raiz nasce com impacto 1 e caminho proprio', async () => {
    const raiz = await servico.criar(UID, { title: 'Meta' } as never);
    expect(raiz.path).toBe(raiz.id);
    expect(raiz.depth).toBe(0);
    expect((await ler(raiz.id)).root_impact).toBe(1);
  });

  it('a filha herda espaco e importancia, e monta o caminho sob a mae', async () => {
    const raiz = await servico.criar(UID, { title: 'Meta', importance: 5 } as never);
    const filha = await servico.criar(UID, { title: 'Sub', parent_id: raiz.id } as never);
    expect(filha.path).toBe(`${raiz.id}/${filha.id}`);
    expect(filha.depth).toBe(1);
    expect(filha.importance).toBe(5);
  });

  it('nasce com janela de uma hora e horario, nao dia inteiro', async () => {
    const n = await servico.criar(UID, { title: 'Tarefa' } as never);
    expect(n.all_day).toBe(false);
    const minutos = (new Date(n.due_date!).getTime() - new Date(n.start_date!).getTime()) / 60000;
    expect(minutos).toBe(60);
  });

  it('a estimativa manda na duracao e no peso', async () => {
    const n = await servico.criar(UID, { title: 'T', estimated_minutes: 45 } as never);
    const minutos = (new Date(n.due_date!).getTime() - new Date(n.start_date!).getTime()) / 60000;
    expect(minutos).toBe(45);
    expect(n.weight).toBeGreaterThan(1);
  });

  it('a mae deixa de ser folha e perde o progresso manual', async () => {
    const raiz = await servico.criar(UID, { title: 'M' } as never);
    await bd.update(nodes).set({ manual_progress: 50 }).where(eq(nodes.id, raiz.id)).run();
    await servico.criar(UID, { title: 'F', parent_id: raiz.id } as never);
    expect((await ler(raiz.id)).manual_progress).toBeNull();
  });

  /**
   * O caso que pegou um bug de verdade na camada de conexao: buscar por um id
   * que nao existe tem de devolver nada, nao um objeto com campos vazios.
   */
  it('pai inexistente e recusado', async () => {
    await expect(
      servico.criar(UID, { title: 'X', parent_id: 'nao-existe' } as never),
    ).rejects.toThrow(/nao encontrad/i);
  });
});

describe('arvore e detalhe', () => {
  it('respeita a profundidade pedida', async () => {
    await projeto();
    const rasa = await servico.arvore(UID, { maxDepth: 1 } as never);
    expect(rasa.every((n) => n.depth <= 1)).toBe(true);
    const funda = await servico.arvore(UID, { maxDepth: 5 } as never);
    expect(funda).toHaveLength(4);
  });

  it('marca folha e conta filhos', async () => {
    const { bloco, a } = await projeto();
    const todos = await servico.arvore(UID, { maxDepth: 5 } as never);
    expect(todos.find((n) => n.id === bloco.id)!.childCount).toBe(2);
    expect(todos.find((n) => n.id === a.id)!.isLeaf).toBe(true);
  });

  it('o detalhe traz ancestrais, filhas e o tamanho do ramo', async () => {
    const { raiz, bloco } = await projeto();
    const d = await servico.detalhe(bloco.id);
    expect(d.ancestors.map((a) => a.id)).toEqual([raiz.id]);
    expect(d.children).toHaveLength(2);
    expect(d.descendants).toBe(2);
    expect(d.activity.length).toBeGreaterThan(0);
  });

  it('busca por titulo ignora caixa', async () => {
    await servico.criar(UID, { title: 'Relatorio Mensal' } as never);
    const achados = await servico.arvore(UID, { maxDepth: 5, search: 'mensal' } as never);
    expect(achados).toHaveLength(1);
  });
});

describe('atualizar', () => {
  it('o fim acompanha a estimativa numa folha com horario', async () => {
    const { a } = await projeto();
    const novo = await servico.atualizar(UID, a.id, { estimated_minutes: 120 } as never);
    const minutos =
      (new Date(novo.due_date!).getTime() - new Date(novo.start_date!).getTime()) / 60000;
    expect(minutos).toBe(120);
  });

  it('num no com filhas a estimativa nao move a janela', async () => {
    const { bloco } = await projeto();
    const antes = (await ler(bloco.id)).due_date;
    await servico.atualizar(UID, bloco.id, { estimated_minutes: 999 } as never);
    expect((await ler(bloco.id)).due_date).toEqual(antes);
  });

  it('progresso manual e recusado em no com filhas', async () => {
    const { bloco } = await projeto();
    await expect(
      servico.atualizar(UID, bloco.id, { manual_progress: 50 } as never),
    ).rejects.toThrow(/cascata/i);
  });

  it('concluir uma mae com filha pendente e recusado', async () => {
    const { bloco } = await projeto();
    await expect(
      servico.atualizar(UID, bloco.id, { status: 'COMPLETED' } as never),
    ).rejects.toThrow(/pendente/i);
  });

  it('trocar o espaco leva o ramo inteiro', async () => {
    const { raiz, a, b } = await projeto();
    await bd.insert(spaces).values({ id: 'e1', user_id: UID, name: 'Trabalho' }).run();

    await servico.atualizar(UID, raiz.id, { space_id: 'e1' } as never);

    expect((await ler(raiz.id)).space_id).toBe('e1');
    expect((await ler(a.id)).space_id).toBe('e1');
    expect((await ler(b.id)).space_id).toBe('e1');
  });
});

describe('concluir e reabrir', () => {
  it('concluir a folha sobe a cascata e informa o impacto', async () => {
    const { raiz, bloco, b } = await projeto();
    const r = await servico.concluir(UID, b.id);

    expect(r.node.status).toBe('COMPLETED');
    expect((await ler(bloco.id)).progress).toBeCloseTo(75, 5);
    expect(r.cascade.map((c) => c.id)).toContain(raiz.id);
    expect(r.impact.deltaPercent).toBeGreaterThan(0);
  });

  it('reabrir derruba o progresso e reabre os ancestrais concluidos', async () => {
    const { raiz, a, b } = await projeto();
    await servico.concluir(UID, a.id);
    await servico.concluir(UID, b.id);
    expect((await ler(raiz.id)).progress).toBeCloseTo(100, 5);

    await bd.update(nodes).set({ status: 'COMPLETED' }).where(eq(nodes.id, raiz.id)).run();
    const r = await servico.reabrir(UID, b.id);

    expect((await ler(b.id)).status).toBe('PENDING');
    expect(r.reopenedAncestors.map((x) => x.id)).toContain(raiz.id);
    expect((await ler(raiz.id)).status).toBe('IN_PROGRESS');
  });

  it('reabrir o que nao esta concluido e recusado', async () => {
    const { a } = await projeto();
    await expect(servico.reabrir(UID, a.id)).rejects.toThrow(/nao esta concluida/i);
  });
});

describe('dependencias', () => {
  it('bloqueada por outra nao conclui', async () => {
    const { a, b } = await projeto();
    await bd.insert(nodeDependencies)
      .values({ id: 'd1', blocker_id: a.id, blocked_id: b.id }).run();

    await expect(servico.concluir(UID, b.id)).rejects.toThrow(/bloqueada/i);
  });

  it('concluir o bloqueador libera quem esperava', async () => {
    const { a, b } = await projeto();
    await bd.insert(nodeDependencies)
      .values({ id: 'd1', blocker_id: a.id, blocked_id: b.id }).run();
    await bd.update(nodes).set({ status: 'BLOCKED' }).where(eq(nodes.id, b.id)).run();

    const r = await servico.concluir(UID, a.id);
    expect(r.unblocked.map((u) => u.id)).toContain(b.id);
    expect((await ler(b.id)).status).toBe('PENDING');
  });
});

describe('mover', () => {
  it('reescreve o caminho do ramo inteiro', async () => {
    const { raiz, bloco, a } = await projeto();
    const outro = await servico.criar(UID, { title: 'Outro', parent_id: raiz.id } as never);

    await servico.mover(UID, bloco.id, outro.id);

    expect((await ler(bloco.id)).path).toBe(`${raiz.id}/${outro.id}/${bloco.id}`);
    expect((await ler(a.id)).path).toBe(`${raiz.id}/${outro.id}/${bloco.id}/${a.id}`);
    expect((await ler(a.id)).depth).toBe(3);
  });

  it('mover para dentro de si mesmo e recusado', async () => {
    const { bloco, a } = await projeto();
    await expect(servico.mover(UID, bloco.id, a.id)).rejects.toThrow(/dentro de si/i);
  });

  it('as irmas ficam numeradas sem buracos nem empates', async () => {
    const raiz = await servico.criar(UID, { title: 'R' } as never);
    const x = await servico.criar(UID, { title: 'X', parent_id: raiz.id } as never);
    const y = await servico.criar(UID, { title: 'Y', parent_id: raiz.id } as never);
    const z = await servico.criar(UID, { title: 'Z', parent_id: raiz.id } as never);

    await servico.mover(UID, z.id, raiz.id, 0);

    const pos = await Promise.all([z, x, y].map(async (n) => (await ler(n.id)).position));
    expect(pos).toEqual([0, 1, 2]);
  });
});

describe('excluir', () => {
  it('leva a subarvore e conta o que levou', async () => {
    const { bloco } = await projeto();
    const r = await servico.excluir(bloco.id);
    expect(r).toEqual({ deleted: true, removed: 3 });
    expect(await bd.select().from(nodes).all()).toHaveLength(1);
  });

  it('o progresso de quem fica e recalculado', async () => {
    const { raiz, bloco, a, b } = await projeto();
    const solta = await servico.criar(UID, { title: 'Solta', parent_id: raiz.id } as never);
    await servico.concluir(UID, solta.id);

    await servico.excluir(bloco.id);
    void a; void b;
    // Sobrou so a tarefa concluida sob a raiz.
    expect((await ler(raiz.id)).progress).toBeCloseTo(100, 5);
  });
});

describe('reagendar', () => {
  it('mover a mae leva as filhas junto', async () => {
    const { bloco, a } = await projeto();
    const antes = (await ler(a.id)).start_date!.getTime();
    const inicio = (await ler(bloco.id)).start_date!;
    const fim = (await ler(bloco.id)).due_date!;

    await servico.reagendar(bloco.id, {
      start_date: new Date(inicio.getTime() + 86_400_000).toISOString(),
      due_date: new Date(fim.getTime() + 86_400_000).toISOString(),
      cascadeChildren: true,
    } as never);

    expect((await ler(a.id)).start_date!.getTime()).toBeGreaterThan(antes);
  });

  it('dryRun nao grava nada', async () => {
    const { bloco } = await projeto();
    const antes = (await ler(bloco.id)).start_date;
    const r = await servico.reagendar(bloco.id, {
      start_date: new Date(2030, 0, 1).toISOString(), dryRun: true,
    } as never);

    expect(r.applied).toBe(false);
    expect((await ler(bloco.id)).start_date).toEqual(antes);
  });

  it('arrastar a borda de uma folha reescreve a estimativa', async () => {
    const { a } = await projeto();
    const inicio = (await ler(a.id)).start_date!;
    await servico.reagendar(a.id, {
      start_date: inicio.toISOString(),
      due_date: new Date(inicio.getTime() + 3 * 3600_000).toISOString(),
    } as never);
    expect((await ler(a.id)).estimated_minutes).toBe(180);
  });
});
