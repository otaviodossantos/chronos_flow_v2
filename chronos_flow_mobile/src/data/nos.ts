import { and, asc, eq, inArray, isNull, like, ne, notInArray, or, sql } from 'drizzle-orm';
import { nodeActivity, nodeDependencies, nodes } from '@db/schema';
import {
  buildPath,
  rebasePath,
  isDescendantOf,
  rootIdOf,
  ancestorIdsBottomUp,
} from '@core/path';
import { canComplete, weightFromEstimate, statusAfterReopen } from '@core/cascade';
import { blockedNodeIds, newlyUnblocked } from '@core/dependencies';
import {
  janelaDeCriacao,
  validateAgainstParent,
  planReschedule,
  grownWindow,
} from '@core/scheduling';
import type {
  CreateNodeInput,
  UpdateNodeInput,
  BreakdownInput,
  RescheduleInput,
  TreeQuery,
} from '@shared/schemas/index';
import type { CompleteResult, NodeDTO, ReopenResult } from '@shared/types';
import { bd as banco, emTransacao, type BD } from './conexao';
import { paraNodeDTO, parseDate } from './serializar';
import * as repo from './repositorio';
import { ErroDeRegra, NaoEncontrado } from './repositorio';
import { doRamo, propagarDe, recalcularProprio, recontarFolhas, recalcularImpacto } from './cascata';

const novoId = () => crypto.randomUUID();

/** Prefixo do ramo, sem a propria raiz. */
const soDescendentes = (caminho: string) => like(nodes.path, `${caminho}/%`);

async function registrar(bd: BD, nodeId: string, kind: string, message: string) {
  await bd.insert(nodeActivity).values({ id: novoId(), node_id: nodeId, kind, message }).run();
}

/** Marca em BLOCKED / desbloqueia os nos afetados por uma mudanca de status. */
async function sincronizarBloqueios(bd: BD, userId: string, tocados: string[]) {
  const arestas = await repo.todasAsDependencias(bd, userId);
  if (arestas.length === 0) return;

  const ids = [...new Set(arestas.flatMap((e) => [e.blocker_id, e.blocked_id]).concat(tocados))];
  const linhas = await bd
    .select({ id: nodes.id, status: nodes.status })
    .from(nodes)
    .where(inArray(nodes.id, ids))
    .all();

  const statusPorId = new Map<string, string>(linhas.map((n) => [n.id, n.status]));
  const bloqueados = blockedNodeIds(arestas, statusPorId);

  // Em lote, nao um UPDATE por no: a lista cresce com o numero de dependencias.
  const aBloquear = linhas.filter((n) => bloqueados.has(n.id) && n.status === 'PENDING');
  const aLiberar = linhas.filter((n) => !bloqueados.has(n.id) && n.status === 'BLOCKED');

  if (aBloquear.length > 0) {
    await bd.update(nodes).set({ status: 'BLOCKED' })
      .where(inArray(nodes.id, aBloquear.map((n) => n.id))).run();
  }
  if (aLiberar.length > 0) {
    await bd.update(nodes).set({ status: 'PENDING' })
      .where(inArray(nodes.id, aLiberar.map((n) => n.id))).run();
  }
}

/**
 * Sobe a arvore alargando cada ancestral ate caber o que esta embaixo. So
 * cresce, e nao toca nas irmas: a cascata de cima para baixo (reagendar o pai)
 * e a de baixo para cima (aumentar a filha) precisam ser caminhos separados,
 * senao esticar uma filha reposicionaria todas as outras.
 *
 * Para cedo no primeiro ancestral que ja continha tudo. Custo O(profundidade).
 */
async function crescerAncestrais(bd: BD, caminho: string) {
  const crescidos: Array<{ id: string; title: string; start_date: Date | null; due_date: Date | null }> = [];

  for (const ancestralId of ancestorIdsBottomUp(caminho)) {
    const ancestral = await repo.acharNo(bd, ancestralId);
    if (!ancestral) break;

    const filhas = await bd
      .select({ start_date: nodes.start_date, due_date: nodes.due_date })
      .from(nodes)
      .where(eq(nodes.parent_id, ancestralId))
      .all();

    const proxima = grownWindow(ancestral, filhas);
    if (!proxima.changed) break;

    await bd.update(nodes)
      .set({ start_date: proxima.start_date, due_date: proxima.due_date })
      .where(eq(nodes.id, ancestralId)).run();

    crescidos.push({
      id: ancestral.id,
      title: ancestral.title,
      start_date: proxima.start_date,
      due_date: proxima.due_date,
    });
  }

  return crescidos;
}

