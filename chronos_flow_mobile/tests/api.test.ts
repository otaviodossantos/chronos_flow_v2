import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { users } from '@db/schema';
import { bancoDeTeste, desligar } from './apoio/bancoDeTeste';
import { api, ApiError } from '../src/lib/api';
import type { BD } from '../src/data/conexao';

/**
 * O shim e a unica coisa que as telas enxergam. Se ele mente sobre o formato
 * de um retorno, a tela quebra no aparelho e nao aqui — por isso o teste
 * exercita a superficie inteira pelos mesmos nomes que o desktop usava.
 */
let bd: BD;
const UID = 'u1';

beforeEach(async () => {
  bd = bancoDeTeste().bd;
  await bd.insert(users).values({ id: UID, name: 'Voce', birth_date: new Date(0) }).run();
});
afterEach(() => desligar());

describe('arvore', () => {
  it('cria, lista e detalha sem passar por HTTP', async () => {
    const raiz = await api.createNode({ title: 'Projeto' });
    const filha = await api.createNode({
      title: 'Etapa', parent_id: raiz.id, estimated_minutes: 60,
    });

    const arvore = await api.tree({});
    expect(arvore.map((n) => n.title).sort()).toEqual(['Etapa', 'Projeto']);

    const filhas = await api.children(raiz.id);
    expect(filhas).toHaveLength(1);
    expect(filhas[0].id).toBe(filha.id);

    const detalhe = await api.nodeDetail(raiz.id);
    expect(detalhe.node.id).toBe(raiz.id);
    expect(detalhe.children).toHaveLength(1);
    expect(detalhe.descendants).toBe(1);
    expect(Array.isArray(detalhe.activity)).toBe(true);
  });

  it('respeita o filtro de profundidade da query', async () => {
    const raiz = await api.createNode({ title: 'Raiz' });
    const meio = await api.createNode({ title: 'Meio', parent_id: raiz.id });
    await api.createNode({ title: 'Folha', parent_id: meio.id });

    const rasa = await api.tree({ maxDepth: 1 });
    expect(rasa.map((n) => n.title).sort()).toEqual(['Meio', 'Raiz']);
  });

  it('conclui, reabre e move', async () => {
    const raiz = await api.createNode({ title: 'Raiz' });
    const a = await api.createNode({ title: 'A', parent_id: raiz.id, estimated_minutes: 60 });
    const outra = await api.createNode({ title: 'Outra raiz' });

    const fim = await api.completeNode(a.id);
    expect(fim.node.status).toBe('COMPLETED');

    const volta = await api.reopenNode(a.id);
    expect(volta.node.status).not.toBe('COMPLETED');

    const movida = await api.moveNode(a.id, outra.id);
    expect(movida.parent_id).toBe(outra.id);
    expect(movida.depth).toBe(1);
  });

  it('quebra em filhas e exclui a subarvore inteira', async () => {
    const raiz = await api.createNode({ title: 'Raiz' });
    const { children } = await api.breakdown(raiz.id, {
      children: [{ title: 'Um' }, { title: 'Dois' }],
    });
    expect(children).toHaveLength(2);

    const apagado = await api.deleteNode(raiz.id);
    expect(apagado.deleted).toBe(true);
    expect(apagado.removed).toBe(3);
    expect(await api.tree({})).toHaveLength(0);
  });

  it('devolve o plano do reagendamento no formato que a timeline espera', async () => {
    const raiz = await api.createNode({ title: 'Raiz' });
    const a = await api.createNode({ title: 'A', parent_id: raiz.id, estimated_minutes: 60 });

    const r = await api.reschedule(a.id, { start_date: new Date(Date.now() + 86_400_000).toISOString() });
    expect(r).toHaveProperty('applied');
    expect(r.plan).toHaveProperty('affected');
    expect(Array.isArray(r.plan.violations)).toBe(true);
  });
});

