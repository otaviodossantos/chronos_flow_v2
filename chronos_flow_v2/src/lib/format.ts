const DAY_MS = 86_400_000;

export const MONTHS_SHORT = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

export function parseISO(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY_MS);
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = typeof value === 'string' ? parseISO(value) : value ?? null;
  if (!d) return '—';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatShortDate(value: string | Date | null | undefined): string {
  const d = typeof value === 'string' ? parseISO(value) : value ?? null;
  if (!d) return '—';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function formatTimeOfDay(value: string | Date | null | undefined): string {
  const d = typeof value === 'string' ? parseISO(value) : value ?? null;
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Data com hora quando a tarefa tem horario; so a data quando ocupa o dia inteiro. */
export function formatDateTime(
  value: string | Date | null | undefined,
  allDay = false,
): string {
  const d = typeof value === 'string' ? parseISO(value) : value ?? null;
  if (!d) return '—';
  return allDay ? formatDate(d) : `${formatShortDate(d)} · ${formatTimeOfDay(d)}`;
}

/** Deslocamento legivel de um arraste: "+2 dias", "-45min", "+1h30". */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'sem mudanca';
  const sign = minutes > 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  if (abs % 1440 === 0) return `${sign}${abs / 1440} dia${abs / 1440 > 1 ? 's' : ''}`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}min`;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h${String(m).padStart(2, '0')}`;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function daysUntil(value: string | null | undefined): number | null {
  const d = parseISO(value ?? null);
  if (!d) return null;
  return diffDays(d, new Date());
}

export function relativeDeadline(value: string | null | undefined): string {
  const days = daysUntil(value);
  if (days == null) return 'sem prazo';
  if (days < 0) return `${Math.abs(days)} dia(s) em atraso`;
  if (days === 0) return 'vence hoje';
  if (days === 1) return 'vence amanha';
  return `faltam ${days} dias`;
}

/** Semaforo da cascata: verde acima de 60, ambar entre 30 e 60, vermelho abaixo. */
export function progressTone(progress: number): 'good' | 'warning' | 'critical' {
  if (progress >= 60) return 'good';
  if (progress >= 30) return 'warning';
  return 'critical';
}

export const TONE_TEXT = {
  good: 'text-[hsl(var(--status-good))]',
  warning: 'text-[hsl(var(--status-warning))]',
  critical: 'text-[hsl(var(--status-critical))]',
} as const;

export const TONE_BG = {
  good: 'bg-[hsl(var(--status-good))]',
  warning: 'bg-[hsl(var(--status-warning))]',
  critical: 'bg-[hsl(var(--status-critical))]',
} as const;

export const TONE_BORDER = {
  good: 'border-[hsl(var(--status-good))]',
  warning: 'border-[hsl(var(--status-warning))]',
  critical: 'border-[hsl(var(--status-critical))]',
} as const;

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em andamento',
  BLOCKED: 'Bloqueada',
  COMPLETED: 'Concluida',
  CANCELLED: 'Cancelada',
};

export function levelLabel(depth: number): string {
  return depth === 0 ? 'N0' : `L${depth}`;
}

/** "agora", "ha 5 min", "ha 3 h", "ontem 14:20", "12 Nov 14:20" — para o feed. */
export function formatRelativeTime(value: string | Date | null | undefined): string {
  const d = typeof value === 'string' ? parseISO(value) : value ?? null;
  if (!d) return '—';
  const minutes = Math.round((Date.now() - d.getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `ha ${minutes} min`;
  const days = diffDays(new Date(), d);
  if (days === 0) return `ha ${Math.round(minutes / 60)} h`;
  if (days === 1) return `ontem ${formatTimeOfDay(d)}`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${sameYear ? formatShortDate(d) : formatDate(d)} ${formatTimeOfDay(d)}`;
}