/** Monta os DTOs de uma lista de nos com filhos, responsavel e dependencias. */
async function comoDTO(bd: BD, linhas: Array<typeof nodes.$inferSelect>): Promise<NodeDTO[]> {
  const ids = linhas.map((n) => n.id);
  const [filhas, pessoas, arestas] = await Promise.all([
    repo.contarFilhas(bd, ids),
    repo.responsaveis(bd, linhas.map((n) => n.assignee_id)),
    repo.dependenciasTocando(bd, ids),
  ]);

  return linhas.map((n) =>
    paraNodeDTO(n, {
      childCount: filhas.get(n.id) ?? 0,
      assignee: n.assignee_id ? (pessoas.get(n.assignee_id) ?? null) : null,
      blockedBy: arestas.filter((e) => e.blocked_id === n.id).map((e) => e.blocker_id),
      blocks: arestas.filter((e) => e.blocker_id === n.id).map((e) => e.blocked_id),
    }),
  );
}

async function umDTO(bd: BD, id: string): Promise<NodeDTO> {
  const no = await repo.exigirNo(bd, id);
  return (await comoDTO(bd, [no]))[0];
}

// ------------------------------------------------------------------ leitura

export async function arvore(userId: string, query: TreeQuery): Promise<NodeDTO[]> {
  const bd = banco();
  const maxDepth = query.maxDepth ?? 1;
  const status = query.status?.split(',').filter(Boolean);

  const filtros = [eq(nodes.user_id, userId)];

  if (query.rootId) {
    const raiz = await bd
      .select({ path: nodes.path, depth: nodes.depth })
      .from(nodes)
      .where(eq(nodes.id, query.rootId))
      .get();
    if (!raiz) throw new NaoEncontrado('No raiz');
    filtros.push(doRamo(raiz.path), sql`${nodes.depth} <= ${raiz.depth + maxDepth}`);
  } else {
    filtros.push(sql`${nodes.depth} <= ${maxDepth}`);
  }

  if (query.spaceId) filtros.push(eq(nodes.space_id, query.spaceId));
  if (query.assigneeId) filtros.push(eq(nodes.assignee_id, query.assigneeId));
  if (status?.length) filtros.push(inArray(nodes.status, status as never[]));
  // O `mode: 'insensitive'` do Postgres nao existe no SQLite; `like` ja ignora
  // caixa para ASCII, que e o caso de um titulo de tarefa.
  if (query.search) filtros.push(like(nodes.title, `%${query.search}%`));

  const linhas = await bd
    .select()
    .from(nodes)
    .where(and(...filtros))
    .orderBy(asc(nodes.depth), asc(nodes.position))
    .limit(4000)
    .all();

  return comoDTO(bd, linhas);
}

export async function filhasDe(parentId: string): Promise<NodeDTO[]> {
  const bd = banco();
  return comoDTO(bd, await repo.filhasDe(bd, parentId));
}

export async function detalhe(id: string) {
  const bd = banco();
  const no = await repo.exigirNo(bd, id);

  const idsAncestrais = no.path.split('/').slice(0, -1);
  const [ancestrais, filhas, arestas, atividade, descendentes] = await Promise.all([
    idsAncestrais.length
      ? bd.select({ id: nodes.id, title: nodes.title, depth: nodes.depth, progress: nodes.progress })
          .from(nodes).where(inArray(nodes.id, idsAncestrais)).all()
      : Promise.resolve([]),
    repo.filhasDe(bd, id),
    bd.select().from(nodeDependencies)
      .where(or(eq(nodeDependencies.blocker_id, id), eq(nodeDependencies.blocked_id, id)))
      .all(),
    bd.select().from(nodeActivity).where(eq(nodeActivity.node_id, id))
      .orderBy(sql`${nodeActivity.created_at} desc`).limit(12).all(),
    repo.contarSubarvore(bd, no.path),
  ]);

  // Titulo e status de quem aparece nos vinculos, numa consulta so.
  const idsVinculados = [...new Set(arestas.flatMap((d) => [d.blocker_id, d.blocked_id]))]
    .filter((x) => x !== id);
  const vinculados = idsVinculados.length
    ? await bd.select({ id: nodes.id, title: nodes.title, status: nodes.status })
        .from(nodes).where(inArray(nodes.id, idsVinculados)).all()
    : [];
  const porId = new Map(vinculados.map((v) => [v.id, v]));
  const mapaAncestrais = new Map(ancestrais.map((a) => [a.id, a]));

  return {
    node: await umDTO(bd, id),
    descendants: descendentes,
    ancestors: idsAncestrais
      .map((aid) => mapaAncestrais.get(aid))
      .filter((a): a is NonNullable<typeof a> => Boolean(a)),
    children: await comoDTO(bd, filhas),
    // O id da aresta vai junto: sem ele a tela mostra o vinculo mas nao o desfaz.
    dependsOn: arestas
      .filter((d) => d.blocked_id === id)
      .map((d) => ({ ...porId.get(d.blocker_id)!, dependency_id: d.id }))
      .filter((d) => d.id),
    blocksNodes: arestas
      .filter((d) => d.blocker_id === id)
      .map((d) => ({ ...porId.get(d.blocked_id)!, dependency_id: d.id }))
      .filter((d) => d.id),
    activity: atividade.map((a) => ({
      id: a.id,
      actor: a.actor,
      kind: a.kind,
      message: a.message,
      created_at: a.created_at.toISOString(),
    })),
  };
}

