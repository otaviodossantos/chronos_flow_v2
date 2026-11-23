import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  GanttChartSquare, Target, Inbox, Users, BarChart3, Settings, Moon, Sun, Plus,
  PanelLeftClose, PanelLeftOpen, LogOut, ShieldCheck,
} from 'lucide-react';
import type { AuthEstado } from '@shared/types';
import { AUTH_KEY, useSair } from '@/features/auth/AuthGate';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { isMacDesktop } from '@/lib/platform';
import { useThemeStore } from '@/stores/themeStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useUiStore } from '@/stores/uiStore';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NewSpaceProjectDialog, type NewKind } from '@/components/NewSpaceProjectDialog';

export type Tab = 'timeline' | 'focus' | 'backlog' | 'team' | 'reports' | 'admin' | 'settings';

const NAV: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  // Timeline, Tabela e Kanban moram juntas aqui: o seletor fica no topo da tela.
  { id: 'timeline', label: 'Projetos', icon: <GanttChartSquare className="h-4 w-4" /> },
  { id: 'focus', label: 'Meu Foco', icon: <Target className="h-4 w-4" /> },
  { id: 'backlog', label: 'Backlog', icon: <Inbox className="h-4 w-4" /> },
  { id: 'team', label: 'Equipe', icon: <Users className="h-4 w-4" /> },
  { id: 'reports', label: 'Relatorios', icon: <BarChart3 className="h-4 w-4" /> },
];

/**
 * Fechada, a barra vira um trilho de icones em vez de sumir. Sumir de vez
 * devolveria mais espaco, mas tiraria a navegacao da tela — e, no macOS,
 * levaria junto a faixa que segura os semaforos da janela.
 *
 * Por isso o trilho e mais largo no macOS: os tres botoes terminam por volta
 * de 71px e precisam caber nele.
 */
const RAIL = 56;
const RAIL_MAC = 78;
const ABERTA = 232;

