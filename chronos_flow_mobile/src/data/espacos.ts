import { and, asc, count, desc, eq, isNull, max, sql } from 'drizzle-orm';
import { members, nodes, spaceMembers, spaces } from '@db/schema';
import type { SpaceDTO } from '@shared/types';
import { bd as banco } from './conexao';
import { paraSpaceDTO } from './serializar';
import { NaoEncontrado } from './repositorio';

const novoId = () => crypto.randomUUID();

export async function listar(userId: string): Promise<SpaceDTO[]> {
  const bd = banco();
  const linhas = await bd.select().from(spaces).where(eq(spaces.user_id, userId))
    .orderBy(asc(spaces.position)).all();

  const raizes = await bd
    .select({ space_id: nodes.space_id, progress: nodes.progress })
    .from(nodes)
    .where(and(eq(nodes.user_id, userId), isNull(nodes.parent_id)))
    .all();

  // O `groupBy` com `_count` e `_max` do Prisma, em SQL direto.
  const totais = await bd
    .select({ space_id: nodes.space_id, quantos: count(), fundo: max(nodes.depth) })
    .from(nodes)
    .where(eq(nodes.user_id, userId))
    .groupBy(nodes.space_id)
    .all();

  return linhas.map((s) => {
    const minhas = raizes.filter((r) => r.space_id === s.id);
    const total = totais.find((c) => c.space_id === s.id);
    const progresso =
      minhas.length > 0
        ? Math.round((minhas.reduce((soma, r) => soma + r.progress, 0) / minhas.length) * 10) / 10
        : 0;

    return paraSpaceDTO(s, {
      rootCount: minhas.length,
      nodeCount: Number(total?.quantos ?? 0),
      progress: progresso,
    });
  });
}

export async function criar(userId: string, dados: { name: string; description?: string | null; color?: string; position?: number }) {
  const bd = banco();
  const ultimo = await bd.select({ position: spaces.position }).from(spaces)
    .where(eq(spaces.user_id, userId)).orderBy(desc(spaces.position)).limit(1).get();

  const id = novoId();
  await bd.insert(spaces).values({
    id,
    user_id: userId,
    name: dados.name,
    description: dados.description ?? null,
    ...(dados.color ? { color: dados.color } : {}),
    position: dados.position ?? (ultimo?.position ?? -1) + 1,
  }).run();

  return paraSpaceDTO((await bd.select().from(spaces).where(eq(spaces.id, id)).get())!);
}

export async function atualizar(id: string, dados: Partial<{ name: string; description: string | null; color: string; position: number; archived: boolean }>) {
  const bd = banco();
  await bd.update(spaces).set(dados).where(eq(spaces.id, id)).run();
  const atual = await bd.select().from(spaces).where(eq(spaces.id, id)).get();
  if (!atual) throw new NaoEncontrado('Espaco');
  return paraSpaceDTO(atual);
}

export async function excluir(id: string) {
  const bd = banco();
  const atual = await bd.select().from(spaces).where(eq(spaces.id, id)).get();
  if (!atual) throw new NaoEncontrado('Espaco');
  await bd.delete(spaces).where(eq(spaces.id, id)).run();
  return { deleted: true };
}

export async function vincularMembro(spaceId: string, memberId: string) {
  const bd = banco();
  const existe = await bd.select().from(spaceMembers)
    .where(and(eq(spaceMembers.space_id, spaceId), eq(spaceMembers.member_id, memberId))).get();
  if (!existe) {
    await bd.insert(spaceMembers)
      .values({ id: novoId(), space_id: spaceId, member_id: memberId }).run();
  }
  return { ok: true };
}

export async function desvincularMembro(spaceId: string, memberId: string) {
  const bd = banco();
  await bd.delete(spaceMembers)
    .where(and(eq(spaceMembers.space_id, spaceId), eq(spaceMembers.member_id, memberId))).run();

  const restantes = await bd.select({ quantos: count() }).from(spaceMembers)
    .where(eq(spaceMembers.member_id, memberId)).get();
  return { deleted: true, stillAssigned: Number(restantes?.quantos ?? 0) };
}

/** Espacos de cada membro, para a tela de equipe. */
export async function espacosPorMembro(userId: string) {
  const bd = banco();
  const linhas = await bd
    .select({
      member_id: spaceMembers.member_id,
      id: spaces.id, name: spaces.name, color: spaces.color,
    })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.space_id))
    .innerJoin(members, eq(members.id, spaceMembers.member_id))
    .where(eq(members.user_id, userId))
    .all();

  const mapa = new Map<string, Array<{ id: string; name: string; color: string }>>();
  for (const l of linhas) {
    const lista = mapa.get(l.member_id) ?? [];
    lista.push({ id: l.id, name: l.name, color: l.color });
    mapa.set(l.member_id, lista);
  }
  return mapa;
}

export const semEspaco = sql`${nodes.space_id} is null`;