describe('espacos, equipe e modelos', () => {
  it('cria espaco, vincula membro e desvincula', async () => {
    const espaco = await api.createSpace({ name: 'Turisky' });
    const membro = await api.createMember({ name: 'Henrique' });

    await api.addMemberToSpace(espaco.id, membro.id);
    const lista = await api.spaces();
    expect(lista.map((e) => e.name)).toContain('Turisky');

    await api.removeMemberFromSpace(espaco.id, membro.id);
    expect((await api.members()).map((m) => m.name)).toContain('Henrique');
  });

  it('marca os espacos na ficha do membro, e desmarcar tira', async () => {
    // O bug: `space_ids` nao e coluna de `members`, e ia direto para o `set()`
    // do Drizzle, que descarta chave desconhecida em silencio. Salvar parecia
    // funcionar e o membro continuava sem espaco nenhum.
    const a = await api.createSpace({ name: 'Produto' });
    const b = await api.createSpace({ name: 'Operacoes' });

    const criado = await api.createMember({ name: 'Mariana', space_ids: [a.id, b.id] });
    expect(criado.spaces?.map((e) => e.name).sort()).toEqual(['Operacoes', 'Produto']);

    // E a lista da tela enxerga os dois, nao so o retorno da gravacao.
    const naLista = (await api.members()).find((m) => m.id === criado.id);
    expect(naLista?.spaces?.map((e) => e.name).sort()).toEqual(['Operacoes', 'Produto']);

    const trocado = await api.updateMember(criado.id, { space_ids: [a.id] });
    expect(trocado.spaces?.map((e) => e.name)).toEqual(['Produto']);

    // Lista vazia e uma decisao, nao ausencia: tira de todos os espacos.
    expect((await api.updateMember(criado.id, { space_ids: [] })).spaces).toEqual([]);

    // Sem a chave, os espacos nao se mexem — editar so o nome nao pode
    // desvincular ninguem.
    await api.updateMember(criado.id, { space_ids: [b.id] });
    const soNome = await api.updateMember(criado.id, { name: 'Mariana A.' });
    expect(soNome.name).toBe('Mariana A.');
    expect(soNome.spaces?.map((e) => e.name)).toEqual(['Operacoes']);
  });

  it('nao guarda email vazio como string, para nao confundir duas pessoas sem email', async () => {
    const m = await api.createMember({ name: 'Sem email', email: '' });
    expect(m.email).toBeNull();
    expect((await api.updateMember(m.id, { email: '' })).email).toBeNull();
  });

  it('instancia um modelo como tarefa de verdade', async () => {
    const espaco = await api.createSpace({ name: 'Casa' });
    const modelo = await api.createTemplate({
      title: 'Checklist', estimated_minutes: 30, space_id: espaco.id,
    });
    expect((await api.templates()).map((t) => t.title)).toContain('Checklist');

    const { node } = await api.instantiateTemplate(modelo.id, {});
    expect(node.title).toBe('Checklist');

    await api.updateTemplate(modelo.id, { title: 'Checklist v2' });
    await api.deleteTemplate(modelo.id);
    expect(await api.templates()).toHaveLength(0);
  });
});

describe('foco, dependencias e relatorios', () => {
  it('monta a fila com impedimentos', async () => {
    const raiz = await api.createNode({ title: 'Raiz' });
    const a = await api.createNode({ title: 'A', parent_id: raiz.id, estimated_minutes: 60 });
    const b = await api.createNode({ title: 'B', parent_id: raiz.id, estimated_minutes: 60 });

    await api.createDependency(a.id, b.id);

    const fila = await api.focusQueue({ scope: 'all' });
    expect(Array.isArray(fila.queue)).toBe(true);
    expect(fila.impediments.map((i) => i.node.id)).toContain(b.id);
    expect(typeof fila.completedToday).toBe('number');

    const sim = await api.simulate([a.id]);
    expect(sim.projections[0].rootId).toBe(raiz.id);
  });

  it('entrega velocidade, risco, historico e vida', async () => {
    const raiz = await api.createNode({ title: 'Raiz' });
    await api.createNode({ title: 'A', parent_id: raiz.id, estimated_minutes: 60 });

    expect(await api.velocity()).toHaveProperty('avgRootProgress');
    expect((await api.riskMap()).roots.map((r) => r.id)).toContain(raiz.id);
    expect(await api.progressHistory(7)).toHaveProperty('series');
    expect(await api.life()).toHaveProperty('weeksLived');
  });
});

