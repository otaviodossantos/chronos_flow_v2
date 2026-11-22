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

const router = Router();

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
    res.status(201).json(await service.createNode(userId, createNodeSchema.parse(req.body)));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    res.json(await service.updateNode(userId, req.params.id, updateNodeSchema.parse(req.body)));
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
    res.json(await service.breakdown(userId, req.params.id, breakdownSchema.parse(req.body)));
  }),
);

router.post(
  '/:id/move',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = moveNodeSchema.parse(req.body);
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
