import { and, asc, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { members, nodeDependencies, nodes } from '@db/schema';
import { doRamo } from './cascata';
import type { BD } from './conexao';

export class NaoEncontrado extends Error {
  readonly code = 'NOT_FOUND';
  constructor(oQue: string) {
    super(`${oQue} nao encontrado.`);
  }
}

export class ErroDeRegra extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Quantos filhos cada no tem, numa consulta so.
 *
 * O Prisma resolvia isto com `_count`, que o Drizzle nao tem. Contar por no
 * seria N idas ao banco para montar uma arvore de centenas de linhas — e cada
 * ida, no aparelho, atravessa a ponte do Capacitor.
 */
export async function contarFilhas(bd: BD, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();

  const linhas = await bd
    .select({ pai: nodes.parent_id, quantas: count() })
    .from(nodes)
    .where(inArray(nodes.parent_id, ids))
    .groupBy(nodes.parent_id)
    .all();

  return new Map(linhas.filter((l) => l.pai).map((l) => [l.pai!, Number(l.quantas)]));
}

/** Responsaveis de um conjunto de nos, numa consulta so. */
export async function responsaveis(bd: BD, ids: Array<string | null>) {
  const limpos = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (limpos.length === 0) return new Map<string, typeof members.$inferSelect>();

  const linhas = await bd.select().from(members).where(inArray(members.id, limpos)).all();
  return new Map(linhas.map((m) => [m.id, m]));
}

export async function dependenciasTocando(bd: BD, ids: string[]) {
  if (ids.length === 0) return [];
  return bd
    .select()
    .from(nodeDependencies)
    .where(
      or(
        inArray(nodeDependencies.blocker_id, ids),
        inArray(nodeDependencies.blocked_id, ids),
      ),
    )
    .all();
}

export async function todasAsDependencias(bd: BD, userId: string) {
  // O `blocked: { user_id }` do Prisma era um filtro por relacao; aqui vira a
  // juncao explicita que ele escondia.
  return bd
    .select({
      id: nodeDependencies.id,
      blocker_id: nodeDependencies.blocker_id,
      blocked_id: nodeDependencies.blocked_id,
    })
    .from(nodeDependencies)
    .innerJoin(nodes, eq(nodes.id, nodeDependencies.blocked_id))
    .where(eq(nodes.user_id, userId))
    .all();
}

/**
 * `undefined` vira `null` aqui, e nao em cada chamador: o dominio compartilhado
 * com o desktop fala `T | null` porque o Prisma devolvia isso, e deixar os dois
 * ausentes circulando obrigaria cada ponto de uso a decidir qual deles trata.
 */
export async function acharNo(bd: BD, id: string) {
  return (await bd.select().from(nodes).where(eq(nodes.id, id)).get()) ?? null;
}

export async function exigirNo(bd: BD, id: string) {
  const no = await acharNo(bd, id);
  if (!no) throw new NaoEncontrado('No');
  return no;
}

export async function filhasDe(bd: BD, parentId: string) {
  return bd
    .select()
    .from(nodes)
    .where(eq(nodes.parent_id, parentId))
    .orderBy(asc(nodes.position))
    .all();
}

export async function subarvore(bd: BD, caminho: string, incluindoEla = true) {
  return bd
    .select()
    .from(nodes)
    .where(incluindoEla ? doRamo(caminho) : sql`${nodes.path} like ${`${caminho}/%`}`)
    .orderBy(asc(nodes.depth), asc(nodes.position))
    .all();
}

export async function contarSubarvore(bd: BD, caminho: string): Promise<number> {
  const r = await bd
    .select({ quantas: count() })
    .from(nodes)
    .where(sql`${nodes.path} like ${`${caminho}/%`}`)
    .get();
  return Number(r?.quantas ?? 0);
}

export async function proximaPosicao(
  bd: BD,
  parentId: string | null,
  userId: string,
): Promise<number> {
  const ultimo = await bd
    .select({ position: nodes.position })
    .from(nodes)
    .where(
      parentId
        ? eq(nodes.parent_id, parentId)
        : and(isNull(nodes.parent_id), eq(nodes.user_id, userId)),
    )
    .orderBy(desc(nodes.position))
    .limit(1)
    .get();

  return (ultimo?.position ?? -1) + 1;
}
