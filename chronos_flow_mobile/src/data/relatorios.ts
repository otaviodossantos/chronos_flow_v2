import { and, asc, eq, gte, inArray, isNull, max, sql } from 'drizzle-orm';
import { members, nodes, progressSnapshots, spaces } from '@db/schema';
import { blockedNodeIds } from '@core/dependencies';
import { startOfDay } from '@core/impact';
import { bd as banco } from './conexao';
import { todasAsDependencias } from './repositorio';

const novoId = () => crypto.randomUUID();
const semFilhas = sql`not exists (select 1 from ${nodes} as f where f.parent_id = ${nodes.id})`;
const diaCivil = (d: Date) => d.toISOString().slice(0, 10);

export async function velocidade(userId: string) {
  const bd = banco();
  const desde = new Date();
  desde.setDate(desde.getDate() - 30);

  const concluidas = await bd
    .select({ q: sql<number>`count(*)` })
    .from(nodes)
    .where(and(eq(nodes.user_id, userId), gte(nodes.completed_at, desde), semFilhas))
    .get();

  const comEstimativa = await bd
    .select({
      estimated_minutes: nodes.estimated_minutes,
      created_at: nodes.created_at,
      completed_at: nodes.completed_at,
    })
    .from(nodes)
    .where(
      and(
        eq(nodes.user_id, userId),
        gte(nodes.completed_at, desde),
        sql`${nodes.estimated_minutes} is not null`,
        semFilhas,
      ),
    )
    .all();

  // Desvio medio entre esforco previsto e tempo real de ponta a ponta.
  const desvios = comEstimativa
    .filter((n) => n.completed_at)
    .map((n) => {
      const real = (n.completed_at!.getTime() - n.created_at.getTime()) / 60_000;
      const previsto = n.estimated_minutes ?? 1;
      return (real - previsto) / previsto;
    });
  const desvioMedio =
    desvios.length > 0
      ? Math.round((desvios.reduce((a, b) => a + b, 0) / desvios.length) * 1000) / 10
      : 0;

  const profundidade = await bd
    .select({ media: sql<number>`avg(${nodes.depth})`, maxima: max(nodes.depth) })
    .from(nodes)
    .where(eq(nodes.user_id, userId))
    .get();

  const raizes = await bd
    .select({ progress: nodes.progress })
    .from(nodes)
    .where(and(eq(nodes.user_id, userId), isNull(nodes.parent_id)))
    .all();

  const arestas = await todasAsDependencias(bd, userId);
  const status = await bd
    .select({ id: nodes.id, status: nodes.status })
    .from(nodes).where(eq(nodes.user_id, userId)).all();
  const travadas = blockedNodeIds(arestas, new Map(status.map((s) => [s.id, s.status])));

  return {
    completedLeaves30d: Number(concluidas?.q ?? 0),
    avgRootProgress:
      raizes.length > 0
        ? Math.round((raizes.reduce((s, r) => s + r.progress, 0) / raizes.length) * 10) / 10
        : 0,
    bottlenecks: travadas.size,
    estimateDeviationPercent: desvioMedio,
    avgDepth: Math.round(Number(profundidade?.media ?? 0) * 10) / 10,
    maxDepth: Number(profundidade?.maxima ?? 0),
  };
}

