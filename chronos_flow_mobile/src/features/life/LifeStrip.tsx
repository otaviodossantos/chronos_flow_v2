import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

/**
 * Horizonte de vida no topo do Meu Foco: a pergunta "quantas semanas ainda
 * tenho" fica ao lado da pergunta "o que faco agora".
 */
export function LifeStrip({ className }: { className?: string }) {
  const { data } = useQuery({ queryKey: ['life'], queryFn: api.life });
  if (!data) return null;

  const focusPct =
    data.today.focusGoalMinutes > 0
      ? (data.today.focusMinutesDone / data.today.focusGoalMinutes) * 100
      : 0;
  const impactPct =
    data.today.impactGoal > 0 ? (data.today.impactDone / data.today.impactGoal) * 100 : 0;

  return (
    /*
      Tres colunas sempre, nao `sm:grid-cols-3`.

      O ponto de corte `sm` e 640px: num iPhone ele nunca chega, entao os tres
      blocos ficavam empilhados e ocupavam quase 320px — metade da tela do Foco
      — antes da fila de tarefas aparecer. Em tres colunas sao 90px, e as
      legendas encurtam para caber nos 120px de cada uma: "49,1% de 3.913 · 36
      anos" vira "49% vivido", que e o que se le de relance mesmo.
    */
    <Card className={cn(className)}>
      <CardContent className="grid grid-cols-3 gap-2 p-2.5">
        <Coluna
          rotulo="Semanas"
          valor={data.weeksRemaining.toLocaleString('pt-BR')}
          barra={data.percentageLived}
          tom="neutral"
          nota={`${data.percentageLived}% vivido`}
        />
        <Coluna
          rotulo="Foco hoje"
          valor={formatDuration(data.today.focusMinutesDone)}
          barra={focusPct}
          tom={focusPct >= 100 ? 'good' : 'warning'}
          nota={`meta ${formatDuration(data.today.focusGoalMinutes)}`}
        />
        <Coluna
          rotulo="Avanco hoje"
          valor={`${data.today.impactDone}%`}
          barra={impactPct}
          tom={impactPct >= 100 ? 'good' : 'warning'}
          nota={`meta ${data.today.impactGoal}%`}
        />
      </CardContent>
    </Card>
  );
}

function Coluna({
  rotulo,
  valor,
  barra,
  tom,
  nota,
}: {
  rotulo: string;
  valor: string;
  barra: number;
  tom: 'neutral' | 'good' | 'warning';
  nota: string;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </div>
      <div className="truncate font-mono text-lg font-semibold tabular-nums">{valor}</div>
      <Progress value={barra} tone={tom} className="mt-1 h-1" />
      <div className="mt-1 truncate text-[10px] text-muted-foreground">{nota}</div>
    </div>
  );
}
