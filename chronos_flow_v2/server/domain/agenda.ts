/**
 * Encadeamento de tarefas no tempo. Puro, sem I/O.
 *
 * O plano da IA diz o que fazer, quanto dura e o que vem antes do que. Nao diz
 * quando — `offset_days` e um chute em granularidade de dia, e usa-lo como
 * resposta empilhava o projeto inteiro no mesmo instante. Aqui o "quando" e
 * calculado: cada tarefa recebe uma janela do tamanho da sua estimativa, depois
 * do que ela depende, e sem colidir com outra tarefa da mesma pessoa.
 */

export interface Expediente {
  inicioHora: number;
  fimHora: number;
  /** Dias da semana trabalhados. 0 = domingo. */
  diasUteis: number[];
}

export const EXPEDIENTE_PADRAO: Expediente = {
  inicioHora: 9,
  fimHora: 18,
  diasUteis: [1, 2, 3, 4, 5],
};

export interface TarefaAgendavel {
  id: string;
  /** Duracao em minutos de trabalho — nao de calendario. */
  minutos: number;
  /** Ids que precisam terminar antes desta comecar. */
  dependeDe: string[];
  /**
   * Quem executa. Duas tarefas da mesma agenda nunca se sobrepoem; agendas
   * diferentes correm em paralelo, que e o que torna um plano com varias
   * pessoas mais curto do que a soma das partes.
   */
  agenda: string;
  /** Piso em dias a partir do inicio, quando o plano pediu um. */
  naoAntesDe?: number | null;
  /** Desempate estavel entre tarefas igualmente prontas. */
  ordem: number;
}

export interface Janela {
  start_date: Date;
  due_date: Date;
}

export function minutosDeJornada(exp: Expediente): number {
  return Math.max(1, (exp.fimHora - exp.inicioHora) * 60);
}

function ehDiaUtil(d: Date, exp: Expediente): boolean {
  return exp.diasUteis.includes(d.getDay());
}

function abreEm(d: Date, exp: Expediente): Date {
  const abre = new Date(d);
  abre.setHours(exp.inicioHora, 0, 0, 0);
  return abre;
}

function fechaEm(d: Date, exp: Expediente): Date {
  const fecha = new Date(d);
  fecha.setHours(exp.fimHora, 0, 0, 0);
  return fecha;
}

/** O primeiro instante de expediente a partir de `instante`, inclusive. */
export function proximoUtil(instante: Date, exp: Expediente = EXPEDIENTE_PADRAO): Date {
  let d = new Date(instante);

  // O teto de voltas e so uma trava contra configuracao sem nenhum dia util.
  for (let i = 0; i < 400; i += 1) {
    if (ehDiaUtil(d, exp)) {
      const abre = abreEm(d, exp);
      if (d < abre) return abre;
      if (d < fechaEm(d, exp)) return d;
    }
    d = new Date(d);
    d.setDate(d.getDate() + 1);
    d.setHours(exp.inicioHora, 0, 0, 0);
  }
  return d;
}

/**
 * Onde termina quem comeca em `inicio` e gasta `minutos` de trabalho.
 *
 * A noite e o fim de semana nao contam como esforco, mas ficam dentro da
 * janela: uma tarefa de 12h comecada as 15h de sexta termina na terca, e a
 * barra atravessa o fim de semana porque foi isso que aconteceu.
 */
export function fimDoTrabalho(
  inicio: Date,
  minutos: number,
  exp: Expediente = EXPEDIENTE_PADRAO,
): Date {
  let atual = proximoUtil(inicio, exp);
  let restante = Math.max(1, Math.round(minutos));

  for (let i = 0; i < 5000; i += 1) {
    const disponivel = Math.round((fechaEm(atual, exp).getTime() - atual.getTime()) / 60_000);
    if (disponivel >= restante) return new Date(atual.getTime() + restante * 60_000);

    restante -= Math.max(0, disponivel);
    const amanha = new Date(atual);
    amanha.setDate(amanha.getDate() + 1);
    amanha.setHours(exp.inicioHora, 0, 0, 0);
    atual = proximoUtil(amanha, exp);
  }
  return atual;
}

/**
 * Ordem de execucao: quem bloqueia sai antes de quem e bloqueado, e o resto
 * segue a ordem do plano. Uma dependencia para fora da lista e ignorada — ela
 * aponta para uma tarefa que o usuario descartou.
 */
export function ordemDeExecucao(tarefas: TarefaAgendavel[]): TarefaAgendavel[] {
  const conhecidas = new Set(tarefas.map((t) => t.id));
  const fila = [...tarefas].sort((a, b) => a.ordem - b.ordem);
  const prontas: TarefaAgendavel[] = [];
  const resolvidas = new Set<string>();

  while (fila.length > 0) {
    const i = fila.findIndex((t) =>
      t.dependeDe.every((d) => !conhecidas.has(d) || resolvidas.has(d)),
    );
    // Nenhuma liberada significa ciclo. Seguir a ordem do plano e melhor do
    // que travar: o ciclo ja foi recusado antes de chegar aqui.
    const [escolhida] = fila.splice(i >= 0 ? i : 0, 1);
    resolvidas.add(escolhida.id);
    prontas.push(escolhida);
  }
  return prontas;
}

