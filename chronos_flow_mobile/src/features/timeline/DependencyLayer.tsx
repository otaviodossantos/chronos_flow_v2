import { useMemo } from 'react';
import type { NodeDTO } from '@shared/types';
import { ROW_HEIGHT } from '@/stores/timelineStore';
import type { TimeScale } from './useTimeScale';
import type { FlatRow } from './useVisibleNodes';

interface Props {
  rows: FlatRow[];
  scale: TimeScale;
  height: number;
}

/**
 * Curvas de Bezier cubicas entre as bordas das barras. So desenha
 * dependencias cujas duas pontas estao visiveis; a ponta fora da lista
 * vira um marcador na margem.
 */
export function DependencyLayer({ rows, scale, height }: Props) {
  const { paths, stubs } = useMemo(() => {
    const rowOf = new Map<string, number>();
    rows.forEach((r, i) => rowOf.set(r.node.id, i));

    const barEdges = (node: NodeDTO) => {
      const x1 = scale.xOf(node.start_date ?? node.due_date);
      const x2 = scale.xOf(node.due_date ?? node.start_date);
      return { left: Math.min(x1, x2), right: Math.max(x1, x2) + 2 };
    };

    const drawn: Array<{ key: string; d: string; critical: boolean }> = [];
    const edgeStubs: Array<{ key: string; x: number; y: number }> = [];

    for (const row of rows) {
      for (const blockedId of row.node.blocks ?? []) {
        const targetIndex = rowOf.get(blockedId);
        const sourceIndex = rowOf.get(row.node.id)!;

        if (targetIndex === undefined) {
          edgeStubs.push({
            key: `${row.node.id}-${blockedId}`,
            x: barEdges(row.node).right + 6,
            y: sourceIndex * ROW_HEIGHT + ROW_HEIGHT / 2,
          });
          continue;
        }

        const target = rows[targetIndex].node;
        const from = barEdges(row.node);
        const to = barEdges(target);
        const y1 = sourceIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
        const y2 = targetIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
        const x1 = from.right;
        const x2 = to.left;

        const dx = Math.min(96, Math.max(24, Math.abs(x2 - x1) * 0.4));

        // Aresta para frente: curva de Bezier simples entre as duas bordas.
        // Aresta para tras (o alvo comeca antes do bloqueador): a curva direta
        // atravessaria as barras no meio, entao contorna por fora com um cotovelo.
        const d =
          x2 >= x1 + 12
            ? `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
            : (() => {
                const out = x1 + 20;
                const back = x2 - 20;
                const lane = (y1 + y2) / 2 + (y2 > y1 ? ROW_HEIGHT / 2 - 4 : -(ROW_HEIGHT / 2 - 4));
                return [
                  `M ${x1} ${y1}`,
                  `C ${out} ${y1}, ${out} ${lane}, ${out - 6} ${lane}`,
                  `L ${back + 6} ${lane}`,
                  `C ${back} ${lane}, ${back} ${y2}, ${x2} ${y2}`,
                ].join(' ');
              })();

        drawn.push({
          key: `${row.node.id}-${blockedId}`,
          d,
          critical: target.status === 'BLOCKED',
        });
      }
    }

    return { paths: drawn, stubs: edgeStubs };
  }, [rows, scale]);

  if (paths.length === 0 && stubs.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={scale.width}
      height={height}
      aria-hidden
    >
      <defs>
        <marker
          id="dep-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill="hsl(var(--muted-foreground))" />
        </marker>
        <marker
          id="dep-arrow-critical"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill="hsl(var(--status-critical))" />
        </marker>
      </defs>

      {paths.map((p) => (
        <path
          key={p.key}
          d={p.d}
          fill="none"
          stroke={p.critical ? 'hsl(var(--status-critical))' : 'hsl(var(--muted-foreground))'}
          strokeWidth={p.critical ? 1.5 : 1}
          strokeDasharray={p.critical ? undefined : '4 3'}
          opacity={p.critical ? 0.9 : 0.5}
          markerEnd={`url(#${p.critical ? 'dep-arrow-critical' : 'dep-arrow'})`}
        />
      ))}

      {stubs.map((s) => (
        <circle
          key={s.key}
          cx={s.x}
          cy={s.y}
          r={3}
          fill="hsl(var(--muted-foreground))"
          opacity={0.6}
        />
      ))}
    </svg>
  );
}
