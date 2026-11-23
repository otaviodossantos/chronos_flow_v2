import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { prisma, type Tx } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { currentUserId } from '../../lib/currentUser.js';
import { AppError, notFound } from '../../lib/errors.js';
import { parseDate } from '../../lib/serialize.js';
import { requireModels } from '../../lib/schemaGuard.js';
import { buildPath } from '../../domain/path.js';
import { weightFromEstimate } from '../../domain/cascade.js';
import { janelasDoPlano, envelope } from '../../domain/agenda.js';
import { findCycle } from '../../domain/dependencies.js';
import { refreshLeafCounts, refreshRootImpact, propagateFrom } from '../nodes/cascade.service.js';
import { planBacklogItem } from '../ai/planner.js';
import {
  createBacklogSchema, applyPlanSchema, savePlanSchema, planRequestSchema,
  type PlanTask,
} from '../../../shared/schemas/index.js';

import { donoDoParam, garantirDono } from '../../lib/dono.js';

const router = Router();

router.param('id', donoDoParam('backlogItem'));
router.param('roleId', donoDoParam('backlogRole'));

// Todo o modulo depende dos modelos novos do schema.
router.use(requireModels('backlogItem', 'backlogRole'));

const shape = (b: any) => ({
  id: b.id,
  title: b.title,
  notes: b.notes ?? null,
  context: b.context ?? null,
  status: b.status,
  position: b.position,
  space_id: b.space_id ?? null,
  start_date: b.start_date ? b.start_date.toISOString() : null,
  target_date: b.target_date ? b.target_date.toISOString() : null,
  max_tasks: b.max_tasks ?? null,
  ai_plan: b.ai_plan ?? null,
  ai_model: b.ai_model ?? null,
  ai_planned_at: b.ai_planned_at ? b.ai_planned_at.toISOString() : null,
  converted_node_id: b.converted_node_id ?? null,
  roles: (b.roles ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    hours_per_week: r.hours_per_week ?? null,
    headcount: r.headcount,
    member_id: r.member_id ?? null,
    member: r.member ? { id: r.member.id, name: r.member.name, color: r.member.color } : null,
  })),
  created_at: b.created_at.toISOString(),
});

const include = { roles: { include: { member: true }, orderBy: { position: 'asc' as const } } };

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const userId = await currentUserId();
    const items = await prisma.backlogItem.findMany({
      where: { user_id: userId },
      include,
      orderBy: [{ status: 'asc' }, { position: 'asc' }],
    });
    res.json(items.map(shape));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = createBacklogSchema.parse(req.body);
    await garantirDono('space', body.space_id);
    const last = await prisma.backlogItem.findFirst({
      where: { user_id: userId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const created = await prisma.backlogItem.create({
      data: {
        ...body,
        user_id: userId,
        start_date: parseDate(body.start_date),
        target_date: parseDate(body.target_date),
        position: body.position ?? (last?.position ?? -1) + 1,
      },
      include,
    });
    res.status(201).json(shape(created));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = createBacklogSchema.partial().parse(req.body);
    await garantirDono('space', body.space_id);
    const updated = await prisma.backlogItem.update({
      where: { id: req.params.id },
      data: {
        ...body,
        ...(body.start_date !== undefined ? { start_date: parseDate(body.start_date) } : {}),
        ...(body.target_date !== undefined ? { target_date: parseDate(body.target_date) } : {}),
      },
      include,
    });
    res.json(shape(updated));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await prisma.backlogItem.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  }),
);

