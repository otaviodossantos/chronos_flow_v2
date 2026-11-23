import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { currentUserId } from '../../lib/currentUser.js';
import {
  createNodeSchema,
  updateNodeSchema,
  breakdownSchema,
  moveNodeSchema,
  rescheduleSchema,
  setStatusSchema,
  treeQuerySchema,
} from '../../../shared/schemas/index.js';
import * as service from './nodes.service.js';
import { donoDoParam, garantirDono } from '../../lib/dono.js';

const router = Router();

// Toda rota com :id so segue se o no for da conta logada.
router.param('id', donoDoParam('node'));

/** Os ids que viram vinculo tambem tem de ser da conta. */
async function vinculos(b: { parent_id?: string | null; space_id?: string | null; assignee_id?: string | null }) {
  await Promise.all([
    garantirDono('node', b.parent_id),
    garantirDono('space', b.space_id),
    garantirDono('member', b.assignee_id),
  ]);
}

router.get(
  '/tree',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    res.json(await service.getTree(userId, treeQuerySchema.parse(req.query)));
  }),
);

router.get(
  '/:id/children',
  asyncHandler(async (req, res) => {
    res.json(await service.getChildren(req.params.id));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await service.getNodeDetail(req.params.id));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = createNodeSchema.parse(req.body);
    await vinculos(body);
    res.status(201).json(await service.createNode(userId, body));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = updateNodeSchema.parse(req.body);
    await vinculos({ space_id: body.space_id, assignee_id: body.assignee_id });
    res.json(await service.updateNode(userId, req.params.id, body));
  }),
);

router.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    res.json(await service.completeLeaf(userId, req.params.id));
  }),
);

router.post(
  '/:id/breakdown',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = breakdownSchema.parse(req.body);
    await garantirDono('member', body.children.map((c) => c.assignee_id));
    res.json(await service.breakdown(userId, req.params.id, body));
  }),
);

router.post(
  '/:id/move',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = moveNodeSchema.parse(req.body);
    await garantirDono('node', body.parent_id);
    res.json(await service.moveNode(userId, req.params.id, body.parent_id, body.position));
  }),
);

router.post(
  '/:id/reschedule',
  asyncHandler(async (req, res) => {
    res.json(await service.reschedule(req.params.id, rescheduleSchema.parse(req.body)));
  }),
);

/** Troca de status como gesto unico: o Kanban e o MCP passam por aqui. */
router.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    res.json(await service.setStatus(userId, req.params.id, setStatusSchema.parse(req.body)));
  }),
);

router.post(
  '/:id/reopen',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    res.json(await service.reopenNode(userId, req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await service.deleteNode(req.params.id));
  }),
);

export default router;