// ------------------------------------------------------------------ escrita

export async function criar(userId: string, input: CreateNodeInput): Promise<NodeDTO> {
  return emTransacao(async (bd) => {
    const pai = input.parent_id ? await repo.acharNo(bd, input.parent_id) : null;
    if (input.parent_id && !pai) throw new NaoEncontrado('Tarefa pai');

    const datas = janelaDeCriacao(
      { start_date: parseDate(input.start_date), due_date: parseDate(input.due_date) },
      pai,
      { agora: new Date(), estimatedMinutes: input.estimated_minutes },
    );

    const violacao = validateAgainstParent(datas, pai).find((v) => v.code === 'START_AFTER_DUE');
    if (violacao) throw new ErroDeRegra('VALIDATION_FAILED', violacao.message);

    const id = novoId();
    const caminho = buildPath(pai?.path ?? null, id);

    await bd.insert(nodes).values({
      id,
      user_id: userId,
      space_id: input.space_id ?? pai?.space_id ?? null,
      parent_id: pai?.id ?? null,
      path: caminho,
      depth: pai ? pai.depth + 1 : 0,
      position: input.position ?? (await repo.proximaPosicao(bd, pai?.id ?? null, userId)),
      title: input.title,
      description: input.description ?? null,
      importance: input.importance ?? pai?.importance ?? 3,
      weight: input.weight ?? weightFromEstimate(input.estimated_minutes),
      estimated_minutes: input.estimated_minutes ?? null,
      start_date: datas.start_date,
      due_date: datas.due_date,
      // A janela padrao tem hora; dia inteiro passou a ser a excecao.
      all_day: input.all_day ?? false,
      alarme: input.alarme ?? false,
      planned_date: parseDate(input.planned_date),
      scheduled_start: input.scheduled_start ?? null,
      scheduled_end: input.scheduled_end ?? null,
      assignee_id: input.assignee_id ?? null,
      leaf_count: 1,
    }).run();

    await registrar(bd, id, 'created', `Criou "${input.title}".`);

    if (pai) {
      // O pai deixou de ser folha: seu progresso passa a ser derivado.
      await bd.update(nodes).set({ manual_progress: null }).where(eq(nodes.id, pai.id)).run();
      await propagarDe(bd, id);
      const rootId = rootIdOf(caminho);
      if (rootId) {
        await recontarFolhas(bd, rootId);
        await recalcularImpacto(bd, rootId);
      }
      if (datas.start_date || datas.due_date) await crescerAncestrais(bd, caminho);
    } else {
      await bd.update(nodes).set({ root_impact: 1 }).where(eq(nodes.id, id)).run();
    }

    return umDTO(bd, id);
  });
}

