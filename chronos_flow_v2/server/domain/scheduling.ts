/** Heranca e validacao de restricoes temporais. Puro, sem I/O. */

export interface TemporalNode {
  id: string;
  title: string;
  start_date: Date | null;
  due_date: Date | null;
  /** Filha de dia inteiro nao pode parar as 13:47 depois de uma reducao. */
  all_day?: boolean;
}

export interface TemporalViolation {
  code: 'DUE_AFTER_PARENT' | 'START_BEFORE_PARENT' | 'START_AFTER_DUE';
  message: string;
}

export function validateAgainstParent(
  child: Pick<TemporalNode, 'start_date' | 'due_date'>,
  parent: Pick<TemporalNode, 'start_date' | 'due_date'> | null,
): TemporalViolation[] {
  const out: TemporalViolation[] = [];

  if (child.start_date && child.due_date && child.start_date > child.due_date) {
    out.push({
      code: 'START_AFTER_DUE',
      message: 'A data de inicio e posterior ao prazo.',
    });
  }
  if (!parent) return out;

  if (child.due_date && parent.due_date && child.due_date > parent.due_date) {
    out.push({
      code: 'DUE_AFTER_PARENT',
      message: `O prazo ultrapassa o da tarefa pai (${fmt(parent.due_date)}).`,
    });
  }
  if (child.start_date && parent.start_date && child.start_date < parent.start_date) {
    out.push({
      code: 'START_BEFORE_PARENT',
      message: `O inicio e anterior ao da tarefa pai (${fmt(parent.start_date)}).`,
    });
  }
  return out;
}

/** Passo do encaixe da timeline: uma tarefa nova nasce numa dessas marcas. */
export const PASSO_BLOCO_MIN = 15;

/** Duracao de uma tarefa que nasce sem estimativa propria. */
export const DURACAO_PADRAO_MIN = 60;

/** Arredonda para cima ate a proxima marca de `passo` minutos. */
export function proximoBloco(agora: Date, passo: number = PASSO_BLOCO_MIN): Date {
  const ms = passo * 60_000;
  return new Date(Math.ceil(agora.getTime() / ms) * ms);
}

/**
 * Janela de uma tarefa que nasce sem data.
 *
 * Antes ela vinha como dia inteiro herdando a janela do pai: num projeto de
 * tres meses, uma tarefa de uma hora nascia com uma barra de tres meses. Agora
 * nasce com hora marcada — a proxima marca de 15 minutos, pelo tempo que a
 * estimativa disser.
 *
 * Ancorar no pai quando ele so comeca no futuro e o que mantem a filha dentro
 * da janela de quem a contem, em vez de esticar o pai para tras.
 */
export function janelaPadrao(
  agora: Date,
  parent: Pick<TemporalNode, 'start_date'> | null,
  estimatedMinutes?: number | null,
): { start_date: Date; due_date: Date } {
  const base = parent?.start_date && parent.start_date > agora ? parent.start_date : agora;
  const start_date = proximoBloco(base);
  const minutos =
    estimatedMinutes && estimatedMinutes > 0 ? estimatedMinutes : DURACAO_PADRAO_MIN;

  return { start_date, due_date: new Date(start_date.getTime() + minutos * 60_000) };
}

/** Filho sem prazo herda o do pai — sugestao, nunca imposicao. */
export function inheritDates(
  child: { start_date?: Date | null; due_date?: Date | null },
  parent: Pick<TemporalNode, 'start_date' | 'due_date'> | null,
): { start_date: Date | null; due_date: Date | null } {
  return {
    start_date: child.start_date ?? parent?.start_date ?? null,
    due_date: child.due_date ?? parent?.due_date ?? null,
  };
}

/**
 * Com que datas uma tarefa nasce.
 *
 * Duas situacoes que nao podem se misturar: quem nao pediu data nenhuma quer
 * apenas "uma tarefa", e recebe um bloco concreto no proximo quarto de hora;
 * quem informou qualquer data sabe o que quer, e ai vale o pedido, com o que
 * faltar herdado do pai como sempre foi.
 */
export function janelaDeCriacao(
  pedido: { start_date: Date | null; due_date: Date | null },
  parent: Pick<TemporalNode, 'start_date' | 'due_date'> | null,
  contexto: { agora: Date; estimatedMinutes?: number | null },
): { start_date: Date | null; due_date: Date | null } {
  const semPedido = pedido.start_date == null && pedido.due_date == null;

  return semPedido
    ? janelaPadrao(contexto.agora, parent, contexto.estimatedMinutes)
    : inheritDates(pedido, parent);
}

