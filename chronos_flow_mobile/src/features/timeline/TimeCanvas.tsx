import { useCallback, useEffect, useRef, useState } from 'react';
import { sistema } from '@/native/chronos';
import type { Ajuste, ModoAjuste } from './ajuste';
import type { NodeDTO } from '@shared/types';
import { cn } from '@/lib/utils';
import { formatDateTime, formatOffset, progressTone, TONE_BG } from '@/lib/format';
import { ROW_HEIGHT, SNAP_MINUTES, useTimelineStore } from '@/stores/timelineStore';
import type { TimeScale } from './useTimeScale';
import type { FlatRow } from './useVisibleNodes';
import { DependencyLayer } from './DependencyLayer';
import { useLinkDraw } from './useLinkDraw';
import { useMover } from './moverPorToque';
import { anchorAt, linkPath, type LinkSide } from './linkDraw';

interface Props {
  rows: FlatRow[];
  scale: TimeScale;
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: (top: number) => void;
  /** Um modelo escolhido na paleta entra aqui: a linha diz o pai, a coluna diz a hora. */
  onSoltarModelo: (parent: FlatRow, startISO: string) => void;
  /**
   * Ajuste em andamento pela barra de botoes. Entra aqui para a barra na tela
   * andar junto com os toques, antes de o banco responder — a mesma previa que
   * o arraste desenha, pelo mesmo caminho.
   */
  previa: Ajuste | null;
  /** Passo do encaixe: o mesmo que as setas da barra de ajuste usam. */
  passo: number;
  /** Levar as filhas junto: o mesmo botao da barra de ajuste. */
  cascata: boolean;
  /** Dedo andando sobre a barra: so redesenha. */
  onArrastar: (modo: ModoAjuste, minutos: number, cascata: boolean) => void;
  /** Dedo solto: grava o que a previa ja mostrava. */
  onSoltar: (modo: ModoAjuste, minutos: number, cascata: boolean) => void;
  onReschedule: (
    id: string,
    startISO: string | null,
    dueISO: string | null,
    cascadeChildren?: boolean,
  ) => void;
}

type DragState = {
  id: string;
  mode: 'move' | 'resize-start' | 'resize-end';
  originX: number;
  /** Deslocamento ja encaixado no passo do zoom: dias nos longos, 15 min no de horas. */
  deltaMinutes: number;
  /**
   * Shift no arraste: muda so a janela desta tarefa e deixa as filhas onde
   * estao. O piso e o fim da ultima filha — a janela do pai nao pode cortar
   * o trabalho que esta dentro dela.
   */
  detach: boolean;
  /** Instante limite do encolhimento, quando ha filhas carregadas. */
  limit: Date | null;
} | null;

const MIN_BAR_WIDTH = 6;

