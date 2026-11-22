import { cn } from '@/lib/utils';
import type { TimeScale } from './useTimeScale';

export function TimeRuler({ scale, scrollLeft }: { scale: TimeScale; scrollLeft: number }) {
  const twoRows = scale.zoom === 'hours';

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden border-b bg-card',
        twoRows ? 'h-14' : 'h-10',
      )}
    >
      <div
        className="absolute inset-y-0 left-0"
        style={{ width: scale.width, transform: `translateX(${-scrollLeft}px)` }}
      >
        {/* No zoom de horas, uma faixa por dia acima das horas: sem ela, "08:00"
            se repete sem dizer de que dia. */}
        {twoRows &&
          scale.bands.map((band) => (
            <div
              key={band.key}
              className="absolute top-0 flex h-6 items-center border-l bg-secondary/40 pl-2 text-[10px] font-medium"
              style={{ left: band.x, width: band.width }}
            >
              {band.label}
            </div>
          ))}

        {scale.ticks.map((tick) => (
          <div
            key={tick.key}
            className={cn(
              'absolute h-full border-l pl-1.5 text-[10px]',
              twoRows ? 'top-6 pt-1.5' : 'top-0 pt-2',
              tick.major
                ? 'border-border font-medium text-foreground'
                : 'border-border/40 text-muted-foreground',
            )}
            style={{ left: tick.x }}
          >
            {tick.label}
          </div>
        ))}

        {scale.todayX >= 0 && (
          <div
            className="absolute top-0 h-full border-l border-dashed border-[hsl(var(--status-good))]"
            style={{ left: scale.todayX }}
          />
        )}
      </div>
    </div>
  );
}