export interface RescheduleImpact {
  shiftedDays: number;
  /** Deslocamento real, em minutos: no zoom de horas o dia arredonda para zero. */
  shiftedMinutes: number;
  /** Quanto a janela encolheu ou cresceu. 1 = so mudou de lugar. */
  scale: number;
  affected: Array<{
    id: string;
    title: string;
    from: { start_date: Date | null; due_date: Date | null };
    to: { start_date: Date | null; due_date: Date | null };
  }>;
  violations: Array<{ id: string; title: string; violations: TemporalViolation[] }>;
}

/**
 * Previa de mover um no no tempo. Nada e aplicado aqui: a UI mostra o
 * resultado e so entao confirma.
 */
const MIN_MS = 60_000;

export interface WindowMap {
  fromStart: Date;
  fromEnd: Date;
  toStart: Date;
  toEnd: Date;
}

/**
 * Leva um instante da janela antiga do pai para a nova, preservando a posicao
 * relativa. Quando as duas janelas tem a mesma duracao, isso vira um
 * deslocamento puro — mover e encolher passam a ser a MESMA conta, e nao dois
 * caminhos que podem divergir.
 *
 * Arredonda no minuto: a escala e fracionaria e sem isso as datas nasceriam
 * com segundos aleatorios.
 */
export function remapInstant(t: Date, w: WindowMap): Date {
  const fromLength = w.fromEnd.getTime() - w.fromStart.getTime();
  const toLength = w.toEnd.getTime() - w.toStart.getTime();

  // Janela de duracao zero nao da para escalar: resta acompanhar o inicio.
  if (fromLength <= 0) {
    return new Date(t.getTime() + (w.toStart.getTime() - w.fromStart.getTime()));
  }

  const ratio = (t.getTime() - w.fromStart.getTime()) / fromLength;
  const raw = w.toStart.getTime() + ratio * toLength;
  return new Date(Math.round(raw / MIN_MS) * MIN_MS);
}

/** Meia-noite local do dia em que o instante cai. */
function startOfLocalDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Reposiciona uma filha. A de dia inteiro e ancorada no comeco do dia: depois
 * de uma reducao de 40%, "13:47 de terca" nao e uma data que alguem queira ler.
 */
function remapChild(
  child: TemporalNode,
  w: WindowMap,
): { start_date: Date | null; due_date: Date | null } {
  const snap = (d: Date | null) => {
    if (!d) return null;
    const mapped = remapInstant(d, w);
    return child.all_day ? startOfLocalDay(mapped) : mapped;
  };
  return { start_date: snap(child.start_date), due_date: snap(child.due_date) };
}

/**
 * Janela que contem todas as filhas. `null` quando nenhuma tem data — nesse
 * caso nao ha envelope a calcular e o pai fica como esta.
 */
export function envelopeOf(
  children: Array<Pick<TemporalNode, 'start_date' | 'due_date'>>,
): { start_date: Date; due_date: Date } | null {
  let min: Date | null = null;
  let max: Date | null = null;

  for (const c of children) {
    for (const d of [c.start_date, c.due_date]) {
      if (!d) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
  }
  return min && max ? { start_date: min, due_date: max } : null;
}

/** Fim do dia local: o pai de dia inteiro nao pode terminar as 15:47. */
function endOfLocalDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 0, 0);
  return copy;
}

