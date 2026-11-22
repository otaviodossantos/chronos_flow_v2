import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Plus, Link2, Layers, Repeat2, ListTree, Rows3,
  CircleDashed, History,
} from 'lucide-react';
import { toast } from 'sonner';
import type { NodeDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTimelineStore, ZOOM_LABEL, PAN_MINUTES, type ZoomLevel } from '@/stores/timelineStore';
import { useTimeScale } from './useTimeScale';
import { useVisibleNodes } from './useVisibleNodes';
import { TreePane } from './TreePane';
import { TimeCanvas } from './TimeCanvas';
import { TimeRuler } from './TimeRuler';
import { DetailPane } from './DetailPane';
import { NewSpaceProjectDialog } from '@/components/NewSpaceProjectDialog';
import { TemplatePalette } from './TemplatePalette';
import { useTreeDrag } from './useTreeDrag';
import { ViewSwitcher } from '@/features/board/BoardToolbar';

const ZOOMS: ZoomLevel[] = ['quarters', 'months', 'weeks', 'days', 'hours'];

export function TimelinePage({
  onOpenWidget,
}: {
  onOpenWidget: (node?: NodeDTO | null) => void;
}) {
  const store = useTimelineStore();
  const queryClient = useQueryClient();
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [newProject, setNewProject] = useState(false);

  const scale = useTimeScale(store.zoom, store.viewportStart);

  const { data: nodes = [], isLoading } = useQuery({
    queryKey: [
      'tree',
      store.spaceId,
      store.assigneeId,
      store.maxDepth,
      store.viewMode,
      store.statusFilter.join(','),
      store.search,
    ],
    queryFn: () =>
      api.tree({
        spaceId: store.spaceId ?? undefined,
        assigneeId: store.assigneeId ?? undefined,
        // No modo compacto a arvore inteira precisa vir: as folhas podem estar
        // mais fundo do que a profundidade escolhida para a visao em arvore.
        maxDepth: store.viewMode === 'compact' ? 12 : Math.max(store.maxDepth, 5),
        status: store.statusFilter.join(',') || undefined,
        search: store.search || undefined,
      }),
  });

  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: api.members });

  const rows = useVisibleNodes(
    nodes,
    store.overrides,
    store.maxDepth,
    store.viewMode,
    store.conclusao,
  );
  // Quantos nos o filtro tirou da frente: sem isso, uma timeline vazia por ter
  // tudo concluido seria indistinguivel de uma timeline vazia por engano.
  const ocultos = store.conclusao === 'abertas' ? nodes.length - rows.length : 0;
  // Um unico estado de arraste para os dois paineis: a arvore desenha o alvo
  // e o canvas desenha a data, mas e o mesmo gesto.
  const drag = useTreeDrag(rows);

  // Arvore e canvas compartilham altura de linha e indice, entao basta espelhar o scroll.
  const syncScroll = useCallback((source: 'tree' | 'canvas', top: number) => {
    if (syncing.current) return;
    syncing.current = true;
    const target = source === 'tree' ? canvasScrollRef.current : treeScrollRef.current;
    if (target) target.scrollTop = top;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);

  const reschedule = useMutation({
    mutationFn: ({
      id,
      start,
      due,
      cascade = true,
    }: {
      id: string;
      start: string | null;
      due: string | null;
      cascade?: boolean;
    }) => api.reschedule(id, { start_date: start, due_date: due, cascadeChildren: cascade }),
    onSuccess: (res) => {
      const moved = res.plan.affected.length;
      // Encolher e mover sao gestos diferentes e o aviso precisa dizer qual foi:
      // "3 subtarefas movidas" depois de reduzir a janela esconde a compressao.
      const encolheu = Math.abs(res.plan.scale - 1) > 0.001;
      const pct = Math.round(res.plan.scale * 100);

      if (res.clampedToChildren) {
        toast.warning('Parou no limite: a janela nao pode cortar a ultima filha.');
      } else {
        toast.success(
          moved === 0
            ? 'Datas ajustadas.'
            : encolheu
              ? `Janela em ${pct}%. ${moved} subtarefa(s) redimensionada(s) na mesma proporcao.`
              : `Datas ajustadas. ${moved} subtarefa(s) movida(s) junto.`,
          {
            description: [
              res.grew?.length
                ? `${res.grew.map((g) => `"${g.title}"`).join(', ')} ${
                    res.grew.length > 1 ? 'cresceram' : 'cresceu'
                  } para caber.`
                : null,
              // Agora que o aviso e raro, ele tem de dizer o que aconteceu:
              // um numero sozinho nao da para agir.
              res.plan.violations.length > 0
                ? `Conflito em "${res.plan.violations[0].title}": ${
                    res.plan.violations[0].violations[0].message
                  }${
                    res.plan.violations.length > 1
                      ? ` (e mais ${res.plan.violations.length - 1})`
                      : ''
                  }`
                : null,
            ]
              .filter(Boolean)
              .join(' ') || undefined,
          },
        );
      }

      // O painel de detalhe tambem mostra estas datas: sem invalidar o no, ele
      // continuava exibindo o prazo antigo depois de arrastar a barra.
      queryClient.invalidateQueries({ queryKey: ['tree'] });
      queryClient.invalidateQueries({ queryKey: ['node'] });
      queryClient.invalidateQueries({ queryKey: ['focus'] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <ViewSwitcher />

        <div className="flex rounded-lg border p-0.5">
          {ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => store.setZoom(z)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                store.zoom === z
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {ZOOM_LABEL[z]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => store.panMinutes(-PAN_MINUTES[store.zoom])}
            aria-label="Voltar"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="xs" onClick={store.goToNow}>
            Hoje
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => store.panMinutes(PAN_MINUTES[store.zoom])}
            aria-label="Avancar"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="ml-2 flex items-center gap-1.5">
          <div className="flex rounded-lg border p-0.5">
            {([
              { id: 'tree' as const, label: 'Arvore', icon: <ListTree className="h-3.5 w-3.5" /> },
              { id: 'compact' as const, label: 'Folhas', icon: <Rows3 className="h-3.5 w-3.5" /> },
            ]).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => store.setViewMode(m.id)}
                title={
                  m.id === 'compact'
                    ? 'So as tarefas sem filhas, agrupadas pela tarefa-mae'
                    : 'Hierarquia inteira'
                }
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  store.viewMode === m.id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex rounded-lg border p-0.5">
            {([
              {
                id: 'abertas' as const,
                label: 'Em aberto',
                icon: <CircleDashed className="h-3.5 w-3.5" />,
                title: 'Esconde os blocos em que tudo ja foi concluido',
              },
              {
                id: 'tudo' as const,
                label: 'Tudo',
                icon: <History className="h-3.5 w-3.5" />,
                title: 'Mostra tambem o que ja foi concluido',
              },
            ]).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => store.setConclusao(f.id)}
                title={f.title}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  store.conclusao === f.id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {f.icon}
                {f.label}
              </button>
            ))}
          </div>

          {ocultos > 0 && (
            <button
              type="button"
              onClick={() => store.setConclusao('tudo')}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              {ocultos} concluida(s) fora da vista
            </button>
          )}

          {/* Profundidade descreve a arvore; no modo compacto nao ha o que ela controle. */}
          {store.viewMode === 'tree' && (
            <>
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Profundidade</span>
              {[0, 1, 2, 3, 5].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => store.setMaxDepth(d)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors',
                    store.maxDepth === d
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {d === 0 ? 'N0' : d === 5 ? 'Tudo' : `N${d}`}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Input
            value={store.search}
            onChange={(e) => store.setSearch(e.target.value)}
            placeholder="Buscar tarefas..."
            className="h-8 w-44 text-xs"
          />
          <Select
            value={store.spaceId ?? ''}
            onChange={(e) => store.setSpace(e.target.value || null)}
          >
            <option value="">Todos os espacos</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select
            value={store.assigneeId ?? ''}
            onChange={(e) => store.setAssignee(e.target.value || null)}
          >
            <option value="">Todos</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          {/* Com so o icone, ninguem adivinha o que este interruptor faz — e um
              chaveiro de corrente cabe em meia duzia de significados. */}
          <label
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
            title="Desenha as linhas entre as tarefas que dependem umas das outras"
          >
            <Link2 className="h-3.5 w-3.5" />
            Dependencias
            <Switch
              aria-label="Mostrar as linhas de dependencia"
              checked={store.showDependencies}
              onCheckedChange={store.toggleDependencies}
            />
          </label>
          <Button
            size="sm"
            variant={store.paletteOpen ? 'secondary' : 'outline'}
            onClick={store.togglePalette}
            title="Modelos de tarefa do espaco"
          >
            <Repeat2 className="h-3.5 w-3.5" />
            Modelos
          </Button>
          <Button size="sm" onClick={() => setNewProject(true)}>
            <Plus className="h-3.5 w-3.5" />
            Nova meta macro
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <TemplatePalette />

        <TreePane
          rows={rows}
          drag={drag}
          scrollRef={treeScrollRef}
          onScroll={(top) => syncScroll('tree', top)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <TimeRuler scale={scale} scrollLeft={scrollLeft} />
          <div
            className="flex min-h-0 flex-1"
            onScrollCapture={(e) => setScrollLeft((e.target as HTMLElement).scrollLeft ?? 0)}
          >
            <TimeCanvas
              rows={rows}
              scale={scale}
              scrollRef={canvasScrollRef}
              onScroll={(top) => syncScroll('canvas', top)}
              drag={drag}
              onReschedule={(id, start, due, cascade) =>
                reschedule.mutate({ id, start, due, cascade })
              }
            />
          </div>
          <footer className="flex shrink-0 items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground">
            <span>
              <strong className="text-foreground">{nodes.length}</strong> nos carregados
            </span>
            <span>
              <strong className="text-foreground">{rows.length}</strong> visiveis
            </span>
            <span className="ml-auto flex items-center gap-3">
              <span className="hidden items-center gap-1 lg:flex">
                <kbd className="rounded border px-1 font-mono text-[10px]">Alt</kbd>
                ligar dependencia
                <span className="opacity-40">·</span>
                <kbd className="rounded border px-1 font-mono text-[10px]">Shift</kbd>
                redimensionar sem as filhas
              </span>
              {isLoading ? 'Carregando...' : 'Progresso bottom-up automatizado'}
            </span>
          </footer>
        </div>

        {store.selectedId && (
          <DetailPane nodeId={store.selectedId} onOpenWidget={onOpenWidget} />
        )}
      </div>

      <NewSpaceProjectDialog
        open={newProject}
        onOpenChange={setNewProject}
        defaultKind="project"
        defaultSpaceId={store.spaceId}
        onCreatedProject={(id) => store.select(id)}
      />
    </div>
  );
}
