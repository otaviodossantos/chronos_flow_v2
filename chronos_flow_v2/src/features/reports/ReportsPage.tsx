import { useQuery } from '@tanstack/react-query';
import { Zap, AlertTriangle, Gauge, Network, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { progressTone, TONE_TEXT } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ProgressChart } from './ProgressChart';

const RISK_LABEL = { good: 'Risco baixo', warning: 'Risco medio', critical: 'Risco alto' } as const;

export function ReportsPage() {
  const { data: velocity } = useQuery({ queryKey: ['velocity'], queryFn: api.velocity });
  const { data: risk } = useQuery({ queryKey: ['risk'], queryFn: api.riskMap });
  const { data: history } = useQuery({
    queryKey: ['history'],
    queryFn: () => api.progressHistory(30),
  });

  const series = history?.series ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] p-6">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Governanca e analise
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Relatorios de impacto e cascata</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Saude dos projetos, propagacao bottom-up e desvios temporais na arvore recursiva.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={<Zap className="h-4 w-4" />}
            label="Progresso medio das metas"
            value={`${velocity?.avgRootProgress ?? 0}%`}
            note="Media do progresso consolidado das metas macro, calculado por cascata."
            tone={progressTone(velocity?.avgRootProgress ?? 0)}
          />
          <MetricCard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Gargalos e bloqueios"
            value={String(velocity?.bottlenecks ?? 0)}
            note="Tarefas travadas por dependencia aberta em algum ponto da arvore."
            tone={(velocity?.bottlenecks ?? 0) > 0 ? 'critical' : 'good'}
          />
          <MetricCard
            icon={<Gauge className="h-4 w-4" />}
            label="Desvio de estimativa"
            value={`${(velocity?.estimateDeviationPercent ?? 0) > 0 ? '+' : ''}${velocity?.estimateDeviationPercent ?? 0}%`}
            note="Diferenca media entre esforco previsto nas folhas e tempo real ate a conclusao."
            tone={Math.abs(velocity?.estimateDeviationPercent ?? 0) > 25 ? 'warning' : 'good'}
          />
          <MetricCard
            icon={<Network className="h-4 w-4" />}
            label="Profundidade media"
            value={`${velocity?.avgDepth ?? 0} niveis`}
            note={`Maximo de ${velocity?.maxDepth ?? 0}. Indice de granularidade da decomposicao.`}
            tone="good"
          />
        </div>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Fluxo de progresso bottom-up no tempo</CardTitle>
            <CardDescription>
              Avanco percentual consolidado nas metas macro, um ponto por dia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProgressChart series={series} />
          </CardContent>
        </Card>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Mapa de risco por ramificacao da arvore</CardTitle>
            <CardDescription>
              Supervisao por meta macro, agregando tarefas filhas recursivas e diagnostico de
              impedimento.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Meta / estrutura</th>
                  <th className="px-4 py-2 font-medium">Progresso consolidado</th>
                  <th className="px-4 py-2 font-medium">Diagnostico</th>
                  <th className="px-4 py-2 font-medium">Topologia</th>
                  <th className="px-4 py-2 font-medium">Ponto focal critico</th>
                </tr>
              </thead>
              <tbody>
                {(risk?.roots ?? []).map((row) => {
                  const tone = progressTone(row.progress);
                  return (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          {row.space && (
                            <span
                              className="h-2 w-2 shrink-0 rounded-sm"
                              style={{ backgroundColor: row.space.color }}
                            />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-medium">{row.title}</div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {row.owner ? `Responsavel: ${row.owner}` : 'Sem responsavel'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={cn('w-11 font-mono text-xs', TONE_TEXT[tone])}>
                            {row.progress.toFixed(1)}%
                          </span>
                          <Progress value={row.progress} tone={tone} className="w-28" />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={row.risk}>{RISK_LABEL[row.risk]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {row.childCount} filhas · {row.levels} niveis
                        {row.blocked > 0 && (
                          <span className="ml-1 text-[hsl(var(--status-critical))]">
                            · {row.blocked} bloqueada(s)
                          </span>
                        )}
                        {row.overdue > 0 && (
                          <span className="ml-1 text-[hsl(var(--status-warning))]">
                            · {row.overdue} atrasada(s)
                          </span>
                        )}
                      </td>
                      <td className="max-w-[200px] px-4 py-3 text-xs">
                        <span className="block truncate text-muted-foreground">
                          {row.focalPoint ?? 'Nenhum'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {(risk?.roots.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      Nenhuma meta macro cadastrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone: 'good' | 'warning' | 'critical';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className={cn('font-mono text-2xl font-semibold tabular-nums', TONE_TEXT[tone])}>
          {value}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}
