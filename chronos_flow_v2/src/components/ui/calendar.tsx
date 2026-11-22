import * as React from 'react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/**
 * Calendario do shadcn sobre o react-day-picker, com os tokens do tema em vez
 * das cores padrao dele — assim o popover acompanha claro/escuro sozinho.
 */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: DayPickerProps) {
  return (
    <DayPicker
      locale={ptBR}
      showOutsideDays={showOutsideDays}
      className={cn('p-1', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-7 items-center justify-center',
        caption_label: 'text-sm font-medium capitalize',
        nav: 'absolute right-1 top-1 flex items-center gap-1',
        button_previous: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-7 w-7 p-0 opacity-60 hover:opacity-100',
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-7 w-7 p-0 opacity-60 hover:opacity-100',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-8 text-[10px] font-normal uppercase text-muted-foreground',
        week: 'mt-1 flex w-full',
        day: 'relative h-8 w-8 p-0 text-center text-sm',
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-8 w-8 p-0 font-normal aria-selected:opacity-100',
        ),
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary',
        today: '[&>button]:bg-accent [&>button]:font-semibold',
        outside: 'text-muted-foreground/40',
        disabled: 'text-muted-foreground/30 [&>button]:pointer-events-none',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  );
}
