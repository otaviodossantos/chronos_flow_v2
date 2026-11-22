import { and, eq, inArray } from 'drizzle-orm';
import { nodeDependencies, nodes } from '@db/schema';
import { findCycle, criticalPath } from '@core/dependencies';
import { bd as banco } from './conexao';
import { ErroDeRegra, NaoEncontrado, todasAsDependencias } from './repositorio';

const novoId = () => crypto.randomUUID();

export async function caminhoCritico(userId: string, spaceId?: string) {
  const bd = banco();
  const filtro = spaceId
    ? and(eq(nodes.user_id, userId), eq(nodes.space_id, spaceId))!
    : eq(nodes.user_id, userId);

  const linhas = await bd
    .select({
      id: nodes.id, title: nodes.title, status: nodes.status,
      estimated_minutes: nodes.estimated_minutes,
    })
    .from(nodes).where(filtro).all();

  const arestas = await todasAsDependencias(bd, userId);
  const ids = criticalPath(linhas, arestas);
  const porId = new Map(linhas.map((n) => [n.id, n]));

  return { path: ids.map((id) => porId.get(id)).filter(Boolean) };
}

export async function criar(userId: string, blockerId: string, blockedId: string) {
  const bd = banco();

  const [bloqueador, bloqueada] = await Promise.all([
    bd.select({ id: nodes.id, title: nodes.title, path: nodes.path })
      .from(nodes).where(eq(nodes.id, blockerId)).get(),
    bd.select({ id: nodes.id, title: nodes.title, path: nodes.path })
      .from(nodes).where(eq(nodes.id, blockedId)).get(),
  ]);
  if (!bloqueador || !bloqueada) throw new NaoEncontrado('No da dependencia');

  if (
    bloqueada.path.startsWith(`${bloqueador.path}/`) ||
    bloqueador.path.startsWith(`${bloqueada.path}/`)
  ) {
    throw new ErroDeRegra(
      'CYCLE_DETECTED',
      'Um no nao pode depender de um ancestral ou descendente proprio.',
    );
  }

  const arestas = await todasAsDependencias(bd, userId);
  const ciclo = findCycle(arestas, blockerId, blockedId);
  if (ciclo) {
    const titulos = await bd.select({ id: nodes.id, title: nodes.title })
      .from(nodes).where(inArray(nodes.id, ciclo)).all();
    const porId = new Map(titulos.map((t) => [t.id, t.title]));
    throw new ErroDeRegra('CYCLE_DETECTED', 'Esta dependencia criaria um ciclo.', {
      path: ciclo.map((id) => porId.get(id) ?? id),
    });
  }

  const id = novoId();
  await bd.insert(nodeDependencies)
    .values({ id, blocker_id: blockerId, blocked_id: blockedId }).run();

  // Quem passou a depender de algo em aberto fica bloqueado na hora.
  const alvo = await bd.select({ status: nodes.status }).from(nodes)
    .where(eq(nodes.id, blockerId)).get();
  if (alvo && alvo.status !== 'COMPLETED' && alvo.status !== 'CANCELLED') {
    await bd.update(nodes).set({ status: 'BLOCKED' })
      .where(and(eq(nodes.id, blockedId), eq(nodes.status, 'PENDING'))).run();
  }

  return { id };
}

export async function excluir(dependencyId: string) {
  const bd = banco();
  const aresta = await bd.select().from(nodeDependencies)
    .where(eq(nodeDependencies.id, dependencyId)).get();
  if (!aresta) throw new NaoEncontrado('Dependencia');

  await bd.delete(nodeDependencies).where(eq(nodeDependencies.id, dependencyId)).run();

  // Sem mais bloqueador aberto, a tarefa volta a ficar disponivel.
  const restantes = await bd.select({ blocker_id: nodeDependencies.blocker_id })
    .from(nodeDependencies).where(eq(nodeDependencies.blocked_id, aresta.blocked_id)).all();

  const aindaPresos = restantes.length
    ? await bd.select({ id: nodes.id }).from(nodes)
        .where(and(
          inArray(nodes.id, restantes.map((r) => r.blocker_id)),
          inArray(nodes.status, ['PENDING', 'IN_PROGRESS', 'BLOCKED']),
        )).all()
    : [];

  if (aindaPresos.length === 0) {
    await bd.update(nodes).set({ status: 'PENDING' })
      .where(and(eq(nodes.id, aresta.blocked_id), eq(nodes.status, 'BLOCKED'))).run();
  }

  return { deleted: true };
}
