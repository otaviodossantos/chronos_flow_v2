import * as React from 'react';
import { cn } from '@/lib/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  tone?: 'good' | 'warning' | 'critical' | 'neutral';
}

const TONE = {
  good: 'bg-[hsl(var(--status-good))]',
  warning: 'bg-[hsl(var(--status-warning))]',
  critical: 'bg-[hsl(var(--status-critical))]',
  neutral: 'bg-foreground',
};

export function Progress({ value, tone = 'neutral', className, ...props }: ProgressProps) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-secondary', className)} {...props}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', TONE[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
