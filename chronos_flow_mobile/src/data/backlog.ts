import { and, asc, eq, desc } from 'drizzle-orm';
import { backlogItems, backlogRoles, members, nodes } from '@db/schema';
import { buildPath } from '@core/path';
import { weightFromEstimate } from '@core/cascade';
import { janelasDoPlano, envelope } from '@core/agenda';
import { findCycle } from '@core/dependencies';
import type { AiPlan, PlanTask } from '@shared/schemas/index';
import { bd as banco, emTransacao } from './conexao';
import { parseDate } from './serializar';
import { NaoEncontrado, ErroDeRegra, proximaPosicao } from './repositorio';
import { propagarDe, recontarFolhas, recalcularImpacto } from './cascata';
import { nodeDependencies } from '@db/schema';

const novoId = () => crypto.randomUUID();

async function comPapeis(userId: string, id?: string) {
  const bd = banco();
  const itens = await bd
    .select()
    .from(backlogItems)
    .where(id ? eq(backlogItems.id, id) : eq(backlogItems.user_id, userId))
    .orderBy(asc(backlogItems.status), asc(backlogItems.position))
    .all();
  if (itens.length === 0) return [];

  const papeis = await bd
    .select({
      p: backlogRoles,
      membroId: members.id, membroNome: members.name, membroCor: members.color,
    })
    .from(backlogRoles)
    .leftJoin(members, eq(members.id, backlogRoles.member_id))
    .orderBy(asc(backlogRoles.position))
    .all();

  return itens.map((b) => ({
    id: b.id,
    title: b.title,
    notes: b.notes,
    context: b.context,
    status: b.status,
    position: b.position,
    space_id: b.space_id,
    start_date: b.start_date ? b.start_date.toISOString() : null,
    target_date: b.target_date ? b.target_date.toISOString() : null,
    max_tasks: b.max_tasks ?? null,
    ai_plan: b.ai_plan ?? null,
    ai_model: b.ai_model,
    ai_planned_at: b.ai_planned_at ? b.ai_planned_at.toISOString() : null,
    converted_node_id: b.converted_node_id,
    roles: papeis
      .filter((r) => r.p.backlog_item_id === b.id)
      .map((r) => ({
        id: r.p.id,
        title: r.p.title,
        description: r.p.description,
        hours_per_week: r.p.hours_per_week,
        headcount: r.p.headcount,
        member_id: r.p.member_id,
        member: r.membroId ? { id: r.membroId, name: r.membroNome, color: r.membroCor } : null,
      })),
    created_at: b.created_at.toISOString(),
  }));
}

export const listar = (userId: string) => comPapeis(userId);

async function um(userId: string, id: string) {
  const achado = (await comPapeis(userId, id))[0];
  if (!achado) throw new NaoEncontrado('Item do backlog');
  return achado;
}

export async function criar(userId: string, dados: Record<string, unknown>) {
  const bd = banco();
  const ultimo = await bd.select({ position: backlogItems.position }).from(backlogItems)
    .where(eq(backlogItems.user_id, userId)).orderBy(desc(backlogItems.position)).limit(1).get();

  const id = novoId();
  await bd.insert(backlogItems).values({
    id,
    user_id: userId,
    title: dados.title as string,
    notes: (dados.notes as string) ?? null,
    context: (dados.context as string) ?? null,
    space_id: (dados.space_id as string) ?? null,
    start_date: parseDate(dados.start_date),
    target_date: parseDate(dados.target_date),
    max_tasks: (dados.max_tasks as number) ?? null,
    position: (dados.position as number) ?? (ultimo?.position ?? -1) + 1,
  }).run();

  return um(userId, id);
}

export async function atualizar(userId: string, id: string, dados: Record<string, unknown>) {
  const bd = banco();
  const limpos: Record<string, unknown> = { ...dados };
  if ('start_date' in dados) limpos.start_date = parseDate(dados.start_date);
  if ('target_date' in dados) limpos.target_date = parseDate(dados.target_date);

  await bd.update(backlogItems).set(limpos).where(eq(backlogItems.id, id)).run();
  return um(userId, id);
}

