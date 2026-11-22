import { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Timer, PictureInPicture2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const BLOCK_SECONDS = 25 * 60;

export function DeepWorkTimer({
  targetTitle,
  onOpenWidget,
}: {
  targetTitle: string | null;
  onOpenWidget?: () => void;
}) {
  const [remaining, setRemaining] = useState(BLOCK_SECONDS);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [running]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Timer className="h-4 w-4" />
          Timer de foco deep-work
        </CardTitle>
        <Badge variant="secondary">Bloco de 25min</Badge>
      </CardHeader>
      <CardContent className="text-center">
        <div className="font-mono text-4xl font-semibold tabular-nums">
          {mm}:{ss}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {targetTitle ? `Alvo: ${targetTitle}` : 'Selecione uma tarefa da fila'}
        </p>
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={() => setRunning((r) => !r)}>
            {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {running ? 'Pausar' : 'Iniciar foco'}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setRunning(false);
              setRemaining(BLOCK_SECONDS);
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Resetar
          </Button>
        </div>
        {onOpenWidget && (
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={onOpenWidget}>
            <PictureInPicture2 className="h-4 w-4" />
            Destacar em janela flutuante
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
