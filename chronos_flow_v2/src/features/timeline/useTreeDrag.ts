import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { NodeDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { SNAP_MINUTES, useTimelineStore } from '@/stores/timelineStore';
import type { FlatRow } from './useVisibleNodes';
import type { TimeScale } from './useTimeScale';
import {
  canDrop,
  dropWhereFor,
  resolveMove,
  HOVER_TO_EXPAND_MS,
  type DropTarget,
} from './treeDrag';

/**
 * Arrasta duas coisas diferentes com o mesmo gesto: um no que ja existe (que
 * muda de lugar) e um modelo da paleta (que vira tarefa nova). As zonas da
 * linha e o alvo sao os mesmos nos dois casos; so muda o que acontece ao
 * soltar — e, no canvas, a coluna vira data de inicio.
 */
export function useTreeDrag(rows: FlatRow[]) {
  const queryClient = useQueryClient();
  const setExpanded = useTimelineStore((s) => s.setExpanded);
  const select = useTimelineStore((s) => s.select);
  const templateId = useTimelineStore((s) => s.draggingTemplateId);
  const setDraggingTemplate = useTimelineStore((s) => s.setDraggingTemplate);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  /**
   * Preenchida so quando o cursor esta sobre o canvas: a coluna vira data.
   * `allDay` sai do zoom no momento do sobrevoo — so o de horas carrega
   * horario de verdade; nos outros a barra ocupa o dia inteiro.
   */
  const [drop, setDrop] = useState<{ date: Date; allDay: boolean } | null>(null);
  const hoverTimer = useRef<{ id: string; timer: number } | null>(null);
  const scrollTimer = useRef<number | null>(null);

  const dragged = draggingId ? (rows.find((r) => r.node.id === draggingId)?.node ?? null) : null;
  const active = Boolean(dragged || templateId);

  const clearHover = useCallback(() => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current.timer);
      hoverTimer.current = null;
    }
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (scrollTimer.current) {
      window.clearInterval(scrollTimer.current);
      scrollTimer.current = null;
    }
  }, []);

  /**
   * Rola a lista quando o cursor encosta nas bordas. Sem isso, arrastar para
   * fora da area visivel e impossivel: largar o botao para rolar cancela o
   * arraste. Um intervalo, e nao o proprio evento, porque o dragover para de
   * disparar quando o cursor fica parado na borda.
   */
  const autoScroll = useCallback(
    (container: HTMLElement | null, clientY: number) => {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const step = clientY - rect.top < 48 ? -14 : rect.bottom - clientY < 48 ? 14 : 0;

      if (step === 0) return stopAutoScroll();
      if (scrollTimer.current) return;
      scrollTimer.current = window.setInterval(() => {
        container.scrollTop += step;
      }, 16);
    },
    [stopAutoScroll],
  );

  const reset = useCallback(() => {
    stopAutoScroll();
    clearHover();
    setDraggingId(null);
    setTarget(null);
    setDrop(null);
    setDraggingTemplate(null);
  }, [clearHover, stopAutoScroll, setDraggingTemplate]);

  const invalidate = (nodeId?: string) => {
    queryClient.invalidateQueries({ queryKey: ['tree'] });
    queryClient.invalidateQueries({ queryKey: ['spaces'] });
    queryClient.invalidateQueries({ queryKey: ['focus'] });
    if (nodeId) queryClient.invalidateQueries({ queryKey: ['node', nodeId] });
  };

  const move = useMutation({
    mutationFn: (input: { id: string; parent_id: string | null; position?: number }) =>
      api.moveNode(input.id, input.parent_id, input.position),
    onSuccess: (node) => {
      invalidate(node.id);
      toast.success(`"${node.title}" movida.`);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const instantiate = useMutation({
    mutationFn: (input: {
      id: string;
      parent_id: string | null;
      position?: number;
      start_date?: string;
      all_day?: boolean;
    }) => {
      const { id, ...body } = input;
      return api.instantiateTemplate(id, body);
    },
    onSuccess: (res) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      select(res.node.id);
      toast.success(`"${res.node.title}" criada a partir do modelo.`);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const onDragStart = useCallback((node: NodeDTO, event: React.DragEvent) => {
    setDraggingId(node.id);
    event.dataTransfer.effectAllowed = 'move';
    // Sem um payload o Firefox nem inicia o arraste.
    event.dataTransfer.setData('text/plain', node.id);
  }, []);

  /** Zona da linha + abertura automatica do no fechado sob o cursor. */
  const aimAtRow = useCallback(
    (row: FlatRow, event: React.DragEvent<HTMLElement>, rect: DOMRect) => {
      const where = dropWhereFor(event, rect);

      if (!canDrop(dragged, row.node, where)) {
        event.dataTransfer.dropEffect = 'none';
        setTarget(null);
        clearHover();
        return false;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = dragged ? 'move' : 'copy';
      setTarget({ id: row.node.id, where });

      if (where === 'inside' && row.hasChildren && !row.isExpanded) {
        if (hoverTimer.current?.id !== row.node.id) {
          clearHover();
          hoverTimer.current = {
            id: row.node.id,
            timer: window.setTimeout(() => setExpanded(row.node.id, true), HOVER_TO_EXPAND_MS),
          };
        }
      } else {
        clearHover();
      }
      return true;
    },
    [dragged, clearHover, setExpanded],
  );

  const onDragOverRow = useCallback(
    (row: FlatRow, event: React.DragEvent<HTMLElement>) => {
      if (!active) return;
      setDrop(null);
      aimAtRow(row, event, event.currentTarget.getBoundingClientRect());
    },
    [active, aimAtRow],
  );

  /**
   * No canvas a linha continua dizendo o pai, e a coluna passa a dizer quando
   * a tarefa comeca — encaixada no passo do zoom, o mesmo do arraste de barra.
   */
  const onDragOverCanvas = useCallback(
    (row: FlatRow, event: React.DragEvent<HTMLElement>, scale: TimeScale, offsetX: number) => {
      if (!active) return;
      if (!aimAtRow(row, event, event.currentTarget.getBoundingClientRect())) return;
      setDrop({
        date: scale.dateAt(offsetX, SNAP_MINUTES[scale.zoom]),
        allDay: scale.zoom !== 'hours',
      });
    },
    [active, aimAtRow],
  );

  const onDragOverRoot = useCallback(
    (event: React.DragEvent) => {
      if (!active || !canDrop(dragged, null, 'inside')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = dragged ? 'move' : 'copy';
      clearHover();
      setDrop(null);
      setTarget({ id: null, where: 'inside' });
    },
    [active, dragged, clearHover],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (target) {
        const resolved = resolveMove(target, dragged, rows);
        if (resolved) {
          if (dragged) {
            move.mutate({ id: dragged.id, ...resolved });
          } else if (templateId) {
            instantiate.mutate({
              id: templateId,
              ...resolved,
              ...(drop
                ? { start_date: drop.date.toISOString(), all_day: drop.allDay }
                : {}),
            });
          }
        }
      }
      reset();
    },
    [target, dragged, templateId, drop, rows, move, instantiate, reset],
  );

  return {
    draggingId,
    templateId,
    active,
    target,
    drop,
    isMoving: move.isPending || instantiate.isPending,
    onDragStart,
    autoScroll,
    onDragOverRow,
    onDragOverCanvas,
    onDragOverRoot,
    onDrop,
    onDragEnd: reset,
  };
}
