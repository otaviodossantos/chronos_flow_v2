import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, Check, Maximize2, Minimize2, X, ChevronLeft, ChevronRight,
  Plus, TrendingUp, ExternalLink,
} from 'lucide-react';
import type { NodeDTO, FocusItem, CascadeStep } from '@shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  FLOATING_CARD, FLOATING_PILL, broadcastActiveNode, broadcastTreeChanged,
  subscribeActiveNode, subscribeTreeChanged, type FloatingMount, resizeFloating,
} from '@/lib/floatingWindow';
import { duracaoDoBloco, ressincronizarBloco, restanteAoAbrir } from './timerBlock';

interface Props {
  /** Como o widget esta montado — decide se pode redimensionar a janela. */
  mount?: FloatingMount | null;
  /** Tarefa inicial, quando aberto a partir de um item da fila. */
  initialNode?: NodeDTO | null;
  /** Fechar: encerra a janela nativa/PiP ou esconde o overlay. */
  onClose?: () => void;
  /** Sinaliza a janela principal que algo mudou na arvore. */
  onChanged?: () => void;
}

interface TimerSnapshot {
  secondsRemaining: number;
  totalSeconds: number;
  isRunning: boolean;
  savedAt: number;
}

const storageKey = (id: string) => `chronos_timer_${id}`;
const SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Retoma o bloco de onde parou. A estimativa da tarefa e a fonte da verdade:
 * um retrato salvo para outra duracao (a estimativa mudou, ou ele foi gravado
 * antes de a tarefa carregar) e descartado em vez de sobrescrever o bloco atual.
 */
function readSnapshot(id: string, expectedTotal: number): TimerSnapshot | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as TimerSnapshot;
    if (typeof parsed.secondsRemaining !== 'number') return null;
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > SNAPSHOT_TTL_MS) return null;
    if (parsed.totalSeconds !== expectedTotal) return null;
    if (parsed.secondsRemaining > parsed.totalSeconds) return null;

    // Desconta o tempo que passou enquanto a janela esteve fechada.
    const elapsed = parsed.isRunning ? Math.floor((Date.now() - parsed.savedAt) / 1000) : 0;
    return { ...parsed, secondsRemaining: parsed.secondsRemaining - elapsed };
  } catch {
    return null;
  }
}

