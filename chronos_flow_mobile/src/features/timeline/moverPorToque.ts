import { create } from 'zustand';
import type { NodeDTO } from '@shared/types';

/**
 * Arrastar nao existe aqui.
 *
 * O desktop reparenteia tarefas e solta modelos na timeline com HTML5
 * drag-and-drop, que o WKWebView simplesmente nao implementa para o dedo: o
 * `dragstart` nunca dispara num toque. Em vez de reinventar o arraste com
 * eventos de ponteiro — gesto que, num celular, disputa com a rolagem da
 * propria lista — o gesto virou dois toques: escolhe-se o que vai mover e
 * depois onde ele entra.
 *
 * Fica, de quebra, mais honesto num dedo: o alvo nao some embaixo do polegar.
 */
interface ModeloEmMao {
  id: string;
  title: string;
}

interface Mover {
  /** Tarefa escolhida para mudar de pai. */
  tarefa: NodeDTO | null;
  /** Modelo escolhido na paleta, esperando um lugar na timeline. */
  modelo: ModeloEmMao | null;

  pegarTarefa: (node: NodeDTO) => void;
  pegarModelo: (modelo: ModeloEmMao) => void;
  largar: () => void;
}

export const useMover = create<Mover>((set) => ({
  tarefa: null,
  modelo: null,
  // Uma coisa de cada vez: com os dois em mao, o proximo toque seria ambiguo.
  pegarTarefa: (node) => set({ tarefa: node, modelo: null }),
  pegarModelo: (modelo) => set({ modelo, tarefa: null }),
  largar: () => set({ tarefa: null, modelo: null }),
}));

/**
 * Um no nao pode entrar debaixo de si mesmo nem de uma descendente sua: isso
 * desligaria o galho inteiro da arvore. O caminho materializado responde a
 * pergunta sem nenhuma consulta.
 */
export function podeReceber(origem: NodeDTO, destino: NodeDTO | null): boolean {
  if (!destino) return origem.parent_id !== null;
  if (destino.id === origem.id) return false;
  if (destino.parent_id === origem.id) return false;
  return !destino.path.startsWith(origem.path);
}
