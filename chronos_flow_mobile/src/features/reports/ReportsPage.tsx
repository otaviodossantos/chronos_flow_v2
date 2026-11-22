import { useQuery } from '@tanstack/react-query';
import { Zap, AlertTriangle, Gauge, Network } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { progressTone, TONE_TEXT } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CabecalhoDaTela } from '@/components/CabecalhoDaTela';
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
  const roots = risk?.roots ?? [];

  return (
    <div className="flex h-full flex-col">
      <CabecalhoDaTela titulo="Relatorios" nota="Saude das metas, cascata e desvios." />

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/*
          Dois por linha, e nao um por linha.

          Cada numero vinha num cartao com o texto explicativo inteiro embaixo —
          tres linhas para contar o que e um progresso medio. Cabiam dois
          numeros e meio na tela toda. Aqui o numero fica grande, a explicacao
          vira uma linha so, e os quatro aparecem de uma vez.
        */}
        <div className="grid grid-cols-2 gap-2">
          <Metrica
            icon={<Zap className="h-3.5 w-3.5" />}
            label="Progresso medio"
            value={`${velocity?.avgRootProgress ?? 0}%`}
            nota="consolidado por cascata"
            tone={progressTone(velocity?.avgRootProgress ?? 0)}
          />
          <Metrica
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="Gargalos"
            value={String(velocity?.bottlenecks ?? 0)}
            nota="travadas por dependencia"
            tone={(velocity?.bottlenecks ?? 0) > 0 ? 'critical' : 'good'}
          />
          <Metrica
            icon={<Gauge className="h-3.5 w-3.5" />}
            label="Desvio de estimativa"
            value={`${(velocity?.estimateDeviationPercent ?? 0) > 0 ? '+' : ''}${velocity?.estimateDeviationPercent ?? 0}%`}
            nota="previsto contra realizado"
            tone={Math.abs(velocity?.estimateDeviationPercent ?? 0) > 25 ? 'warning' : 'good'}
          />
          <Metrica
            icon={<Network className="h-3.5 w-3.5" />}
            label="Profundidade"
            value={`${velocity?.avgDepth ?? 0}`}
            nota={`media · maximo de ${velocity?.maxDepth ?? 0}`}
            tone="good"
          />
        </div>

        <Card className="mt-3">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-sm">Progresso no tempo</CardTitle>
            <CardDescription className="text-[11px]">
              Avanco consolidado nas metas macro, um ponto por dia.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <ProgressChart series={series} />
          </CardContent>
        </Card>

        <Card className="mt-3">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-sm">Mapa de risco</CardTitle>
            <CardDescription className="text-[11px]">
              Uma linha por meta macro, agregando as filhas recursivas.
            </CardDescription>
          </CardHeader>

          {/*
            Cartoes, e nao tabela.

            Eram cinco colunas — meta, progresso, diagnostico, topologia e ponto
            focal — e so a primeira cabia em 390px: o resto saia pela direita,
            sem barra de rolagem que avisasse. Rolar uma tabela de lado no
            polegar tambem nao e resposta; a mesma informacao, empilhada, cabe.
          */}
          <CardContent className="divide-y p-0">
            {roots.map((row) => {
              const tone = progressTone(row.progress);
              return (
                <div key={row.id} className="p-3">
                  <div className="flex items-start gap-2">
                    {row.space && (
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: row.space.color }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug line-clamp-2">{row.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {row.owner ? `Responsavel: ${row.owner}` : 'Sem responsavel'}
                      </p>
                    </div>
                    <Badge variant={row.risk} className="shrink-0">
                      {RISK_LABEL[row.risk]}
                    </Badge>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={row.progress} tone={tone} className="flex-1" />
                    <span className={cn('shrink-0 font-mono text-xs tabular-nums', TONE_TEXT[tone])}>
                      {row.progress.toFixed(1)}%
                    </span>
                  </div>

                  <p className="mt-1.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                    <span>{row.childCount} {row.childCount === 1 ? 'filha' : 'filhas'}</span>
                    <span>· {row.levels} {row.levels === 1 ? 'nivel' : 'niveis'}</span>
                    {row.blocked > 0 && (
                      <span className="text-[hsl(var(--status-critical))]">
                        · {row.blocked} bloqueada(s)
                      </span>
                    )}
                    {row.overdue > 0 && (
                      <span className="text-[hsl(var(--status-warning))]">
                        · {row.overdue} atrasada(s)
                      </span>
                    )}
                  </p>

                  {row.focalPoint && (
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      Ponto focal: <span className="text-foreground">{row.focalPoint}</span>
                    </p>
                  )}
                </div>
              );
            })}

            {roots.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma meta macro cadastrada.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="h-3" />
      </div>
    </div>
  );
}

function Metrica({
  icon,
  label,
  value,
  nota,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  nota: string;
  tone: 'good' | 'warning' | 'critical';
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="min-w-0 flex-1 truncate text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <div className={cn('mt-1 font-mono text-xl font-semibold tabular-nums', TONE_TEXT[tone])}>
        {value}
      </div>
      <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{nota}</p>
    </div>
  );
}
