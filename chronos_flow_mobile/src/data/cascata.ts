import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { nodes } from '@db/schema';
import { ancestorIdsBottomUp } from '@core/path';
import { weightedProgress, leafProgress, round2 } from '@core/cascade';
import { contributionMap } from '@core/impact';
import type { CascadeStep } from '@shared/types';
import type { BD } from './conexao';

/** Linhas do ramo inteiro, raiz inclusive. Era o `startsWith` do Prisma. */
export function doRamo(caminho: string) {
  return or(eq(nodes.path, caminho), like(nodes.path, `${caminho}/%`))!;
}

const round6 = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

/**
 * Sobe a cascata a partir de um no, um nivel por vez, parando cedo quando o
 * progresso gravado nao muda. Custo O(profundidade), nao O(tamanho da arvore).
 */
export async function propagarDe(bd: BD, nodeId: string): Promise<CascadeStep[]> {
  const no = await bd.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!no) return [];

  const passos: CascadeStep[] = [];

  // O proprio no primeiro: se virou folha ou mudou de status, seu valor muda.
  await recalcularProprio(bd, no.id);

  for (const ancestralId of ancestorIdsBottomUp(no.path)) {
    const ancestral = await bd.select().from(nodes).where(eq(nodes.id, ancestralId)).get();
    if (!ancestral) break;

    const filhas = await bd.select().from(nodes).where(eq(nodes.parent_id, ancestralId)).all();
    const proximo = weightedProgress(filhas);
    const anterior = ancestral.progress;

    if (Math.abs(proximo - anterior) < 0.005) break;

    await bd.update(nodes).set({ progress: proximo }).where(eq(nodes.id, ancestralId)).run();
    passos.push({
      id: ancestral.id,
      title: ancestral.title,
      depth: ancestral.depth,
      previous: anterior,
      progress: proximo,
    });
  }

  return passos.reverse();
}

/** Recalcula o valor de um unico no a partir dos seus filhos diretos. */
export async function recalcularProprio(bd: BD, nodeId: string): Promise<number> {
  const no = await bd.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!no) return 0;

  const filhas = await bd.select().from(nodes).where(eq(nodes.parent_id, nodeId)).all();

  const valor =
    filhas.length === 0
      ? leafProgress({ status: no.status, manual_progress: no.manual_progress })
      : weightedProgress(filhas);

  if (Math.abs(valor - no.progress) >= 0.005) {
    await bd.update(nodes).set({ progress: valor }).where(eq(nodes.id, nodeId)).run();
  }
  return valor;
}

/** Recontagem de folhas na subarvore — usada em relatorios e na barra lateral. */
export async function recontarFolhas(bd: BD, caminhoRaiz: string): Promise<void> {
  const linhas = await bd
    .select({ id: nodes.id, parent_id: nodes.parent_id, depth: nodes.depth })
    .from(nodes)
    .where(doRamo(caminhoRaiz))
    .orderBy(sql`${nodes.depth} desc`)
    .all();

  const filhasDe = new Map<string, string[]>();
  for (const n of linhas) {
    if (!n.parent_id) continue;
    const lista = filhasDe.get(n.parent_id) ?? [];
    lista.push(n.id);
    filhasDe.set(n.parent_id, lista);
  }

  // Ordenado por profundidade decrescente: quando chega numa mae, as filhas
  // dela ja foram contadas.
  const contagem = new Map<string, number>();
  for (const n of linhas) {
    const filhas = filhasDe.get(n.id) ?? [];
    contagem.set(
      n.id,
      filhas.length === 0 ? 1 : filhas.reduce((s, k) => s + (contagem.get(k) ?? 1), 0),
    );
  }

  await gravarEmLote(bd, [...contagem], (valor) => ({ leaf_count: valor }));
}

/**
 * Recalcula `root_impact` de toda a arvore de uma raiz: a fracao da meta macro
 * que cada no representa. Roda quando peso ou estrutura mudam.
 */
