import type { RequestParamHandler } from 'express';
import { prisma } from '../db/client.js';
import { currentUserId } from './currentUser.js';
import { notFound } from './errors.js';

/**
 * Cada conta so enxerga o que e dela.
 *
 * Muitas rotas buscam o registro direto pelo id (`/nodes/:id`), e os ids que
 * chegam no corpo (`parent_id`, `assignee_id`, `space_id`...) viram vinculos.
 * Sem esta checagem, quem soubesse um id de outra conta leria, mudaria ou
 * penduraria coisa sua no projeto alheio.
 *
 * Responde 404, nao 403: "existe mas nao e seu" ja seria contar demais.
 */
export type Recurso =
  | 'node'
  | 'space'
  | 'member'
  | 'template'
  | 'backlogItem'
  | 'backlogRole'
  | 'dependency';

const NOME: Record<Recurso, string> = {
  node: 'No',
  space: 'Espaco',
  member: 'Membro',
  template: 'Modelo',
  backlogItem: 'Item do backlog',
  backlogRole: 'Papel',
  dependency: 'Dependencia',
};

async function contar(recurso: Recurso, ids: string[], userId: string): Promise<number> {
  const id = { in: ids };
  switch (recurso) {
    case 'node':
      return prisma.node.count({ where: { id, user_id: userId } });
    case 'space':
      return prisma.space.count({ where: { id, user_id: userId } });
    case 'member':
      return prisma.member.count({ where: { id, user_id: userId } });
    case 'template':
      return prisma.taskTemplate.count({ where: { id, user_id: userId } });
    case 'backlogItem':
      return prisma.backlogItem.count({ where: { id, user_id: userId } });
    case 'backlogRole':
      return prisma.backlogRole.count({ where: { id, backlog_item: { user_id: userId } } });
    case 'dependency':
      return prisma.nodeDependency.count({ where: { id, blocked: { user_id: userId } } });
  }
}

/** Ids nulos ou ausentes passam: "sem pai" e "sem responsavel" sao validos. */
export async function garantirDono(
  recurso: Recurso,
  ids: string | null | undefined | Array<string | null | undefined>,
  userId?: string,
): Promise<void> {
  const lista = [...new Set((Array.isArray(ids) ? ids : [ids]).filter((x): x is string => Boolean(x)))];
  if (lista.length === 0) return;
  const dono = userId ?? (await currentUserId());
  if ((await contar(recurso, lista, dono)) !== lista.length) throw notFound(NOME[recurso]);
}

/** Para `router.param`: confere o dono antes de qualquer rota com aquele parametro. */
export function donoDoParam(recurso: Recurso): RequestParamHandler {
  return (_req, _res, next, id) => {
    garantirDono(recurso, String(id)).then(() => next(), next);
  };
}