export function Sidebar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { theme, toggle } = useThemeStore();
  const { spaceId, setSpace, select } = useTimelineStore();
  const { sidebarCollapsed: fechada, toggleSidebar } = useUiStore();
  const [newKind, setNewKind] = useState<NewKind | null>(null);
  const mac = isMacDesktop();

  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });
  const { data: auth } = useQuery<AuthEstado>({ queryKey: AUTH_KEY, enabled: false });
  const sair = useSair();
  const { data: focus } = useQuery({ queryKey: ['focus', 'today'], queryFn: () => api.focusQueue({ scope: 'today' }) });

  const largura = fechada ? (mac ? RAIL_MAC : RAIL) : ABERTA;
  const pendentes = focus?.queue.length ?? 0;

  /** Rotulo so no trilho: aberta, o texto ja esta ao lado do icone. */
  const comDica = (conteudo: React.ReactNode, texto: string) =>
    fechada ? (
      <Tooltip>
        <TooltipTrigger asChild>{conteudo}</TooltipTrigger>
        <TooltipContent side="right">{texto}</TooltipContent>
      </Tooltip>
    ) : (
      conteudo
    );

  return (
    <nav
      className="flex shrink-0 flex-col border-r bg-card transition-[width] duration-200"
      style={{ width: largura }}
    >
      {/*
        No macOS os semaforos ficam dentro da janela (`hiddenInset`) e caem
        justamente aqui. Em vez de empurrar a marca para baixo, abre-se a
        margem a esquerda e eles ocupam o lugar do icone.
      */}
      <div
        className={cn(
          'app-drag flex h-12 items-center gap-2',
          fechada ? 'justify-center px-2' : 'px-4',
          mac && !fechada && 'pl-[82px] pr-3',
        )}
      >
        {fechada ? (
          !mac && <GanttChartSquare className="h-4 w-4 shrink-0" />
        ) : (
          <>
            {!mac && <GanttChartSquare className="h-4 w-4" />}
            <span className="truncate text-sm font-semibold">Chronos Flow</span>
            <span className="rounded bg-secondary px-1 font-mono text-[9px] text-muted-foreground">
              v2
            </span>
          </>
        )}
      </div>

      <div className={cn('py-2', fechada ? 'px-2' : 'px-3')}>
        {!fechada && (
          <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Workspace
          </div>
        )}
        {[
          ...NAV,
          // So quem administra o servidor ve a aba (o servidor confere de novo).
          ...(auth?.usuario?.papel === 'ADMIN'
            ? [{ id: 'admin' as Tab, label: 'Admin', icon: <ShieldCheck className="h-4 w-4" /> }]
            : []),
        ].map((item) =>
          comDica(
            <button
              key={item.id}
              type="button"
              onClick={() => onTab(item.id)}
              aria-label={item.label}
              className={cn(
                'relative flex w-full items-center rounded-md text-sm transition-colors',
                fechada ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-2.5 py-2',
                tab === item.id
                  ? 'bg-secondary font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {item.icon}
              {!fechada && <span className="flex-1 text-left">{item.label}</span>}

              {item.id === 'focus' && pendentes > 0 && (
                <span
                  className={cn(
                    'rounded bg-secondary font-mono text-[10px]',
                    fechada
                      ? 'absolute right-0.5 top-0.5 min-w-3.5 px-0.5 text-center leading-3.5'
                      : 'px-1.5',
                  )}
                >
                  {pendentes}
                </span>
              )}
            </button>,
            item.label,
          ),
        )}
      </div>

      {!fechada && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Espacos e projetos
            </span>
            <button
              type="button"
              title="Novo espaco ou projeto"
              aria-label="Novo espaco ou projeto"
              onClick={() => setNewKind('space')}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSpace(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors',
              spaceId === null ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
            <span className="flex-1 text-left">Todos</span>
          </button>
          {spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSpace(s.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                spaceId === s.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="flex-1 truncate text-left">{s.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {Math.round(s.progress)}%
              </span>
            </button>
          ))}
        </div>
      )}

      {/*
        Fechada, a lista de espacos sai e o rodape subiria junto. Este vao
        segura o rodape embaixo, no mesmo lugar dos dois estados.
      */}
      {fechada && <div className="min-h-0 flex-1" />}

      <div className={cn('border-t', fechada ? 'space-y-1 p-2' : 'p-3')}>
        {fechada ? (
          comDica(
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
              className="flex w-full items-center justify-center rounded-md py-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>,
            theme === 'dark' ? 'Tema claro' : 'Tema escuro',
          )
        ) : (
          <label className="mb-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
              Modo escuro
            </span>
            <Switch checked={theme === 'dark'} onCheckedChange={toggle} />
          </label>
        )}

        {comDica(
          <button
            type="button"
            onClick={() => onTab('settings')}
            aria-label="Configuracoes"
            className={cn(
              'flex w-full items-center rounded-md text-sm transition-colors',
              fechada ? 'justify-center py-2.5' : 'gap-2.5 px-2.5 py-2',
              tab === 'settings'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Settings className="h-4 w-4" />
            {!fechada && 'Configuracoes'}
          </button>,
          'Configuracoes',
        )}

        {comDica(
          <button
            type="button"
            onClick={() => sair.mutate()}
            disabled={sair.isPending}
            aria-label="Sair da conta"
            title={auth?.usuario?.email ?? undefined}
            className={cn(
              'flex w-full items-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              fechada ? 'justify-center py-2.5' : 'gap-2.5 px-2.5 py-2',
            )}
          >
            <LogOut className="h-4 w-4" />
            {!fechada && (
              <span className="min-w-0 flex-1 truncate text-left">
                Sair{auth?.usuario ? ` · ${auth.usuario.name}` : ''}
              </span>
            )}
          </button>,
          'Sair da conta',
        )}

        {comDica(
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={fechada ? 'Abrir a barra lateral' : 'Fechar a barra lateral'}
            className={cn(
              'flex w-full items-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              fechada ? 'justify-center py-2.5' : 'gap-2.5 px-2.5 py-2',
            )}
          >
            {fechada ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
            {!fechada && (
              <>
                <span className="flex-1 text-left">Fechar barra</span>
                <kbd className="rounded border px-1 font-mono text-[9px]">
                  {isMacDesktop() ? '⌘B' : 'Ctrl+B'}
                </kbd>
              </>
            )}
          </button>,
          `${fechada ? 'Abrir' : 'Fechar'} a barra lateral`,
        )}
      </div>

      <NewSpaceProjectDialog
        open={newKind !== null}
        onOpenChange={(open) => !open && setNewKind(null)}
        defaultKind={newKind ?? 'space'}
        defaultSpaceId={spaceId}
        onCreatedSpace={(id) => setSpace(id)}
        onCreatedProject={(id) => {
          select(id);
          onTab('timeline');
        }}
      />
    </nav>
  );
}
