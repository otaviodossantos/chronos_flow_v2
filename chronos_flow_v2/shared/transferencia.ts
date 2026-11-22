/**
 * O formato do pacote que viaja entre o desktop e o iPhone.
 *
 * Mora em `shared/` pelo mesmo motivo que os tipos e os schemas: os dois apps
 * precisam concordar sobre ele byte a byte, e duas definicoes paralelas
 * divergiriam na primeira coluna nova — com o sintoma aparecendo so do outro
 * lado da transferencia, horas depois.
 *
 * As tabelas estao na ordem das chaves estrangeiras. Inverter espaco e tarefa
 * faria o banco recusar a primeira linha da importacao.
 */
export const FORMATO_DO_PACOTE = 2;

export const TABELAS_DO_PACOTE = [
  'users',
  'spaces',
  'members',
  'space_members',
  'task_templates',
  'nodes',
  'node_dependencies',
  'progress_snapshots',
  'node_activity',
  'backlog_items',
  'backlog_roles',
] as const;

export type TabelaDoPacote = (typeof TABELAS_DO_PACOTE)[number];

export interface Pacote {
  formato: number;
  app: 'chronos-flow';
  /** De onde saiu, so para a tela dizer "veio do MacBook do Henrique". */
  origem?: { tipo: 'desktop' | 'iphone'; nome: string };
  exportadoEm: string;
  tabelas: Partial<Record<TabelaDoPacote, Array<Record<string, unknown>>>>;
}

export interface ResumoDoPacote {
  exportadoEm: string;
  origem: string | null;
  nos: number;
  espacos: number;
  membros: number;
  backlog: number;
}

export class PacoteInvalido extends Error {
  readonly code = 'VALIDATION_FAILED';
}

/**
 * Aceita so o que da para importar sem estragar o banco de quem recebe.
 *
 * Um formato mais novo e recusado de proposito: o pacote pode trazer colunas
 * que esta versao nao conhece, e importar pela metade e pior do que nao
 * importar — o lado que recebe ja apagou os proprios dados nesse ponto.
 */
export function validarPacote(bruto: unknown): Pacote {
  const p = bruto as Partial<Pacote> | null;
  if (!p || typeof p !== 'object' || p.app !== 'chronos-flow' || typeof p.tabelas !== 'object') {
    throw new PacoteInvalido('Este arquivo nao e uma exportacao do Chronos Flow.');
  }
  if (typeof p.formato !== 'number') {
    throw new PacoteInvalido('O pacote nao diz em que formato foi gerado.');
  }
  if (p.formato > FORMATO_DO_PACOTE) {
    throw new PacoteInvalido(
      `O pacote veio de uma versao mais nova do Chronos (formato ${p.formato}).` +
        ' Atualize este app antes de importar.',
    );
  }
  if (!Array.isArray(p.tabelas.users) || p.tabelas.users.length === 0) {
    // Sem usuario nao ha dono para nada: o banco recusaria a primeira tarefa.
    throw new PacoteInvalido('O pacote nao tem usuario — provavelmente esta incompleto.');
  }
  return p as Pacote;
}

export function resumoDoPacote(pacote: Pacote): ResumoDoPacote {
  const conta = (t: TabelaDoPacote) => pacote.tabelas[t]?.length ?? 0;
  return {
    exportadoEm: pacote.exportadoEm,
    origem: pacote.origem?.nome ?? null,
    nos: conta('nodes'),
    espacos: conta('spaces'),
    membros: conta('members'),
    backlog: conta('backlog_items'),
  };
}

/**
 * A ordem em que as linhas de uma tabela podem entrar.
 *
 * `nodes.parent_id` aponta para a propria tabela, e a exportacao sai na ordem
 * fisica do banco — sem garantia nenhuma de que a mae venha antes da filha.
 * Quando nao vinha, o banco de quem recebia recusava a linha com "foreign key
 * constraint failed" no meio de um lote de cem, e a mensagem que sobrava na
 * tela era a lista inteira de parametros do INSERT.
 *
 * `depth` resolve isso sem precisar de grafo: a raiz e 0, a filha e sempre
 * maior que a mae, entao ordenar por profundidade coloca todo pai antes de
 * qualquer filho seu. As demais tabelas ja estao ordenadas entre si pela ordem
 * de TABELAS_DO_PACOTE e nao se referenciam internamente.
 */
export function ordenarParaInserir<T extends Record<string, unknown>>(
  tabela: TabelaDoPacote,
  linhas: T[],
): T[] {
  if (tabela !== 'nodes') return linhas;
  return [...linhas].sort(
    (a, b) => (Number(a.depth) || 0) - (Number(b.depth) || 0),
  );
}

/** Texto ISO com fuso: e assim que data atravessa JSON sem virar outra coisa. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const pareceData = (valor: unknown): valor is string =>
  typeof valor === 'string' && ISO.test(valor);

/**
 * O Postgres guarda `progress` e `root_impact` como DECIMAL e o Prisma os
 * entrega como objeto; o SQLite do iPhone os guarda como numero. No meio do
 * caminho o JSON aceitaria os dois, e e por isso que a conversao e explicita:
 * um `{"s":1,"e":0,"d":[50]}` chegando no outro lado viraria `NaN` silencioso.
 */
export function numeroDoPacote(valor: unknown): number | null {
  if (valor == null) return null;
  if (typeof valor === 'number') return valor;
  const n = Number(
    typeof valor === 'object' && 'toString' in valor ? String(valor) : (valor as string),
  );
  return Number.isFinite(n) ? n : null;
}
