import { Router } from 'express';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { currentUserId } from '../../lib/currentUser.js';
import { notFound } from '../../lib/errors.js';
import { toNodeUpdateDTO } from '../../lib/serialize.js';
import { requireModels } from '../../lib/schemaGuard.js';
import {
  createNodeUpdateSchema,
  editNodeUpdateSchema,
  nodeUpdatesQuerySchema,
} from '../../../shared/schemas/index.js';

/**
 * Feed de atualizacoes por tarefa, no estilo do Monday. Texto em markdown,
 * quantas a tarefa precisar, mais nova primeiro.
 *
 * Mora fora de `/api/nodes` porque editar e apagar falam da atualizacao, nao
 * da tarefa: `/api/updates/:id` dispensa saber de qual no ela e.
 */
const router = Router();

router.use(requireModels('nodeUpdate'));

/** O no tem de ser deste usuario: o id sozinho nao basta para escrever nele. */
async function requireOwnNode(userId: string, nodeId: string) {
  const node = await prisma.node.findFirst({
    where: { id: nodeId, user_id: userId },
    select: { id: true },
  });
  if (!node) throw notFound('No');
}

async function requireOwnUpdate(userId: string, id: string) {
  const update = await prisma.nodeUpdate.findFirst({
    where: { id, node: { user_id: userId } },
  });
  if (!update) throw notFound('Atualizacao');
  return update;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const { nodeId } = nodeUpdatesQuerySchema.parse(req.query);
    await requireOwnNode(userId, nodeId);
    const updates = await prisma.nodeUpdate.findMany({
      where: { node_id: nodeId },
      orderBy: { created_at: 'desc' },
    });
    res.json(updates.map(toNodeUpdateDTO));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = createNodeUpdateSchema.parse(req.body);
    await requireOwnNode(userId, body.node_id);

    // Sem autor explicito, assina com o nome do perfil — e o que a tela mostra
    // para quem esta usando o app.
    const author =
      body.author ??
      (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }))
        .name;

    const created = await prisma.nodeUpdate.create({
      data: { node_id: body.node_id, body: body.body, author },
    });
    res.status(201).json(toNodeUpdateDTO(created));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const { body } = editNodeUpdateSchema.parse(req.body);
    await requireOwnUpdate(userId, req.params.id);
    const updated = await prisma.nodeUpdate.update({
      where: { id: req.params.id },
      data: { body },
    });
    res.json(toNodeUpdateDTO(updated));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    await requireOwnUpdate(userId, req.params.id);
    await prisma.nodeUpdate.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  }),
);

export default router;
