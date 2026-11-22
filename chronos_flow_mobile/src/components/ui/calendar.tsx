import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/**
 * Calendario do shadcn sobre o react-day-picker, com os tokens do tema em vez
 * das cores padrao dele — assim o popover acompanha claro/escuro sozinho.
 *
 * No mobile ele abre com **seletores de mes e ano**, nao com as setinhas de
 * navegacao que o desktop usa. As setas servem para andar um mes ou dois; para
 * chegar em 2028, ou numa data de nascimento, eram dezenas de toques. O
 * `captionLayout="dropdown"` do react-day-picker gera dois `<select>` de
 * verdade, e no iPhone um `<select>` abre a roda nativa do sistema — que e
 * justamente a ferramenta certa para escolher um ano.
 */
const HOJE = new Date();

/** De 1940 ate dez anos a frente: cobre data de nascimento e planejamento. */
const PRIMEIRO_MES = new Date(1940, 0);
const ULTIMO_MES = new Date(HOJE.getFullYear() + 10, 11);

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'dropdown',
  startMonth = PRIMEIRO_MES,
  endMonth = ULTIMO_MES,
  ...props
}: DayPickerProps) {
  return (
    <DayPicker
      locale={ptBR}
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      /*
        O `locale` do date-fns traduz os nomes de mes, nao os rotulos de
        acessibilidade do proprio react-day-picker — sem isto o VoiceOver le
        "Choose the Year" no meio de uma tela inteira em portugues.
      */
      labels={{
        labelMonthDropdown: () => 'Escolher o mes',
        labelYearDropdown: () => 'Escolher o ano',
        ...props.labels,
      }}
      startMonth={startMonth}
      endMonth={endMonth}
      className={cn('p-1', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-9 items-center justify-center',
        caption_label: 'text-sm font-medium capitalize',
        // O `<select>` do react-day-picker vem transparente por cima do rotulo;
        // em 44px de altura ele vira um alvo que o dedo acerta.
        dropdowns: 'flex items-center gap-1.5 text-sm font-medium',
        dropdown_root: 'relative inline-flex items-center rounded-md px-1.5 py-1 active:bg-accent',
        dropdown: 'absolute inset-0 h-full w-full cursor-pointer opacity-0',
        months_dropdown: 'capitalize',
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
