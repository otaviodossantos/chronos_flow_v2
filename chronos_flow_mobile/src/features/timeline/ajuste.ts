import type { ZoomLevel } from '@/stores/timelineStore';

/**
 * Ajustar a janela de uma tarefa sem arrastar.
 *
 * No desktop as tres operacoes sao um arraste: a barra inteira move, a borda
 * esquerda muda o inicio, a direita muda o fim. No iPhone o arraste nao
 * sobrevive ao WebKit — ele trata qualquer toque que se desloca como rolagem e
 * cancela o ponteiro antes de o app ver o movimento. As mesmas tres operacoes
 * viram, aqui, um modo escolhido e um par de setas.
 *
 * O vocabulario e o mesmo do arraste de proposito: a previa na tela, o rotulo
 * flutuante e a chamada ao servidor sao o mesmo codigo para os dois caminhos.
 */
export type ModoAjuste = 'move' | 'resize-start' | 'resize-end';

export interface Ajuste {
  id: string;
  modo: ModoAjuste;
  /** Acumulado desde o ultimo envio. Negativo = para tras no tempo. */
  minutos: number;
  /** Levar as filhas junto, como o arraste sem Shift faz no desktop. */
  cascata: boolean;
}

export const MODOS: Array<{ id: ModoAjuste; label: string; ajuda: string }> = [
  { id: 'move', label: 'Mover', ajuda: 'desloca a tarefa inteira' },
  { id: 'resize-start', label: 'Inicio', ajuda: 'muda so quando comeca' },
  { id: 'resize-end', label: 'Fim', ajuda: 'muda so quando termina' },
];

export const PASSOS: Array<{ minutos: number; label: string }> = [
  { minutos: 15, label: '15 min' },
  { minutos: 60, label: '1 hora' },
  { minutos: 1440, label: '1 dia' },
  { minutos: 10080, label: '1 semana' },
];

/**
 * O passo que faz sentido no zoom atual.
 *
 * Nao e uma trava: e so o palpite inicial. Quem esta na visao de meses
 * costuma querer empurrar dias, nao quinze minutos — mas pode trocar, e e
 * justamente por isso que o passo e escolhido aqui e nao herdado do zoom a
 * cada render.
 */
export function passoPadrao(zoom: ZoomLevel): number {
  if (zoom === 'hours') return 15;
  if (zoom === 'days') return 60;
  return 1440;
}

/**
 * Qual ponta da tarefa o modo mexe — e, portanto, qual data precisa existir
 * para o botao fazer sentido. Uma tarefa sem data de inicio nao tem inicio a
 * adiar.
 */
export function dataNecessaria(modo: ModoAjuste): 'start' | 'due' | 'qualquer' {
  if (modo === 'resize-start') return 'start';
  if (modo === 'resize-end') return 'due';
  return 'qualquer';
}
