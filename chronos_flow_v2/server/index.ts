process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ZodError } from 'zod';
import { AppError } from './lib/errors.js';
import { exigeAcesso, enderecosDaRede } from './lib/acesso.js';
import { currentUserId } from './lib/currentUser.js';
import { missingModels } from './lib/schemaGuard.js';
import { recomputeAll } from './modules/nodes/cascade.service.js';
import nodeRoutes from './modules/nodes/nodes.routes.js';
import dependencyRoutes from './modules/dependencies/dependencies.routes.js';
import spaceRoutes from './modules/spaces/spaces.routes.js';
import memberRoutes from './modules/members/members.routes.js';
import focusRoutes from './modules/focus/focus.routes.js';
import reportRoutes, { captureSnapshots } from './modules/reports/reports.routes.js';
import lifeRoutes from './modules/life/life.routes.js';
import userRoutes from './modules/user/user.routes.js';
import backlogRoutes from './modules/backlog/backlog.routes.js';
import templateRoutes from './modules/templates/templates.routes.js';
import aiRoutes from './modules/ai/ai.routes.js';
import transferRoutes, { nomeDesteComputador } from './modules/transfer/transfer.routes.js';
import { anunciar, PORTA_DESCOBERTA } from './lib/descoberta.js';
import { FORMATO_DO_PACOTE } from '../shared/transferencia.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? 3101);

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '2mb' }));

/**
 * A transferencia entra antes do porteiro geral.
 *
 * O celular nao tem como apresentar o `CHRONOS_ACCESS_TOKEN` do `.env`, e
 * entrega-lo a ele daria acesso a API inteira em vez de a uma transferencia.
 * Entao este modulo tem a propria porta: um codigo de seis digitos que voce
 * libera na tela, vale cinco minutos e serve uma vez. Cada rota de la declara
 * quem pode chama-la.
 */
app.use('/api/transfer', transferRoutes);

// Antes de qualquer outra rota, inclusive da tela: de fora, so com token.
app.use(exigeAcesso());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'Chronos Flow v2', timestamp: new Date().toISOString() });
});

app.use('/api/nodes', nodeRoutes);
app.use('/api/dependencies', dependencyRoutes);
app.use('/api/spaces', spaceRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/focus', focusRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/life', lifeRoutes);
app.use('/api/user', userRoutes);
app.use('/api/backlog', backlogRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/ai', aiRoutes);

/**
 * A tela sai do mesmo servidor que a API quando `dist` existe. E o que faz o
 * acesso pela rede funcionar sem configurar nada no cliente: um endereco so,
 * mesma origem, e o `/api` relativo continua valendo de qualquer aparelho.
 */
const dist = path.resolve(process.cwd(), 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota inexistente.' } });
});

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof ZodError) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Dados invalidos.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (err instanceof AppError) {
      return res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if ((err as any)?.code === 'NOT_FOUND') {
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: (err as Error).message } });
    }

    console.error('[api]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL', message: (err as Error)?.message ?? 'Erro interno.' },
    });
  },
);

if (process.env.NODE_ENV !== 'test') {
  // 0.0.0.0 por padrao: o porteiro acima e que decide quem entra, nao o bind.
  const HOST = process.env.HOST ?? '0.0.0.0';

  app.listen(PORT, HOST, async () => {
    console.log(`Chronos Flow v2 API em http://localhost:${PORT}`);

    const aberto = Boolean((process.env.CHRONOS_ACCESS_TOKEN ?? '').trim());
    for (const ip of enderecosDaRede()) {
      console.log(`  na rede: http://${ip}:${PORT}${aberto ? '' : '  (bloqueado)'}`);
    }
    if (!aberto) {
      console.log(
        '  Conexoes de fora estao recusadas. Para liberar, defina' +
          ' CHRONOS_ACCESS_TOKEN no .env e reinicie.',
      );
    }

    // O anuncio na rede nao expoe dado nenhum: diz que existe um Chronos
    // aqui. O que vale alguma coisa so sai com o codigo de pareamento.
    anunciar({ nome: nomeDesteComputador(), porta: PORT, formato: FORMATO_DO_PACOTE })
      .then(() => console.log(`  descoberta na rede: UDP ${PORTA_DESCOBERTA} e Bonjour _chronos._tcp`))
      .catch((e: Error) => console.warn('[descoberta]', e.message));

    const missing = missingModels();
    if (missing.length > 0) {
      console.warn(
        `\n  ATENCAO: o client do Prisma nao conhece: ${missing.join(', ')}.` +
          '\n  O schema mudou e o client nao foi regenerado.' +
          '\n  Rode:  npm run prisma:migrate' +
          '\n  (banco sem historico de migrations? rode antes: npm run db:baseline)' +
          '\n  Ate la, as telas que dependem desses modelos ficam indisponiveis.\n',
      );
    }
    try {
      const userId = await currentUserId();
      const result = await recomputeAll(userId);
      if (result.nodes > 0) {
        console.log(`Cascata verificada: ${result.nodes} nos em ${result.roots} meta(s).`);
      }
      await captureSnapshots(userId);
    } catch {
      // Banco ainda subindo: o app tenta de novo na proxima requisicao.
    }
  });
}

export default app;