export function FloatingTimerWidget({ mount = null, initialNode = null, onClose, onChanged }: Props) {
  const [queue, setQueue] = useState<FocusItem[]>([]);
  const [index, setIndex] = useState(0);
  const [node, setNode] = useState<NodeDTO | null>(initialNode);
  const [isPill, setIsPill] = useState(false);
  const [isRunning, setIsRunning] = useState(true);
  const [secondsRemaining, setSecondsRemaining] = useState(() => duracaoDoBloco(null));
  const [totalSeconds, setTotalSeconds] = useState(() => duracaoDoBloco(null));
  const [cascade, setCascade] = useState<{ steps: CascadeStep[]; delta: number; root: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const endsAtRef = useRef<number | null>(null);
  const lastWriteRef = useRef(0);
  const notifiedRef = useRef(false);
  const nodeRef = useRef<NodeDTO | null>(node);
  nodeRef.current = node;

  // Espelhos do estado para o efeito do bloco poder ler o cronometro atual
  // sem depender dele — dependesse, ele rodaria a cada segundo.
  const totalRef = useRef(totalSeconds);
  totalRef.current = totalSeconds;
  const restanteRef = useRef(secondsRemaining);
  restanteRef.current = secondsRemaining;
  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;
  /**
   * Que bloco esta montado: de qual tarefa, e para qual estimativa. Guardar os
   * dois e o que torna o efeito abaixo idempotente — rodar de novo com os
   * mesmos valores nao pode mexer no cronometro.
   */
  const blocoRef = useRef<{ id: string; total: number } | null>(null);

  const current = queue[index];

  // Fundo transparente quando a janela e a nativa sem moldura.
  useEffect(() => {
    document.documentElement.classList.add('is-floating-window');
    return () => document.documentElement.classList.remove('is-floating-window');
  }, []);

  // Carrega a fila do dia — a mesma ordem por impacto do Meu Foco.
  const loadQueue = useCallback(async () => {
    try {
      const data = await api.focusQueue({ scope: 'today' });
      const items = data.queue.length > 0 ? data.queue : data.impediments;
      setQueue(items);

      const wanted = nodeRef.current?.id;
      const at = wanted ? items.findIndex((i) => i.node.id === wanted) : -1;
      const resolved = at >= 0 ? at : 0;
      setIndex(resolved);
      if (!wanted && items[0]) setNode(items[0].node);
    } catch {
      /* servidor fora do ar: o widget continua com o que tem */
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // A janela principal (ou a outra janela) pode trocar a tarefa ativa.
  useEffect(
    () =>
      subscribeActiveNode((incoming) => {
        if (!incoming) return;
        setNode(incoming);
        setQueue((q) => {
          const at = q.findIndex((i) => i.node.id === incoming.id);
          if (at >= 0) setIndex(at);
          return q;
        });
      }),
    [],
  );

  const nodeId = node?.id ?? null;
  /** Tamanho do bloco desta tarefa. Muda no instante em que a estimativa muda. */
  const totalDoNo = duracaoDoBloco(node?.estimated_minutes);

  /**
   * Os dois casos no mesmo efeito, porque a diferenca entre eles e justamente
   * o que nao se pode errar: tarefa nova recomeca o bloco; a mesma tarefa com
   * estimativa nova so reajusta o que falta, preservando o que ja se gastou.
   */
  useEffect(() => {
    if (!nodeId) return;
    const montado = blocoRef.current;

    // Nada mudou de verdade. Acontece quando o React reexecuta o efeito da
    // montagem: sem esta saida, o reajuste abaixo rodaria lendo um estado que
    // ainda nao foi aplicado e jogaria o cronometro de volta ao bloco cheio.
    if (montado?.id === nodeId && montado.total === totalDoNo) return;

    if (montado?.id === nodeId) {
      blocoRef.current = { id: nodeId, total: totalDoNo };
      const ajustado = ressincronizarBloco(
        { totalSeconds: totalRef.current, secondsRemaining: restanteRef.current },
        totalDoNo,
      );
      setTotalSeconds(ajustado.totalSeconds);
      setSecondsRemaining(ajustado.secondsRemaining);
      endsAtRef.current = isRunningRef.current
        ? Date.now() + ajustado.secondsRemaining * 1000
        : null;
      if (ajustado.reabriu) notifiedRef.current = false;
      lastWriteRef.current = 0;
      return;
    }

    blocoRef.current = { id: nodeId, total: totalDoNo };
    const atual = nodeRef.current;
    // O retrato salvo tem precedencia sobre a agenda: ele e trabalho que
    // realmente aconteceu, e a agenda e so o plano.
    const saved = readSnapshot(nodeId, totalDoNo);
    const remaining =
      saved?.secondsRemaining ??
      (atual ? restanteAoAbrir(atual, totalDoNo, new Date()) : totalDoNo);
    const running = saved?.isRunning ?? true;
    setTotalSeconds(totalDoNo);
    setSecondsRemaining(remaining);
    setIsRunning(running);

    // A ancora do fim do bloco e definida aqui, nao no efeito do loop: naquele
    // ponto `secondsRemaining` ainda seria o valor da renderizacao anterior,
    // e o cronometro voltaria ao bloco padrao de 25 minutos.
    endsAtRef.current = running ? Date.now() + remaining * 1000 : null;
    // Abrir uma tarefa que ja estourou nao e motivo para alarme: o estouro
    // esta na tela. O aviso volta a valer se o bloco for esticado.
    notifiedRef.current = remaining <= 0;
    setCascade(null);
  }, [nodeId, totalDoNo]);

  /**
   * A janela principal salvou alguma coisa. Pode ter sido a estimativa desta
   * tarefa — e e dela que sai o prazo do bloco. Buscar a tarefa pelo id em vez
   * de confiar na fila: o widget pode estar cronometrando algo que nao esta na
   * fila de hoje, aberto direto pelo painel de detalhe.
   */
  useEffect(
    () =>
      subscribeTreeChanged(() => {
        loadQueue();
        const id = nodeRef.current?.id;
        if (!id) return;
        api
          .nodeDetail(id)
          .then((detalhe) => setNode(detalhe.node))
          .catch(() => {
            /* servidor fora do ar: segue com o que tem */
          });
      }, { ignore: 'widget' }),
    [loadQueue],
  );

  // Loop ancorado no relogio do sistema: sem acumulo de erro e sem re-render extra.
  useEffect(() => {
    if (!isRunning || !node) {
      endsAtRef.current = null;
      return;
    }
    if (endsAtRef.current == null) endsAtRef.current = Date.now() + secondsRemaining * 1000;

    const id = window.setInterval(() => {
      const next = Math.round(((endsAtRef.current ?? Date.now()) - Date.now()) / 1000);
      setSecondsRemaining(next);

      if (next <= 0 && !notifiedRef.current) {
        notifiedRef.current = true;
        window.chronos?.notify?.({
          title: 'Tempo esgotado',
          subtitle: nodeRef.current?.title ?? '',
          body: 'O bloco planejado terminou. Conclua a tarefa ou estenda em 5 minutos.',
        });
        window.chronos?.bounceDock?.('critical');
      }
    }, 1000);

    return () => window.clearInterval(id);
  }, [isRunning, nodeId]);

  // Persistencia com throttle: uma escrita a cada 15s enquanto roda.
  useEffect(() => {
    if (!node) return;
    // Ainda na duracao padrao de uma tarefa que tem estimativa propria:
    // gravar aqui salvaria um bloco que nao e o desta tarefa.
    if (totalSeconds !== totalDoNo) return;
    const now = Date.now();
    if (isRunning && now - lastWriteRef.current < 15_000) return;
    lastWriteRef.current = now;
    try {
      localStorage.setItem(
        storageKey(node.id),
        JSON.stringify({ secondsRemaining, totalSeconds, isRunning, savedAt: now }),
      );
    } catch {
      /* storage bloqueado */
    }
  }, [node?.id, secondsRemaining, totalSeconds, isRunning, totalDoNo]);

  const togglePill = () => {
    const next = !isPill;
    setIsPill(next);
    resizeFloating(mount, next ? FLOATING_PILL : FLOATING_CARD);
  };

  const toggleRunning = () => {
    endsAtRef.current = isRunning ? null : Date.now() + secondsRemaining * 1000;
    setIsRunning((r) => !r);
    lastWriteRef.current = 0;
  };

  const addFiveMinutes = () => {
    const base = secondsRemaining < 0 ? 0 : secondsRemaining;
    const next = base + 300;
    setSecondsRemaining(next);
    setTotalSeconds((t) => Math.max(t, next));
    endsAtRef.current = isRunning ? Date.now() + next * 1000 : null;
    notifiedRef.current = false;
    lastWriteRef.current = 0;
  };

  const goTo = (delta: number) => {
    if (queue.length === 0) return;
    const next = (index + delta + queue.length) % queue.length;
    setIndex(next);
    setNode(queue[next].node);
    broadcastActiveNode(queue[next].node);
  };

  /**
   * Concluir daqui devolve a cascata inteira: o widget mostra a meta macro
   * subindo, que e a razao de existir da v2.
   */
  const complete = async () => {
    if (!node || busy) return;
    setBusy(true);
    try {
      const result = await api.completeNode(node.id);
      setIsRunning(false);
      setCascade({
        steps: result.cascade,
        delta: result.impact.deltaPercent,
        root: result.impact.rootTitle,
      });
      try {
        localStorage.removeItem(storageKey(node.id));
      } catch {
        /* ignora */
      }

      window.chronos?.notify?.({
        title: `+${result.impact.deltaPercent}% em ${result.impact.rootTitle}`,
        subtitle: node.title,
        body:
          result.unblocked.length > 0
            ? `Destravou ${result.unblocked.length} tarefa(s).`
            : 'Progresso propagado ate a meta macro.',
      });

      broadcastTreeChanged('widget');
      onChanged?.();

      // Deixa a cascata na tela por um instante e passa para a proxima.
      window.setTimeout(async () => {
        setCascade(null);
        await loadQueue();
      }, 3200);
    } catch {
      /* erro ja e visivel pela tarefa continuar aberta */
    } finally {
      setBusy(false);
    }
  };

  const openMain = () => {
    if (window.chronos?.openMainWindow) window.chronos.openMainWindow();
    else window.focus();
  };

  const remainingPercent = useMemo(() => {
    if (totalSeconds <= 0 || secondsRemaining <= 0) return 0;
    return Math.min(100, Math.max(0, (secondsRemaining / totalSeconds) * 100));
  }, [secondsRemaining, totalSeconds]);

  const isOvertime = secondsRemaining < 0;
  const barTone = isOvertime
    ? 'bg-[hsl(var(--status-critical))]'
    : remainingPercent <= 20
      ? 'bg-[hsl(var(--status-warning))]'
      : 'bg-[hsl(var(--status-good))]';

  const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties;
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

  // ---------------------------------------------------------------- pilula
  if (isPill) {
    return (
      <div className="flex h-full w-full items-center justify-center p-0.5 font-sans" style={dragStyle}>
        <div className="floating-glass-pill relative flex h-[40px] w-full items-center justify-between gap-2 overflow-hidden rounded-full px-3 text-white">
          <div className="absolute bottom-0 left-3 right-3 h-[2px] overflow-hidden rounded-full bg-white/10">
            <div
              className={cn('h-full transition-[width] duration-300 ease-linear', barTone)}
              style={{ width: isOvertime ? '100%' : `${remainingPercent}%` }}
            />
          </div>

          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                isOvertime
                  ? 'bg-[hsl(var(--status-critical))] shadow-[0_0_8px_hsl(var(--status-critical))]'
                  : isRunning
                    ? 'bg-[hsl(var(--status-good))] shadow-[0_0_8px_hsl(var(--status-good))]'
                    : 'bg-[hsl(var(--status-warning))]',
              )}
            />
            <span className="max-w-[72px] truncate text-[11px] font-medium text-zinc-200">
              {node?.title ?? 'Livre'}
            </span>
          </div>

          <span
            className={cn(
              'shrink-0 font-mono text-xs font-bold tabular-nums',
              isOvertime ? 'text-[hsl(var(--status-critical))]' : 'text-[hsl(var(--status-good))]',
            )}
          >
            {node ? formatClock(secondsRemaining) : '--:--'}
          </span>

          <div className="flex shrink-0 items-center gap-0.5" style={noDragStyle}>
            {node && (
              <>
                <IconButton onClick={toggleRunning} title={isRunning ? 'Pausar' : 'Iniciar'}>
                  {isRunning ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 fill-current" />}
                </IconButton>
                <IconButton onClick={complete} title="Concluir" tone="good" disabled={busy}>
                  <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                </IconButton>
              </>
            )}
            <IconButton onClick={togglePill} title="Expandir">
              <Maximize2 className="h-3 w-3" />
            </IconButton>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ card
  return (
    <div className="flex h-full w-full items-center justify-center p-1 font-sans" style={dragStyle}>
      <div className="floating-glass relative flex h-full w-full flex-col overflow-hidden rounded-xl px-3 py-2 text-white">
        {cascade ? (
          <CascadePanel cascade={cascade} />
        ) : (
          <>
            <header className="flex items-center gap-1.5">
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  isOvertime
                    ? 'bg-[hsl(var(--status-critical))]'
                    : isRunning
                      ? 'bg-[hsl(var(--status-good))]'
                      : 'bg-[hsl(var(--status-warning))]',
                )}
              />
              <span className="min-w-0 flex-1 truncate text-[10px] uppercase tracking-wide text-zinc-400">
                {current?.root.title ?? 'Chronos Flow'}
              </span>
              {current && (
                <span className="flex shrink-0 items-center gap-0.5 rounded bg-[hsl(var(--status-good)/0.18)] px-1 text-[9px] font-semibold text-[hsl(var(--status-good))]">
                  <TrendingUp className="h-2.5 w-2.5" />+{current.deltaPercent}%
                </span>
              )}
              <div className="flex shrink-0 items-center gap-0.5" style={noDragStyle}>
                <IconButton onClick={openMain} title="Abrir o Chronos Flow" size="xs">
                  <ExternalLink className="h-2.5 w-2.5" />
                </IconButton>
                <IconButton onClick={togglePill} title="Recolher para pilula" size="xs">
                  <Minimize2 className="h-2.5 w-2.5" />
                </IconButton>
                <IconButton onClick={onClose} title="Fechar" size="xs">
                  <X className="h-2.5 w-2.5" />
                </IconButton>
              </div>
            </header>

            <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-zinc-100">
              {node?.title ?? 'Nenhuma tarefa na fila de hoje'}
            </p>

            <div className="mt-auto flex items-end justify-between gap-2">
              <div>
                <div
                  className={cn(
                    'font-mono text-[26px] font-semibold leading-none tabular-nums',
                    isOvertime ? 'text-[hsl(var(--status-critical))]' : 'text-zinc-50',
                  )}
                >
                  {node ? formatClock(secondsRemaining) : '--:--'}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-400">
                  {node ? formatReadable(secondsRemaining) : 'fila vazia'}
                </div>
              </div>

              <div className="flex items-center gap-0.5" style={noDragStyle}>
                <IconButton onClick={() => goTo(-1)} title="Anterior" disabled={queue.length < 2}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton onClick={addFiveMinutes} title="+5 minutos" disabled={!node}>
                  <Plus className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton onClick={toggleRunning} title={isRunning ? 'Pausar' : 'Iniciar'} disabled={!node}>
                  {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                </IconButton>
                <IconButton onClick={complete} title="Concluir" tone="good" disabled={!node || busy}>
                  <Check className="h-4 w-4 stroke-[2.5]" />
                </IconButton>
                <IconButton onClick={() => goTo(1)} title="Proxima" disabled={queue.length < 2}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </div>

            <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={cn('h-full transition-[width] duration-300 ease-linear', barTone)}
                style={{ width: isOvertime ? '100%' : `${remainingPercent}%` }}
              />
            </div>

            {queue.length > 1 && (
              <div className="mt-1 text-center text-[9px] text-zinc-500">
                {index + 1} de {queue.length} na fila de hoje
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** O que a v1 nao tinha: ver a meta macro subir no instante da conclusao. */
function CascadePanel({
  cascade,
}: {
  cascade: { steps: CascadeStep[]; delta: number; root: string };
}) {
  const top = cascade.steps[0];
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="flex items-center gap-1.5 text-[hsl(var(--status-good))]">
        <Check className="h-3.5 w-3.5 stroke-[3]" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">Cascata propagada</span>
      </div>

      <div className="mt-1 truncate text-[10px] text-zinc-400">{cascade.root}</div>

      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="font-mono text-[26px] font-semibold leading-none text-[hsl(var(--status-good))]">
          +{cascade.delta}%
        </span>
        {top && (
          <span className="font-mono text-[11px] text-zinc-300">
            {top.previous.toFixed(1)}% <span className="text-zinc-500">→</span>{' '}
            <span className="text-zinc-50">{top.progress.toFixed(1)}%</span>
          </span>
        )}
      </div>

      <ul className="mt-1.5 space-y-0.5">
        {cascade.steps.slice(0, 3).map((step) => (
          <li key={step.id} className="flex items-center gap-1.5 text-[9px] text-zinc-400">
            <span className="font-mono text-zinc-500">L{step.depth}</span>
            <span className="min-w-0 flex-1 truncate">{step.title}</span>
            <span className="font-mono text-[hsl(var(--status-good))]">
              {step.progress.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  disabled,
  tone,
  size = 'sm',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title: string;
  disabled?: boolean;
  tone?: 'good';
  size?: 'xs' | 'sm';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-30',
        size === 'xs' ? 'h-5 w-5' : 'h-6 w-6',
        tone === 'good'
          ? 'text-[hsl(var(--status-good))] hover:bg-[hsl(var(--status-good)/0.25)]'
          : 'text-zinc-300 hover:bg-white/20 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

function formatClock(totalSec: number): string {
  const negative = totalSec < 0;
  const abs = Math.abs(totalSec);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0
    ? `${negative ? '+' : ''}${h}:${pad(m)}:${pad(s)}`
    : `${negative ? '+' : ''}${pad(m)}:${pad(s)}`;
}

function formatReadable(totalSec: number): string {
  const abs = Math.abs(totalSec);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const label = h > 0 ? `${h}h ${m}m` : `${m || 1} min`;
  return totalSec < 0 ? `${label} de atraso` : `${label} restantes`;
}

export default FloatingTimerWidget;
