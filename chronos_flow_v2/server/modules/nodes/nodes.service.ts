import { randomUUID } from 'node:crypto';
import { prisma, type Tx } from '../../db/client.js';
import { AppError, notFound } from '../../lib/errors.js';
import { num, parseDate, toNodeDTO } from '../../lib/serialize.js';
import {
  buildPath,
  rebasePath,
  isDescendantOf,
  rootIdOf,
  ancestorIdsBottomUp,
} from '../../domain/path.js';
import { canComplete, weightFromEstimate, statusAfterReopen } from '../../domain/cascade.js';
import { stepsToStatus } from '../../domain/status.js';
import { blockedNodeIds, newlyUnblocked } from '../../domain/dependencies.js';
import {
  janelaDeCriacao,
  validateAgainstParent,
  planReschedule,
  grownWindow,
} from '../../domain/scheduling.js';
import {
  propagateFrom,
  refreshOwnProgress,
  refreshLeafCounts,
  refreshRootImpact,
} from './cascade.service.js';
import * as repo from './nodes.repository.js';
import { assinaturaDoAdmin } from '../../lib/sessao.js';
import type {
  CreateNodeInput,
  UpdateNodeInput,
  BreakdownInput,
  RescheduleInput,
  SetStatusInput,
  TreeQuery,
} from '../../../shared/schemas/index.js';
import type {
  CompleteResult,
  NodeDTO,
  ReopenResult,
  SetStatusResult,
} from '../../../shared/types.js';

async function logActivity(tx: Tx, nodeId: string, kind: string, message: string) {
  // Admin no espaco de outra conta: a atividade fica no nome dele.
  const admin = assinaturaDoAdmin();
  await tx.nodeActivity.create({
    data: { node_id: nodeId, kind, message, ...(admin ? { actor: admin } : {}) },
  });
}

/** Marca em BLOCKED / desbloqueia os nos afetados por uma mudanca de status. */
async function syncBlockedStatus(tx: Tx, userId: string, touchedIds: string[]) {
  const edges = await tx.nodeDependency.findMany({
    where: { blocked: { user_id: userId } },
    select: { blocker_id: true, blocked_id: true },
  });
  if (edges.length === 0) return;

  const ids = [...new Set(edges.flatMap((e) => [e.blocker_id, e.blocked_id]).concat(touchedIds))];
  const nodes = await tx.node.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true },
  });
  const statusById = new Map<string, string>(nodes.map((n: { id: string; status: string }) => [n.id, n.status]));
  const blocked = blockedNodeIds(edges, statusById);

  for (const n of nodes) {
    const shouldBlock = blocked.has(n.id);
    if (shouldBlock && n.status === 'PENDING') {
      await tx.node.update({ where: { id: n.id }, data: { status: 'BLOCKED' } });
    } else if (!shouldBlock && n.status === 'BLOCKED') {
      await tx.node.update({ where: { id: n.id }, data: { status: 'PENDING' } });
    }
  }
}

/**
 * Sobe a arvore alargando cada ancestral ate caber o que esta embaixo. So
 * cresce, e nao toca nas irmas: a cascata de cima para baixo (reagendar o pai)
 * e a de baixo para cima (aumentar a filha) precisam ser caminhos separados,
 * senao esticar uma filha reposicionaria todas as outras.
 *
 * Para cedo no primeiro ancestral que ja continha tudo: se ele nao mudou, os
 * acima dele tambem nao mudam. Custo O(profundidade).
 */
async function growAncestors(
  tx: Tx,
  path: string,
): Promise<Array<{ id: string; title: string; start_date: Date | null; due_date: Date | null }>> {
  const crescidos: Array<{
    id: string;
    title: string;
    start_date: Date | null;
    due_date: Date | null;
  }> = [];

  for (const ancestorId of ancestorIdsBottomUp(path)) {
    const ancestor = await tx.node.findUnique({
      where: { id: ancestorId },
      select: { id: true, title: true, start_date: true, due_date: true, all_day: true },
    });
    if (!ancestor) break;

    const filhas = await tx.node.findMany({
      where: { parent_id: ancestorId },
      select: { start_date: true, due_date: true },
    });

    const next = grownWindow(ancestor, filhas);
    if (!next.changed) break;

    await tx.node.update({
      where: { id: ancestorId },
      data: { start_date: next.start_date, due_date: next.due_date },
    });
    crescidos.push({
      id: ancestor.id,
      title: ancestor.title,
      start_date: next.start_date,
      due_date: next.due_date,
    });
  }

  return crescidos;
}

