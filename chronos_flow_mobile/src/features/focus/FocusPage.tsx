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
import { CabecalhoDaTela } from '@/components/CabecalhoDaTela';
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
    <div className="flex h-full flex-col">
      <CabecalhoDaTela titulo="Foco do dia" nota="Tarefas folha ordenadas pelo impacto nas metas." />

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <LifeStrip />

        {/*
          Os tres numeros numa faixa so.

          Era um cartao largo com "Impacto potencial hoje", a frase explicando a
          propagacao, "Concluidas hoje" e um selo de contagem. Em 390px aquilo
          quebrava em quatro linhas e empurrava a fila — que e o conteudo desta
          tela — para fora da primeira dobra.
        */}
        <div className="mt-3 flex items-stretch gap-2">
          <div className="min-w-0 flex-1 rounded-lg border bg-card p-2.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3 w-3 shrink-0" />
              {/* "Potencial", e nao "Impacto hoje": a faixa de vida logo acima
                  ja tem um "Avanco hoje", que e o avanco JA feito. Dois
                  rotulos parecidos para numeros diferentes viram confusao. */}
              <span className="truncate">Potencial</span>
            </div>
            <div className="mt-0.5 font-mono text-xl font-semibold text-[hsl(var(--status-good))]">
              +{data?.potentialImpact ?? 0}%
            </div>
          </div>
          <div className="min-w-0 flex-1 rounded-lg border bg-card p-2.5">
            <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              Concluidas
            </div>
            <div className="mt-0.5 font-mono text-xl font-semibold">{data?.completedToday ?? 0}</div>
          </div>
          <div className="min-w-0 flex-1 rounded-lg border bg-card p-2.5">
            <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              Na fila
            </div>
            <div className="mt-0.5 font-mono text-xl font-semibold">{queue.length}</div>
          </div>
        </div>

        {/* Rotulos curtos: "Todas atribuidas a mim" nao cabia ao lado dos
            outros dois, e encolher a fonte encolheria junto o alvo do dedo. */}
        <Tabs value={scope} onValueChange={setScope} className="mt-3">
          <TabsList className="w-full">
            <TabsTrigger value="today" className="flex-1">Hoje ({queue.length})</TabsTrigger>
            <TabsTrigger value="next48" className="flex-1">48h</TabsTrigger>
            <TabsTrigger value="all" className="flex-1">Minhas</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-3 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <section>
            <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              Fila, por criticidade ponderada
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
                    <CardContent className="p-3">
                      {/*
                        O selo de impacto desceu para a linha dos outros dados.

                        Ele era irmao do texto, com `shrink-0` e a frase inteira
                        "+63.6% na meta macro" dentro: ficava com 200 dos 340px
                        da linha, o titulo quebrava palavra por palavra na faixa
                        que sobrava e os botoes saiam pela direita. O nome da
                        meta macro ja esta no rodape do cartao; aqui basta o
                        numero.
                      */}
                      <div className="flex items-start gap-2.5">
                        <Checkbox
                          checked={selected.has(item.node.id)}
                          onCheckedChange={() => toggle(item.node.id)}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                            {item.spacePath.map((p, i) => (
                              <span key={i} className="flex items-center gap-1">
                                {i > 0 && <span>/</span>}
                                <span className="truncate">{p}</span>
                              </span>
                            ))}
                          </div>
                          <h3 className="text-sm font-medium leading-snug">{item.node.title}</h3>

                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                            <Badge variant="good" className="gap-1">
                              <TrendingUp className="h-3 w-3" />+{item.deltaPercent}%
                            </Badge>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(item.node.estimated_minutes)}
                            </span>
                            <span>{relativeDeadline(item.node.due_date)}</span>
                            <span className="font-mono">{levelLabel(item.node.depth)}</span>
                          </div>

                          {/* `flex-wrap` e rotulos curtos: quatro botoes numa
                              linha de 340px passavam da borda, e o que sumia
                              por ultimo era justamente o Concluir. */}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => setBreakdownTarget(item.node)}
                            >
                              <Scissors className="h-3 w-3" />
                              Quebrar
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
                              Timeline
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => onOpenWidget(item.node)}
                            >
                              <PictureInPicture2 className="h-3 w-3" />
                              Focar
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
                      </div>

                      <div className="mt-2.5 flex items-center gap-2 border-t pt-2 text-[11px]">
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {item.root.title}
                        </span>
                        <Progress value={item.root.progress} tone={tone} className="w-16 shrink-0" />
                        <span className={cn('shrink-0 font-mono', TONE_TEXT[tone])}>
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
