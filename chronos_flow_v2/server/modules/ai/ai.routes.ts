import { Router, json } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { currentUserId } from '../../lib/currentUser.js';
import { preservarContexto, somenteSessao } from '../../lib/sessao.js';
import { aiSettingsSchema } from '../../../shared/schemas/index.js';
import { listModels, transcribeAudio } from './gemini.js';

const router = Router();

/** A chave nunca volta inteira para o cliente. */
const mask = (key: string | null) =>
  key ? `${key.slice(0, 4)}${'•'.repeat(Math.max(0, key.length - 8))}${key.slice(-4)}` : null;

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const userId = await currentUserId();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const envKey = process.env.GEMINI_API_KEY ?? null;
    res.json({
      configured: Boolean(user.gemini_api_key || envKey),
      source: user.gemini_api_key ? 'settings' : envKey ? 'env' : null,
      // A chave do servidor vale para todas as contas, mas nao e de nenhuma:
      // nem o pedaco mascarado dela aparece na tela de quem a usa.
      maskedKey: mask(user.gemini_api_key),
      model: user.gemini_model,
    });
  }),
);

router.patch(
  '/settings',
  somenteSessao,
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = aiSettingsSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(body.gemini_api_key !== undefined
          ? { gemini_api_key: body.gemini_api_key || null }
          : {}),
        ...(body.gemini_model ? { gemini_model: body.gemini_model } : {}),
      },
    });
    res.json({
      configured: Boolean(user.gemini_api_key || process.env.GEMINI_API_KEY),
      maskedKey: mask(user.gemini_api_key ?? process.env.GEMINI_API_KEY ?? null),
      model: user.gemini_model,
    });
  }),
);

/** Lista os modelos da propria chave: nada de chutar nome de modelo na interface. */
router.get(
  '/models',
  asyncHandler(async (_req, res) => {
    const userId = await currentUserId();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const key = user.gemini_api_key ?? process.env.GEMINI_API_KEY ?? '';
    res.json({ models: await listModels(key) });
  }),
);

const transcribeSchema = z.object({
  audio: z.string().min(16, 'audio vazio'),
  mimeType: z.string().max(80).default('audio/webm'),
});

/**
 * Audio chega em base64, entao o corpo e grande — daí o limite proprio,
 * bem acima do limite global de 2mb usado no resto da API.
 */
router.post(
  '/transcribe',
  preservarContexto(json({ limit: '25mb' })),
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const { audio, mimeType } = transcribeSchema.parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const apiKey = user.gemini_api_key ?? process.env.GEMINI_API_KEY ?? '';

    const text = await transcribeAudio(
      { apiKey, model: user.gemini_model },
      audio,
      // O navegador manda "audio/webm;codecs=opus"; a API quer so o tipo base.
      mimeType.split(';')[0].trim(),
    );

    res.json({ text });
  }),
);

export default router;