export function TimeCanvas({
  rows,
  scale,
  scrollRef,
  onScroll,
  onSoltarModelo,
  onReschedule,
  previa,
  passo,
  cascata,
  onArrastar,
  onSoltar,
}: Props) {
  const { marcadoId, marcar, showDependencies } = useTimelineStore();
  const modelo = useMover((m) => m.modelo);
  const [drag, setDrag] = useState<DragState>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const link = useLinkDraw(rows);

  /** Cursor em coordenadas do canvas: o fio e desenhado no mesmo sistema. */
  const pontoNoCanvas = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
  }, []);

  /** Menor janela que ainda cobre as filhas carregadas desta tarefa. */
  const limiteDasFilhas = useCallback(
    (nodeId: string, mode: 'resize-start' | 'resize-end'): Date | null => {
      const filhas = rows.filter((r) => r.node.parent_id === nodeId).map((r) => r.node);
      const pontas = filhas
        .map((f) => (mode === 'resize-end' ? f.due_date ?? f.start_date : f.start_date ?? f.due_date))
        .filter(Boolean)
        .map((iso) => new Date(iso as string).getTime());
      if (pontas.length === 0) return null;
      return new Date(mode === 'resize-end' ? Math.max(...pontas) : Math.min(...pontas));
    },
    [rows],
  );

  const startDrag = useCallback(
    (e: React.PointerEvent, node: NodeDTO, mode: 'move' | 'resize-start' | 'resize-end') => {
      // No dedo quem manda e o arraste nativo, mais abaixo. Deixar os dois
      // caminhos vivos ao mesmo tempo aplicaria o deslocamento duas vezes.
      if (e.pointerType === 'touch') return;
      e.stopPropagation();
      e.preventDefault();
      // `currentTarget`, nao `target`: o toque pode cair num <span> do rotulo,
      // que desaparece no proximo render e leva a captura do ponteiro junto.
      e.currentTarget.setPointerCapture(e.pointerId);
      const detach = e.shiftKey && mode !== 'move' && !node.isLeaf;
      setDrag({
        id: node.id,
        mode,
        originX: e.clientX,
        deltaMinutes: 0,
        detach,
        limit: detach ? limiteDasFilhas(node.id, mode) : null,
      });
    },
    [limiteDasFilhas],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const snap = SNAP_MINUTES[scale.zoom];
      const rawMinutes = (e.clientX - drag.originX) / scale.pxPerMinute;
      let deltaMinutes = Math.round(rawMinutes / snap) * snap;

      // Trava o proprio arraste no limite, em vez de deixar passar e voltar
      // sozinho depois da resposta: a barra tem de parar onde para.
      if (drag.detach && drag.limit) {
        const node = rows.find((r) => r.node.id === drag.id)?.node;
        const borda = drag.mode === 'resize-end' ? node?.due_date : node?.start_date;
        if (borda) {
          const folga = Math.round((drag.limit.getTime() - new Date(borda).getTime()) / 60_000);
          deltaMinutes =
            drag.mode === 'resize-end'
              ? Math.max(deltaMinutes, folga)
              : Math.min(deltaMinutes, folga);
        }
      }

      if (deltaMinutes !== drag.deltaMinutes) setDrag({ ...drag, deltaMinutes });
    },
    [drag, rows, scale.pxPerMinute, scale.zoom],
  );

  /**
   * Soltar o dedo depois de arrastar dispara um `click` na barra, e o clique
   * abre o detalhe por cima da timeline. Depois de mover uma barra, ver o
   * painel de detalhe cobrindo a tela e o oposto do que se quer.
   */
  const arrastou = useRef(false);

  const endDrag = useCallback(() => {
    if (!drag) return;
    if (drag.deltaMinutes !== 0) arrastou.current = true;
    const row = rows.find((r) => r.node.id === drag.id);
    if (row && drag.deltaMinutes !== 0) {
      const { node } = row;
      const shift = (iso: string | null, minutes: number) =>
        iso ? new Date(new Date(iso).getTime() + minutes * 60_000).toISOString() : null;

      const cascade = !drag.detach;
      if (drag.mode === 'move') {
        onReschedule(
          node.id,
          shift(node.start_date, drag.deltaMinutes),
          shift(node.due_date, drag.deltaMinutes),
          cascade,
        );
      } else if (drag.mode === 'resize-start') {
        onReschedule(node.id, shift(node.start_date, drag.deltaMinutes), node.due_date, cascade);
      } else {
        onReschedule(node.id, node.start_date, shift(node.due_date, drag.deltaMinutes), cascade);
      }
    }
    setDrag(null);
  }, [drag, rows, onReschedule]);

  /*
    Arraste por dedo, com ouvintes nativos.

    O caminho de eventos de ponteiro do React nunca chegou ao fim no iPhone: o
    WebKit entendia o gesto como rolagem e mandava `pointercancel` antes do
    segundo movimento. O motivo provavel e que o React registra `touchstart` e
    `touchmove` como ouvintes PASSIVOS na raiz, e num ouvinte passivo o
    `preventDefault()` e simplesmente ignorado — e `preventDefault` no primeiro
    `touchmove` e o unico jeito garantido de dizer ao WebKit que aquele gesto
    nao e rolagem. `touch-action: none` no CSS deveria bastar e, nesse
    aparelho, nao bastou.

    Daí ouvintes proprios, com `{ passive: false }`, presos uma vez so ao
    container que rola. Um unico conjunto para a timeline inteira: quem foi
    tocado se descobre no `touchstart`, pelo `data-pega` mais proximo. Assim os
    ouvintes nao sao refeitos a cada redesenho — e durante um arraste ha um
    redesenho por movimento.

    So a barra MARCADA arrasta. Nas outras, o dedo continua rolando a timeline
    como sempre: sem isso, encostar numa barra qualquer prenderia a rolagem.
  */
  const vivo = useRef({ marcadoId, pxPorMinuto: scale.pxPerMinute, passo, cascata, onArrastar, onSoltar });
  vivo.current = { marcadoId, pxPorMinuto: scale.pxPerMinute, passo, cascata, onArrastar, onSoltar };

  const dedo = useRef<{ modo: ModoAjuste; x0: number; minutos: number; moveu: boolean } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;

    const comecar = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const alvo = (e.target as Element | null)?.closest?.('[data-pega]') as HTMLElement | null;
      if (!alvo) return;
      const dono = alvo.closest('[data-node-id]')?.getAttribute('data-node-id');
      if (!dono || dono !== vivo.current.marcadoId) return;
      dedo.current = {
        modo: (alvo.dataset.pega as ModoAjuste) ?? 'move',
        x0: e.touches[0].clientX,
        minutos: 0,
        moveu: false,
      };
    };

    const mover = (e: TouchEvent) => {
      const d = dedo.current;
      if (!d) return;
      // Antes de qualquer conta, e em todo movimento: e esta linha que impede
      // o WebKit de assumir o gesto como rolagem e cancelar o toque no meio.
      e.preventDefault();

      const { pxPorMinuto, passo: p, cascata: c, onArrastar: desenhar } = vivo.current;
      const dx = e.touches[0].clientX - d.x0;
      if (!d.moveu) {
        if (Math.abs(dx) < 4) return;
        d.moveu = true;
        void sistema.vibrar('leve');
      }

      const minutos = Math.round(dx / pxPorMinuto / p) * p;
      if (minutos === d.minutos) return;
      d.minutos = minutos;
      desenhar(d.modo, minutos, c);
    };

    const largar = () => {
      const d = dedo.current;
      dedo.current = null;
      if (!d || !d.moveu) return;
      // Soltar o dedo dispara um `click` na barra, e o clique desmarcaria
      // justamente a tarefa que se acabou de mover.
      arrastou.current = true;
      vivo.current.onSoltar(d.modo, d.minutos, vivo.current.cascata);
    };

    el.addEventListener('touchstart', comecar, { passive: false });
    el.addEventListener('touchmove', mover, { passive: false });
    el.addEventListener('touchend', largar);
    el.addEventListener('touchcancel', largar);
    return () => {
      el.removeEventListener('touchstart', comecar);
      el.removeEventListener('touchmove', mover);
      el.removeEventListener('touchend', largar);
      el.removeEventListener('touchcancel', largar);
    };
  }, [scrollRef]);

  const gridSize =
    scale.ticks.length > 1 ? Math.max(1, scale.ticks[1].x - scale.ticks[0].x) : 40;

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => onScroll(e.currentTarget.scrollTop)}
      className="relative flex-1 overflow-auto"
      onPointerMove={(e) => {
        onPointerMove(e);
        if (link.arrasto) {
          const alvo = (e.target as HTMLElement).closest('[data-node-id]');
          const { x, y } = pontoNoCanvas(e);
          link.move(x, y, alvo?.getAttribute('data-node-id') ?? null);
        }
      }}
      onPointerUp={() => {
        endDrag();
        if (link.arrasto) link.finish();
      }}
      onPointerCancel={() => {
        // O WebKit do iPhone cai aqui assim que decide que o toque e rolagem,
        // o que no aparelho acontece antes do primeiro movimento util. E por
        // isso que o ajuste de verdade mora nos botoes da barra, e nao aqui.
        endDrag();
        link.cancel();
      }}
    >
      <div
        ref={containerRef}
        className="timeline-grid relative"
        style={{
          width: scale.width,
          height: Math.max(rows.length * ROW_HEIGHT, 200),
          backgroundSize: `${gridSize}px 100%`,
        }}
      >
        {/* Zoom de horas: faixa alternada por dia, senao a grade vira um borrao */}
        {scale.zoom === 'hours' &&
          scale.bands.map((band, i) =>
            i % 2 === 1 ? (
              <div
                key={band.key}
                className="pointer-events-none absolute top-0 h-full bg-secondary/25"
                style={{ left: band.x, width: band.width }}
              />
            ) : null,
          )}

        {/* Linha de hoje */}
        {scale.todayX >= 0 && scale.todayX <= scale.width && (
          <div
            className="pointer-events-none absolute top-0 z-20 h-full border-l border-dashed border-[hsl(var(--status-good))]"
            style={{ left: scale.todayX }}
          >
            <span className="absolute -top-0 left-1 rounded bg-[hsl(var(--status-good))] px-1 text-[9px] font-medium text-white">
              hoje
            </span>
          </div>
        )}

        {showDependencies && (
          <DependencyLayer rows={rows} scale={scale} height={rows.length * ROW_HEIGHT} />
        )}

        {/*
          Faixas de insercao, uma por linha. So existem com um modelo na mao:
          fora disso cobririam as barras e roubariam o toque. A linha diz o pai
          e a coluna diz a hora de inicio — as mesmas duas informacoes que o
          arraste carregava no desktop.
        */}
        {modelo &&
          rows.map((row, i) => (
            <div
              key={`soltar-${row.node.id}`}
              role="button"
              tabIndex={-1}
              aria-label={`Inserir ${modelo.title} em ${row.node.title}`}
              onClick={(e) => {
                const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                onSoltarModelo(row, scale.dateAt(x).toISOString());
              }}
              className="absolute left-0 z-30 border-b border-dashed border-primary/30 bg-primary/5 active:bg-primary/20"
              style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT, width: scale.width }}
            />
          ))}

        {/*
          Fio em construcao. Fica acima de tudo e sem pointer-events para nao
          roubar o cursor do alvo justamente na hora de soltar.
        */}
        {link.arrasto && (() => {
          const origemRow = rows.findIndex((r) => r.node.id === link.arrasto!.fromId);
          if (origemRow < 0) return null;
          const origem = rows[origemRow].node;
          const left = Math.max(0, scale.xOf(origem.start_date ?? origem.due_date));
          const right = scale.xOf(origem.due_date ?? origem.start_date);
          const de = anchorAt(left, Math.max(MIN_BAR_WIDTH, right - left), origemRow, ROW_HEIGHT, link.arrasto!.side);
          const para = { x: link.arrasto!.x, y: link.arrasto!.y };
          const cor =
            link.alvoValido === null
              ? 'hsl(var(--primary))'
              : link.alvoValido
                ? 'hsl(var(--status-good))'
                : 'hsl(var(--status-critical))';

          return (
            <svg
              className="pointer-events-none absolute left-0 top-0 z-40"
              width={scale.width}
              height={Math.max(rows.length * ROW_HEIGHT, 200)}
              aria-hidden
            >
              <path
                d={linkPath(de, para, link.arrasto!.side)}
                fill="none"
                stroke={cor}
                strokeWidth={2}
                strokeDasharray="5 3"
              />
              <circle cx={de.x} cy={de.y} r={4} fill={cor} />
              <circle cx={para.x} cy={para.y} r={3} fill={cor} />
            </svg>
          );
        })()}

        {/*
          Piso do encolhimento quando se arrasta com Shift: a ponta da ultima
          filha. Mostrar a parede e o que diferencia "travou" de "quebrou".
        */}
        {drag?.detach && drag.limit && (
          <div
            className="pointer-events-none absolute top-0 z-30 h-full border-l-2 border-dashed border-[hsl(var(--status-warning))]"
            style={{ left: scale.xOf(drag.limit) }}
          >
            <span className="absolute top-0 ml-1 whitespace-nowrap rounded bg-[hsl(var(--status-warning))] px-1.5 py-0.5 text-[10px] font-medium text-black">
              limite das filhas
            </span>
          </div>
        )}


        {rows.map((row, i) => {
          const { node } = row;
          const anchor = node.start_date ?? node.due_date;
          if (!anchor) return null;

          const dragging = drag?.id === node.id ? drag : null;

          /*
            Arraste e botao desenham a mesma previa. O arraste so existe hoje no
            navegador, onde o layout e ajustado; no aparelho o deslocamento vem
            sempre da barra de botoes.
          */
          const mexendo: { modo: ModoAjuste; minutos: number; semFilhas: boolean } | null =
            dragging
              ? { modo: dragging.mode, minutos: dragging.deltaMinutes, semFilhas: dragging.detach }
              : previa?.id === node.id
                ? { modo: previa.modo, minutos: previa.minutos, semFilhas: !previa.cascata }
                : null;

          const shiftPx = (mexendo?.minutos ?? 0) * scale.pxPerMinute;

          let left = scale.xOf(node.start_date ?? node.due_date);
          let right = scale.xOf(node.due_date ?? node.start_date);
          if (right < left) [left, right] = [right, left];

          if (mexendo?.modo === 'move') {
            left += shiftPx;
            right += shiftPx;
          } else if (mexendo?.modo === 'resize-start') {
            left += shiftPx;
          } else if (mexendo?.modo === 'resize-end') {
            right += shiftPx;
          }

          // A barra pode comecar antes do viewport. Recorta a esquerda em vez de
          // deixar o titulo sair pela borda do canvas.
          const clippedLeft = Math.max(0, left);
          const startsBeforeView = left < 0;
          const width = Math.max(MIN_BAR_WIDTH, right - clippedLeft);
          const tone = progressTone(node.progress);
          const isSelected = marcadoId === node.id;
          const isRoot = node.depth === 0;

          return (
            <div
              key={node.id}
              className="absolute"
              style={{
                top: i * ROW_HEIGHT + 8,
                left: clippedLeft,
                width,
                height: ROW_HEIGHT - 16,
              }}
            >
              <div
                role="button"
                tabIndex={0}
                data-node-id={node.id}
                data-pega="move"
                onPointerDown={(e) => startDrag(e, node, 'move')}
                /*
                  Um toque marca; nada mais. O painel de detalhe cobria a tela
                  inteira a cada toque numa barra, e nao havia como escolher uma
                  tarefa sem perder a timeline de vista — justamente o que se
                  precisa ver enquanto se ajusta a data dela.
                */
                onClick={() => {
                  if (arrastou.current) {
                    arrastou.current = false;
                    return;
                  }
                  marcar(marcadoId === node.id ? null : node.id);
                }}
                onKeyDown={(e) => e.key === 'Enter' && marcar(node.id)}
                className={cn(
                  'group relative h-full cursor-grab overflow-hidden rounded-md border transition-shadow active:cursor-grabbing',
                  isRoot ? 'bg-secondary' : 'bg-card',
                  isSelected ? 'border-primary shadow-sm ring-2 ring-primary/70' : 'border-border',
                  startsBeforeView && 'rounded-l-none border-l-0',
                  node.status === 'BLOCKED' && 'border-[hsl(var(--status-critical))]',
                  dragging && 'z-30 opacity-90 shadow-lg ring-2 ring-primary',
                  link.arrasto?.overId === node.id &&
                    link.arrasto.fromId !== node.id &&
                    (link.alvoValido
                      ? 'ring-2 ring-[hsl(var(--status-good))]'
                      : 'ring-2 ring-[hsl(var(--status-critical))]'),
                )}
                title={
                  `${node.title} — ${formatDateTime(node.start_date, node.all_day)} ate ${formatDateTime(node.due_date, node.all_day)}` +
                  (node.isLeaf ? '' : '\nShift + arrastar a borda muda so esta tarefa')
                }
              >
                <div
                  className={cn('absolute inset-y-0 left-0 opacity-25', TONE_BG[tone])}
                  style={{ width: `${node.progress}%` }}
                />
                {width > 56 && (
                  <span className="pointer-events-none relative z-10 flex h-full items-center gap-1.5 px-2 text-[11px]">
                    <span className="truncate font-medium">{node.title}</span>
                    {width > 140 && (
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                        {Math.round(node.progress)}%
                      </span>
                    )}
                  </span>
                )}

                {/*
                  z-20 e proposital: o rotulo da barra usa z-10 e, sem isso,
                  cobria as alcas — a borda direita virava inalcancavel em
                  qualquer barra larga o bastante para mostrar o nome.
                */}
                <div
                  data-pega="resize-start"
                  onPointerDown={(e) => startDrag(e, node, 'resize-start')}
                  aria-label={`Ajustar o inicio de ${node.title}`}
                  className={cn(
                    'absolute inset-y-0 left-0 z-20 cursor-ew-resize transition-opacity',
                    // Alcas mais largas na barra marcada: e nela que o dedo
                    // vai mirar, e 16px de alvo num polegar e pouco.
                    isSelected
                      ? 'w-6 bg-primary/50 opacity-100'
                      : 'w-4 opacity-0 group-hover:opacity-100 group-hover:bg-primary/40',
                  )}
                />
                <div
                  data-pega="resize-end"
                  onPointerDown={(e) => startDrag(e, node, 'resize-end')}
                  aria-label={`Ajustar o fim de ${node.title}`}
                  className={cn(
                    'absolute inset-y-0 right-0 z-20 cursor-ew-resize transition-opacity',
                    isSelected
                      ? 'w-6 bg-primary/50 opacity-100'
                      : 'w-4 opacity-0 group-hover:opacity-100 group-hover:bg-primary/40',
                  )}
                />
              </div>

              {/*
                Pontos de ligacao, irmaos da barra e nao filhos: dentro dela o
                `overflow-hidden` cortava o circulo ao meio e o clique escapava
                para o arraste da propria barra.
              */}
              {link.armed &&
                (['start', 'end'] as LinkSide[]).map((side) => (
                  <span
                    key={side}
                    role="button"
                    aria-label={`${side === 'end' ? 'Bloqueia' : 'Depende de'} — puxar de ${node.title}`}
                    // Irmao da barra, fora do `[data-node-id]`: sem isto o
                    // gesto de ligar dependencia e roubado pela rolagem,
                    // exatamente como acontecia com a faixa de progresso.
                    data-arrasta-dedo
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const { x, y } = pontoNoCanvas(e);
                      link.start(node, side, x, y);
                    }}
                    className={cn(
                      'absolute top-1/2 z-40 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full',
                      'border-2 border-background bg-primary shadow transition-transform hover:scale-125',
                      side === 'start' ? '-left-2' : '-right-2',
                    )}
                  />
                ))}

              {mexendo && mexendo.minutos !== 0 && (
                <span className="absolute -top-5 left-0 z-30 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                  {formatOffset(mexendo.minutos)}
                  {mexendo.semFilhas && ' · sem as filhas'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