describe('backlog', () => {
  const plano = {
    summary: 'Plano',
    tasks: [
      { title: 'Descobrir', estimated_minutes: 120, ref: 't1' },
      { title: 'Construir', estimated_minutes: 240, ref: 't2', depends_on: ['t1'] },
    ],
    roles: [{ title: 'Dev', hours_per_week: 20, headcount: 1 }],
  };

  it('guarda e devolve o limite de tarefas, inclusive para tirar', async () => {
    // O limite atravessa o schema Zod, o SQLite e o DTO. Zod descarta chave
    // que nao esta no schema em silencio, entao "o campo some no caminho" e
    // uma falha que nao faz barulho nenhum ate alguem reparar que a IA
    // ignorou o teto.
    const item = await api.createBacklog({ title: 'Abrir filial', max_tasks: 10 });
    expect(item.max_tasks).toBe(10);
    expect((await api.backlog()).find((b) => b.id === item.id)?.max_tasks).toBe(10);

    expect((await api.updateBacklog(item.id, { max_tasks: 20 })).max_tasks).toBe(20);
    expect((await api.updateBacklog(item.id, { max_tasks: null })).max_tasks).toBeNull();

    // Sem limite e o padrao de quem nunca escolheu nenhum.
    expect((await api.createBacklog({ title: 'Sem teto' })).max_tasks).toBeNull();
  });

  it('guarda o rascunho e aplica virando arvore encadeada', async () => {
    const item = await api.createBacklog({ title: 'Lancar o app' });
    expect((await api.backlog()).map((b) => b.title)).toContain('Lancar o app');

    await api.updateBacklog(item.id, { notes: 'com pressa' });
    const salvo = await api.saveBacklogPlan(item.id, plano as never);
    expect(salvo.ai_plan).not.toBeNull();

    const r = await api.applyBacklogPlan(item.id, { plan: plano as never });
    expect(r.nodesCreated).toBeGreaterThanOrEqual(2);
    expect(r.dependencies).toBe(1);
    expect(typeof r.fimPrevisto).toBe('string');
    expect(typeof r.atrasaEntrega).toBe('boolean');

    // O encadeamento e o ponto: a segunda tarefa nao pode comecar junto.
    const criadas = (await api.tree({ rootId: r.rootId })).filter((n) => n.depth === 1);
    const inicios = new Set(criadas.map((n) => n.start_date));
    expect(inicios.size).toBe(2);
  });

  it('recusa aplicar um plano sem nenhuma tarefa mantida', async () => {
    const item = await api.createBacklog({ title: 'Vazio' });
    const tudoDescartado = {
      ...plano,
      tasks: plano.tasks.map((t) => ({ ...t, keep: false })),
    };
    await expect(api.applyBacklogPlan(item.id, { plan: tudoDescartado as never })).rejects.toThrow(
      ApiError,
    );
  });

  it('exclui o item', async () => {
    const item = await api.createBacklog({ title: 'Some' });
    await api.deleteBacklog(item.id);
    expect(await api.backlog()).toHaveLength(0);
  });
});

describe('usuario e ajustes', () => {
  it('le e atualiza o perfil sem jamais devolver a chave', async () => {
    const perfil = await api.user();
    expect(perfil.name).toBe('Voce');

    await api.updateUser({ name: 'Henrique', daily_focus_goal_minutes: 300 });
    expect((await api.user()).daily_focus_goal_minutes).toBe(300);

    await api.updateAiSettings({ gemini_api_key: 'abcd1234efgh5678' });
    const ajustes = await api.aiSettings();
    expect(ajustes.configured).toBe(true);
    expect(ajustes.maskedKey).toBe('abcd••••••••5678');
    expect(ajustes.maskedKey).not.toContain('1234efgh');
  });

  it('recomputa, resume e zera', async () => {
    const raiz = await api.createNode({ title: 'Raiz' });
    await api.createNode({ title: 'A', parent_id: raiz.id, estimated_minutes: 60 });

    const r = await api.recompute();
    expect(r.nodes).toBe(2);
    expect(r.roots).toBe(1);

    const resumo = await api.dataSummary();
    expect(resumo.nodes).toBe(2);
    expect(resumo.staleClient).toEqual([]);

    const zerado = await api.resetAll('APAGAR TUDO', false);
    expect(zerado.reset).toBe(true);
    expect(zerado.deleted.nodes).toBe(2);
    expect(await api.tree({})).toHaveLength(0);
  });
});

describe('erros', () => {
  it('traduz schema invalido em VALIDATION_FAILED', async () => {
    await expect(api.createNode({ title: '' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('traduz tarefa inexistente em NOT_FOUND', async () => {
    await expect(api.nodeDetail('nao-existe')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('nao chama o Gemini sem chave configurada', async () => {
    const item = await api.createBacklog({ title: 'Sem chave' });
    await expect(api.planBacklog(item.id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('recusa a frase errada no reset', async () => {
    await expect(api.resetAll('apagar', false)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
