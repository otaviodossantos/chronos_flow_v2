import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sidebar, type Tab } from '@/components/Sidebar';
import { TimelinePage } from '@/features/timeline/TimelinePage';
import { TableView } from '@/features/board/TableView';
import { KanbanView } from '@/features/board/KanbanView';
import { TaskSheet } from '@/features/task/TaskSheet';
import { FocusPage } from '@/features/focus/FocusPage';
import { BacklogPage } from '@/features/backlog/BacklogPage';
import { TeamPage } from '@/features/team/TeamPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { FloatingTimerWidget } from '@/features/focus/FloatingTimerWidget';
import {
  useFloatingWidget,
  FloatingWidgetPortal,
} from '@/features/focus/FloatingWidgetHost';
import { isFloatingWindow } from '@/lib/floatingWindow';
import { useTimelineStore } from '@/stores/timelineStore';
import { useThemeStore } from '@/stores/themeStore';
import { useUiStore } from '@/stores/uiStore';
import { AuthGate } from '@/features/auth/AuthGate';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

function Shell() {
  const [tab, setTab] = useState<Tab>('timeline');
  const theme = useThemeStore((s) => s.theme);
  const floating = useFloatingWidget();
  const selectNode = useTimelineStore((s) => s.select);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const projectView = useUiStore((s) => s.projectView);

  // Cmd/Ctrl+B: o mesmo atalho de editor e de app de notas para a barra
  // lateral. Fica no shell, e nao na barra, para funcionar com o foco em
  // qualquer tela.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground antialiased">
      <Toaster richColors position="top-right" theme={theme} />

      <div className="flex min-h-0 flex-1">
        <Sidebar tab={tab} onTab={setTab} />
        <main className="min-w-0 flex-1">
          {/* Uma tela de projetos, tres jeitos de ver a mesma arvore. */}
          {tab === 'timeline' && projectView === 'timeline' && (
            <TimelinePage />
          )}
          {tab === 'timeline' && projectView === 'table' && <TableView />}
          {tab === 'timeline' && projectView === 'kanban' && (
            <KanbanView />
          )}
          {/* A mesma gaveta para as tres visoes: segue a tarefa selecionada. */}
          {tab === 'timeline' && <TaskSheet onOpenWidget={floating.open} />}
          {tab === 'focus' && (
            <FocusPage onNavigateToTimeline={() => setTab('timeline')} onOpenWidget={floating.open} />
          )}
          {tab === 'backlog' && (
            <BacklogPage
              onGoToTimeline={(nodeId) => {
                selectNode(nodeId);
                setTab('timeline');
              }}
            />
          )}
          {tab === 'team' && <TeamPage />}
          {tab === 'reports' && <ReportsPage />}
          {tab === 'settings' && <SettingsPage />}
        </main>
      </div>

      <FloatingWidgetPortal mount={floating.mount} node={floating.node} onClose={floating.close} />
    </div>
  );
}

export default function App() {
  // A janela flutuante nativa carrega o mesmo bundle com ?window=floating.
  if (isFloatingWindow()) {
    return (
      <QueryClientProvider client={queryClient}>
        <FloatingTimerWidget onClose={() => window.close()} />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <AuthGate>
          <Shell />
        </AuthGate>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
