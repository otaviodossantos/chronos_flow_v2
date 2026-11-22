import { GanttChartSquare, Target, Inbox, BarChart3, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Tab = 'timeline' | 'focus' | 'backlog' | 'reports' | 'mais';

const NAV: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'timeline', label: 'Timeline', icon: <GanttChartSquare className="h-5 w-5" /> },
  { id: 'focus', label: 'Foco', icon: <Target className="h-5 w-5" /> },
  { id: 'backlog', label: 'Backlog', icon: <Inbox className="h-5 w-5" /> },
  { id: 'reports', label: 'Relatorios', icon: <BarChart3 className="h-5 w-5" /> },
  { id: 'mais', label: 'Mais', icon: <MoreHorizontal className="h-5 w-5" /> },
];

/**
 * A barra lateral do desktop nao cabe num iPhone, entao a navegacao desceu
 * para o rodape — onde o polegar alcanca.
 *
 * Equipe e Ajustes nao viraram abas: seis alvos numa barra de 390px deixariam
 * cada um com menos que os 44px que a Apple pede, e sao as duas telas que
 * menos se abrem no dia a dia. Elas moram em "Mais".
 */
export function TabBar({
  tab,
  onTab,
  pendentes,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  pendentes: number;
}) {
  return (
    <nav
      className="flex shrink-0 items-stretch border-t bg-card/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {NAV.map((item) => {
        const ativo = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTab(item.id)}
            aria-label={item.label}
            aria-current={ativo ? 'page' : undefined}
            className={cn(
              'relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
              ativo ? 'text-primary' : 'text-muted-foreground active:bg-accent',
            )}
          >
            <span className="relative">
              {item.icon}
              {/* O numero da fila so aparece na aba do foco: repetir o aviso
                  em todas as abas transformaria o alerta em ruido. */}
              {item.id === 'focus' && pendentes > 0 && (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                  {pendentes > 99 ? '99+' : pendentes}
                </span>
              )}
            </span>
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
