import { and, asc, eq } from 'drizzle-orm';
import { members, taskTemplates } from '@db/schema';
import type { TaskTemplateDTO } from '@shared/types';
import { bd as banco } from './conexao';
import { paraTemplateDTO } from './serializar';
import { NaoEncontrado } from './repositorio';
import * as nos from './nos';

const novoId = () => crypto.randomUUID();

export async function listar(userId: string, spaceId?: string): Promise<TaskTemplateDTO[]> {
  const bd = banco();
  const linhas = await bd
    .select()
    .from(taskTemplates)
    .where(
      and(
        eq(taskTemplates.user_id, userId),
        eq(taskTemplates.archived, false),
        ...(spaceId ? [eq(taskTemplates.space_id, spaceId)] : []),
      ),
    )
    .orderBy(asc(taskTemplates.position))
    .all();

  const pessoas = new Map(
    (await bd.select().from(members).where(eq(members.user_id, userId)).all()).map((m) => [m.id, m]),
  );

  return linhas.map((t) =>
    paraTemplateDTO(t, t.assignee_id ? (pessoas.get(t.assignee_id) ?? null) : null),
  );
}

export async function criar(userId: string, dados: Record<string, unknown>) {
  const bd = banco();
  const id = novoId();
  await bd.insert(taskTemplates)
    .values({ id, user_id: userId, ...(dados as { space_id: string; title: string }) }).run();
  return paraTemplateDTO((await bd.select().from(taskTemplates).where(eq(taskTemplates.id, id)).get())!);
}

export async function atualizar(id: string, dados: Record<string, unknown>) {
  const bd = banco();
  await bd.update(taskTemplates).set(dados).where(eq(taskTemplates.id, id)).run();
  const atual = await bd.select().from(taskTemplates).where(eq(taskTemplates.id, id)).get();
  if (!atual) throw new NaoEncontrado('Modelo');
  return paraTemplateDTO(atual);
}

export async function excluir(id: string) {
  const bd = banco();
  await bd.delete(taskTemplates).where(eq(taskTemplates.id, id)).run();
  return { deleted: true };
}

/**
 * O modelo vira tarefa de verdade e nao guarda vinculo: e copia solta, nao
 * instancia. Editar a tarefa depois nao mexe no modelo, e e isso que se quer
 * de um preenchedor rapido.
 */
export async function instanciar(
  userId: string,
  templateId: string,
  corpo: { parent_id?: string | null; start_date?: string | null; all_day?: boolean; position?: number; title?: string },
) {
  const bd = banco();
  const modelo = await bd.select().from(taskTemplates).where(eq(taskTemplates.id, templateId)).get();
  if (!modelo) throw new NaoEncontrado('Modelo');

  const inicio = corpo.start_date ? new Date(corpo.start_date) : null;
  // Soltar no canvas ja diz quando comeca; o fim vem da estimativa do modelo.
  // Sem isso a barra nasceria com largura zero na timeline.
  const fim =
    inicio && modelo.estimated_minutes
      ? new Date(inicio.getTime() + modelo.estimated_minutes * 60_000)
      : null;

  const criada = await nos.criar(userId, {
    title: corpo.title ?? modelo.title,
    description: modelo.description,
    parent_id: corpo.parent_id ?? null,
    space_id: modelo.space_id,
    assignee_id: modelo.assignee_id,
    importance: modelo.importance,
    weight: modelo.weight,
    estimated_minutes: modelo.estimated_minutes,
    start_date: inicio ? inicio.toISOString() : undefined,
    due_date: fim ? fim.toISOString() : undefined,
    all_day: corpo.all_day ?? false,
    position: corpo.position,
  } as never);

  await bd.update(taskTemplates)
    .set({ uses: modelo.uses + 1, last_used_at: new Date() })
    .where(eq(taskTemplates.id, templateId)).run();

  // O modelo volta junto porque a tela mostra quantas vezes ele ja foi usado:
  // devolver so a tarefa deixaria esse numero parado ate a lista recarregar.
  const atualizado = (await bd.select().from(taskTemplates)
    .where(eq(taskTemplates.id, templateId)).get())!;
  const dono = atualizado.assignee_id
    ? ((await bd.select().from(members).where(eq(members.id, atualizado.assignee_id)).get()) ?? null)
    : null;

  return { node: criada, template: paraTemplateDTO(atualizado, dono) };
}
