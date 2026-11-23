import { useCallback, useRef, useState } from 'react';
import type { NodeDTO } from '@shared/types';
import { cn } from '@/lib/utils';
import { formatDateTime, formatOffset, progressTone, TONE_BG } from '@/lib/format';
import type { useTreeDrag } from './useTreeDrag';
import { ROW_HEIGHT, SNAP_MINUTES, useTimelineStore } from '@/stores/timelineStore';
import type { TimeScale } from './useTimeScale';
import type { FlatRow } from './useVisibleNodes';
import { DependencyLayer } from './DependencyLayer';
import { useLinkDraw } from './useLinkDraw';
import { anchorAt, linkPath, type LinkSide } from './linkDraw';

interface Props {
  rows: FlatRow[];
  scale: TimeScale;
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: (top: number) => void;
  /** O mesmo gesto da arvore: aqui a coluna tambem vira data. */
  drag: ReturnType<typeof useTreeDrag>;
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
  drag: treeDrag,
  onReschedule,
}: Props) {
  const { selectedId, select, showDependencies } = useTimelineStore();
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

  /**
   * O navegador dispara um clique ao soltar a barra, e o clique abre a gaveta
   * da tarefa por cima da tela. Depois de um arraste de verdade (a barra
   * andou), esse clique e engolido: ajustar datas nao deve abrir nada.
   */
  const arrastou = useRef(false);

  const startDrag = useCallback(
    (e: React.PointerEvent, node: NodeDTO, mode: 'move' | 'resize-start' | 'resize-end') => {
      arrastou.current = false;
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
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

      if (deltaMinutes !== 0) arrastou.current = true;
      if (deltaMinutes !== drag.deltaMinutes) setDrag({ ...drag, deltaMinutes });
    },
    [drag, rows, scale.pxPerMinute, scale.zoom],
  );

  const endDrag = useCallback(() => {
    if (!drag) return;
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
      onPointerUp={(e) => {
        endDrag();
        if (link.arrasto) link.finish();
      }}
      onPointerCancel={() => {
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
          // A grade comeca na primeira marca da regua, e nao no pixel zero: a
          // janela nem sempre abre a meia-noite (o zoom preserva o centro), e
          // sem isso as linhas ficariam deslocadas das etiquetas.
          backgroundPosition: `${scale.ticks.length ? ((scale.ticks[0].x % gridSize) + gridSize) % gridSize : 0}px 0`,
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
          Faixas de soltura, uma por linha. So existem durante o arraste: fora
          dele cobririam as barras e roubariam o clique. A linha diz o pai
          (mesmas tres zonas da arvore) e a coluna diz a data de inicio.
        */}
        {treeDrag.active &&
          rows.map((row, i) => {
            const where = treeDrag.target?.id === row.node.id ? treeDrag.target.where : null;
            return (
              <div
                key={`drop-${row.node.id}`}
                onDragOver={(e) =>
                  treeDrag.onDragOverCanvas(row, e, scale, (e.nativeEvent as DragEvent).offsetX)
                }
                onDrop={treeDrag.onDrop}
                className={cn(
                  'absolute left-0 z-30',
                  where === 'inside' && 'bg-primary/10 ring-1 ring-inset ring-primary',
                )}
                style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT, width: scale.width }}
              >
                {(where === 'before' || where === 'after') && (
                  <span
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute left-0 right-0 h-0.5 bg-primary',
                      where === 'before' ? 'top-0' : 'bottom-0',
                    )}
                  />
                )}
              </div>
            );
          })}

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

        {/* Marcador da data sob o cursor enquanto se arrasta sobre o canvas. */}
        {treeDrag.drop && (
          <div
            className="pointer-events-none absolute top-0 z-40 h-full border-l-2 border-primary"
            style={{ left: scale.xOf(treeDrag.drop.date) }}
          >
            <span className="absolute top-0 ml-1 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
              {formatDateTime(treeDrag.drop.date, treeDrag.drop.allDay)}
            </span>
          </div>
        )}

        {rows.map((row, i) => {
          const { node } = row;
          const anchor = node.start_date ?? node.due_date;
          if (!anchor) return null;

          const dragging = drag?.id === node.id ? drag : null;
          const shiftPx = dragging ? dragging.deltaMinutes * scale.pxPerMinute : 0;

          let left = scale.xOf(node.start_date ?? node.due_date);
          let right = scale.xOf(node.due_date ?? node.start_date);
          if (right < left) [left, right] = [right, left];

          if (dragging?.mode === 'move') {
            left += shiftPx;
            right += shiftPx;
          } else if (dragging?.mode === 'resize-start') {
            left += shiftPx;
          } else if (dragging?.mode === 'resize-end') {
            right += shiftPx;
          }

          // A barra pode comecar antes do viewport. Recorta a esquerda em vez de
          // deixar o titulo sair pela borda do canvas.
          const clippedLeft = Math.max(0, left);
          const startsBeforeView = left < 0;
          const width = Math.max(MIN_BAR_WIDTH, right - clippedLeft);
          const tone = progressTone(node.progress);
          const isSelected = selectedId === node.id;
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
                onPointerDown={(e) => startDrag(e, node, 'move')}
                onClick={() => {
                  if (arrastou.current) {
                    arrastou.current = false;
                    return;
                  }
                  select(node.id);
                }}
                onKeyDown={(e) => e.key === 'Enter' && select(node.id)}
                className={cn(
                  'group relative h-full cursor-grab overflow-hidden rounded-md border transition-shadow active:cursor-grabbing',
                  isRoot ? 'bg-secondary' : 'bg-card',
                  isSelected ? 'border-primary shadow-sm' : 'border-border',
                  startsBeforeView && 'rounded-l-none border-l-0',
                  node.status === 'BLOCKED' && 'border-[hsl(var(--status-critical))]',
                  dragging && 'opacity-80 ring-1 ring-primary',
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
                  onPointerDown={(e) => startDrag(e, node, 'resize-start')}
                  aria-label={`Ajustar o inicio de ${node.title}`}
                  className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 group-hover:bg-primary/40"
                />
                <div
                  onPointerDown={(e) => startDrag(e, node, 'resize-end')}
                  aria-label={`Ajustar o fim de ${node.title}`}
                  className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 group-hover:bg-primary/40"
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

              {dragging && dragging.deltaMinutes !== 0 && (
                <span className="absolute -top-5 left-0 z-30 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                  {formatOffset(dragging.deltaMinutes)}
                  {dragging.detach && ' · sem as filhas'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
