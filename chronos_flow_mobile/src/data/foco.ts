import { and, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { nodes, spaces } from '@db/schema';
import { focusScore, rootCriticality, projectProgress, startOfDay } from '@core/impact';
import { blockedNodeIds } from '@core/dependencies';
import type { FocusItem } from '@shared/types';
import { bd as banco } from './conexao';
import { paraNodeDTO } from './serializar';
import * as repo from './repositorio';

/** `children: { none: {} }` do Prisma — aqui a subconsulta que ele escondia. */
const semFilhas = sql`not exists (select 1 from ${nodes} as f where f.parent_id = ${nodes.id})`;

/**
 * Fila do dia: so folhas, ordenadas pelo quanto destravam a meta macro mais
 * pressionada. Bloqueadas vao para uma lista separada.
 */
export async function fila(
  userId: string,
  opcoes: { scope?: string; assigneeId?: string } = {},
) {
  const bd = banco();
  const hoje = new Date();
  const scope = opcoes.scope ?? 'today';

  const folhas = await bd
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.user_id, userId),
        notInArray(nodes.status, ['COMPLETED', 'CANCELLED']),
        semFilhas,
        ...(opcoes.assigneeId ? [eq(nodes.assignee_id, opcoes.assigneeId)] : []),
      ),
    )
    .limit(500)
    .all();

  const idsRaiz = [...new Set(folhas.map((n) => n.path.split('/')[0]))];
  const raizes = idsRaiz.length
    ? await bd
        .select({
          id: nodes.id,
          title: nodes.title,
          progress: nodes.progress,
          importance: nodes.importance,
          due_date: nodes.due_date,
          cor: spaces.color,
        })
        .from(nodes)
        .leftJoin(spaces, eq(spaces.id, nodes.space_id))
        .where(inArray(nodes.id, idsRaiz))
        .all()
    : [];
  const raizPorId = new Map(raizes.map((r) => [r.id, r]));

  const arestas = await repo.todasAsDependencias(bd, userId);
  const todos = await bd
    .select({ id: nodes.id, status: nodes.status, title: nodes.title, depth: nodes.depth })
    .from(nodes)
    .where(eq(nodes.user_id, userId))
    .all();

  const statusPorId = new Map<string, string>(todos.map((s) => [s.id, s.status]));
  const tituloPorId = new Map(todos.map((s) => [s.id, s.title]));
  const bloqueados = blockedNodeIds(arestas, statusPorId);
  const pessoas = await repo.responsaveis(bd, folhas.map((n) => n.assignee_id));

  const itens: FocusItem[] = folhas.map((n) => {
    const raiz = raizPorId.get(n.path.split('/')[0]);
    const criticidade = raiz ? rootCriticality(raiz.importance, raiz.due_date, hoje) : 1;
    const bloqueada = bloqueados.has(n.id);

    return {
      node: paraNodeDTO(n, {
        assignee: n.assignee_id ? (pessoas.get(n.assignee_id) ?? null) : null,
        blockedBy: arestas.filter((e) => e.blocked_id === n.id).map((e) => e.blocker_id),
      }),
      root: {
        id: raiz?.id ?? '',
        title: raiz?.title ?? 'Sem meta',
        progress: raiz?.progress ?? 0,
        color: raiz?.cor ?? '#10B981',
      },
      spacePath: n.path
        .split('/')
        .slice(0, -1)
        .map((id) => tituloPorId.get(id) ?? '')
        .filter(Boolean),
      score: focusScore(
        {
          contribution: n.root_impact,
          rootCriticality: criticidade,
          isBlocked: bloqueada,
          dueDate: n.due_date,
          plannedDate: n.planned_date,
        },
        hoje,
      ),
      deltaPercent: Math.round(n.root_impact * 1000) / 10,
      isBlocked: bloqueada,
      blockers: arestas
        .filter((e) => e.blocked_id === n.id)
        .map((e) => ({ id: e.blocker_id, title: tituloPorId.get(e.blocker_id) ?? '' }))
        .filter((b) => statusPorId.get(b.id) !== 'COMPLETED'),
    } as FocusItem;
  });

  const horizonte = new Date(hoje);
  horizonte.setDate(horizonte.getDate() + (scope === 'next48' ? 2 : 0));
  const limite = startOfDay(horizonte).getTime() + 86_399_000;

  const noEscopo =
    scope === 'all'
      ? itens
      : itens.filter((i) => {
          const planejada = i.node.planned_date ? new Date(i.node.planned_date).getTime() : null;
          const prazo = i.node.due_date ? new Date(i.node.due_date).getTime() : null;
          return (planejada != null && planejada <= limite) || (prazo != null && prazo <= limite);
        });

  // Escopo vazio cai para a lista inteira: uma fila vazia por filtro parece
  // "nao ha o que fazer", que e uma mentira desanimadora.
  const conjunto = noEscopo.length > 0 ? noEscopo : itens;
  const abertas = conjunto.filter((i) => !i.isBlocked).sort((a, b) => b.score - a.score).slice(0, 25);
  const impedimentos = conjunto
    .filter((i) => i.isBlocked)
    .sort((a, b) => b.deltaPercent - a.deltaPercent)
    .slice(0, 10);

  const concluidasHoje = await contarConcluidasHoje(userId);

  return {
    queue: abertas,
    impediments: impedimentos,
    potentialImpact: Math.round(abertas.reduce((s, i) => s + i.deltaPercent, 0) * 10) / 10,
    completedToday: concluidasHoje,
  };
}

export async function contarConcluidasHoje(userId: string): Promise<number> {
  const bd = banco();
  const r = await bd
    .select({ quantas: sql<number>`count(*)` })
    .from(nodes)
    .where(and(eq(nodes.user_id, userId), gte(nodes.completed_at, startOfDay(new Date()))))
    .get();
  return Number(r?.quantas ?? 0);
}

/** Projecao do simulador: quanto cada raiz sobe se estas folhas fecharem hoje. */
export async function simular(nodeIds: string[]) {
  const bd = banco();
  if (nodeIds.length === 0) return { projections: [] };

  const folhas = await bd
    .select({
      id: nodes.id, path: nodes.path, root_impact: nodes.root_impact,
      progress: nodes.progress, title: nodes.title,
    })
    .from(nodes)
    .where(inArray(nodes.id, nodeIds))
    .all();

  const porRaiz = new Map<string, typeof folhas>();
  for (const n of folhas) {
    const rootId = n.path.split('/')[0];
    const lista = porRaiz.get(rootId) ?? [];
    lista.push(n);
    porRaiz.set(rootId, lista);
  }

  const raizes = porRaiz.size
    ? await bd
        .select({ id: nodes.id, title: nodes.title, progress: nodes.progress })
        .from(nodes)
        .where(inArray(nodes.id, [...porRaiz.keys()]))
        .all()
    : [];

  return {
    projections: raizes.map((r) => ({
      rootId: r.id,
      rootTitle: r.title,
      current: r.progress,
      projected: projectProgress(
        r.progress,
        (porRaiz.get(r.id) ?? []).map((l) => ({
          contribution: l.root_impact,
          progress: l.progress,
        })),
      ),
    })),
  };
}

/** Folhas fechadas hoje, para o resumo do dia e para os widgets. */
export async function fechadasHoje(userId: string) {
  const bd = banco();
  return bd
    .select({ estimated_minutes: nodes.estimated_minutes, root_impact: nodes.root_impact })
    .from(nodes)
    .where(
      and(
        eq(nodes.user_id, userId),
        gte(nodes.completed_at, startOfDay(new Date())),
        lte(nodes.depth, 99),
        semFilhas,
      ),
    )
    .all();
}
