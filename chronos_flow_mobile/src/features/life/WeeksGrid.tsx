import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Uma celula por semana, agrupada por decada. */
export function WeeksGrid() {
  const { data } = useQuery({ queryKey: ['life'], queryFn: api.life });
  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Horizonte de vida</CardTitle>
        <CardDescription>
          {data.weeksLived.toLocaleString('pt-BR')} semanas vividas ·{' '}
          {data.weeksRemaining.toLocaleString('pt-BR')} restantes de{' '}
          {data.totalWeeks.toLocaleString('pt-BR')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.decades.map((decade) => (
          <div key={decade.decadeNumber}>
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {decade.startAge} a {decade.endAge} anos
              </span>
              <span className="font-mono">
                {decade.weeksLived}/{decade.totalWeeks}
              </span>
            </div>
            <div className="flex flex-wrap gap-[2px]">
              {Array.from({ length: decade.totalWeeks }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-[7px] w-[7px] rounded-[1px]',
                    i < decade.weeksLived ? 'bg-foreground/70' : 'bg-secondary',
                  )}
                />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
