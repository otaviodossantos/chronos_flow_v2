import { useMemo } from 'react';
import { MONTHS_SHORT } from '@/lib/format';

interface Point {
  nodeId: string;
  title: string;
  date: string;
  progress: number;
}

const SERIES_COLORS = [
  'hsl(var(--status-good))',
  'hsl(var(--status-warning))',
  '#6366F1',
  '#EC4899',
  '#06B6D4',
  '#8B5CF6',
];

/**
 * Nivel ao longo do tempo: uma linha por meta macro. Barras esconderiam a
 * inclinacao, que e justamente o que o leitor procura aqui.
 */
export function ProgressChart({ series }: { series: Point[] }) {
  const chart = useMemo(() => {
    if (series.length === 0) return null;

    const byNode = new Map<string, Point[]>();
    for (const p of series) {
      const list = byNode.get(p.nodeId) ?? [];
      list.push(p);
      byNode.set(p.nodeId, list);
    }

    const times = series.map((p) => Date.parse(p.date));
    const lo = Math.min(...times);
    const hi = Math.max(...times);
    const span = Math.max(1, hi - lo);

    /*
      O viewBox e desenhado em pixels de tela, nao nos 960x260 do desktop.
      Um SVG de 960 de largura esticado para os 366px uteis do iPhone encolhe
      tudo que esta dentro dele na mesma proporcao: a fonte 10 virava 3,8px na
      tela, e os rotulos dos eixos deixavam de ser legiveis. Mantendo o viewBox
      perto da largura real, 10 e 10.
    */
    const W = 360;
    const H = 190;
    const padL = 26;
    const padR = 8;
    const padT = 10;
    const padB = 22;

    const X = (d: string) => padL + ((Date.parse(d) - lo) / span) * (W - padL - padR);
    const Y = (v: number) => padT + (1 - v / 100) * (H - padT - padB);

    const lines = [...byNode.entries()].map(([nodeId, points], i) => {
      const sorted = [...points].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
      return {
        nodeId,
        title: sorted[0].title,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        last: sorted.at(-1)!,
        d: sorted.map((p, j) => `${j === 0 ? 'M' : 'L'} ${X(p.date).toFixed(1)} ${Y(p.progress).toFixed(1)}`).join(' '),
      };
    });

    // Quatro marcas: cinco rotulos de '12 Out' se encostam em 360px.
    const tickCount = 4;
    const xTicks = Array.from({ length: tickCount }, (_, i) => {
      const t = new Date(lo + (span * i) / (tickCount - 1));
      const iso = t.toISOString().slice(0, 10);
      return { iso, x: X(iso), label: `${t.getDate()} ${MONTHS_SHORT[t.getMonth()]}` };
    });

    return { W, H, padL, padR, padT, padB, X, Y, lines, xTicks };
  }, [series]);

  if (!chart) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        Sem historico ainda. Os retratos diarios comecam a ser gravados conforme voce usa o app.
      </p>
    );
  }

  const { W, H, padL, padR, padB, Y, lines, xTicks } = chart;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Progresso consolidado das metas macro ao longo do tempo">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={W - padR}
              y1={Y(v)}
              y2={Y(v)}
              stroke="hsl(var(--border))"
              strokeWidth="1"
            />
            <text
              x={padL - 8}
              y={Y(v) + 3}
              textAnchor="end"
              fontSize="9"
              fill="hsl(var(--muted-foreground))"
            >
              {v}%
            </text>
          </g>
        ))}

        {/* As pontas ancoram para dentro: centradas, a primeira e a ultima
            data saem pela borda do SVG e aparecem cortadas. */}
        {xTicks.map((t, i) => (
          <text
            key={t.iso}
            x={t.x}
            y={H - padB + 15}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            fontSize="9"
            fill="hsl(var(--muted-foreground))"
          >
            {t.label}
          </text>
        ))}

        {lines.map((line) => (
          <g key={line.nodeId}>
            <path d={line.d} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" />
            <circle cx={chart.X(line.last.date)} cy={Y(line.last.progress)} r="3" fill={line.color} />
          </g>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {lines.map((line) => (
          <span key={line.nodeId} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: line.color }} />
            <span className="truncate">{line.title}</span>
            <span className="font-mono text-foreground">{line.last.progress.toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
