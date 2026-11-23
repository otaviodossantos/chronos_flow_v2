import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App as AppNativo } from '@capacitor/app';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TabBar, type Tab } from '@/components/TabBar';
import { TimelinePage } from '@/features/timeline/TimelinePage';
import { FocusPage } from '@/features/focus/FocusPage';
import { BacklogPage } from '@/features/backlog/BacklogPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { MaisPage } from '@/features/mais/MaisPage';
import { BarraDeFoco } from '@/features/focus/BarraDeFoco';
import { useSessaoDeFoco } from '@/features/focus/sessaoDeFoco';
import { usePublicarResumo } from '@/features/focus/usePublicarResumo';
import { useAvisos } from '@/features/avisos/useAvisos';
import { api } from '@/lib/api';
import { abrirBanco } from '@/data/partida';
import { Porteira } from '@/features/conta/Porteira';
import { useTimelineStore } from '@/stores/timelineStore';
import { useThemeStore } from '@/stores/themeStore';

const queryClient = new QueryClient({
  defaultOptions: {
    // 15s como no desktop; `refetchOnWindowFocus` aqui significa voltar do
    // segundo plano, que e justamente quando os dados podem ter envelhecido.
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

function Shell() {
  const [tab, setTab] = useState<Tab>('timeline');
  const theme = useThemeStore((s) => s.theme);
  const selectNode = useTimelineStore((s) => s.select);
  const sessao = useSessaoDeFoco();

  const { data: focus } = useQuery({
    queryKey: ['focus', 'today'],
    queryFn: () => api.focusQueue({ scope: 'today' }),
  });

  usePublicarResumo();
  // Mantem a fila de avisos do iOS em dia com as tarefas. Monta aqui, e nao
  // numa tela, porque ela precisa valer com qualquer aba aberta.
  useAvisos();

  const abrirTarefa = (nodeId: string) => {
    selectNode(nodeId);
    setTab('timeline');
  };

  /**
   * Tocar na Ilha Dinamica abre `chronosflow://tarefa/<id>`. Sem isto o toque
   * so traria o app para a frente, na tela em que ele estava — e a promessa da
   * ilha e justamente levar direto a tarefa que esta contando.
   */
  useEffect(() => {
    const handle = AppNativo.addListener('appUrlOpen', ({ url }) => {
      const id = url.match(/tarefa\/([0-9a-fA-F-]{36})/)?.[1];
      if (id) abrirTarefa(id);
    });
    return () => void handle.then((h) => h.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Voltar do segundo plano. O iOS congela o JavaScript e pode ate descartar
   * o WebView: o cronometro precisa ser relido do armazenamento, e os dados da
   * tela podem ter mudado enquanto a Live Activity seguia contando sozinha.
   */
  useEffect(() => {
    const handle = AppNativo.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      sessao.restaurar();
      void queryClient.invalidateQueries();
    });
    return () => void handle.then((h) => h.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Abrir o foco, aqui, e comecar a contagem na ilha. */
  const focar = (node: Parameters<typeof sessao.iniciar>[0] | null | undefined) => {
    if (!node) return;
    sessao.iniciar(node);
  };

  return (
    <div
      className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-background text-foreground antialiased"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Em baixo, acima da barra de abas. No topo os avisos cairiam
          justamente sobre o cabecalho da timeline — e, enquanto nao somem,
          engolem o toque nos botoes que estao debaixo deles. */}
      <Toaster richColors position="bottom-center" offset={96} theme={theme} />

      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === 'timeline' && <TimelinePage onOpenWidget={focar} />}
        {tab === 'focus' && (
          <FocusPage onNavigateToTimeline={() => setTab('timeline')} onOpenWidget={focar} />
        )}
        {tab === 'backlog' && <BacklogPage onGoToTimeline={abrirTarefa} />}
        {tab === 'reports' && <ReportsPage />}
        {tab === 'mais' && <MaisPage />}
      </main>

      <BarraDeFoco onAbrir={abrirTarefa} />
      <TabBar tab={tab} onTab={setTab} pendentes={focus?.queue.length ?? 0} />
    </div>
  );
}

/**
 * O banco e do aparelho e abre antes de qualquer tela. Renderizar primeiro e
 * abrir depois faria toda consulta da primeira pintura falhar com "banco nao
 * foi aberto" — e o usuario veria uma tela de erro que some sozinha.
 */
function ComBanco({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<'abrindo' | 'pronto' | string>('abrindo');

  useEffect(() => {
    abrirBanco().then(
      () => setEstado('pronto'),
      (e: Error) => setEstado(e.message || 'Nao foi possivel abrir o banco.'),
    );
  }, []);

  if (estado === 'pronto') return <>{children}</>;

  return (
    <div className="flex h-[100dvh] items-center justify-center bg-background p-8 text-center">
      {estado === 'abrindo' ? (
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      ) : (
        <p className="text-sm text-muted-foreground">{estado}</p>
      )}
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ComBanco>
        {/* O banco do aparelho abre sempre (as preferencias moram nele); a
            porteira decide se os projetos vem dele ou de um servidor. */}
        <Porteira>
          <TooltipProvider delayDuration={200}>
            <Shell />
          </TooltipProvider>
        </Porteira>
      </ComBanco>
    </QueryClientProvider>
  );
}
