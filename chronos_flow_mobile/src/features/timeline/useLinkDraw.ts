import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { NodeDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import type { FlatRow } from './useVisibleNodes';
import { canLink, resolveLink, type LinkSide } from './linkDraw';

/**
 * Tecla que revela os pontos de ligacao. Alt e a modificadora de "desenhar
 * conexao" em ferramentas de diagrama, nao colide com o Shift (que ja
 * redimensiona sem levar as filhas) e nao dispara atalho do navegador.
 */
const LINK_KEY = 'Alt';

interface Arrasto {
  fromId: string;
  side: LinkSide;
  /** Cursor em coordenadas do canvas, nao da janela. */
  x: number;
  y: number;
  overId: string | null;
}

export function useLinkDraw(rows: FlatRow[]) {
  const queryClient = useQueryClient();
  const [armed, setArmed] = useState(false);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const arrastoRef = useRef<Arrasto | null>(null);
  arrastoRef.current = arrasto;

  // A tecla arma o modo; soltar no meio do gesto nao cancela o que ja comecou,
  // senao a ligacao morreria quando o dedo escorrega do Alt.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === LINK_KEY) setArmed(true);
      if (e.key === 'Escape') setArrasto(null);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === LINK_KEY && !arrastoRef.current) setArmed(false);
    };
    const blur = () => {
      setArmed(false);
      setArrasto(null);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const criar = useMutation({
    mutationFn: ({ blocker_id, blocked_id }: { blocker_id: string; blocked_id: string }) =>
      api.createDependency(blocker_id, blocked_id),
    onSuccess: () => {
      toast.success('Dependencia criada.');
      queryClient.invalidateQueries({ queryKey: ['tree'] });
      queryClient.invalidateQueries({ queryKey: ['node'] });
      queryClient.invalidateQueries({ queryKey: ['focus'] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const nodeById = useCallback(
    (id: string | null) => (id ? (rows.find((r) => r.node.id === id)?.node ?? null) : null),
    [rows],
  );

  const start = useCallback((node: NodeDTO, side: LinkSide, x: number, y: number) => {
    setArrasto({ fromId: node.id, side, x, y, overId: null });
  }, []);

  const move = useCallback((x: number, y: number, overId: string | null) => {
    setArrasto((a) => (a ? { ...a, x, y, overId } : a));
  }, []);

  const finish = useCallback(() => {
    const a = arrastoRef.current;
    setArrasto(null);
    setArmed(false);
    if (!a || !a.overId) return;

    const from = nodeById(a.fromId);
    const to = nodeById(a.overId);
    if (!from) return;

    const check = canLink(from, to);
    if (!check.ok) {
      if (check.reason) toast.error(check.reason);
      return;
    }
    criar.mutate(resolveLink(a.fromId, a.side, a.overId));
  }, [nodeById, criar]);

  /** Alvo valido sob o cursor: usado para pintar a barra de verde ou vermelho. */
  const alvoValido = (() => {
    if (!arrasto?.overId) return null;
    const from = nodeById(arrasto.fromId);
    if (!from) return null;
    return canLink(from, nodeById(arrasto.overId)).ok;
  })();

  return {
    armed: armed || arrasto !== null,
    arrasto,
    alvoValido,
    isPending: criar.isPending,
    start,
    move,
    finish,
    cancel: () => {
      setArrasto(null);
      setArmed(false);
    },
  };
}