export async function atualizar(
  userId: string,
  id: string,
  input: UpdateNodeInput,
): Promise<NodeDTO> {
  return emTransacao(async (bd) => {
    const atual = await repo.acharNo(bd, id);
    if (!atual) throw new NaoEncontrado('No');

    const filhas = await repo.filhasDe(bd, id);
    const temFilhas = filhas.length > 0;

    if (input.manual_progress != null && temFilhas) {
      throw new ErroDeRegra(
        'MANUAL_PROGRESS_ON_PARENT',
        'Um no com filhos tem progresso derivado da cascata e nao aceita valor manual.',
      );
    }

    if (input.status === 'COMPLETED' && temFilhas && !canComplete(filhas)) {
      const pendentes = filhas.filter((c) => c.status !== 'COMPLETED' && c.status !== 'CANCELLED');
      throw new ErroDeRegra(
        'PARENT_HAS_PENDING_CHILDREN',
        `Ha ${pendentes.length} subtarefa(s) pendente(s). Conclua-as primeiro.`,
        { pending: pendentes.map((c) => c.title) },
      );
    }

    if (input.status === 'COMPLETED' || input.status === 'IN_PROGRESS') {
      const abertos = await bloqueadoresAbertos(bd, id);
      if (abertos.length > 0) {
        throw new ErroDeRegra('BLOCKED_BY_DEPENDENCY', 'Esta tarefa esta bloqueada por outra.', {
          blockers: abertos,
        });
      }
    }

    const proximas = {
      start_date: input.start_date !== undefined ? parseDate(input.start_date) : atual.start_date,
      due_date: input.due_date !== undefined ? parseDate(input.due_date) : atual.due_date,
    };

    /**
     * Numa tarefa com horario, a barra da timeline E a duracao: mudar a
     * estimativa sem mexer no fim deixaria os dois numeros brigando na tela.
     * O fim segue a estimativa — mas so quando ela nao e prazo.
     */
    const proximoDiaInteiro = input.all_day ?? atual.all_day;
    const mudouEstimativa =
      input.estimated_minutes !== undefined &&
      input.estimated_minutes !== atual.estimated_minutes;
    const fimSegueEstimativa =
      mudouEstimativa &&
      !proximoDiaInteiro &&
      !temFilhas &&
      input.due_date === undefined &&
      Boolean(proximas.start_date) &&
      Boolean(input.estimated_minutes);

    if (fimSegueEstimativa) {
      proximas.due_date = new Date(
        proximas.start_date!.getTime() + input.estimated_minutes! * 60_000,
      );
    }

    const pai = atual.parent_id ? await repo.acharNo(bd, atual.parent_id) : null;
    const violacao = validateAgainstParent(proximas, pai).find((v) => v.code === 'START_AFTER_DUE');
    if (violacao) throw new ErroDeRegra('VALIDATION_FAILED', violacao.message);

    const mudouStatus = Boolean(input.status && input.status !== atual.status);

    await bd.update(nodes).set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.importance !== undefined ? { importance: input.importance } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
      ...(input.estimated_minutes !== undefined
        ? {
            estimated_minutes: input.estimated_minutes,
            ...(input.weight === undefined && !temFilhas
              ? { weight: weightFromEstimate(input.estimated_minutes) }
              : {}),
          }
        : {}),
      ...(input.start_date !== undefined ? { start_date: proximas.start_date } : {}),
      ...(input.due_date !== undefined || fimSegueEstimativa
        ? { due_date: proximas.due_date }
        : {}),
      ...(input.all_day !== undefined ? { all_day: input.all_day } : {}),
      ...(input.planned_date !== undefined
        ? { planned_date: parseDate(input.planned_date) }
        : {}),
      ...(input.scheduled_start !== undefined ? { scheduled_start: input.scheduled_start } : {}),
      ...(input.scheduled_end !== undefined ? { scheduled_end: input.scheduled_end } : {}),
      ...(input.assignee_id !== undefined ? { assignee_id: input.assignee_id } : {}),
      ...(input.space_id !== undefined ? { space_id: input.space_id } : {}),
      ...(input.manual_progress !== undefined ? { manual_progress: input.manual_progress } : {}),
      ...(mudouStatus && input.status === 'COMPLETED' ? { completed_at: new Date() } : {}),
      ...(mudouStatus && input.status !== 'COMPLETED' ? { completed_at: null } : {}),
    }).where(eq(nodes.id, id)).run();

    if (mudouStatus) {
      await registrar(bd, id, 'status', `Status mudou para ${input.status}.`);
      await sincronizarBloqueios(bd, userId, [id]);
    }

    /**
     * Espaco e propriedade do ramo, nao da tarefa solta. Mudar so a mae
     * deixaria o mesmo projeto partido entre dois espacos — e as filhas
     * sumiriam do filtro por espaco justamente onde se foi procurar por elas.
     */
    if (input.space_id !== undefined && input.space_id !== atual.space_id) {
      const quantas = await repo.contarSubarvore(bd, atual.path);
      if (quantas > 0) {
        await bd.update(nodes).set({ space_id: input.space_id })
          .where(and(eq(nodes.user_id, userId), soDescendentes(atual.path))).run();
        await registrar(bd, id, 'space', `Mudou de espaco e levou ${quantas} subtarefa(s) junto.`);
      }
    }

    // Data alterada pode ter estourado a janela do pai: ele acompanha.
    if (input.start_date !== undefined || input.due_date !== undefined || fimSegueEstimativa) {
      await crescerAncestrais(bd, atual.path);
    }

    await recalcularProprio(bd, id);
    await propagarDe(bd, id);

    if (input.weight !== undefined || input.estimated_minutes !== undefined) {
      const rootId = rootIdOf(atual.path);
      if (rootId) await recalcularImpacto(bd, rootId);
    }

    return umDTO(bd, id);
  });
}