/** A janela de cada tarefa, encadeada por dependencia e por agenda. */
export function agendarExecucao(
  tarefas: TarefaAgendavel[],
  inicio: Date,
  exp: Expediente = EXPEDIENTE_PADRAO,
): Map<string, Janela> {
  const janelas = new Map<string, Janela>();
  const livre = new Map<string, Date>();
  const base = proximoUtil(inicio, exp);

  for (const tarefa of ordemDeExecucao(tarefas)) {
    const marcos = [base.getTime()];

    for (const dep of tarefa.dependeDe) {
      const janela = janelas.get(dep);
      if (janela) marcos.push(janela.due_date.getTime());
    }
    const agendaLivre = livre.get(tarefa.agenda);
    if (agendaLivre) marcos.push(agendaLivre.getTime());
    if (tarefa.naoAntesDe) marcos.push(base.getTime() + tarefa.naoAntesDe * 86_400_000);

    const start_date = proximoUtil(new Date(Math.max(...marcos)), exp);
    const due_date = fimDoTrabalho(start_date, tarefa.minutos, exp);

    janelas.set(tarefa.id, { start_date, due_date });
    livre.set(tarefa.agenda, due_date);
  }

  return janelas;
}

/** Menor janela que cobre todas as passadas. Serve para a janela das maes. */
export function envelope(janelas: Janela[]): Janela | null {
  if (janelas.length === 0) return null;
  return {
    start_date: new Date(Math.min(...janelas.map((j) => j.start_date.getTime()))),
    due_date: new Date(Math.max(...janelas.map((j) => j.due_date.getTime()))),
  };
}

/** O minimo que o agendamento precisa saber de uma tarefa do plano. */
export interface ItemDePlano {
  id: string;
  parentId: string;
  folha: boolean;
  estimated_minutes?: number | null;
  duration_days?: number | null;
  offset_days?: number | null;
  role?: string | null;
  depends_on?: string[];
}

export interface OpcoesDoPlano {
  inicio: Date;
  /** ref da IA -> id do no criado. */
  refParaId: Map<string, string>;
  /** papel -> agenda (membro). Sem membro, todos caem na mesma agenda. */
  papelParaAgenda: Map<string, string>;
  expediente?: Expediente;
}

/**
 * A janela de cada no do plano — folhas encadeadas, maes pelo envelope.
 *
 * Tres decisoes moram aqui, e todas as tres vinham erradas antes:
 *  - a duracao e a estimativa da tarefa, nao um dia inteiro por padrao;
 *  - depender de um bloco e esperar tudo o que ha dentro dele, nao so o rotulo;
 *  - a mae nao inventa janela: ela cobre exatamente as filhas.
 */
export function janelasDoPlano(
  itens: ItemDePlano[],
  opcoes: OpcoesDoPlano,
): Map<string, Janela> {
  const exp = opcoes.expediente ?? EXPEDIENTE_PADRAO;
  const jornada = minutosDeJornada(exp);

  const filhasDe = new Map<string, ItemDePlano[]>();
  for (const item of itens) {
    const lista = filhasDe.get(item.parentId) ?? [];
    lista.push(item);
    filhasDe.set(item.parentId, lista);
  }

  const folhasSob = (id: string): string[] => {
    const filhas = filhasDe.get(id) ?? [];
    return filhas.length === 0 ? [id] : filhas.flatMap((f) => folhasSob(f.id));
  };

  const janelas = agendarExecucao(
    itens
      .filter((item) => item.folha)
      .map((item, ordem) => ({
        id: item.id,
        minutos:
          item.estimated_minutes ??
          (item.duration_days ? item.duration_days * jornada : 60),
        dependeDe: (item.depends_on ?? [])
          .map((ref) => opcoes.refParaId.get(ref))
          .filter((id): id is string => Boolean(id))
          .flatMap(folhasSob)
          .filter((id) => id !== item.id),
        agenda: (item.role ? opcoes.papelParaAgenda.get(item.role) : null) ?? 'sem-dono',
        naoAntesDe: item.offset_days ?? null,
        ordem,
      })),
    opcoes.inicio,
    exp,
  );

  const janelaDe = (item: ItemDePlano): Janela => {
    const pronta = janelas.get(item.id);
    if (pronta) return pronta;

    const env = envelope((filhasDe.get(item.id) ?? []).map(janelaDe)) ?? {
      start_date: proximoUtil(opcoes.inicio, exp),
      due_date: fimDoTrabalho(opcoes.inicio, 60, exp),
    };
    janelas.set(item.id, env);
    return env;
  };
  for (const item of itens) janelaDe(item);

  return janelas;
}
