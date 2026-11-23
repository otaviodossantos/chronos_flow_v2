import { Router, type Request } from 'express';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { AppError, notFound } from '../../lib/errors.js';
import { hashSegredo, novoSegredo } from '../../lib/senha.js';
import { contexto, exigeAdmin, pessoaReal, tokenDaSessao } from '../../lib/sessao.js';
import {
  atualizarUsuarioSchema,
  atuarComoSchema,
  criarConviteSchema,
} from '../../../shared/schemas/index.js';
import type { AdminUsuarioDTO, ConviteDTO } from '../../../shared/types.js';

/**
 * Administracao do servidor. So admin, e so pela tela: token de API nao
 * administra nada.
 *
 * Funciona tambem com o admin "dentro do espaco" de outra conta — e por aqui
 * que ele sai dele —, sempre agindo como ele mesmo (`pessoaReal`).
 */
const router = Router();

router.use((_req, _res, next) => {
  if (contexto.getStore()?.via === 'token') {
    next(new AppError('SO_PELA_TELA', 'A administracao so pode ser feita pela tela do app.'));
    return;
  }
  next();
});
router.use(exigeAdmin);

const admin = () => pessoaReal()!;

/** Admins ativos (nao bloqueados): nunca pode chegar a zero. */
const adminsAtivos = () => prisma.user.count({ where: { papel: 'ADMIN', bloqueado_em: null } });

/** A sessao do navegador que fez esta requisicao. */
async function sessaoAtual(req: Request) {
  const valor = tokenDaSessao(req);
  if (!valor) throw new AppError('NAO_AUTENTICADO', 'Entre na sua conta para continuar.');
  const s = await prisma.session.findUnique({ where: { token_hash: hashSegredo(valor) }, select: { id: true } });
  if (!s) throw new AppError('NAO_AUTENTICADO', 'Entre na sua conta para continuar.');
  return s;
}

/* ── Usuarios ────────────────────────────────────────────────────────────── */

router.get(
  '/usuarios',
  asyncHandler(async (_req, res) => {
    // So contas de verdade (com e-mail): o usuario antigo sem login, de antes
    // das contas, nao e ninguem para administrar.
    const usuarios = await prisma.user.findMany({
      where: { email: { not: null } },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        papel: true,
        bloqueado_em: true,
        created_at: true,
        spaces: { where: { archived: false }, select: { id: true, name: true, color: true }, orderBy: { position: 'asc' } },
      },
    });
    const ids = usuarios.map((u) => u.id);
    const [nos, metas, abertas, acessos] = await Promise.all([
      prisma.node.groupBy({ by: ['user_id'], where: { user_id: { in: ids } }, _count: { _all: true } }),
      prisma.node.groupBy({ by: ['user_id'], where: { user_id: { in: ids }, parent_id: null }, _count: { _all: true } }),
      prisma.node.groupBy({
        by: ['user_id'],
        where: { user_id: { in: ids }, children: { none: {} }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        _count: { _all: true },
      }),
      prisma.session.groupBy({ by: ['user_id'], where: { user_id: { in: ids } }, _max: { last_seen_at: true } }),
    ]);
    const de = <T extends { user_id: string }>(lista: T[], id: string) => lista.find((x) => x.user_id === id);

    const dto: AdminUsuarioDTO[] = usuarios.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      papel: u.papel,
      bloqueado_em: u.bloqueado_em?.toISOString() ?? null,
      created_at: u.created_at.toISOString(),
      ultimo_acesso: de(acessos, u.id)?._max.last_seen_at?.toISOString() ?? null,
      espacos: u.spaces,
      metas: de(metas, u.id)?._count._all ?? 0,
      tarefas: de(nos, u.id)?._count._all ?? 0,
      tarefas_abertas: de(abertas, u.id)?._count._all ?? 0,
    }));
    res.json(dto);
  }),
);