async function bloqueadoresAbertos(bd: BD, id: string) {
  const arestas = await bd
    .select({ blocker_id: nodeDependencies.blocker_id })
    .from(nodeDependencies)
    .where(eq(nodeDependencies.blocked_id, id))
    .all();
  if (arestas.length === 0) return [];

  return bd
    .select({ id: nodes.id, title: nodes.title })
    .from(nodes)
    .where(
      and(
        inArray(nodes.id, arestas.map((a) => a.blocker_id)),
        notInArray(nodes.status, ['COMPLETED', 'CANCELLED']),
      ),
    )
    .all();
}

export async function concluir(userId: string, id: string): Promise<CompleteResult> {
  return emTransacao(async (bd) => {
    const no = await repo.acharNo(bd, id);
    if (!no) throw new NaoEncontrado('No');

    const filhas = await repo.filhasDe(bd, id);
    if (filhas.length > 0 && !canComplete(filhas)) {
      throw new ErroDeRegra(
        'PARENT_HAS_PENDING_CHILDREN',
        'Este no tem subtarefas pendentes. O progresso dele sobe sozinho quando elas fecharem.',
      );
    }

    const abertos = await bloqueadoresAbertos(bd, id);
    if (abertos.length > 0) {
      throw new ErroDeRegra('BLOCKED_BY_DEPENDENCY', 'Esta tarefa esta bloqueada por outra.', {
        blockers: abertos,
      });
    }

    await bd.update(nodes).set({
      status: 'COMPLETED',
      completed_at: new Date(),
      manual_progress: null,
      progress: 100,
    }).where(eq(nodes.id, id)).run();
    await registrar(bd, id, 'completed', 'Concluiu a tarefa.');

    const cascade = await propagarDe(bd, id);

    const arestas = await repo.todasAsDependencias(bd, userId);
    const idsTocados = [...new Set(arestas.flatMap((e) => [e.blocker_id, e.blocked_id]))];
    const statusPorId = new Map<string, string>(
      (idsTocados.length
        ? await bd.select({ id: nodes.id, status: nodes.status }).from(nodes)
            .where(inArray(nodes.id, idsTocados)).all()
        : []
      ).map((n) => [n.id, n.status]),
    );

    const liberados = newlyUnblocked(arestas, statusPorId, id);
    if (liberados.length > 0) {
      await bd.update(nodes).set({ status: 'PENDING' })
        .where(and(inArray(nodes.id, liberados), eq(nodes.status, 'BLOCKED'))).run();
    }
    const unblocked = liberados.length
      ? await bd.select({ id: nodes.id, title: nodes.title }).from(nodes)
          .where(inArray(nodes.id, liberados)).all()
      : [];

    const rootId = no.path.split('/')[0];
    const raiz = await bd.select({ title: nodes.title }).from(nodes)
      .where(eq(nodes.id, rootId)).get();

    return {
      node: await umDTO(bd, id),
      cascade,
      unblocked,
      impact: {
        rootId,
        rootTitle: raiz?.title ?? '',
        deltaPercent: Math.round(no.root_impact * 1000) / 10,
      },
    };
  });
}

/**
 * Desfaz uma conclusao. Nao e um `update` de status qualquer: reabrir tem duas
 * consequencias que o update generico nao cobre — os ancestrais concluidos
 * reabrem junto, e quem estava livre por causa desta tarefa volta a travar.
 */
