import { useEffect } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Pause, Play, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { sistema } from '@/native/chronos';
import { useSessaoDeFoco, emSegundos } from './sessaoDeFoco';

/**
 * O que a Ilha Dinamica mostra, dentro do app.
 *
 * E a contraparte da Live Activity: a ilha serve quem esta fora do Chronos, e
 * esta barra serve quem esta dentro dele, navegando por outras telas. As duas
 * leem a mesma sessao, entao nao ha dois cronometros que possam discordar.
 */
export function BarraDeFoco({ onAbrir }: { onAbrir: (nodeId: string) => void }) {
  const { retrato, restante, pausar, retomar, encerrar, tique } = useSessaoDeFoco();
  const qc = useQueryClient();

  // Um tique por segundo enquanto a barra existe. Fora da tela o iOS congela
  // este relogio, e e por isso que o restante e sempre recalculado do instante
  // guardado, nunca decrementado.
  useEffect(() => {
    if (!retrato || retrato.correndoDesde == null) return;
    const id = window.setInterval(tique, 1000);
    return () => window.clearInterval(id);
  }, [retrato, tique]);

  const concluir = useMutation({
    mutationFn: () => api.completeNode(retrato!.nodeId),
    onSuccess: () => {
      void sistema.vibrar('sucesso');
      encerrar();
      void qc.invalidateQueries();
      toast.success('Tarefa concluida.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!retrato) return null;

  const estourou = restante <= 0;
  const correndo = retrato.correndoDesde != null;
  const progresso = Math.min(
    100,
    Math.max(0, ((retrato.totalSeconds - restante) / retrato.totalSeconds) * 100),
  );

  return (
    <div className="relative shrink-0 border-t bg-card">
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-0.5 transition-[width]',
          estourou ? 'bg-[hsl(var(--status-critical))]' : 'bg-primary',
        )}
        style={{ width: `${progresso}%` }}
      />

      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => onAbrir(retrato.nodeId)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-medium">{retrato.titulo}</p>
          {retrato.trilha && (
            <p className="truncate text-[11px] text-muted-foreground">{retrato.trilha}</p>
          )}
        </button>

        <span
          className={cn(
            'font-mono text-lg font-semibold tabular-nums',
            estourou && 'text-[hsl(var(--status-critical))]',
          )}
        >
          {emSegundos(restante)}
        </span>

        <button
          type="button"
          onClick={() => {
            void sistema.vibrar('leve');
            correndo ? pausar() : retomar();
          }}
          aria-label={correndo ? 'Pausar o foco' : 'Retomar o foco'}
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
        >
          {correndo ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>

        <button
          type="button"
          onClick={() => concluir.mutate()}
          disabled={concluir.isPending}
          aria-label="Concluir a tarefa"
          className="flex h-11 w-11 items-center justify-center rounded-full text-[hsl(var(--status-good))] active:bg-accent disabled:opacity-50"
        >
          <Check className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={encerrar}
          aria-label="Encerrar o foco"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
