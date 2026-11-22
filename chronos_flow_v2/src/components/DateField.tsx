import { useState } from 'react';
import { CalendarIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate, formatShortDate, formatTimeOfDay } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';

const pad = (n: number) => String(n).padStart(2, '0');

const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));
const MINUTES = Array.from({ length: 12 }, (_, i) => pad(i * 5));

/**
 * Campos de data e hora do app. Os nativos (<input type="date"> e
 * type="time") seguem a lingua do SISTEMA, nao a do app: no Electron a data
 * saia como 09/28/2026 e a hora como "12:00 PM". Aqui tudo passa pelo
 * calendario do shadcn com locale fixo em pt-BR. O valor continua sendo
 * string — so a leitura e a escolha mudaram.
 */

/** "2026-10-01" a partir de um Date, no fuso local (nao no UTC do toISOString). */
export const toDayValue = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Le "2026-10-01" como meia-noite local; sem isso vira o dia anterior no Brasil. */
export const fromDayValue = (value: string): Date | undefined => {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

interface DateFieldProps {
  /** "yyyy-MM-dd" ou string vazia. */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  /** Primeiro e ultimo dia selecionaveis, no mesmo formato do valor. */
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  size?: 'sm' | 'default';
}

export function DateField({
  value,
  onChange,
  id,
  placeholder = 'Escolher data',
  min,
  max,
  disabled,
  clearable = true,
  className,
  size = 'default',
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = fromDayValue(value);
  const minDate = min ? fromDayValue(min) : undefined;
  const maxDate = max ? fromDayValue(max) : undefined;
  const bounds = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start gap-2 px-3 font-normal',
            size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="flex-1 truncate text-left">
            {selected ? formatDate(selected) : placeholder}
          </span>
          {clearable && selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpar data"
              className="shrink-0 rounded p-0.5 opacity-50 hover:opacity-100"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange('');
              }}
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent>
        <Calendar
          mode="single"
          autoFocus
          selected={selected}
          defaultMonth={selected ?? minDate ?? maxDate}
          disabled={bounds.length > 0 ? bounds : undefined}
          onSelect={(d) => {
            if (d) onChange(toDayValue(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface DateTimeFieldProps {
  /** ISO completo, ou null. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** false = o campo representa o dia inteiro e a hora some. */
  showTime?: boolean;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'default';
}

/**
 * Data com hora. A hora fica dentro do proprio popover, logo abaixo do
 * calendario: separar em dois controles fazia o usuario abrir um, fechar, e
 * so entao perceber que faltava o horario.
 */
export function DateTimeField({
  value,
  onChange,
  showTime = true,
  id,
  placeholder = 'Escolher',
  disabled,
  className,
  size = 'default',
}: DateTimeFieldProps) {
  const [open, setOpen] = useState(false);
  const current = value ? new Date(value) : null;
  const valid = current && !Number.isNaN(current.getTime()) ? current : null;

  const emit = (date: Date) => onChange(date.toISOString());

  const pickDay = (d: Date | undefined) => {
    if (!d) return;
    const next = new Date(d);
    // Mantem o horario ja escolhido ao trocar so o dia.
    if (valid && showTime) next.setHours(valid.getHours(), valid.getMinutes(), 0, 0);
    else next.setHours(showTime ? 9 : 0, 0, 0, 0);
    emit(next);
    if (!showTime) setOpen(false);
  };

  const pickTime = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h)) return;
    const next = valid ? new Date(valid) : new Date();
    next.setHours(h, m || 0, 0, 0);
    emit(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start gap-2 px-3 font-normal',
            size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm',
            !valid && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="flex-1 truncate text-left">
            {valid
              ? showTime
                ? `${formatShortDate(valid)} · ${formatTimeOfDay(valid)}`
                : formatDate(valid)
              : placeholder}
          </span>
          {valid && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpar data"
              className="shrink-0 rounded p-0.5 opacity-50 hover:opacity-100"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(null);
              }}
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent>
        <Calendar
          mode="single"
          autoFocus
          selected={valid ?? undefined}
          defaultMonth={valid ?? undefined}
          onSelect={pickDay}
        />
        {showTime && (
          <div className="mt-2 flex items-center gap-2 border-t pt-2">
            <span className="text-xs text-muted-foreground">Horario</span>
            <Select
              aria-label="Hora"
              className="h-8 flex-1"
              value={valid ? pad(valid.getHours()) : ''}
              onChange={(e) => pickTime(`${e.target.value}:${valid ? pad(valid.getMinutes()) : '00'}`)}
            >
              {!valid && <option value="">--</option>}
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
            <span className="text-xs text-muted-foreground">:</span>
            <Select
              aria-label="Minuto"
              className="h-8 flex-1"
              value={valid ? pad(Math.round(valid.getMinutes() / 5) * 5 % 60) : ''}
              onChange={(e) => pickTime(`${valid ? pad(valid.getHours()) : '09'}:${e.target.value}`)}
            >
              {!valid && <option value="">--</option>}
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