export async function reabrir(userId: string, id: string): Promise<ReopenResult> {
  return emTransacao(async (bd) => {
    const no = await repo.acharNo(bd, id);
    if (!no) throw new NaoEncontrado('No');

    if (no.status !== 'COMPLETED' && no.status !== 'CANCELLED') {
      throw new ErroDeRegra('NOT_COMPLETED', 'Esta tarefa nao esta concluida.');
    }
    const estavaCancelada = no.status === 'CANCELLED';

    // Zerar antes de recalcular: enquanto o status for COMPLETED, a folha vale
    // 100 por definicao e o recalculo nao teria o que mudar.
    await bd.update(nodes).set({ status: 'PENDING', completed_at: null })
      .where(eq(nodes.id, id)).run();
    const proprio = await recalcularProprio(bd, id);

    const status = statusAfterReopen(proprio, estavaCancelada);
    if (status !== 'PENDING') {
      await bd.update(nodes).set({ status }).where(eq(nodes.id, id)).run();
    }

    const cascade = await propagarDe(bd, id);

    const idsAncestrais = ancestorIdsBottomUp(no.path);
    const ancestrais = idsAncestrais.length
      ? await bd.select({ id: nodes.id, title: nodes.title, progress: nodes.progress })
          .from(nodes)
          .where(and(inArray(nodes.id, idsAncestrais), eq(nodes.status, 'COMPLETED')))
          .all()
      : [];

    const reabertos = ancestrais.filter((a) => a.progress < 99.995);
    if (reabertos.length > 0) {
      await bd.update(nodes).set({ status: 'IN_PROGRESS', completed_at: null })
        .where(inArray(nodes.id, reabertos.map((a) => a.id))).run();
    }

    await registrar(bd, id, 'reopened', 'Reabriu a tarefa.');

    const antes = await bd.select({ id: nodes.id }).from(nodes)
      .where(and(eq(nodes.status, 'BLOCKED'), eq(nodes.user_id, userId))).all();
    const jaBloqueados = new Set(antes.map((n) => n.id));

    await sincronizarBloqueios(bd, userId, [id, ...reabertos.map((a) => a.id)]);

    const depois = await bd.select({ id: nodes.id, title: nodes.title }).from(nodes)
      .where(and(eq(nodes.status, 'BLOCKED'), eq(nodes.user_id, userId), ne(nodes.id, id))).all();
    const reblocked = depois.filter((n) => !jaBloqueados.has(n.id));

    return {
      node: await umDTO(bd, id),
      cascade,
      reopenedAncestors: reabertos.map((a) => ({ id: a.id, title: a.title })),
      reblocked,
    };
  });
}

export async function quebrar(userId: string, id: string, input: BreakdownInput) {
  return emTransacao(async (bd) => {
    const pai = await repo.acharNo(bd, id);
    if (!pai) throw new NaoEncontrado('Tarefa pai');

    const base = await repo.proximaPosicao(bd, id, userId);

    for (const [i, filha] of input.children.entries()) {
      const filhaId = novoId();
      const fim = parseDate(filha.due_date) ?? pai.due_date;

      if (fim && pai.due_date && fim > pai.due_date) {
        throw new ErroDeRegra(
          'DEADLINE_EXCEEDS_PARENT',
          `"${filha.title}" tem prazo depois do da tarefa pai.`,
          { parentDue: pai.due_date.toISOString() },
        );
      }

      await bd.insert(nodes).values({
        id: filhaId,
        user_id: userId,
        space_id: pai.space_id,
        parent_id: pai.id,
        path: buildPath(pai.path, filhaId),
        depth: pai.depth + 1,
        position: base + i,
        title: filha.title,
        importance: pai.importance,
        weight: filha.weight ?? weightFromEstimate(filha.estimated_minutes),
        estimated_minutes: filha.estimated_minutes ?? null,
        start_date: pai.start_date,
        due_date: fim,
        all_day: pai.all_day,
        assignee_id: filha.assignee_id ?? null,
        leaf_count: 1,
      }).run();
    }

    await bd.update(nodes).set({ manual_progress: null }).where(eq(nodes.id, id)).run();
    await registrar(bd, id, 'breakdown', `Quebrou em ${input.children.length} subtarefa(s).`);

    await recalcularProprio(bd, id);
    await propagarDe(bd, id);

    const rootId = pai.path.split('/')[0];
    await recontarFolhas(bd, rootId);
    await recalcularImpacto(bd, rootId);

    return {
      parent: await umDTO(bd, id),
      children: await comoDTO(bd, await repo.filhasDe(bd, id)),
    };
  });
}

/**
 * Deixa as posicoes de um grupo de irmas em 0..n-1, sem buracos nem empates.
 * Com `pin`, aquela tarefa e tirada da fila e reinserida no indice `at` — que e
 * contado na lista JA sem ela, que e como a tela enxerga o alvo.
 */
