import {
  TABELAS_DO_PACOTE,
  numeroDoPacote,
  pareceData,
  type TabelaDoPacote,
} from '../../../shared/transferencia.js';

/**
 * Como cada tabela do pacote se chama no Prisma. Sem este mapa seria preciso
 * escrever onze blocos iguais — e esquecer um deles so apareceria na
 * importacao de quem recebe, com a tabela faltando em silencio.
 */
export const DELEGATE: Record<TabelaDoPacote, string> = {
  users: 'user',
  spaces: 'space',
  members: 'member',
  space_members: 'spaceMember',
  task_templates: 'taskTemplate',
  nodes: 'node',
  node_dependencies: 'nodeDependency',
  progress_snapshots: 'progressSnapshot',
  node_activity: 'nodeActivity',
  backlog_items: 'backlogItem',
  backlog_roles: 'backlogRole',
};

/**
 * Colunas DECIMAL do Postgres.
 *
 * O Prisma as entrega como objeto Decimal, que em JSON vira
 * `{"s":1,"e":0,"d":[50]}` — do outro lado o SQLite guardaria isso como texto
 * e todo calculo de progresso passaria a devolver NaN. Entao elas atravessam
 * como numero, explicitamente, nos dois sentidos.
 */
export const DECIMAIS: Partial<Record<TabelaDoPacote, string[]>> = {
  users: ['daily_impact_goal'],
  nodes: ['progress', 'manual_progress', 'root_impact'],
  progress_snapshots: ['progress'],
};

/** Ordem de insercao: pai antes de filho. Apagar e o caminho inverso. */
export const ORDEM = TABELAS_DO_PACOTE;

/** Uma linha do banco virando linha do pacote. */
export function paraOPacote(
  tabela: TabelaDoPacote,
  linha: Record<string, unknown>,
): Record<string, unknown> {
  const decimais = DECIMAIS[tabela] ?? [];
  const saida: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(linha)) {
    if (valor instanceof Date) saida[chave] = valor.toISOString();
    else if (decimais.includes(chave)) saida[chave] = numeroDoPacote(valor);
    else saida[chave] = valor;
  }
  return saida;
}

/** E a volta: linha do pacote virando linha para o banco. */
export function doPacote(
  tabela: TabelaDoPacote,
  linha: Record<string, unknown>,
): Record<string, unknown> {
  const decimais = DECIMAIS[tabela] ?? [];
  const saida: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(linha)) {
    if (decimais.includes(chave)) saida[chave] = numeroDoPacote(valor);
    else if (pareceData(valor)) saida[chave] = new Date(valor);
    else saida[chave] = valor;
  }
  return saida;
}
