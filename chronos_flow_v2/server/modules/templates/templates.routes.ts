import { Router } from 'express';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { currentUserId } from '../../lib/currentUser.js';
import { notFound } from '../../lib/errors.js';
import { requireModels } from '../../lib/schemaGuard.js';
import { parseDate } from '../../lib/serialize.js';
import {
  createTemplateSchema,
  instantiateTemplateSchema,
} from '../../../shared/schemas/index.js';
import { toTemplateDTO } from '../../lib/serialize.js';
import * as nodes from '../nodes/nodes.service.js';

const router = Router();

router.use(requireModels('taskTemplate'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const spaceId = req.query.spaceId as string | undefined;

    const list = await prisma.taskTemplate.findMany({
      where: {
        user_id: userId,
        archived: false,
        ...(spaceId ? { space_id: spaceId } : {}),
      },
      include: { assignee: true },
      orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
    });

    res.json(list.map((t) => toTemplateDTO(t)));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = createTemplateSchema.parse(req.body);

    const space = await prisma.space.findFirst({
      where: { id: body.space_id, user_id: userId },
    });
    if (!space) throw notFound('Espaco');

    const last = await prisma.taskTemplate.findFirst({
      where: { user_id: userId, space_id: body.space_id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const created = await prisma.taskTemplate.create({
      data: {
        ...body,
        user_id: userId,
        position: body.position ?? (last?.position ?? -1) + 1,
        color: body.color ?? space.color,
      },
      include: { assignee: true },
    });

    res.status(201).json(toTemplateDTO(created));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = createTemplateSchema.partial().parse(req.body);

    const existing = await prisma.taskTemplate.findFirst({
      where: { id: req.params.id, user_id: userId },
    });
    if (!existing) throw notFound('Modelo');

    const updated = await prisma.taskTemplate.update({
      where: { id: existing.id },
      data: body,
      include: { assignee: true },
    });

    res.json(toTemplateDTO(updated));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const existing = await prisma.taskTemplate.findFirst({
      where: { id: req.params.id, user_id: userId },
    });
    if (!existing) throw notFound('Modelo');

    await prisma.taskTemplate.delete({ where: { id: existing.id } });
    res.json({ deleted: true });
  }),
);

/**
 * O gesto de soltar. A tarefa nasce como copia solta: editar uma nao mexe na
 * outra. O modelo so guarda que foi usado, para voce saber o que nunca sai
 * da estante.
 */
router.post(
  '/:id/instantiate',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = instantiateTemplateSchema.parse(req.body);

    const template = await prisma.taskTemplate.findFirst({
      where: { id: req.params.id, user_id: userId },
    });
    if (!template) throw notFound('Modelo');

    const start = parseDate(body.start_date);
    // Soltar no canvas ja diz quando comeca; o fim vem da estimativa do
    // modelo. Sem isso a barra nasceria com largura zero na timeline.
    const due =
      start && template.estimated_minutes
        ? new Date(start.getTime() + template.estimated_minutes * 60_000)
        : null;

    const node = await nodes.createNode(userId, {
      title: body.title ?? template.title,
      description: template.description,
      parent_id: body.parent_id ?? null,
      space_id: template.space_id,
      assignee_id: template.assignee_id,
      importance: template.importance,
      weight: template.weight,
      estimated_minutes: template.estimated_minutes,
      start_date: start ? start.toISOString() : undefined,
      due_date: due ? due.toISOString() : undefined,
      // O modelo cai no canvas com hora e duracao: dia inteiro apagaria as duas.
      all_day: body.all_day ?? false,
      position: body.position,
    });

    // A posicao pedida so vale se as irmas forem renumeradas junto: senao
    // empata com quem ja estava ali e a ordem vira sorteio do banco.
    if (body.position != null) {
      await nodes.renumberSiblings(prisma, userId, body.parent_id ?? null, {
        pin: node.id,
        at: body.position,
      });
    }

    const updated = await prisma.taskTemplate.update({
      where: { id: template.id },
      data: { uses: { increment: 1 }, last_used_at: new Date() },
      include: { assignee: true },
    });

    res.status(201).json({ node, template: toTemplateDTO(updated) });
  }),
);

export default router;