export async function renumerarIrmas(
  bd: BD,
  userId: string,
  parentId: string | null,
  fixada?: { pin: string; at?: number },
) {
  const irmas = await bd
    .select({ id: nodes.id })
    .from(nodes)
    .where(parentId ? eq(nodes.parent_id, parentId) : and(isNull(nodes.parent_id), eq(nodes.user_id, userId)))
    .orderBy(asc(nodes.position), asc(nodes.created_at))
    .all();

  let ordem = irmas.map((s) => s.id);
  if (fixada?.at != null) {
    ordem = ordem.filter((sid) => sid !== fixada.pin);
    ordem.splice(Math.max(0, Math.min(fixada.at, ordem.length)), 0, fixada.pin);
  }

  for (const [i, sid] of ordem.entries()) {
    await bd.update(nodes).set({ position: i }).where(eq(nodes.id, sid)).run();
  }
}

export async function mover(
  userId: string,
  id: string,
  newParentId: string | null,
  position?: number,
): Promise<NodeDTO> {
  return emTransacao(async (bd) => {
    const no = await repo.acharNo(bd, id);
    if (!no) throw new NaoEncontrado('No');

    const novoPai = newParentId ? await repo.acharNo(bd, newParentId) : null;
    if (newParentId && !novoPai) throw new NaoEncontrado('Novo pai');

    if (novoPai && (novoPai.id === id || isDescendantOf(novoPai.path, no.path))) {
      throw new ErroDeRegra('INVALID_MOVE', 'Um no nao pode ser movido para dentro de si mesmo.');
    }

    const caminhoAntigo = no.path;
    const raizAntiga = caminhoAntigo.split('/')[0];
    const caminhoNovo = buildPath(novoPai?.path ?? null, id);
    const deltaProfundidade = (novoPai ? novoPai.depth + 1 : 0) - no.depth;

    const ramo = await bd
      .select({ id: nodes.id, path: nodes.path, depth: nodes.depth })
      .from(nodes)
      .where(doRamo(caminhoAntigo))
      .all();

    const posicaoFinal = position ?? (await repo.proximaPosicao(bd, novoPai?.id ?? null, userId));

    for (const d of ramo) {
      await bd.update(nodes).set({
        path: rebasePath(d.path, caminhoAntigo, caminhoNovo),
        depth: d.depth + deltaProfundidade,
        ...(d.id === id
          ? {
              parent_id: novoPai?.id ?? null,
              position: posicaoFinal,
              space_id: novoPai?.space_id ?? no.space_id,
            }
          : {}),
      }).where(eq(nodes.id, d.id)).run();
    }

    // O ramo inteiro acompanha o espaco do novo pai: mover so a raiz do ramo
    // deixava as filhas orfas no espaco antigo.
    const novoEspaco = novoPai?.space_id ?? no.space_id;
    if (novoEspaco !== no.space_id) {
      await bd.update(nodes).set({ space_id: novoEspaco })
        .where(and(eq(nodes.user_id, userId), soDescendentes(caminhoNovo))).run();
    }

    // Renumerar as duas listas de irmas. Sem isso, um `position` explicito
    // empata com o de quem ja estava ali e a ordem vira sorteio do banco.
    const paiAntigo = no.parent_id;
    await renumerarIrmas(bd, userId, novoPai?.id ?? null, { pin: id, at: position });
    if (paiAntigo !== (novoPai?.id ?? null)) await renumerarIrmas(bd, userId, paiAntigo);

    await crescerAncestrais(bd, caminhoNovo);
    await registrar(bd, id, 'moved', 'Moveu o no na arvore.');

    if (no.parent_id) await propagarDe(bd, no.parent_id);
    await propagarDe(bd, id);

    const raizNova = caminhoNovo.split('/')[0];
    for (const rootId of new Set([raizAntiga, raizNova])) {
      await recontarFolhas(bd, rootId);
      await recalcularImpacto(bd, rootId);
    }

    return umDTO(bd, id);
  });
}

export async function excluir(id: string) {
  return emTransacao(async (bd) => {
    const no = await repo.acharNo(bd, id);
    if (!no) throw new NaoEncontrado('No');

    const rootId = no.path.split('/')[0];
    const paiId = no.parent_id;

    // Contado antes: depois do delete nao ha mais o que contar.
    const descendentes = await repo.contarSubarvore(bd, no.path);

    // A chave estrangeira da arvore limpa a subarvore em cascata.
    await bd.delete(nodes).where(eq(nodes.id, id)).run();

    if (paiId) {
      await recalcularProprio(bd, paiId);
      await propagarDe(bd, paiId);
      await recontarFolhas(bd, rootId);
      await recalcularImpacto(bd, rootId);
    }
    return { deleted: true, removed: descendentes + 1 };
  });
}