/** Pede o rascunho ao modelo. Nada e criado na arvore aqui. */
router.post(
  '/:id/plan',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const { extraInstructions, maxTasks } = planRequestSchema.parse(req.body ?? {});

    const [item, user, members] = await Promise.all([
      prisma.backlogItem.findUnique({ where: { id: req.params.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.member.findMany({ where: { user_id: userId }, select: { name: true, role: true } }),
    ]);
    if (!item) throw notFound('Item do backlog');

    const apiKey = user.gemini_api_key ?? process.env.GEMINI_API_KEY ?? '';
    const plan = await planBacklogItem(
      { apiKey, model: user.gemini_model },
      {
        title: item.title,
        notes: item.notes,
        context: item.context,
        startDate: item.start_date,
        targetDate: item.target_date,
        existingRoles: members.map((m) => m.role ?? m.name).filter(Boolean) as string[],
        extraInstructions,
        // O teto do corpo da requisicao ganha do gravado no item: e assim que
        // "gerar de novo, mas com metade disso" funciona sem gravar antes.
        maxTasks: maxTasks !== undefined ? maxTasks : item.max_tasks,
      },
    );

    const updated = await prisma.backlogItem.update({
      where: { id: item.id },
      data: {
        ai_plan: plan as any,
        ai_model: user.gemini_model,
        ai_planned_at: new Date(),
        status: item.status === 'INBOX' ? 'PLANNING' : item.status,
      },
      include,
    });

    res.json(shape(updated));
  }),
);

/**
 * Aplica o rascunho ja revisado: cria a meta macro com a arvore inteira numa
 * transacao, e guarda os papeis que ficaram sem pessoa para preencher depois.
 */
/**
 * Guarda o rascunho como ele esta na tela — tarefas e papeis descartados
 * inclusive. Sem isto, escolher o que fica e o que sai era trabalho que
 * evaporava ao trocar de item ou fechar a janela.
 */
router.patch(
  '/:id/plan',
  asyncHandler(async (req, res) => {
    const { plan } = savePlanSchema.parse(req.body);
    await garantirDono('member', plan.roles.map((r) => r.member_id));

    const item = await prisma.backlogItem.findUnique({ where: { id: req.params.id } });
    if (!item) throw notFound('Item do backlog');

    // `ai_planned_at` nao e tocado de proposito: ele marca quando a IA gerou, e
    // e por essa marca que a tela decide descartar o rascunho local. Mexer nela
    // aqui faria cada salvamento jogar fora a edicao em curso.
    const updated = await prisma.backlogItem.update({
      where: { id: req.params.id },
      data: { ai_plan: plan as object },
      include,
    });

    res.json(shape(updated));
  }),
);

router.post(
  '/:id/apply',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = applyPlanSchema.parse(req.body);
    await Promise.all([
      garantirDono('space', body.space_id),
      garantirDono('member', body.plan.roles.map((r) => r.member_id)),
    ]);

    const item = await prisma.backlogItem.findUnique({ where: { id: req.params.id } });
    if (!item) throw notFound('Item do backlog');

    const kept = body.plan.tasks.filter((t) => t.keep !== false);
    if (kept.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Nenhuma tarefa marcada para criar.');
    }

    const projectStart = parseDate(body.start_date) ?? item.start_date ?? new Date();
    projectStart.setHours(9, 0, 0, 0);
    const projectEnd = item.target_date ?? null;

    // Papel -> membro, para atribuir as folhas ja na criacao.
    const roleToMember = new Map<string, string>();
    for (const role of body.plan.roles) {
      if (role.keep !== false && role.member_id) roleToMember.set(role.title, role.member_id);
    }

    const rootId = randomUUID();

    /**
     * Primeiro o plano vira uma lista plana com ids, depois as datas sao
     * calculadas, e so entao o banco e tocado. A ordem importa: as dependencias
     * so existem depois que todo mundo tem id, e o agendamento so faz sentido
     * depois que as dependencias existem.
     */
    interface NoDoPlano {
      id: string;
      parentId: string;
      parentPath: string;
      depth: number;
      position: number;
      task: PlanTask;
      folha: boolean;
    }

    const plano: NoDoPlano[] = [];
    const byRef = new Map<string, string>();

    const achatar = (tasks: PlanTask[], parentId: string, parentPath: string, depth: number) => {
      let position = 0;
      for (const task of tasks) {
        if (task.keep === false) continue;

        const id = randomUUID();
        const filhas = (task.children ?? []).filter((c) => c.keep !== false);
        plano.push({ id, parentId, parentPath, depth, position, task, folha: filhas.length === 0 });
        position += 1;

        if (task.ref) byRef.set(task.ref, id);
        if (filhas.length > 0) achatar(filhas, id, buildPath(parentPath, id), depth + 1);
      }
    };
    achatar(kept, rootId, rootId, 1);

    // As dependencias entram no agendamento, entao sao resolvidas antes dele.
    const edges: Array<{ blocker_id: string; blocked_id: string }> = [];
    if (body.applyDependencies !== false) {
      for (const no of plano) {
        for (const ref of no.task.depends_on ?? []) {
          const blockerId = byRef.get(ref);
          if (!blockerId || blockerId === no.id) continue;
          if (findCycle(edges, blockerId, no.id)) continue;
          edges.push({ blocker_id: blockerId, blocked_id: no.id });
        }
      }
    }

    /**
     * O plano da IA nao diz quando cada coisa acontece — `offset_days` e um
     * palpite em granularidade de dia, e usa-lo como resposta jogava o projeto
     * inteiro no mesmo instante. Aqui ele vira apenas um piso, e o "quando" sai
     * da estimativa, da ordem de dependencia e da agenda de cada responsavel.
     */
    const janelas = janelasDoPlano(
      plano.map((no) => ({
        id: no.id,
        parentId: no.parentId,
        folha: no.folha,
        estimated_minutes: no.task.estimated_minutes,
        duration_days: no.task.duration_days,
        offset_days: no.task.offset_days,
        role: no.task.role,
        depends_on: no.task.depends_on,
      })),
      { inicio: projectStart, refParaId: byRef, papelParaAgenda: roleToMember },
    );

    // Sem cortar nada para caber: um plano que estoura a entrega precisa
    // aparecer estourado, e nao amontoado na data limite.
    const fimPrevisto = envelope([...janelas.values()])?.due_date ?? projectStart;
    const atrasaEntrega = Boolean(projectEnd && fimPrevisto > projectEnd);

    const result = await prisma.$transaction(async (tx) => {
      const lastRoot = await tx.node.findFirst({
        where: { user_id: userId, parent_id: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      });

      await tx.node.create({
        data: {
          id: rootId,
          user_id: userId,
          space_id: body.space_id ?? item.space_id ?? null,
          parent_id: null,
          path: rootId,
          depth: 0,
          position: (lastRoot?.position ?? -1) + 1,
          title: item.title,
          description: body.plan.summary ?? item.notes ?? null,
          importance: body.importance ?? 4,
          root_impact: 1,
          start_date: projectStart,
          due_date: projectEnd ?? fimPrevisto,
          all_day: true,
        },
      });

      const created = plano.length + 1;

      // Pre-ordem: a mae sempre foi empilhada antes das filhas.
      for (const no of plano) {
        const janela = janelas.get(no.id)!;
        await tx.node.create({
          data: {
            id: no.id,
            user_id: userId,
            space_id: body.space_id ?? item.space_id ?? null,
            parent_id: no.parentId,
            path: buildPath(no.parentPath, no.id),
            depth: no.depth,
            position: no.position,
            title: no.task.title,
            description: no.task.detail ?? null,
            importance: body.importance ?? 4,
            weight: weightFromEstimate(no.task.estimated_minutes),
            estimated_minutes: no.task.estimated_minutes ?? null,
            start_date: janela.start_date,
            due_date: janela.due_date,
            // Tudo aqui tem horario de verdade agora.
            all_day: false,
            assignee_id: no.task.role ? (roleToMember.get(no.task.role) ?? null) : null,
            leaf_count: 1,
          },
        });
      }

      // Dependencias sugeridas. Refs que apontam para tarefas descartadas
      // simplesmente nao existem no mapa e ja foram ignoradas acima.
      for (const edge of edges) {
        await tx.nodeDependency.create({ data: edge });
      }
      if (edges.length > 0) {
        const blocked = [...new Set(edges.map((e) => e.blocked_id))];
        await tx.node.updateMany({
          where: { id: { in: blocked }, status: 'PENDING' },
          data: { status: 'BLOCKED' },
        });
      }
      const dependencies = edges.length;

      await propagateFrom(rootId, tx as Tx);
      await refreshLeafCounts(rootId, tx as Tx);
      await refreshRootImpact(rootId, tx as Tx);

      // Papeis sobrevivem ao rascunho: sao o que voce vai preencher com gente.
      await tx.backlogRole.deleteMany({ where: { backlog_item_id: item.id } });
      const roles = body.plan.roles.filter((r) => r.keep !== false);
      for (const [index, role] of roles.entries()) {
        await tx.backlogRole.create({
          data: {
            backlog_item_id: item.id,
            title: role.title,
            description: role.description ?? null,
            hours_per_week: role.hours_per_week ?? null,
            headcount: role.headcount ?? 1,
            member_id: role.member_id ?? null,
            position: index,
          },
        });
      }

      await tx.backlogItem.update({
        where: { id: item.id },
        data: { status: 'CONVERTED', converted_node_id: rootId },
      });

      return { created, roles: roles.length, dependencies };
    });

    const fresh = await prisma.backlogItem.findUniqueOrThrow({
      where: { id: item.id },
      include,
    });

    res.json({
      item: shape(fresh),
      rootId,
      nodesCreated: result.created,
      roles: result.roles,
      dependencies: result.dependencies,
      fimPrevisto: fimPrevisto.toISOString(),
      atrasaEntrega,
    });
  }),
);

/** Liga um papel a alguem da equipe. */
router.patch(
  '/roles/:roleId',
  asyncHandler(async (req, res) => {
    const memberId = (req.body?.member_id ?? null) as string | null;
    await garantirDono('member', memberId);
    const updated = await prisma.backlogRole.update({
      where: { id: req.params.roleId },
      data: { member_id: memberId },
      include: { member: true },
    });
    res.json({
      id: updated.id,
      member_id: updated.member_id,
      member: updated.member
        ? { id: updated.member.id, name: updated.member.name, color: updated.member.color }
        : null,
    });
  }),
);

export default router;