export async function excluir(id: string) {
  const bd = banco();
  await bd.delete(backlogItems).where(eq(backlogItems.id, id)).run();
  return { deleted: true };
}

/**
 * Guarda o rascunho como ele esta na tela — tarefas e papeis descartados
 * inclusive. `ai_planned_at` nao e tocado de proposito: e por essa marca que a
 * tela decide descartar o rascunho local, e mexer nela faria cada salvamento
 * jogar fora a edicao em curso.
 */
export async function salvarPlano(userId: string, id: string, plan: AiPlan) {
  const bd = banco();
  const existe = await bd.select({ id: backlogItems.id }).from(backlogItems)
    .where(eq(backlogItems.id, id)).get();
  if (!existe) throw new NaoEncontrado('Item do backlog');

  await bd.update(backlogItems).set({ ai_plan: plan }).where(eq(backlogItems.id, id)).run();
  return um(userId, id);
}

export async function guardarRascunhoDaIA(
  userId: string, id: string, plan: AiPlan, modelo: string,
) {
  const bd = banco();
  await bd.update(backlogItems)
    .set({ ai_plan: plan, ai_model: modelo, ai_planned_at: new Date(), status: 'PLANNING' })
    .where(eq(backlogItems.id, id)).run();
  return um(userId, id);
}

export async function definirMembroDoPapel(userId: string, roleId: string, memberId: string | null) {
  const bd = banco();
  await bd.update(backlogRoles).set({ member_id: memberId })
    .where(eq(backlogRoles.id, roleId)).run();

  const papel = await bd.select().from(backlogRoles).where(eq(backlogRoles.id, roleId)).get();
  if (!papel) throw new NaoEncontrado('Papel');
  return um(userId, papel.backlog_item_id);
}

interface NoDoPlano {
  id: string;
  parentId: string;
  parentPath: string;
  depth: number;
  position: number;
  task: PlanTask;
  folha: boolean;
}

