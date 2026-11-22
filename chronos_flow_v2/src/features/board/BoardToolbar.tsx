import { useQuery } from '@tanstack/react-query';
import { CircleDashed, GanttChartSquare, History, KanbanSquare, Plus, Table2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useTimelineStore } from '@/stores/timelineStore';
import { useUiStore, type ProjectView } from '@/stores/uiStore';

const VIEWS: Array<{ id: ProjectView; label: string; icon: React.ReactNode }> = [
  { id: 'timeline', label: 'Timeline', icon: <GanttChartSquare className="h-3.5 w-3.5" /> },
  { id: 'table', label: 'Tabela', icon: <Table2 className="h-3.5 w-3.5" /> },
  { id: 'kanban', label: 'Kanban', icon: <KanbanSquare className="h-3.5 w-3.5" /> },
];

/** As tres visoes leem a mesma arvore; trocar de visao nao perde filtro nem selecao. */
export function ViewSwitcher() {
  const { projectView, setProjectView } = useUiStore();
  return (
    <div className="flex rounded-lg border p-0.5" role="tablist" aria-label="Visao">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={projectView === v.id}
          onClick={() => setProjectView(v.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            projectView === v.id
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {v.icon}
          {v.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Cabecalho da Tabela e do Kanban. Os filtros moram no mesmo store da
 * timeline, entao valem para as tres visoes ao mesmo tempo.
 */
export function BoardToolbar({
  children,
  onNewProject,
}: {
  /** Controles proprios da visao, entre o seletor e os filtros. */
  children?: React.ReactNode;
  onNewProject: () => void;
}) {
  const store = useTimelineStore();
  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: api.members });

  return (
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <ViewSwitcher />

      <div className="flex rounded-lg border p-0.5">
        {([
          { id: 'abertas' as const, label: 'Em aberto', icon: <CircleDashed className="h-3.5 w-3.5" /> },
          { id: 'tudo' as const, label: 'Tudo', icon: <History className="h-3.5 w-3.5" /> },
        ]).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => store.setConclusao(f.id)}
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

      {children}

      <div className="ml-auto flex items-center gap-2">
        <Input
          value={store.search}
          onChange={(e) => store.setSearch(e.target.value)}
          placeholder="Buscar tarefas..."
          className="h-8 w-44 text-xs"
        />
        <Select value={store.spaceId ?? ''} onChange={(e) => store.setSpace(e.target.value || null)}>
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
        <Button size="sm" onClick={onNewProject}>
          <Plus className="h-3.5 w-3.5" />
          Nova meta macro
        </Button>
      </div>
    </header>
  );
}