export async function mapaDeRisco(userId: string) {
  const bd = banco();
  const raizes = await bd
    .select({
      id: nodes.id, title: nodes.title, progress: nodes.progress,
      path: nodes.path, depth: nodes.depth,
      espacoNome: spaces.name, espacoCor: spaces.color, dono: members.name,
    })
    .from(nodes)
    .leftJoin(spaces, eq(spaces.id, nodes.space_id))
    .leftJoin(members, eq(members.id, nodes.assignee_id))
    .where(and(eq(nodes.user_id, userId), isNull(nodes.parent_id)))
    .orderBy(asc(nodes.position))
    .all();

  const arestas = await todasAsDependencias(bd, userId);
  const todos = await bd
    .select({
      id: nodes.id, status: nodes.status, path: nodes.path,
      title: nodes.title, due_date: nodes.due_date, depth: nodes.depth,
    })
    .from(nodes).where(eq(nodes.user_id, userId)).all();

  const travadas = blockedNodeIds(arestas, new Map(todos.map((s) => [s.id, s.status])));
  const hoje = startOfDay(new Date());

  return {
    roots: raizes.map((raiz) => {
      const ramo = todos.filter((s) => s.path.startsWith(`${raiz.path}/`));
      const idsDoRamo = new Set(ramo.map((s) => s.id));
      const presas = [...travadas].filter((id) => idsDoRamo.has(id));
      const atrasadas = ramo.filter(
        (s) => s.due_date && s.due_date < hoje && s.status !== 'COMPLETED',
      );
      const maisFundo = ramo.reduce((m, s) => Math.max(m, s.depth), raiz.depth);

      const risco =
        presas.length > 0 || atrasadas.length > 0
          ? raiz.progress < 30
            ? 'critical'
            : 'warning'
          : raiz.progress >= 60
            ? 'good'
            : 'warning';

      return {
        id: raiz.id,
        title: raiz.title,
        space: raiz.espacoNome ? { name: raiz.espacoNome, color: raiz.espacoCor } : null,
        owner: raiz.dono ?? null,
        progress: raiz.progress,
        childCount: ramo.length,
        levels: maisFundo - raiz.depth,
        blocked: presas.length,
        overdue: atrasadas.length,
        risk: risco,
        focalPoint:
          presas.length > 0
            ? (ramo.find((s) => s.id === presas[0])?.title ?? null)
            : (atrasadas[0]?.title ?? null),
      };
    }),
  };
}

export async function historico(userId: string, dias = 30) {
  const bd = banco();
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);

  const linhas = await bd
    .select({
      nodeId: nodes.id, title: nodes.title,
      date: progressSnapshots.captured_on,
      progress: progressSnapshots.progress,
      leafEffort: progressSnapshots.leaf_effort,
    })
    .from(progressSnapshots)
    .innerJoin(nodes, eq(nodes.id, progressSnapshots.node_id))
    .where(
      and(
        eq(nodes.user_id, userId),
        isNull(nodes.parent_id),
        gte(progressSnapshots.captured_on, diaCivil(desde)),
      ),
    )
    .orderBy(asc(progressSnapshots.captured_on))
    .all();

  return { series: linhas };
}

/** Grava o retrato do dia. Chamado na abertura e depois de cada conclusao. */
export async function capturarRetrato(userId: string) {
  const bd = banco();
  const hoje = diaCivil(startOfDay(new Date()));

  const raizes = await bd
    .select({ id: nodes.id, progress: nodes.progress, path: nodes.path })
    .from(nodes)
    .where(and(eq(nodes.user_id, userId), isNull(nodes.parent_id)))
    .all();

  for (const raiz of raizes) {
    const esforco = await bd
      .select({ soma: sql<number>`coalesce(sum(${nodes.estimated_minutes}), 0)` })
      .from(nodes)
      .where(
        and(
          sql`${nodes.path} like ${`${raiz.path}/%`}`,
          gte(nodes.completed_at, startOfDay(new Date())),
        ),
      )
      .get();

    const existente = await bd
      .select({ id: progressSnapshots.id })
      .from(progressSnapshots)
      .where(
        and(eq(progressSnapshots.node_id, raiz.id), eq(progressSnapshots.captured_on, hoje)),
      )
      .get();

    const valores = { progress: raiz.progress, leaf_effort: Number(esforco?.soma ?? 0) };

    // O `upsert` do Prisma: o SQLite tem o indice unico, mas o Drizzle pede
    // que a decisao seja explicita.
    if (existente) {
      await bd.update(progressSnapshots).set(valores)
        .where(eq(progressSnapshots.id, existente.id)).run();
    } else {
      await bd.insert(progressSnapshots)
        .values({ id: novoId(), node_id: raiz.id, captured_on: hoje, ...valores }).run();
    }
  }
}

export const _inArray = inArray;