/** Texto do historico: diferencia mover de encolher, que sao gestos distintos. */
function descreverReagendamento(plan: { shiftedMinutes: number; scale: number; affected: unknown[] }): string {
  const filhas = plan.affected.length;
  const sufixo = filhas > 0 ? `, ajustando ${filhas} subtarefa(s)` : '';

  if (Math.abs(plan.scale - 1) > 0.001) {
    return `Redimensionou a janela para ${Math.round(plan.scale * 100)}% do tamanho${sufixo}.`;
  }
  if (plan.shiftedMinutes === 0) return 'Ajustou as datas.';
  return `Deslocou ${formatarOffset(plan.shiftedMinutes)}${sufixo}.`;
}

function formatarOffset(minutos: number): string {
  const sinal = minutos > 0 ? '+' : '-';
  const abs = Math.abs(minutos);
  if (abs % 1440 === 0) return `${sinal}${abs / 1440} dia(s)`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sinal}${m}min`;
  return m === 0 ? `${sinal}${h}h` : `${sinal}${h}h${String(m).padStart(2, '0')}`;
}

export async function reagendar(id: string, input: RescheduleInput) {
  const bd = banco();
  const no = await repo.acharNo(bd, id);
  if (!no) throw new NaoEncontrado('No');

  const proximas = {
    start_date: input.start_date !== undefined ? parseDate(input.start_date) : no.start_date,
    due_date: input.due_date !== undefined ? parseDate(input.due_date) : no.due_date,
  };

  const descendentes = await bd
    .select({
      id: nodes.id, title: nodes.title, parent_id: nodes.parent_id,
      start_date: nodes.start_date, due_date: nodes.due_date, all_day: nodes.all_day,
    })
    .from(nodes)
    .where(soDescendentes(no.path))
    .all();
  const pai = no.parent_id ? await repo.acharNo(bd, no.parent_id) : null;

  /**
   * Redimensionar sem levar as filhas (Shift no arraste) tem um piso: a janela
   * nao pode cortar nenhuma delas. `grownWindow` e exatamente essa conta, entao
   * encolher demais volta ao limite em vez de ser recusado.
   */
  const soltarFilhas = input.cascadeChildren === false;
  let travouNoLimite = false;
  if (soltarFilhas) {
    const diretas = descendentes.filter((c) => c.parent_id === id);
    const piso = grownWindow({ ...proximas, all_day: input.all_day ?? no.all_day }, diretas);
    travouNoLimite = piso.changed;
    proximas.start_date = piso.start_date;
    proximas.due_date = piso.due_date;
  }

  const plan = planReschedule(no, proximas, descendentes, pai, input.cascadeChildren ?? true);

  if (input.dryRun) return { applied: false, plan, grew: [], clampedToChildren: travouNoLimite };

  const proximoDiaInteiro = input.all_day ?? no.all_day;
  /**
   * Fecha o ciclo com a regra inversa: se a estimativa manda no fim da barra,
   * arrastar a borda da barra tem de mandar na estimativa. So em folha com
   * horario — num pai a janela e a soma das filhas. O peso NAO acompanha de
   * proposito: ele decide a fatia na meta macro.
   */
  const temFilhas = (await repo.filhasDe(bd, id)).length > 0;
  const estimativaDaJanela =
    !temFilhas && !proximoDiaInteiro && proximas.start_date && proximas.due_date
      ? Math.max(1, Math.round((proximas.due_date.getTime() - proximas.start_date.getTime()) / 60_000))
      : null;

  const grew = await emTransacao(async (tx) => {
    await tx.update(nodes).set({
      start_date: proximas.start_date,
      due_date: proximas.due_date,
      ...(input.all_day !== undefined ? { all_day: input.all_day } : {}),
      ...(estimativaDaJanela !== null ? { estimated_minutes: estimativaDaJanela } : {}),
    }).where(eq(nodes.id, id)).run();

    for (const mudanca of plan.affected) {
      await tx.update(nodes).set(mudanca.to).where(eq(nodes.id, mudanca.id)).run();
    }

    // Depois de mexer nesta tarefa, os pais podem ter ficado pequenos. Cresce
    // so o envelope: as irmas nao sao reposicionadas por tabela.
    const crescidos = (await crescerAncestrais(tx, no.path)).map((g) => ({ id: g.id, title: g.title }));

    await registrar(
      tx, id, 'rescheduled',
      crescidos.length > 0
        ? `${descreverReagendamento(plan)} ${crescidos.length} tarefa(s) acima cresceram para caber.`
        : descreverReagendamento(plan),
    );
    return crescidos;
  });

  return { applied: true, plan, grew, clampedToChildren: travouNoLimite };
}
