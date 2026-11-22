/**
 * Regras do bloco de tempo do widget flutuante, fora do componente para
 * poderem ser testadas sem React e sem relogio.
 */

export const BLOCO_PADRAO_MIN = 25;

/** Teto de um bloco: acima disso a contagem deixa de ser util como foco. */
const TETO_MIN = 8 * 60;

/** Duracao do bloco em segundos. A estimativa manda; sem ela, 25 minutos. */
export function duracaoDoBloco(estimatedMinutes: number | null | undefined): number {
  if (!estimatedMinutes || estimatedMinutes <= 0) return BLOCO_PADRAO_MIN * 60;
  return Math.min(estimatedMinutes, TETO_MIN) * 60;
}

export interface BlocoRessincronizado {
  totalSeconds: number;
  secondsRemaining: number;
  /** Saiu do vermelho: o aviso de "tempo esgotado" volta a poder soar. */
  reabriu: boolean;
}

/**
 * A estimativa mudou enquanto o cronometro daquela mesma tarefa corria.
 *
 * O bloco passa a valer o novo prazo, mas o tempo ja gasto nao evapora: o que
 * se recalcula e o que sobra, nunca o que passou. Encurtar para menos do que
 * ja se gastou deixa o bloco em atraso — que e exatamente o que aconteceu na
 * vida real, e nao um erro a esconder.
 */
export function ressincronizarBloco(
  anterior: { totalSeconds: number; secondsRemaining: number },
  novoTotal: number,
): BlocoRessincronizado {
  const gasto = Math.max(0, anterior.totalSeconds - anterior.secondsRemaining);
  const secondsRemaining = novoTotal - gasto;

  return {
    totalSeconds: novoTotal,
    secondsRemaining,
    reabriu: anterior.secondsRemaining <= 0 && secondsRemaining > 0,
  };
}

export interface JanelaDaTarefa {
  start_date: string | Date | null;
  due_date: string | Date | null;
  all_day: boolean;
}

const emMs = (v: string | Date | null): number | null => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Com quanto o bloco abre.
 *
 * O cronometro mede o plano, nao o clique: uma tarefa marcada das 9h as 9h30
 * aberta as 9h15 abre faltando 15 minutos, porque e isso que sobra dela. Comecar
 * nos 30 seria prometer meia hora que o dia ja nao tem.
 *
 * Quatro situacoes, nessa ordem:
 *  - sem hora marcada (dia inteiro, ou sem termino): o prazo ali e data-limite,
 *    nao duracao — abre o bloco inteiro;
 *  - antes da hora, ou janela mais larga que o bloco: bloco inteiro;
 *  - dentro da janela: o que falta dela;
 *  - depois dela: o atraso, enquanto ainda for o atraso deste bloco. Passado
 *    isso o plano envelheceu, e insistir num contador de horas negativas nao
 *    ajuda ninguem a trabalhar: o bloco recomeca cheio.
 */
export function restanteAoAbrir(
  janela: JanelaDaTarefa,
  totalSeconds: number,
  agora: Date,
): number {
  if (janela.all_day) return totalSeconds;

  const fim = emMs(janela.due_date);
  if (fim == null) return totalSeconds;

  const faltam = Math.round((fim - agora.getTime()) / 1000);
  if (faltam >= totalSeconds) return totalSeconds;
  if (faltam <= -totalSeconds) return totalSeconds;

  return faltam;
}
