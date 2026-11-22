import type { NodeDTO } from '@shared/types';
import { formatTimeOfDay } from '@/lib/format';

/**
 * O que vai ser armado no iOS, decidido aqui e so aqui.
 *
 * Separado do lado nativo de proposito: a parte que erra nao e o `schedule` do
 * sistema, e sim *quais* tarefas merecem aviso e *quando*. Isso e uma funcao
 * pura de (tarefas, ajustes, agora), e uma funcao pura da para testar sem
 * iPhone nenhum.
 */
export type TipoDeAviso = 'aviso' | 'alarme';

export interface Aviso {
  /** Estavel e derivado do no: rearmar duas vezes nao duplica nada. */
  id: string;
  nodeId: string;
  tipo: TipoDeAviso;
  titulo: string;
  corpo: string;
  /** ISO. O instante em que o iOS deve avisar. */
  quando: string;
}

export interface AjustesDeAviso {
  ligado: boolean;
  /** Minutos antes do inicio. Zero = na hora. */
  antecedencia: number;
}

export const AJUSTES_PADRAO: AjustesDeAviso = { ligado: false, antecedencia: 5 };

export const ANTECEDENCIAS = [0, 5, 10, 15, 30, 60];

/**
 * Ate onde olhar para a frente.
 *
 * Quem arma os avisos e o app rodando, entao a janela precisa cobrir o tempo
 * que voce pode passar sem abri-lo. Uma semana cobre uma viagem; esticar mais
 * so gastaria o teto abaixo com tarefas que ainda vao mudar de data.
 */
export const HORIZONTE_DIAS = 7;

/**
 * Teto de avisos.
 *
 * O iOS guarda no maximo 64 notificacoes pendentes por app e descarta as mais
 * distantes sem avisar ninguem. Parar em 56 deixa folga para o que o app
 * agenda fora deste plano — o fim de um bloco de foco, por exemplo — sem que
 * um empurre o outro para fora da fila.
 */
export const TETO = 56;

const MIN = 60_000;

/** Tarefa que pode gerar aviso, com o motivo de cada recusa a vista. */
function avisavel(node: NodeDTO): boolean {
  // Folhas apenas. A janela de uma meta macro comeca junto com a primeira
  // filha dela, entao avisar as duas tocaria duas vezes no mesmo instante
  // para a mesma coisa.
  if (!node.isLeaf) return false;
  if (node.status === 'COMPLETED') return false;
  if (!node.start_date) return false;
  // Dia inteiro nao tem hora de comecar: "faltam 5 minutos" cairia a meia
  // noite menos cinco, que nao e o que ninguem quis dizer.
  if (node.all_day) return false;
  return true;
}

/**
 * Monta a lista de avisos a armar.
 *
 * O aviso vem antes do inicio, pela antecedencia escolhida. O despertador,
 * quando a tarefa pede um, toca **na hora** — primeiro o empurrao, depois o
 * alarme. Com antecedencia zero os dois cairiam no mesmo segundo, entao ali o
 * aviso cede o lugar ao alarme.
 */
export function planoDeAvisos(
  nodes: NodeDTO[],
  ajustes: AjustesDeAviso,
  agora: Date = new Date(),
): Aviso[] {
  const limite = agora.getTime() + HORIZONTE_DIAS * 24 * 60 * MIN;
  const saida: Aviso[] = [];

  for (const node of nodes) {
    if (!avisavel(node)) continue;

    const inicio = new Date(node.start_date as string);
    const hora = formatTimeOfDay(inicio);
    const querAlarme = node.alarme === true;

    if (ajustes.ligado && !(querAlarme && ajustes.antecedencia === 0)) {
      const quando = new Date(inicio.getTime() - ajustes.antecedencia * MIN);
      // Passado nao se arma: o iOS aceitaria em silencio e nunca tocaria.
      if (quando > agora && quando.getTime() <= limite) {
        saida.push({
          id: `${node.id}:aviso`,
          nodeId: node.id,
          tipo: 'aviso',
          titulo: node.title,
          corpo:
            ajustes.antecedencia > 0
              ? `Comeca em ${ajustes.antecedencia} min, as ${hora}.`
              : `Comeca agora, as ${hora}.`,
        quando: quando.toISOString(),
        });
      }
    }

    // O despertador nao depende do interruptor geral: quem marcou uma tarefa
    // como "me acorde" pediu aquilo para aquela tarefa, e desligar os avisos
    // de rotina nao pode cancelar um alarme em silencio.
    if (querAlarme && inicio > agora && inicio.getTime() <= limite) {
      saida.push({
        id: `${node.id}:alarme`,
        nodeId: node.id,
        tipo: 'alarme',
        titulo: node.title,
        corpo: `Hora de comecar, as ${hora}.`,
        quando: inicio.toISOString(),
      });
    }
  }

  // Mais perto primeiro: quando o teto corta, corta o que esta mais longe —
  // que e tambem o que tem mais chance de mudar de data antes de acontecer.
  saida.sort((a, b) => a.quando.localeCompare(b.quando));
  return saida.slice(0, TETO);
}

/** O que muda de verdade entre dois planos, para nao rearmar a toa. */
export function mesmoPlano(a: Aviso[], b: Aviso[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.id === b[i].id && x.quando === b[i].quando && x.corpo === b[i].corpo);
}