/** Transforma o rascunho numa arvore de verdade. */
export async function aplicar(
  userId: string,
  id: string,
  corpo: { plan: AiPlan; space_id?: string | null; start_date?: string | null; importance?: number; applyDependencies?: boolean },
) {
  const bd = banco();
  const item = await bd.select().from(backlogItems).where(eq(backlogItems.id, id)).get();
  if (!item) throw new NaoEncontrado('Item do backlog');

  const mantidas = corpo.plan.tasks.filter((t) => t.keep !== false);
  if (mantidas.length === 0) {
    throw new ErroDeRegra('VALIDATION_FAILED', 'Nenhuma tarefa marcada para criar.');
  }

  const inicio = parseDate(corpo.start_date) ?? item.start_date ?? new Date();
  inicio.setHours(9, 0, 0, 0);
  const entrega = item.target_date ?? null;

  const papelParaAgenda = new Map<string, string>();
  for (const papel of corpo.plan.roles) {
    if (papel.keep !== false && papel.member_id) papelParaAgenda.set(papel.title, papel.member_id);
  }

  const rootId = novoId();
  const plano: NoDoPlano[] = [];
  const refParaId = new Map<string, string>();

  const achatar = (tasks: PlanTask[], parentId: string, parentPath: string, depth: number) => {
    let position = 0;
    for (const task of tasks) {
      if (task.keep === false) continue;
      const noId = novoId();
      const filhas = (task.children ?? []).filter((c) => c.keep !== false);
      plano.push({ id: noId, parentId, parentPath, depth, position, task, folha: filhas.length === 0 });
      position += 1;
      if (task.ref) refParaId.set(task.ref, noId);
      if (filhas.length > 0) achatar(filhas, noId, buildPath(parentPath, noId), depth + 1);
    }
  };
  achatar(mantidas, rootId, rootId, 1);

  // As dependencias entram no agendamento, entao sao resolvidas antes dele.
  const arestas: Array<{ blocker_id: string; blocked_id: string }> = [];
  if (corpo.applyDependencies !== false) {
    for (const no of plano) {
      for (const ref of no.task.depends_on ?? []) {
        const blockerId = refParaId.get(ref);
        if (!blockerId || blockerId === no.id) continue;
        if (findCycle(arestas, blockerId, no.id)) continue;
        arestas.push({ blocker_id: blockerId, blocked_id: no.id });
      }
    }
  }

  const janelas = janelasDoPlano(
    plano.map((no) => ({
      id: no.id, parentId: no.parentId, folha: no.folha,
      estimated_minutes: no.task.estimated_minutes,
      duration_days: no.task.duration_days,
      offset_days: no.task.offset_days,
      role: no.task.role,
      depends_on: no.task.depends_on,
    })),
    { inicio, refParaId, papelParaAgenda },
  );

  // Sem cortar nada para caber: um plano que estoura a entrega precisa
  // aparecer estourado, e nao amontoado na data limite.
  const fimPrevisto = envelope([...janelas.values()])?.due_date ?? inicio;
  const atrasaEntrega = Boolean(entrega && fimPrevisto > entrega);

  const resultado = await emTransacao(async (tx) => {
    const ultimaRaiz = await proximaPosicao(tx, null, userId);

    await tx.insert(nodes).values({
      id: rootId,
      user_id: userId,
      space_id: corpo.space_id ?? item.space_id ?? null,
      parent_id: null,
      path: rootId,
      depth: 0,
      position: ultimaRaiz,
      title: item.title,
      description: corpo.plan.summary ?? item.notes ?? null,
      importance: corpo.importance ?? 4,
      root_impact: 1,
      start_date: inicio,
      due_date: entrega ?? fimPrevisto,
      all_day: true,
    }).run();

    // Pre-ordem: a mae sempre foi empilhada antes das filhas.
    for (const no of plano) {
      const janela = janelas.get(no.id)!;
      await tx.insert(nodes).values({
        id: no.id,
        user_id: userId,
        space_id: corpo.space_id ?? item.space_id ?? null,
        parent_id: no.parentId,
        path: buildPath(no.parentPath, no.id),
        depth: no.depth,
        position: no.position,
        title: no.task.title,
        description: no.task.detail ?? null,
        importance: corpo.importance ?? 4,
        weight: weightFromEstimate(no.task.estimated_minutes),
        estimated_minutes: no.task.estimated_minutes ?? null,
        start_date: janela.start_date,
        due_date: janela.due_date,
        all_day: false,
        assignee_id: no.task.role ? (papelParaAgenda.get(no.task.role) ?? null) : null,
        leaf_count: 1,
      }).run();
    }

    for (const aresta of arestas) {
      await tx.insert(nodeDependencies).values({ id: novoId(), ...aresta }).run();
    }
    if (arestas.length > 0) {
      const bloqueadas = [...new Set(arestas.map((e) => e.blocked_id))];
      for (const bid of bloqueadas) {
        await tx.update(nodes).set({ status: 'BLOCKED' })
          .where(and(eq(nodes.id, bid), eq(nodes.status, 'PENDING'))).run();
      }
    }

    await propagarDe(tx, rootId);
    await recontarFolhas(tx, rootId);
    await recalcularImpacto(tx, rootId);

    // Papeis sobrevivem ao rascunho: sao o que voce vai preencher com gente.
    await tx.delete(backlogRoles).where(eq(backlogRoles.backlog_item_id, item.id)).run();
    const papeis = corpo.plan.roles.filter((r) => r.keep !== false);
    for (const [i, papel] of papeis.entries()) {
      await tx.insert(backlogRoles).values({
        id: novoId(),
        backlog_item_id: item.id,
        title: papel.title,
        description: papel.description ?? null,
        hours_per_week: papel.hours_per_week ?? null,
        headcount: papel.headcount ?? 1,
        member_id: papel.member_id ?? null,
        position: i,
      }).run();
    }

    await tx.update(backlogItems)
      .set({ status: 'CONVERTED', converted_node_id: rootId })
      .where(eq(backlogItems.id, item.id)).run();

    return { created: plano.length + 1, roles: papeis.length, dependencies: arestas.length };
  });

  return {
    item: await um(userId, id),
    rootId,
    nodesCreated: resultado.created,
    roles: resultado.roles,
    dependencies: resultado.dependencies,
    fimPrevisto: fimPrevisto.toISOString(),
    atrasaEntrega,
  };
}