export async function recalcularImpacto(bd: BD, rootId: string): Promise<void> {
  const raiz = await bd.select({ path: nodes.path }).from(nodes).where(eq(nodes.id, rootId)).get();
  if (!raiz) return;

  const linhas = await bd
    .select({
      id: nodes.id,
      parent_id: nodes.parent_id,
      weight: nodes.weight,
      status: nodes.status,
    })
    .from(nodes)
    .where(doRamo(raiz.path))
    .all();

  const contribuicao = contributionMap(linhas);
  await gravarEmLote(
    bd,
    linhas.map((n) => [n.id, round6(contribuicao.get(n.id) ?? 0)] as [string, number]),
    (valor) => ({ root_impact: valor }),
  );
}

/**
 * Grava um valor por no em poucas instrucoes, agrupando os ids que recebem o
 * mesmo numero. Numa arvore de centenas de nos, um UPDATE por linha custaria
 * centenas de idas ao SQLite — no desktop isso ia por uma conexao local, aqui
 * cada ida atravessa a ponte do Capacitor.
 */
async function gravarEmLote(
  bd: BD,
  pares: Array<[string, number]>,
  campo: (valor: number) => Record<string, number>,
): Promise<void> {
  const porValor = new Map<number, string[]>();
  for (const [id, valor] of pares) {
    const lista = porValor.get(valor) ?? [];
    lista.push(id);
    porValor.set(valor, lista);
  }

  for (const [valor, ids] of porValor) {
    await bd.update(nodes).set(campo(valor)).where(inArray(nodes.id, ids)).run();
  }
}

/** Recomputa uma arvore inteira de baixo para cima. Manutencao e verificacao. */
export async function recomputarRaiz(bd: BD, rootId: string): Promise<number> {
  const raiz = await bd.select({ path: nodes.path }).from(nodes).where(eq(nodes.id, rootId)).get();
  if (!raiz) return 0;

  const linhas = await bd
    .select({
      id: nodes.id,
      parent_id: nodes.parent_id,
      depth: nodes.depth,
      weight: nodes.weight,
      status: nodes.status,
      manual_progress: nodes.manual_progress,
    })
    .from(nodes)
    .where(doRamo(raiz.path))
    .orderBy(sql`${nodes.depth} desc`)
    .all();

  const filhasDe = new Map<string, typeof linhas>();
  for (const n of linhas) {
    if (!n.parent_id) continue;
    const lista = filhasDe.get(n.parent_id) ?? [];
    lista.push(n);
    filhasDe.set(n.parent_id, lista);
  }

  const progresso = new Map<string, number>();
  for (const n of linhas) {
    const filhas = filhasDe.get(n.id) ?? [];
    progresso.set(
      n.id,
      filhas.length === 0
        ? leafProgress({ status: n.status, manual_progress: n.manual_progress })
        : weightedProgress(
            filhas.map((k) => ({
              weight: k.weight,
              progress: progresso.get(k.id) ?? 0,
              status: k.status,
            })),
          ),
    );
  }

  await gravarEmLote(
    bd,
    linhas.map((n) => [n.id, round2(progresso.get(n.id) ?? 0)] as [string, number]),
    (valor) => ({ progress: valor }),
  );
  await bd.update(nodes).set({ rollup_dirty: false }).where(doRamo(raiz.path)).run();

  await recontarFolhas(bd, raiz.path);
  await recalcularImpacto(bd, rootId);
  return linhas.length;
}

/** Recomputa todas as raizes do usuario. */
export async function recomputarTudo(bd: BD, userId: string): Promise<{ nos: number; raizes: number }> {
  const raizes = await bd
    .select({ id: nodes.id })
    .from(nodes)
    .where(and(eq(nodes.user_id, userId), sql`${nodes.parent_id} is null`))
    .all();

  let nos = 0;
  for (const raiz of raizes) nos += await recomputarRaiz(bd, raiz.id);
  return { nos, raizes: raizes.length };
}