export async function getTree(userId: string, query: TreeQuery): Promise<NodeDTO[]> {
  const maxDepth = query.maxDepth ?? 1;
  const statuses = query.status?.split(',').filter(Boolean);

  let pathFilter: object = {};
  if (query.rootId) {
    const root = await prisma.node.findUnique({
      where: { id: query.rootId },
      select: { path: true, depth: true },
    });
    if (!root) throw notFound('No raiz');
    pathFilter = {
      OR: [{ path: root.path }, { path: { startsWith: `${root.path}/` } }],
      depth: { lte: root.depth + maxDepth },
    };
  } else {
    pathFilter = { depth: { lte: maxDepth } };
  }

  const nodes = await prisma.node.findMany({
    where: {
      user_id: userId,
      ...pathFilter,
      ...(query.spaceId ? { space_id: query.spaceId } : {}),
      ...(query.assigneeId ? { assignee_id: query.assigneeId } : {}),
      ...(statuses?.length ? { status: { in: statuses as any } } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    },
    ...repo.nodeSelect,
    orderBy: [{ depth: 'asc' }, { position: 'asc' }],
    take: 4000,
  });

  const edges = await repo.dependenciesTouching(nodes.map((n) => n.id));
  return nodes.map((n) =>
    toNodeDTO(n, {
      blockedBy: edges.filter((e) => e.blocked_id === n.id).map((e) => e.blocker_id),
      blocks: edges.filter((e) => e.blocker_id === n.id).map((e) => e.blocked_id),
    }),
  );
}

export async function getChildren(parentId: string): Promise<NodeDTO[]> {
  const children = await repo.childrenOf(parentId);
  const edges = await repo.dependenciesTouching(children.map((c) => c.id));
  return children.map((c) =>
    toNodeDTO(c, {
      blockedBy: edges.filter((e) => e.blocked_id === c.id).map((e) => e.blocker_id),
      blocks: edges.filter((e) => e.blocker_id === c.id).map((e) => e.blocked_id),
    }),
  );
}

export async function getNodeDetail(id: string) {
  const node = await repo.findNode(id);
  if (!node) throw notFound('No');

  const ancestorIds = node.path.split('/').slice(0, -1);
  const [ancestors, children, deps, activity, descendants] = await Promise.all([
    prisma.node.findMany({
      where: { id: { in: ancestorIds } },
      select: { id: true, title: true, depth: true, progress: true },
    }),
    repo.childrenOf(id),
    prisma.nodeDependency.findMany({
      where: { OR: [{ blocker_id: id }, { blocked_id: id }] },
      include: {
        blocker: { select: { id: true, title: true, status: true } },
        blocked: { select: { id: true, title: true, status: true } },
      },
    }),
    prisma.nodeActivity.findMany({
      where: { node_id: id },
      orderBy: { created_at: 'desc' },
      take: 12,
    }),
    // Toda a subarvore, nao so os filhos diretos: e o que some junto numa
    // exclusao, e a confirmacao precisa dizer o numero certo.
    prisma.node.count({ where: { path: { startsWith: `${node.path}/` } } }),
  ]);

  const byId = new Map(ancestors.map((a) => [a.id, a]));
  return {
    node: toNodeDTO(node),
    descendants,
    ancestors: ancestorIds
      .map((aid) => byId.get(aid))
      .filter(Boolean)
      .map((a) => ({ id: a!.id, title: a!.title, depth: a!.depth, progress: num(a!.progress) })),
    children: children.map((c) => toNodeDTO(c)),
    // O id da aresta vai junto: sem ele a tela consegue mostrar o vinculo mas
    // nao consegue desfaze-lo.
    dependsOn: deps
      .filter((d) => d.blocked_id === id)
      .map((d) => ({ ...d.blocker, dependency_id: d.id })),
    blocksNodes: deps
      .filter((d) => d.blocker_id === id)
      .map((d) => ({ ...d.blocked, dependency_id: d.id })),
    activity: activity.map((a) => ({
      id: a.id,
      actor: a.actor,
      kind: a.kind,
      message: a.message,
      created_at: a.created_at.toISOString(),
    })),
  };
}

export async function createNode(userId: string, input: CreateNodeInput): Promise<NodeDTO> {
  return prisma.$transaction(async (tx) => {
    const parent = input.parent_id
      ? await tx.node.findUnique({ where: { id: input.parent_id } })
      : null;
    if (input.parent_id && !parent) throw notFound('Tarefa pai');

    const dates = janelaDeCriacao(
      { start_date: parseDate(input.start_date), due_date: parseDate(input.due_date) },
      parent,
      { agora: new Date(), estimatedMinutes: input.estimated_minutes },
    );

    const violations = validateAgainstParent(dates, parent);
    const hard = violations.find((v) => v.code === 'START_AFTER_DUE');
    if (hard) throw new AppError('VALIDATION_FAILED', hard.message);

    const id = randomUUID();
    const created = await tx.node.create({
      data: {
        id,
        user_id: userId,
        space_id: input.space_id ?? parent?.space_id ?? null,
        parent_id: parent?.id ?? null,
        path: buildPath(parent?.path ?? null, id),
        depth: parent ? parent.depth + 1 : 0,
        position: input.position ?? (await repo.nextPosition(parent?.id ?? null, userId, tx)),
        title: input.title,
        description: input.description ?? null,
        importance: input.importance ?? parent?.importance ?? 3,
        weight: input.weight ?? weightFromEstimate(input.estimated_minutes),
        estimated_minutes: input.estimated_minutes ?? null,
        start_date: dates.start_date,
        due_date: dates.due_date,
        // A janela padrao tem hora; dia inteiro passou a ser a excecao, nao a regra.
        all_day: input.all_day ?? false,
        planned_date: parseDate(input.planned_date),
        scheduled_start: input.scheduled_start ?? null,
        scheduled_end: input.scheduled_end ?? null,
        assignee_id: input.assignee_id ?? null,
        leaf_count: 1,
      },
      ...repo.nodeSelect,
    });

    await logActivity(tx as Tx, id, 'created', `Criou "${input.title}".`);

    if (parent) {
      // O pai deixou de ser folha: seu progresso passa a ser derivado.
      await tx.node.update({ where: { id: parent.id }, data: { manual_progress: null } });
      await propagateFrom(id, tx as Tx);
      const rootId = rootIdOf(created.path);
      if (rootId) {
        await refreshLeafCounts(created.path.split('/')[0], tx as Tx);
        await refreshRootImpact(rootId, tx as Tx);
      }
    } else {
      await tx.node.update({ where: { id }, data: { root_impact: 1 } });
    }

    if (parent && (dates.start_date || dates.due_date)) {
      await growAncestors(tx as Tx, created.path);
    }

    const fresh = await repo.requireNode(id, tx as Tx);
    return toNodeDTO(fresh);
  });
}

export async function updateNode(
  userId: string,
  id: string,
  input: UpdateNodeInput,
): Promise<NodeDTO> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.node.findUnique({
      where: { id },
      include: { _count: { select: { children: true } } },
    });
    if (!existing) throw notFound('No');

    const hasChildren = existing._count.children > 0;
    if (input.manual_progress != null && hasChildren) {
      throw new AppError(
        'MANUAL_PROGRESS_ON_PARENT',
        'Um no com filhos tem progresso derivado da cascata e nao aceita valor manual.',
      );
    }

    if (input.status === 'COMPLETED' && hasChildren) {
      const children = await tx.node.findMany({
        where: { parent_id: id },
        select: { status: true, title: true },
      });
      if (!canComplete(children)) {
        const pending = children.filter((c) => c.status !== 'COMPLETED' && c.status !== 'CANCELLED');
        throw new AppError(
          'PARENT_HAS_PENDING_CHILDREN',
          `Ha ${pending.length} subtarefa(s) pendente(s). Conclua-as primeiro.`,
          { pending: pending.map((c) => c.title) },
        );
      }
    }

    if (input.status === 'COMPLETED' || input.status === 'IN_PROGRESS') {
      const blockers = await tx.nodeDependency.findMany({
        where: { blocked_id: id },
        include: { blocker: { select: { id: true, title: true, status: true } } },
      });
      const open = blockers.filter(
        (b) => b.blocker.status !== 'COMPLETED' && b.blocker.status !== 'CANCELLED',
      );
      if (open.length > 0) {
        throw new AppError('BLOCKED_BY_DEPENDENCY', 'Esta tarefa esta bloqueada por outra.', {
          blockers: open.map((b) => ({ id: b.blocker.id, title: b.blocker.title })),
        });
      }
    }

    const nextDates = {
      start_date:
        input.start_date !== undefined ? parseDate(input.start_date) : existing.start_date,
      due_date: input.due_date !== undefined ? parseDate(input.due_date) : existing.due_date,
    };

    /**
     * Numa tarefa com horario, a barra da timeline E a duracao: mudar a
     * estimativa sem mexer no fim deixaria os dois numeros brigando na tela.
     * Entao o fim segue a estimativa — mas so quando ela nao e prazo:
     *
     * - dia inteiro: o fim e uma data que alguem escolheu, nao duracao;
     * - com filhas: a janela vem da subarvore, nao do esforco proprio;
     * - fim enviado na mesma chamada: quem manda e o que o usuario digitou.
     */
    const nextAllDay = input.all_day ?? existing.all_day;
    const novaEstimativa =
      input.estimated_minutes !== undefined &&
      input.estimated_minutes !== existing.estimated_minutes;
    const fimSegueEstimativa =
      novaEstimativa &&
      !nextAllDay &&
      !hasChildren &&
      input.due_date === undefined &&
      Boolean(nextDates.start_date) &&
      Boolean(input.estimated_minutes);

    if (fimSegueEstimativa) {
      nextDates.due_date = new Date(
        nextDates.start_date!.getTime() + input.estimated_minutes! * 60_000,
      );
    }

    const parent = existing.parent_id
      ? await tx.node.findUnique({ where: { id: existing.parent_id } })
      : null;
    const violations = validateAgainstParent(nextDates, parent);
    const hard = violations.find((v) => v.code === 'START_AFTER_DUE');
    if (hard) throw new AppError('VALIDATION_FAILED', hard.message);

    const statusChanged = input.status && input.status !== existing.status;

    await tx.node.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.importance !== undefined ? { importance: input.importance } : {}),
        ...(input.weight !== undefined ? { weight: input.weight } : {}),
        ...(input.estimated_minutes !== undefined
          ? {
              estimated_minutes: input.estimated_minutes,
              ...(input.weight === undefined && !hasChildren
                ? { weight: weightFromEstimate(input.estimated_minutes) }
                : {}),
            }
          : {}),
        ...(input.start_date !== undefined ? { start_date: nextDates.start_date } : {}),
        ...(input.due_date !== undefined || fimSegueEstimativa
          ? { due_date: nextDates.due_date }
          : {}),
        ...(input.all_day !== undefined ? { all_day: input.all_day } : {}),
        ...(input.planned_date !== undefined
          ? { planned_date: parseDate(input.planned_date) }
          : {}),
        ...(input.scheduled_start !== undefined
          ? { scheduled_start: input.scheduled_start }
          : {}),
        ...(input.scheduled_end !== undefined ? { scheduled_end: input.scheduled_end } : {}),
        ...(input.assignee_id !== undefined ? { assignee_id: input.assignee_id } : {}),
        ...(input.space_id !== undefined ? { space_id: input.space_id } : {}),
        ...(input.manual_progress !== undefined
          ? { manual_progress: input.manual_progress }
          : {}),
        ...(statusChanged && input.status === 'COMPLETED' ? { completed_at: new Date() } : {}),
        ...(statusChanged && input.status !== 'COMPLETED' ? { completed_at: null } : {}),
      },
    });

    if (statusChanged) {
      await logActivity(tx as Tx, id, 'status', `Status mudou para ${input.status}.`);
      await syncBlockedStatus(tx as Tx, userId, [id]);
    }

    /**
     * Espaco e propriedade do ramo, nao da tarefa solta. Mudar so a mae
     * deixaria o mesmo projeto partido entre dois espacos — e as filhas
     * sumiriam do filtro por espaco justamente onde se foi procurar por elas.
     */
    if (input.space_id !== undefined && input.space_id !== existing.space_id) {
      const { count } = await tx.node.updateMany({
        where: { user_id: userId, path: { startsWith: `${existing.path}/` } },
        data: { space_id: input.space_id },
      });
      if (count > 0) {
        await logActivity(
          tx as Tx,
          id,
          'space',
          `Mudou de espaco e levou ${count} subtarefa(s) junto.`,
        );
      }
    }

    // Data alterada pode ter estourado a janela do pai: ele acompanha.
    const mexeuNasDatas =
      input.start_date !== undefined || input.due_date !== undefined || fimSegueEstimativa;
    if (mexeuNasDatas) await growAncestors(tx as Tx, existing.path);

    await refreshOwnProgress(id, tx as Tx);
    await propagateFrom(id, tx as Tx);

    if (input.weight !== undefined || input.estimated_minutes !== undefined) {
      const rootId = rootIdOf(existing.path);
      if (rootId) await refreshRootImpact(rootId, tx as Tx);
    }

    return toNodeDTO(await repo.requireNode(id, tx as Tx));
  });
}

