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
    <Card className={cn(className)}>
      <CardContent className="grid grid-cols-1 gap-5 p-4 sm:grid-cols-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Semanas restantes
          </div>
          <div className="font-mono text-2xl font-semibold tabular-nums">
            {data.weeksRemaining.toLocaleString('pt-BR')}
          </div>
          <div className="mt-1.5">
            <Progress value={data.percentageLived} tone="neutral" />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {data.percentageLived}% de {data.totalWeeks.toLocaleString('pt-BR')} · {data.currentAgeYears} anos
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Foco de hoje
          </div>
          <div className="font-mono text-2xl font-semibold tabular-nums">
            {formatDuration(data.today.focusMinutesDone)}
          </div>
          <div className="mt-1.5">
            <Progress value={focusPct} tone={focusPct >= 100 ? 'good' : 'warning'} />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            meta de {formatDuration(data.today.focusGoalMinutes)} · {data.today.leavesCompleted} tarefa(s)
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Impacto de hoje
          </div>
          <div className="font-mono text-2xl font-semibold tabular-nums">
            {data.today.impactDone}%
          </div>
          <div className="mt-1.5">
            <Progress value={impactPct} tone={impactPct >= 100 ? 'good' : 'warning'} />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            meta de {data.today.impactGoal}% de avanco nas metas macro
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
