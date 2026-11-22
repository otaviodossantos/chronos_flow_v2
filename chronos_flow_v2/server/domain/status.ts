/**
 * Troca de status como um gesto so.
 *
 * Mover um cartao no Kanban parece um `update` de campo, mas nao e: concluir
 * uma folha dispara a cascata e destrava dependentes, e tirar algo de
 * "Concluida" precisa reabrir os ancestrais junto. Cada um desses caminhos ja
 * existe no servico; esta funcao so decide quais, e em que ordem, levam de um
 * status ao outro. Pura, para o Kanban e o MCP concordarem sobre a regra.
 */
export type NodeStatusValue = 'PENDING' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';

/** Os status que se escolhem a mao. BLOCKED vem das dependencias. */
export type SettableStatus = Exclude<NodeStatusValue, 'BLOCKED'>;

/**
 * - `complete`: o caminho de concluir folha (cascata, desbloqueio, impacto);
 * - `reopen`:   o caminho de reabrir (ancestrais e dependentes acompanham);
 * - `patch`:    gravar o status direto, com as validacoes do update comum.
 */
export type StatusStep = 'complete' | 'reopen' | 'patch';

const fechado = (s: NodeStatusValue) => s === 'COMPLETED' || s === 'CANCELLED';

export function stepsToStatus(
  from: NodeStatusValue,
  to: SettableStatus,
  isLeaf: boolean,
): StatusStep[] {
  if (from === to) return [];

  // Cancelar nao e concluir: sai da conta sem disparar a cascata de conclusao.
  if (to === 'CANCELLED') return ['patch'];

  if (to === 'COMPLETED') {
    // Pai nao tem o caminho de folha: o update comum ja recusa quando ha
    // filha pendente, que e a regra certa para ele.
    const concluir: StatusStep = isLeaf ? 'complete' : 'patch';
    return from === 'CANCELLED' ? ['reopen', concluir] : [concluir];
  }

  // Daqui para baixo o destino e PENDING ou IN_PROGRESS.
  if (fechado(from)) {
    // Reabrir ja devolve a tarefa como pendente (ou bloqueada, se voltou a
    // depender de alguem). So "em andamento" pede um passo a mais.
    return to === 'PENDING' ? ['reopen'] : ['reopen', 'patch'];
  }

  return ['patch'];
}