export async function completeLeaf(userId: string, id: string): Promise<CompleteResult> {
  return prisma.$transaction(async (tx) => {
    const node = await tx.node.findUnique({
      where: { id },
      include: { _count: { select: { children: true } } },
    });
    if (!node) throw notFound('No');

    if (node._count.children > 0) {
      const children = await tx.node.findMany({
        where: { parent_id: id },
        select: { status: true },
      });
      if (!canComplete(children)) {
        throw new AppError(
          'PARENT_HAS_PENDING_CHILDREN',
          'Este no tem subtarefas pendentes. O progresso dele sobe sozinho quando elas fecharem.',
        );
      }
    }

    const edges = await tx.nodeDependency.findMany({
      where: { blocked: { user_id: userId } },
      select: { blocker_id: true, blocked_id: true },
    });
    const blockerIds = edges.filter((e) => e.blocked_id === id).map((e) => e.blocker_id);
    if (blockerIds.length > 0) {
      const openBlockers = await tx.node.findMany({
        where: { id: { in: blockerIds }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        select: { id: true, title: true },
      });
      if (openBlockers.length > 0) {
        throw new AppError('BLOCKED_BY_DEPENDENCY', 'Esta tarefa esta bloqueada por outra.', {
          blockers: openBlockers,
        });
      }
    }

    await tx.node.update({
      where: { id },
      data: { status: 'COMPLETED', completed_at: new Date(), manual_progress: null, progress: 100 },
    });
    await logActivity(tx as Tx, id, 'completed', 'Concluiu a tarefa.');

    const cascade = await propagateFrom(id, tx as Tx);

    const statusNodes = await tx.node.findMany({
      where: { id: { in: [...new Set(edges.flatMap((e) => [e.blocker_id, e.blocked_id]))] } },
      select: { id: true, status: true },
    });
    const statusById = new Map<string, string>(statusNodes.map((n: { id: string; status: string }) => [n.id, n.status]));
    const freed = newlyUnblocked(edges, statusById, id);
    if (freed.length > 0) {
      await tx.node.updateMany({
        where: { id: { in: freed }, status: 'BLOCKED' },
        data: { status: 'PENDING' },
      });
    }
    const unblocked = await tx.node.findMany({
      where: { id: { in: freed } },
      select: { id: true, title: true },
    });

    const rootId = node.path.split('/')[0];
    const root = await tx.node.findUnique({
      where: { id: rootId },
      select: { id: true, title: true },
    });

    return {
      node: toNodeDTO(await repo.requireNode(id, tx as Tx)),
      cascade,
      unblocked,
      impact: {
        rootId,
        rootTitle: root?.title ?? '',
        deltaPercent: Math.round(num(node.root_impact) * 1000) / 10,
      },
    };
  });
}

/**
 * Desfaz uma conclusao. Nao e um `update` de status qualquer: reabrir tem
 * duas consequencias que o update generico nao cobre.
 *
 * 1. Os ancestrais concluidos precisam reabrir junto. Um pai so fica
 *    concluido porque todas as filhas fecharam; se uma volta, a premissa
 *    caiu e deixa-lo marcado como concluido seria mentira.
 * 2. Quem esta livre por causa desta tarefa volta a ficar bloqueado.
 */
export async function reopenNode(userId: string, id: string): Promise<ReopenResult> {
  return prisma.$transaction(async (tx) => {
    const node = await tx.node.findUnique({ where: { id } });
    if (!node) throw notFound('No');

    if (node.status !== 'COMPLETED' && node.status !== 'CANCELLED') {
      throw new AppError('NOT_COMPLETED', 'Esta tarefa nao esta concluida.');
    }

    const wasCancelled = node.status === 'CANCELLED';

    // Zerar antes de recalcular: enquanto o status for COMPLETED, a folha
    // vale 100 por definicao e o refresh nao teria o que mudar.
    await tx.node.update({
      where: { id },
      data: { status: 'PENDING', completed_at: null },
    });
    const own = await refreshOwnProgress(id, tx as Tx);

    const status = statusAfterReopen(own, wasCancelled);
    if (status !== 'PENDING') {
      await tx.node.update({ where: { id }, data: { status } });
    }

    const cascade = await propagateFrom(id, tx as Tx);

    // Ancestrais: qualquer um marcado como concluido que agora nao chega a
    // 100 volta para em andamento.
    const ancestorIds = ancestorIdsBottomUp(node.path);
    const ancestors = ancestorIds.length
      ? await tx.node.findMany({
          where: { id: { in: ancestorIds }, status: 'COMPLETED' },
          select: { id: true, title: true, progress: true },
        })
      : [];
    const reopenedAncestors = ancestors.filter((a) => num(a.progress) < 99.995);
    if (reopenedAncestors.length > 0) {
      await tx.node.updateMany({
        where: { id: { in: reopenedAncestors.map((a) => a.id) } },
        data: { status: 'IN_PROGRESS', completed_at: null },
      });
    }

    await logActivity(tx as Tx, id, 'reopened', 'Reabriu a tarefa.');

    const blockedBefore = await tx.node.findMany({
      where: { status: 'BLOCKED', user_id: userId },
      select: { id: true },
    });
    const wasBlocked = new Set(blockedBefore.map((n) => n.id));

    await syncBlockedStatus(tx as Tx, userId, [id, ...reopenedAncestors.map((a) => a.id)]);

    const reblocked = await tx.node.findMany({
      where: { status: 'BLOCKED', user_id: userId, id: { notIn: [...wasBlocked, id] } },
      select: { id: true, title: true },
    });

    return {
      node: toNodeDTO(await repo.requireNode(id, tx as Tx)),
      cascade,
      reopenedAncestors: reopenedAncestors.map((a) => ({ id: a.id, title: a.title })),
      reblocked,
    };
  });
}

export async function breakdown(userId: string, id: string, input: BreakdownInput) {
  return prisma.$transaction(async (tx) => {
    const parent = await tx.node.findUnique({ where: { id } });
    if (!parent) throw notFound('Tarefa pai');

    const basePosition = await repo.nextPosition(id, userId, tx as Tx);
    const created: string[] = [];

    for (const [index, child] of input.children.entries()) {
      const childId = randomUUID();
      const due = parseDate(child.due_date) ?? parent.due_date;

      if (due && parent.due_date && due > parent.due_date) {
        throw new AppError(
          'DEADLINE_EXCEEDS_PARENT',
          `"${child.title}" tem prazo depois do da tarefa pai.`,
          { parentDue: parent.due_date.toISOString() },
        );
      }

      await tx.node.create({
        data: {
          id: childId,
          user_id: userId,
          space_id: parent.space_id,
          parent_id: parent.id,
          path: buildPath(parent.path, childId),
          depth: parent.depth + 1,
          position: basePosition + index,
          title: child.title,
          importance: parent.importance,
          weight: child.weight ?? weightFromEstimate(child.estimated_minutes),
          estimated_minutes: child.estimated_minutes ?? null,
          start_date: parent.start_date,
          due_date: due,
          assignee_id: child.assignee_id ?? null,
          leaf_count: 1,
        },
      });
      created.push(childId);
    }

    await tx.node.update({ where: { id }, data: { manual_progress: null } });
    await logActivity(
      tx as Tx,
      id,
      'breakdown',
      `Quebrou em ${input.children.length} subtarefa(s).`,
    );

    await refreshOwnProgress(id, tx as Tx);
    await propagateFrom(id, tx as Tx);

    const rootId = parent.path.split('/')[0];
    await refreshLeafCounts(rootId, tx as Tx);
    await refreshRootImpact(rootId, tx as Tx);

    const children = await repo.childrenOf(id, tx as Tx);
    return { parent: toNodeDTO(await repo.requireNode(id, tx as Tx)), children: children.map((c) => toNodeDTO(c)) };
  });
}

/**
 * Deixa as posicoes de um grupo de irmas em 0..n-1, sem buracos nem empates.
 * Com `pin`, aquela tarefa e tirada da fila e reinserida no indice `at` —
 * que e contado na lista JA sem ela, que e como a tela enxerga o alvo.
 */
export async function renumberSiblings(
  tx: Tx,
  userId: string,
  parentId: string | null,
  pinned?: { pin: string; at?: number },
) {
  const siblings = await tx.node.findMany({
    where: parentId ? { parent_id: parentId } : { parent_id: null, user_id: userId },
    orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
    select: { id: true },
  });

  let order = siblings.map((s) => s.id);
  if (pinned?.at != null) {
    order = order.filter((sid) => sid !== pinned.pin);
    order.splice(Math.max(0, Math.min(pinned.at, order.length)), 0, pinned.pin);
  }

  await Promise.all(
    order.map((sid, index) => tx.node.update({ where: { id: sid }, data: { position: index } })),
  );
}

export async function moveNode(
  userId: string,
  id: string,
  newParentId: string | null,
  position?: number,
) {
  return prisma.$transaction(async (tx) => {
    const node = await tx.node.findUnique({ where: { id } });
    if (!node) throw notFound('No');

    const newParent = newParentId
      ? await tx.node.findUnique({ where: { id: newParentId } })
      : null;
    if (newParentId && !newParent) throw notFound('Novo pai');

    if (newParent && (newParent.id === id || isDescendantOf(newParent.path, node.path))) {
      throw new AppError('INVALID_MOVE', 'Um no nao pode ser movido para dentro de si mesmo.');
    }

    const oldPath = node.path;
    const oldRootId = oldPath.split('/')[0];
    const newPath = buildPath(newParent?.path ?? null, id);
    const depthDelta = (newParent ? newParent.depth + 1 : 0) - node.depth;

    const subtree = await tx.node.findMany({
      where: { OR: [{ path: oldPath }, { path: { startsWith: `${oldPath}/` } }] },
      select: { id: true, path: true, depth: true },
    });

    for (const descendant of subtree) {
      await tx.node.update({
        where: { id: descendant.id },
        data: {
          path: rebasePath(descendant.path, oldPath, newPath),
          depth: descendant.depth + depthDelta,
          ...(descendant.id === id
            ? {
                parent_id: newParent?.id ?? null,
                position: position ?? (await repo.nextPosition(newParent?.id ?? null, userId, tx as Tx)),
                space_id: newParent?.space_id ?? node.space_id,
              }
            : {}),
        },
      });
    }

    // O ramo inteiro acompanha o espaco do novo pai: mover so a raiz do ramo
    // deixava as filhas orfas no espaco antigo.
    // A mesma conta que o proprio no usa acima — pai sem espaco nao apaga o atual.
    const novoEspaco = newParent?.space_id ?? node.space_id;
    if (novoEspaco !== node.space_id) {
      await tx.node.updateMany({
        where: { user_id: userId, path: { startsWith: `${newPath}/` } },
        data: { space_id: novoEspaco },
      });
    }

    // Renumerar as duas listas de irmas. Sem isso, um `position` explicito
    // empata com o de quem ja estava ali e a ordem passa a depender do
    // desempate do banco — a tarefa "pula" sozinha na proxima leitura.
    const oldParentId = node.parent_id;
    await renumberSiblings(tx as Tx, userId, newParent?.id ?? null, { pin: id, at: position });
    if (oldParentId !== (newParent?.id ?? null)) {
      await renumberSiblings(tx as Tx, userId, oldParentId);
    }

    await growAncestors(tx as Tx, newPath);

    await logActivity(tx as Tx, id, 'moved', 'Moveu o no na arvore.');

    if (node.parent_id) {
      const oldParent = await tx.node.findUnique({ where: { id: node.parent_id } });
      if (oldParent) await propagateFrom(oldParent.id, tx as Tx);
    }
    await propagateFrom(id, tx as Tx);

    const newRootId = newPath.split('/')[0];
    for (const rootId of new Set([oldRootId, newRootId])) {
      await refreshLeafCounts(rootId, tx as Tx);
      await refreshRootImpact(rootId, tx as Tx);
    }

    return toNodeDTO(await repo.requireNode(id, tx as Tx));
  });
}

/** Texto do historico: diferencia mover de encolher, que sao gestos distintos. */
function descreveReagendamento(plan: {
  shiftedMinutes: number;
  scale: number;
  affected: Array<unknown>;
}): string {
  const filhas = plan.affected.length;
  const sufixo = filhas > 0 ? `, ajustando ${filhas} subtarefa(s)` : '';
  const encolheu = Math.abs(plan.scale - 1) > 0.001;

  if (encolheu) {
    const pct = Math.round(plan.scale * 100);
    return `Redimensionou a janela para ${pct}% do tamanho${sufixo}.`;
  }
  if (plan.shiftedMinutes === 0) return 'Ajustou as datas.';
  return `Deslocou ${formatarOffset(plan.shiftedMinutes)}${sufixo}.`;
}

function formatarOffset(minutes: number): string {
  const sinal = minutes > 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  if (abs % 1440 === 0) return `${sinal}${abs / 1440} dia(s)`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sinal}${m}min`;
  return m === 0 ? `${sinal}${h}h` : `${sinal}${h}h${String(m).padStart(2, '0')}`;
}

export async function reschedule(id: string, input: RescheduleInput) {
  const node = await prisma.node.findUnique({ where: { id } });
  if (!node) throw notFound('No');

  const next = {
    start_date: input.start_date !== undefined ? parseDate(input.start_date) : node.start_date,
    due_date: input.due_date !== undefined ? parseDate(input.due_date) : node.due_date,
  };

  const [descendants, parent] = await Promise.all([
    prisma.node.findMany({
      where: { path: { startsWith: `${node.path}/` } },
      select: {
        id: true,
        title: true,
        parent_id: true,
        start_date: true,
        due_date: true,
        all_day: true,
      },
    }),
    node.parent_id ? prisma.node.findUnique({ where: { id: node.parent_id } }) : null,
  ]);

  /**
   * Redimensionar sem levar as filhas (Shift no arraste) tem um piso: a janela
   * nao pode cortar nenhuma delas. `grownWindow` ja e exatamente essa conta —
   * ela devolve a menor janela que contem as filhas, entao encolher demais
   * simplesmente volta ao limite em vez de ser recusado.
   */
  const soltarFilhas = input.cascadeChildren === false;
  let travouNoLimite = false;
  if (soltarFilhas) {
    const filhasDiretas = descendants.filter((c) => c.parent_id === id);
    const piso = grownWindow({ ...next, all_day: input.all_day ?? node.all_day }, filhasDiretas);
    travouNoLimite = piso.changed;
    next.start_date = piso.start_date;
    next.due_date = piso.due_date;
  }

  const plan = planReschedule(
    node,
    next,
    descendants,
    parent,
    input.cascadeChildren ?? true,
  );

  if (input.dryRun) return { applied: false, plan, grew: [], clampedToChildren: travouNoLimite };

  const nextAllDay = input.all_day ?? node.all_day;
  /**
   * Fecha o ciclo com a regra inversa: se a estimativa manda no fim da barra,
   * arrastar a borda da barra tem de mandar na estimativa. Sem isso o campo
   * diria "1h" ao lado de uma barra de tres horas.
   *
   * So em folha com horario — num pai a janela e a soma das filhas, nao
   * esforco proprio. O peso NAO acompanha de proposito: ele decide a fatia na
   * meta macro e nao deve ser reescrito por um arraste.
   */
  const semFilhas = (await prisma.node.count({ where: { parent_id: id } })) === 0;
  const estimativaDaJanela =
    semFilhas && !nextAllDay && next.start_date && next.due_date
      ? Math.max(
          1,
          Math.round((next.due_date.getTime() - next.start_date.getTime()) / 60_000),
        )
      : null;

  let grew: Array<{ id: string; title: string }> = [];

  await prisma.$transaction(async (tx) => {
    await tx.node.update({
      where: { id },
      data: {
        ...next,
        ...(input.all_day !== undefined ? { all_day: input.all_day } : {}),
        ...(estimativaDaJanela !== null ? { estimated_minutes: estimativaDaJanela } : {}),
      },
    });
    for (const change of plan.affected) {
      await tx.node.update({ where: { id: change.id }, data: change.to });
    }

    // Depois de mexer nesta tarefa, os pais dela podem ter ficado pequenos.
    // Cresce so o envelope: as irmas nao sao reposicionadas por tabela.
    const crescidos = await growAncestors(tx as Tx, node.path);
    grew = crescidos.map((g) => ({ id: g.id, title: g.title }));

    await logActivity(
      tx as Tx,
      id,
      'rescheduled',
      grew.length > 0
        ? `${descreveReagendamento(plan)} ${grew.length} tarefa(s) acima cresceram para caber.`
        : descreveReagendamento(plan),
    );
  });

  return { applied: true, plan, grew, clampedToChildren: travouNoLimite };
}

export async function deleteNode(id: string) {
  return prisma.$transaction(async (tx) => {
    const node = await tx.node.findUnique({ where: { id } });
    if (!node) throw notFound('No');

    const rootId = node.path.split('/')[0];
    const parentId = node.parent_id;

    // Contado antes: depois do delete nao ha mais o que contar.
    const descendants = await tx.node.count({
      where: { path: { startsWith: `${node.path}/` } },
    });

    await tx.node.delete({ where: { id } }); // onDelete Cascade limpa a subarvore

    if (parentId) {
      await refreshOwnProgress(parentId, tx as Tx);
      await propagateFrom(parentId, tx as Tx);
      await refreshLeafCounts(rootId, tx as Tx);
      await refreshRootImpact(rootId, tx as Tx);
    }
    return { deleted: true, removed: descendants + 1 };
  });
}

/**
 * Leva o no ao status pedido pelo caminho certo (ver `domain/status.ts`).
 *
 * Os passos rodam em transacoes separadas porque cada um ja e uma transacao
 * propria no servico. Se o segundo falhar — "em andamento" numa tarefa que
 * voltou a ficar bloqueada, por exemplo — o no fica no estado do primeiro, que
 * e sempre um estado valido: reaberto e pendente.
 */
export async function setStatus(
  userId: string,
  id: string,
  input: SetStatusInput,
): Promise<SetStatusResult> {
  const atual = await repo.findNode(id);
  if (!atual) throw notFound('No');

  const steps = stepsToStatus(atual.status, input.status, atual._count.children === 0);
  const result: SetStatusResult = { node: toNodeDTO(atual), steps };

  for (const step of steps) {
    if (step === 'complete') {
      result.completed = await completeLeaf(userId, id);
      result.node = result.completed.node;
    } else if (step === 'reopen') {
      result.reopened = await reopenNode(userId, id);
      result.node = result.reopened.node;
    } else {
      result.node = await updateNode(userId, id, { status: input.status });
    }
  }
  return result;
}
