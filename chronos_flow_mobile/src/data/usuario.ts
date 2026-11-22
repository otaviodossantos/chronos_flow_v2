import { count, eq, isNull, and } from 'drizzle-orm';
import {
  backlogItems, members, nodeDependencies, nodes, spaces, users,
} from '@db/schema';
import { bd as banco, emTransacao } from './conexao';
import { recomputarTudo } from './cascata';

const novoId = () => crypto.randomUUID();

/**
 * O app e de uma pessoa so e nao tem login: o usuario e simplesmente a unica
 * linha da tabela, criada na primeira abertura.
 *
 * O id fica em memoria porque toda chamada de servico o pede, e cada leitura
 * atravessaria a ponte do Capacitor. Quem troca o banco inteiro debaixo dele
 * — a importacao — precisa chamar `esquecerUsuarioAtual`, senao o app segue
 * escrevendo com um id que acabou de deixar de existir.
 */
let lembrado: { de: unknown; id: string } | null = null;

export function esquecerUsuarioAtual(): void {
  lembrado = null;
}

export async function usuarioAtual(): Promise<string> {
  const bd = banco();
  // A lembranca vale para *aquela* conexao. Trocar de banco — outro teste,
  // ou o app religando — invalida sozinho, sem ninguem precisar lembrar.
  if (lembrado && lembrado.de === bd) return lembrado.id;

  const existente = await bd.select({ id: users.id }).from(users).limit(1).get();
  if (existente) {
    lembrado = { de: bd, id: existente.id };
    return existente.id;
  }

  const id = novoId();
  await bd.insert(users)
    .values({ id, name: 'Voce', birth_date: new Date('1990-01-01T00:00:00.000Z') }).run();
  lembrado = { de: bd, id };
  return id;
}

export async function perfil(userId: string) {
  const bd = banco();
  const u = await bd.select().from(users).where(eq(users.id, userId)).get();
  if (!u) throw new Error('Usuario nao encontrado.');
  return {
    id: u.id,
    name: u.name,
    birth_date: u.birth_date.toISOString(),
    life_expectancy: u.life_expectancy,
    daily_focus_goal_minutes: u.daily_focus_goal_minutes,
    daily_impact_goal: u.daily_impact_goal,
    timezone: u.timezone,
    gemini_model: u.gemini_model,
    // A chave nunca sai inteira daqui: a tela so precisa saber se existe.
    hasGeminiKey: Boolean(u.gemini_api_key),
  };
}

export async function atualizarPerfil(userId: string, dados: Record<string, unknown>) {
  const bd = banco();
  const limpos = { ...dados };
  if (typeof limpos.birth_date === 'string') limpos.birth_date = new Date(limpos.birth_date);
  await bd.update(users).set(limpos).where(eq(users.id, userId)).run();
  return perfil(userId);
}

export async function resumoDosDados(userId: string) {
  const bd = banco();
  const um = async (tabela: 'nodes' | 'spaces' | 'members' | 'backlog' | 'deps' | 'roots') => {
    const consultas = {
      nodes: bd.select({ q: count() }).from(nodes).where(eq(nodes.user_id, userId)),
      roots: bd.select({ q: count() }).from(nodes)
        .where(and(eq(nodes.user_id, userId), isNull(nodes.parent_id))),
      spaces: bd.select({ q: count() }).from(spaces).where(eq(spaces.user_id, userId)),
      members: bd.select({ q: count() }).from(members).where(eq(members.user_id, userId)),
      backlog: bd.select({ q: count() }).from(backlogItems).where(eq(backlogItems.user_id, userId)),
      deps: bd.select({ q: count() }).from(nodeDependencies),
    };
    return Number((await consultas[tabela].get())?.q ?? 0);
  };

  return {
    nodes: await um('nodes'),
    roots: await um('roots'),
    spaces: await um('spaces'),
    members: await um('members'),
    backlog: await um('backlog'),
    dependencies: await um('deps'),
  };
}

export async function recomputar(userId: string) {
  return emTransacao((bd) => recomputarTudo(bd, userId));
}

/** Apaga tudo menos o proprio usuario. Sem volta. */
export async function zerarTudo(userId: string) {
  return emTransacao(async (bd) => {
    // A ordem importa mesmo com cascata: dependencias apontam para nos dos dois
    // lados, e apagar os nos primeiro deixaria o SQLite resolvendo arestas.
    await bd.delete(nodeDependencies).run();
    await bd.delete(nodes).where(eq(nodes.user_id, userId)).run();
    await bd.delete(backlogItems).where(eq(backlogItems.user_id, userId)).run();
    await bd.delete(members).where(eq(members.user_id, userId)).run();
    await bd.delete(spaces).where(eq(spaces.user_id, userId)).run();
    return { ok: true };
  });
}
