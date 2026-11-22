import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { members, nodes, spaceMembers, spaces } from '@db/schema';
import type { MemberDTO } from '@shared/types';
import { bd as banco, emTransacao, type BD } from './conexao';
import { paraMemberDTO } from './serializar';
import { NaoEncontrado } from './repositorio';
import { espacosPorMembro } from './espacos';

const novoId = () => crypto.randomUUID();

export async function listar(userId: string): Promise<MemberDTO[]> {
  const bd = banco();
  const linhas = await bd.select().from(members).where(eq(members.user_id, userId))
    .orderBy(asc(members.name)).all();
  if (linhas.length === 0) return [];

  // Carga aberta por pessoa, numa consulta so em vez de uma por membro.
  const carga = await bd
    .select({
      assignee_id: nodes.assignee_id,
      minutos: sql<number>`coalesce(sum(${nodes.estimated_minutes}), 0)`,
      folhas: sql<number>`count(*)`,
    })
    .from(nodes)
    .where(
      and(
        eq(nodes.user_id, userId),
        notInArray(nodes.status, ['COMPLETED', 'CANCELLED']),
        inArray(nodes.assignee_id, linhas.map((m) => m.id)),
      ),
    )
    .groupBy(nodes.assignee_id)
    .all();

  const porMembro = new Map(carga.map((c) => [c.assignee_id!, c]));
  const espacos = await espacosPorMembro(userId);

  return linhas.map((m) => {
    const c = porMembro.get(m.id);
    const minutos = Number(c?.minutos ?? 0);
    const capacidade = m.capacity_hours_week * 60;
    return paraMemberDTO(m, {
      spaces: espacos.get(m.id) ?? [],
      openMinutes: minutos,
      openLeaves: Number(c?.folhas ?? 0),
      // Percentual da semana ja comprometida — e o que denuncia sobrecarga.
      loadPercent: capacidade > 0 ? Math.round((minutos / capacidade) * 100) : 0,
    } as Partial<MemberDTO>);
  });
}

/**
 * Os espacos de um membro, trocados de uma vez.
 *
 * `space_ids` chega junto dos outros campos do formulario, mas nao e uma
 * coluna de `members` — e a tabela de ligacao. Ate aqui ele era passado direto
 * ao `set()` do Drizzle, que descarta chave que nao e coluna **sem reclamar**:
 * marcar os espacos na ficha do membro parecia funcionar, salvava, e o membro
 * continuava sem espaco nenhum. Vincular pelo lado do espaco funcionava porque
 * aquele caminho escreve nesta tabela.
 *
 * Apaga e regrava em vez de calcular a diferenca: a lista que chega e a
 * verdade inteira, e desmarcar um espaco precisa remover o vinculo tanto
 * quanto marcar precisa cria-lo.
 */
async function trocarEspacos(bd: BD, memberId: string, spaceIds: string[]): Promise<void> {
  await bd.delete(spaceMembers).where(eq(spaceMembers.member_id, memberId)).run();
  // Repetido na lista nao pode virar erro de indice unico.
  for (const space_id of [...new Set(spaceIds)]) {
    await bd.insert(spaceMembers).values({ id: novoId(), space_id, member_id: memberId }).run();
  }
}

/** O membro com os espacos dele, que e o que a tela espera de volta. */
async function comEspacos(bd: BD, id: string): Promise<MemberDTO> {
  const linha = await bd.select().from(members).where(eq(members.id, id)).get();
  if (!linha) throw new NaoEncontrado('Membro');

  const vinculos = await bd
    .select({ id: spaces.id, name: spaces.name, color: spaces.color })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.space_id))
    .where(eq(spaceMembers.member_id, id))
    .all();

  return paraMemberDTO(linha, { spaces: vinculos } as Partial<MemberDTO>);
}

export async function criar(userId: string, dados: Record<string, unknown>) {
  const { space_ids, ...campos } = dados as { space_ids?: string[] } & Record<string, unknown>;
  const id = novoId();

  return emTransacao(async (bd) => {
    await bd
      .insert(members)
      .values({
        id,
        user_id: userId,
        ...(campos as { name: string }),
        // O schema aceita string vazia no email; o banco nao deve guarda-la.
        // Vazio e nulo tem de ser a mesma coisa, senao a busca por email
        // encontra "" e acha que duas pessoas sem email sao a mesma.
        ...(campos.email !== undefined ? { email: (campos.email as string) || null } : {}),
      })
      .run();

    if (space_ids?.length) await trocarEspacos(bd, id, space_ids);
    return comEspacos(bd, id);
  });
}

export async function atualizar(id: string, dados: Record<string, unknown>) {
  const { space_ids, ...campos } = dados as { space_ids?: string[] } & Record<string, unknown>;

  return emTransacao(async (bd) => {
    if (Object.keys(campos).length > 0) {
      await bd
        .update(members)
        .set({
          ...campos,
          ...(campos.email !== undefined ? { email: (campos.email as string) || null } : {}),
        })
        .where(eq(members.id, id))
        .run();
    }

    // `undefined` e "nao mexa nos espacos"; lista vazia e "tire de todos".
    if (space_ids) await trocarEspacos(bd, id, space_ids);

    return comEspacos(bd, id);
  });
}