function startOfLocalDayDate(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Cresce a janela do pai ate caber tudo o que esta embaixo dele. So CRESCE:
 * encolher junto quando uma filha diminui apagaria em silencio um prazo que
 * alguem escolheu, e transformaria cada ajuste fino numa reacao em cadeia.
 *
 * Esta e a direcao de baixo para cima, e ela e deliberadamente diferente da
 * de cima para baixo: aqui o pai muda de tamanho SEM reescalar as irmas. Se
 * as duas regras se chamassem, aumentar uma filha reposicionaria todas as
 * outras — o oposto do que quem arrastou pediu.
 */
export function grownWindow(
  parent: Pick<TemporalNode, 'start_date' | 'due_date'> & { all_day?: boolean },
  children: Array<Pick<TemporalNode, 'start_date' | 'due_date'>>,
): { start_date: Date | null; due_date: Date | null; changed: boolean } {
  const env = envelopeOf(children);
  if (!env) {
    return { start_date: parent.start_date, due_date: parent.due_date, changed: false };
  }

  let start = parent.start_date && parent.start_date <= env.start_date
    ? parent.start_date
    : env.start_date;
  let due = parent.due_date && parent.due_date >= env.due_date ? parent.due_date : env.due_date;

  if (parent.all_day) {
    start = startOfLocalDayDate(start);
    due = endOfLocalDay(due);
  }

  const changed =
    start.getTime() !== parent.start_date?.getTime() ||
    due.getTime() !== parent.due_date?.getTime();

  return { start_date: start, due_date: due, changed };
}

export function planReschedule(
  node: TemporalNode,
  next: { start_date: Date | null; due_date: Date | null },
  descendants: TemporalNode[],
  parent: TemporalNode | null,
  cascadeChildren: boolean,
  /**
   * O reagendamento cresce os ancestrais logo depois de aplicar. Quando isso
   * vai acontecer, sair da janela do pai nao e conflito nenhum: e o caso
   * normal, e o pai passa a caber a tarefa. Contar como violacao produzia o
   * aviso contraditorio — "o pai cresceu para caber" ao lado de "1 conflito de
   * prazo registrado" — em todo arraste que tirasse a tarefa da janela de cima.
   */
  opcoes: { ancestraisCrescem?: boolean } = {},
): RescheduleImpact {
  const anchorBefore = node.start_date ?? node.due_date;
  const anchorAfter = next.start_date ?? next.due_date;
  const shiftedMinutes =
    anchorBefore && anchorAfter
      ? Math.round((anchorAfter.getTime() - anchorBefore.getTime()) / MIN_MS)
      : 0;
  const shiftedDays = Math.round(shiftedMinutes / 1440);

  // A janela so existe com as duas pontas nos dois momentos. Sem ela nao ha
  // proporcao a preservar, e o melhor que da para fazer e deslocar.
  const janela: WindowMap | null =
    node.start_date && node.due_date && next.start_date && next.due_date
      ? {
          fromStart: node.start_date,
          fromEnd: node.due_date,
          toStart: next.start_date,
          toEnd: next.due_date,
        }
      : null;

  const fromLength = janela ? janela.fromEnd.getTime() - janela.fromStart.getTime() : 0;
  const toLength = janela ? janela.toEnd.getTime() - janela.toStart.getTime() : 0;
  const scale = janela && fromLength > 0 ? toLength / fromLength : 1;

  const affected: RescheduleImpact['affected'] = [];
  const violations: RescheduleImpact['violations'] = [];

  const mudou = (
    a: { start_date: Date | null; due_date: Date | null },
    b: { start_date: Date | null; due_date: Date | null },
  ) =>
    a.start_date?.getTime() !== b.start_date?.getTime() ||
    a.due_date?.getTime() !== b.due_date?.getTime();

  for (const child of descendants) {
    const atual = { start_date: child.start_date, due_date: child.due_date };
    let moved = atual;

    if (cascadeChildren) {
      moved = janela
        ? remapChild(child, janela)
        : {
            start_date: shiftMinutes(child.start_date, shiftedMinutes),
            due_date: shiftMinutes(child.due_date, shiftedMinutes),
          };
    }

    if (cascadeChildren && mudou(atual, moved)) {
      affected.push({ id: child.id, title: child.title, from: atual, to: moved });
    }

    const v = validateAgainstParent(moved, next);
    if (v.length > 0) violations.push({ id: child.id, title: child.title, violations: v });
  }

  // Com os ancestrais crescendo, sobra desta checagem o que nenhum crescimento
  // conserta: inicio depois do fim.
  const ancestraisCrescem = opcoes.ancestraisCrescem ?? true;
  const own = validateAgainstParent(next, ancestraisCrescem ? null : parent);
  if (own.length > 0) violations.unshift({ id: node.id, title: node.title, violations: own });

  return { shiftedDays, shiftedMinutes, scale, affected, violations };
}

export function shiftDate(d: Date | null, days: number): Date | null {
  if (!d || days === 0) return d;
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Deslocamento em minutos: o de dias zerava qualquer arraste no zoom de horas. */
export function shiftMinutes(d: Date | null, minutes: number): Date | null {
  if (!d || minutes === 0) return d;
  return new Date(d.getTime() + minutes * MIN_MS);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10).split('-').reverse().join('/');
}