router.patch(
  '/usuarios/:id',
  asyncHandler(async (req, res) => {
    const body = atualizarUsuarioSchema.parse(req.body);
    const alvo = await prisma.user.findFirst({ where: { id: req.params.id, email: { not: null } } });
    if (!alvo) throw notFound('Usuario');
    const eu = admin();

    if (body.bloqueado !== undefined && alvo.id === eu) {
      throw new AppError('VALIDATION_FAILED', 'Voce nao pode bloquear a propria conta.');
    }

    // Nunca sem admin: rebaixar ou bloquear o ultimo admin ativo e recusado.
    const deixaDeSerAdminAtivo =
      alvo.papel === 'ADMIN' &&
      !alvo.bloqueado_em &&
      (body.papel === 'MEMBRO' || body.bloqueado === true);
    if (deixaDeSerAdminAtivo && (await adminsAtivos()) <= 1) {
      throw new AppError('VALIDATION_FAILED', 'O servidor precisa de pelo menos um administrador ativo.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: alvo.id },
        data: {
          ...(body.papel ? { papel: body.papel } : {}),
          ...(body.bloqueado !== undefined ? { bloqueado_em: body.bloqueado ? new Date() : null } : {}),
        },
      });
      // Quem deixa de ser admin sai de qualquer espaco alheio em que estivesse.
      if (body.papel === 'MEMBRO') {
        await tx.session.updateMany({ where: { user_id: alvo.id }, data: { atuando_como_id: null } });
      }
      // Bloqueio vale na hora: sessoes e tokens da pessoa caem.
      if (body.bloqueado) {
        await tx.session.deleteMany({ where: { user_id: alvo.id } });
        await tx.apiToken.deleteMany({ where: { user_id: alvo.id } });
      }
    });
    res.json({ atualizado: true });
  }),
);

/* ── Entrar no espaco de outra conta ─────────────────────────────────────── */

router.post(
  '/atuar',
  asyncHandler(async (req, res) => {
    const { userId } = atuarComoSchema.parse(req.body);
    const eu = admin();
    if (userId === eu) throw new AppError('VALIDATION_FAILED', 'Esse ja e o seu espaco.');
    const alvo = await prisma.user.findFirst({ where: { id: userId, email: { not: null } }, select: { id: true } });
    if (!alvo) throw notFound('Usuario');
    const sessao = await sessaoAtual(req);
    await prisma.session.update({ where: { id: sessao.id }, data: { atuando_como_id: alvo.id } });
    res.json({ atuandoComo: alvo.id });
  }),
);

router.post(
  '/parar',
  asyncHandler(async (req, res) => {
    const sessao = await sessaoAtual(req);
    await prisma.session.update({ where: { id: sessao.id }, data: { atuando_como_id: null } });
    res.json({ atuandoComo: null });
  }),
);

/* ── Convites individuais ────────────────────────────────────────────────── */

const estadoDoConvite = (c: { usado_em: Date | null; revogado_em: Date | null; expira_em: Date }) =>
  c.usado_em ? 'usado' : c.revogado_em ? 'revogado' : c.expira_em.getTime() < Date.now() ? 'expirado' : 'pendente';

router.get(
  '/convites',
  asyncHandler(async (_req, res) => {
    const convites = await prisma.convite.findMany({
      orderBy: { criado_em: 'desc' },
      take: 50,
      include: {
        criado_por: { select: { name: true } },
        usado_por: { select: { name: true, email: true } },
      },
    });
    const dto: ConviteDTO[] = convites.map((c) => ({
      id: c.id,
      email: c.email,
      criado_em: c.criado_em.toISOString(),
      expira_em: c.expira_em.toISOString(),
      criado_por: c.criado_por?.name ?? null,
      usado_em: c.usado_em?.toISOString() ?? null,
      usado_por: c.usado_por,
      revogado_em: c.revogado_em?.toISOString() ?? null,
      estado: estadoDoConvite(c),
    }));
    res.json(dto);
  }),
);

/**
 * Gera o convite. O token aparece so nesta resposta (o banco guarda o hash);
 * quem monta o link e a tela, com a origem que a propria tela conhece.
 */
router.post(
  '/convites',
  asyncHandler(async (req, res) => {
    const body = criarConviteSchema.parse(req.body);
    if (body.email && (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } }))) {
      throw new AppError('EMAIL_EM_USO', 'Ja existe uma conta com esse e-mail.');
    }
    const token = novoSegredo('cv_');
    const criado = await prisma.convite.create({
      data: {
        token_hash: hashSegredo(token),
        email: body.email ?? null,
        criado_por_id: admin(),
        expira_em: new Date(Date.now() + (body.dias ?? 7) * 86_400_000),
      },
    });
    res.status(201).json({ id: criado.id, token, email: criado.email, expira_em: criado.expira_em.toISOString() });
  }),
);

router.delete(
  '/convites/:id',
  asyncHandler(async (req, res) => {
    const { count } = await prisma.convite.updateMany({
      where: { id: req.params.id, usado_em: null, revogado_em: null },
      data: { revogado_em: new Date() },
    });
    if (count === 0) throw notFound('Convite pendente');
    res.json({ revogado: true });
  }),
);

export default router;
