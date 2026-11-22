import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, Clock, Ban, Scissors, ExternalLink, GitBranch, PictureInPicture2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDuration, relativeDeadline, levelLabel, progressTone, TONE_TEXT } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTimelineStore } from '@/stores/timelineStore';
import { DeepWorkTimer } from './DeepWorkTimer';
import { BreakdownModal } from '@/features/team/BreakdownModal';
import { LifeStrip } from '@/features/life/LifeStrip';
import type { NodeDTO } from '@shared/types';

export function FocusPage({
  onNavigateToTimeline,
  onOpenWidget,
}: {
  onNavigateToTimeline: () => void;
  onOpenWidget: (node?: NodeDTO | null) => void;
}) {
  const [scope, setScope] = useState('today');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [breakdownTarget, setBreakdownTarget] = useState<NodeDTO | null>(null);
  const queryClient = useQueryClient();
  const selectNode = useTimelineStore((s) => s.select);

  const { data, isLoading } = useQuery({
    queryKey: ['focus', scope],
    queryFn: () => api.focusQueue({ scope }),
  });

  const queue = data?.queue ?? [];
  const selectedIds = useMemo(() => [...selected], [selected]);

  const { data: simulation } = useQuery({
    queryKey: ['simulate', selectedIds.join(',')],
    queryFn: () => api.simulate(selectedIds),
    enabled: selectedIds.length > 0,
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.completeNode(id),
    onSuccess: (res) => {
      toast.success(`+${res.impact.deltaPercent}% em "${res.impact.rootTitle}".`, {
        description: res.cascade.map((c) => `${c.title}: ${c.progress.toFixed(1)}%`).join(' · '),
      });
      if (res.unblocked.length > 0) {
        toast.info(`Destravou: ${res.unblocked.map((u) => u.title).join(', ')}`);
      }
      queryClient.invalidateQueries({ queryKey: ['focus'] });
      queryClient.invalidateQueries({ queryKey: ['tree'] });
      queryClient.invalidateQueries({ queryKey: ['life'] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const topItem = queue[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] p-6">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide">
          <span className="flex items-center gap-1.5 text-[hsl(var(--status-good))]">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--status-good))]" />
            Algoritmo bottom-up ativo
          </span>
          <span className="text-muted-foreground">Execucao individual</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">O foco do dia</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Tarefas folha priorizadas pelo impacto ascendente. Cada entrega recalcula os pesos
          ponderados das metas macro na hora.
        </p>

        <LifeStrip className="mt-5" />

        <Tabs value={scope} onValueChange={setScope} className="mt-5">
          <TabsList>
            <TabsTrigger value="today">Hoje ({queue.length})</TabsTrigger>
            <TabsTrigger value="next48">Proximas 48h</TabsTrigger>
            <TabsTrigger value="all">Todas atribuidas a mim</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card className="mt-4">
          <CardContent className="flex flex-wrap items-center gap-6 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm">
                  Impacto potencial hoje:{' '}
                  <strong className="text-[hsl(var(--status-good))]">
                    +{data?.potentialImpact ?? 0}%
                  </strong>
                </div>
                <div className="text-xs text-muted-foreground">
                  Propagacao calculada sobre as metas macro interdependentes.
                </div>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Concluidas hoje</div>
                <div className="font-mono text-sm">{data?.completedToday ?? 0}</div>
              </div>
              <Badge variant="secondary">{queue.length} microtarefas executaveis</Badge>
            </div>
          </CardContent>
        </Card>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <section>
            <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Fila de execucao autonoma (bottom-up)</span>
              <span>Ordenado por criticidade ponderada</span>
            </div>

            {isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando fila...</p>}
            {!isLoading && queue.length === 0 && (
              <Card>
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  Nada na fila. Crie uma meta macro na Timeline e quebre-a em microtarefas.
                </CardContent>
              </Card>
            )}

            <div className="space-y-2.5">
              {queue.map((item) => {
                const tone = progressTone(item.root.progress);
                return (
                  <Card key={item.node.id} className="transition-colors hover:border-primary/40">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={selected.has(item.node.id)}
                          onCheckedChange={() => toggle(item.node.id)}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            {item.spacePath.map((p, i) => (
                              <span key={i} className="flex items-center gap-1.5">
                                {i > 0 && <span>/</span>}
                                <span className="truncate">{p}</span>
                              </span>
                            ))}
                          </div>
                          <h3 className="text-base font-medium leading-snug">{item.node.title}</h3>

                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              {formatDuration(item.node.estimated_minutes)}
                            </span>
                            <span>{relativeDeadline(item.node.due_date)}</span>
                            <span className="font-mono">{levelLabel(item.node.depth)}</span>
                          </div>

                          <div className="mt-3 flex gap-2">
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => setBreakdownTarget(item.node)}
                            >
                              <Scissors className="h-3 w-3" />
                              Quebrar em subtarefas
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => {
                                selectNode(item.node.id);
                                onNavigateToTimeline();
                              }}
                            >
                              <ExternalLink className="h-3 w-3" />
                              Ver na timeline
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => onOpenWidget(item.node)}
                            >
                              <PictureInPicture2 className="h-3 w-3" />
                              Focar nesta
                            </Button>
                            <Button
                              size="xs"
                              className="ml-auto"
                              disabled={complete.isPending}
                              onClick={() => complete.mutate(item.node.id)}
                            >
                              Concluir
                            </Button>
                          </div>
                        </div>

                        <Badge variant="good" className="shrink-0 gap-1">
                          <TrendingUp className="h-3 w-3" />+{item.deltaPercent}% na meta macro
                        </Badge>
                      </div>

                      <div className="mt-3 flex items-center gap-2 border-t pt-2 text-[11px]">
                        <span className="truncate text-muted-foreground">{item.root.title}</span>
                        <Progress value={item.root.progress} tone={tone} className="w-24" />
                        <span className={cn('font-mono', TONE_TEXT[tone])}>
                          {item.root.progress.toFixed(1)}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {(data?.impediments.length ?? 0) > 0 && (
              <section className="mt-6">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[hsl(var(--status-critical))]">
                  <Ban className="h-3.5 w-3.5" />
                  Impedimentos — bloqueadas por dependencia
                </div>
                <div className="space-y-2">
                  {data!.impediments.map((item) => (
                    <Card key={item.node.id} className="border-[hsl(var(--status-critical)/0.4)]">
                      <CardContent className="flex items-center gap-3 p-3">
                        <Ban className="h-4 w-4 shrink-0 text-[hsl(var(--status-critical))]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{item.node.title}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            Aguarda: {item.blockers.map((b) => b.title).join(', ') || 'dependencia'}
                          </div>
                        </div>
                        <Badge variant="critical">+{item.deltaPercent}% travado</Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}
          </section>

          <aside className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Simulador de cascata bottom-up
                </CardTitle>
                <Badge variant="secondary">Tempo real</Badge>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  Marque tarefas da fila para ver o peso subir pelos nos da arvore em cascata
                  reversa.
                </p>

                {selectedIds.length === 0 && (
                  <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Nenhuma tarefa marcada ainda.
                  </p>
                )}

                {simulation?.projections.map((p) => (
                  <div key={p.rootId} className="mb-3 rounded-lg border p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{p.rootTitle}</span>
                      <span className="shrink-0 font-mono text-sm">
                        {p.current.toFixed(1)}%
                        <span className="text-[hsl(var(--status-good))]">
                          {' '}
                          → {p.projected.toFixed(1)}%
                        </span>
                      </span>
                    </div>
                    <div className="relative">
                      <Progress value={p.projected} tone="good" />
                      <div
                        className="absolute top-0 h-1.5 rounded-full bg-foreground/30"
                        style={{ width: `${p.current}%` }}
                      />
                    </div>
                  </div>
                ))}

                {selectedIds.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {selectedIds.length} tarefa(s) marcada(s). Concluir a fila de hoje reduz o desvio
                    de prazo das metas envolvidas.
                  </p>
                )}
              </CardContent>
            </Card>

            <DeepWorkTimer
              targetTitle={topItem?.node.title ?? null}
              onOpenWidget={() => onOpenWidget(topItem?.node ?? null)}
            />
          </aside>
        </div>
      </div>

      {breakdownTarget && (
        <BreakdownModal
          open
          onOpenChange={(v) => !v && setBreakdownTarget(null)}
          parent={breakdownTarget}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['focus'] });
            queryClient.invalidateQueries({ queryKey: ['tree'] });
          }}
        />
      )}
    </div>
  );
}
