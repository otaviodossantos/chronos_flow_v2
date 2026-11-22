import { create } from 'zustand';
import type { NodeDTO } from '@shared/types';
import { ilha } from '@/native/chronos';
import { duracaoDoBloco, ressincronizarBloco, restanteAoAbrir } from './timerBlock';

const CHAVE = 'chronos.foco.sessao';

interface Retrato {
  nodeId: string;
  titulo: string;
  trilha: string;
  totalSeconds: number;
  secondsRemaining: number;
  /** Quando o relogio voltou a andar. null = pausado. */
  correndoDesde: number | null;
}

/**
 * O relogio da sessao nao e um `setInterval` guardado em estado.
 *
 * O iOS congela o JavaScript assim que o app sai da tela, entao um contador
 * que decrementa a cada tique perderia exatamente o tempo em que voce esteve
 * fora — justo o tempo que a Ilha Dinamica esteve mostrando a contagem certa.
 * O que se guarda e o instante em que o relogio voltou a andar; o restante e
 * sempre calculado a partir dele.
 */
function restanteAgora(r: Retrato, agora = Date.now()): number {
  if (r.correndoDesde == null) return r.secondsRemaining;
  return r.secondsRemaining - Math.floor((agora - r.correndoDesde) / 1000);
}

function gravar(r: Retrato | null) {
  try {
    if (r) localStorage.setItem(CHAVE, JSON.stringify(r));
    else localStorage.removeItem(CHAVE);
  } catch {
    /* modo privado, ou armazenamento cheio: a sessao vive so nesta sessao */
  }
}

function ler(): Retrato | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as Retrato) : null;
  } catch {
    return null;
  }
}

/** O fim que a ilha usa para contar sozinha, em ISO. */
const fimPrevisto = (r: Retrato): string =>
  new Date(Date.now() + Math.max(0, restanteAgora(r)) * 1000).toISOString();

interface Sessao {
  retrato: Retrato | null;
  /** Reavaliado a cada segundo so enquanto o app esta na tela. */
  restante: number;

  iniciar: (node: NodeDTO, trilha?: string) => void;
  pausar: () => void;
  retomar: () => void;
  encerrar: () => void;
  /** A estimativa da tarefa mudou enquanto ela estava em foco. */
  ressincronizar: (node: NodeDTO) => void;
  /** Recalcula o restante; chamado pelo tique e ao voltar do segundo plano. */
  tique: () => void;
  restaurar: () => void;
}

export const useSessaoDeFoco = create<Sessao>((set, get) => ({
  retrato: ler(),
  restante: (() => {
    const r = ler();
    return r ? restanteAgora(r) : 0;
  })(),

  iniciar: (node, trilha = '') => {
    const total = duracaoDoBloco(node.estimated_minutes);
    const retrato: Retrato = {
      nodeId: node.id,
      titulo: node.title,
      trilha,
      totalSeconds: total,
      // Abrir faltando o que sobra da janela, nao o bloco cheio: e a mesma
      // regra do widget do desktop, e a razao de ela viver em timerBlock.
      secondsRemaining: restanteAoAbrir(
        { start_date: node.start_date, due_date: node.due_date, all_day: node.all_day },
        total,
        new Date(),
      ),
      correndoDesde: Date.now(),
    };

    gravar(retrato);
    set({ retrato, restante: retrato.secondsRemaining });

    void ilha.iniciar({
      nodeId: node.id,
      titulo: node.title,
      trilha,
      fim: fimPrevisto(retrato),
      totalSegundos: total,
      pausadoEm: null,
    });
  },

  pausar: () => {
    const { retrato } = get();
    if (!retrato || retrato.correndoDesde == null) return;

    const parado: Retrato = {
      ...retrato,
      secondsRemaining: restanteAgora(retrato),
      correndoDesde: null,
    };
    gravar(parado);
    set({ retrato: parado, restante: parado.secondsRemaining });

    void ilha.atualizar({
      nodeId: parado.nodeId,
      fim: fimPrevisto(parado),
      pausadoEm: new Date().toISOString(),
    });
  },

  retomar: () => {
    const { retrato } = get();
    if (!retrato || retrato.correndoDesde != null) return;

    const andando: Retrato = { ...retrato, correndoDesde: Date.now() };
    gravar(andando);
    set({ retrato: andando, restante: andando.secondsRemaining });

    void ilha.atualizar({
      nodeId: andando.nodeId,
      fim: fimPrevisto(andando),
      pausadoEm: null,
    });
  },

  encerrar: () => {
    const { retrato } = get();
    gravar(null);
    set({ retrato: null, restante: 0 });
    if (retrato) void ilha.encerrar(retrato.nodeId);
  },

  ressincronizar: (node) => {
    const { retrato } = get();
    if (!retrato || retrato.nodeId !== node.id) return;

    const novoTotal = duracaoDoBloco(node.estimated_minutes);
    if (novoTotal === retrato.totalSeconds && node.title === retrato.titulo) return;

    // O gasto nao evapora quando o prazo muda: recalcula-se o que sobra.
    const ajustado = ressincronizarBloco(
      { totalSeconds: retrato.totalSeconds, secondsRemaining: restanteAgora(retrato) },
      novoTotal,
    );

    const novo: Retrato = {
      ...retrato,
      titulo: node.title,
      totalSeconds: ajustado.totalSeconds,
      secondsRemaining: ajustado.secondsRemaining,
      correndoDesde: retrato.correndoDesde == null ? null : Date.now(),
    };
    gravar(novo);
    set({ retrato: novo, restante: ajustado.secondsRemaining });

    void ilha.atualizar({
      nodeId: novo.nodeId,
      titulo: novo.titulo,
      fim: fimPrevisto(novo),
      totalSegundos: novo.totalSeconds,
    });
  },

  tique: () => {
    const { retrato } = get();
    if (!retrato) return;
    set({ restante: restanteAgora(retrato) });
  },

  /**
   * Voltar do segundo plano. O retrato no armazenamento pode ser mais novo do
   * que o da memoria quando o iOS descartou o WebView e o recriou.
   */
  restaurar: () => {
    const gravado = ler();
    if (!gravado) {
      if (get().retrato) set({ retrato: null, restante: 0 });
      return;
    }
    set({ retrato: gravado, restante: restanteAgora(gravado) });
  },
}));

export const emSegundos = (total: number) => {
  const negativo = total < 0;
  const abs = Math.abs(total);
  const mm = String(Math.floor(abs / 60)).padStart(2, '0');
  const ss = String(abs % 60).padStart(2, '0');
  return `${negativo ? '-' : ''}${mm}:${ss}`;
};
