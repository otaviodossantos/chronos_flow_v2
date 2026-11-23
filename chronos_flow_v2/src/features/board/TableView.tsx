import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Lock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberDTO, NodeDTO, NodeStatus } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDuration, progressTone } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NewSpaceProjectDialog } from '@/components/NewSpaceProjectDialog';
import { useTimelineStore } from '@/stores/timelineStore';
import { BoardToolbar } from './BoardToolbar';
import { useBoardNodes, useBoardUi } from './useBoardNodes';
import {
  DueField,
  ImportancePicker,
  MemberPicker,
  STATUS_META,
  StatusPicker,
  UpdatesBubble,
  useInvalidateBoard,
  useUpdateNode,
} from './boardShared';

/**
 * Tabela no estilo do Monday: cada meta macro e um grupo colorido, as tarefas
 * sao linhas e as filhas abrem como subitens. Status, responsavel, prazo e
 * criticidade se editam na propria celula.
 *
 * A arvore nao tem limite de niveis, entao "subitem" aqui e recursivo: cada
 * linha com filhas ganha a setinha, em qualquer profundidade.
 */
const GRID = 'minmax(280px,1fr) 44px 160px 140px 170px 90px 110px 160px';
const COLUMNS = ['Tarefa', '', 'Responsavel', 'Status', 'Prazo', 'Estimativa', 'Criticidade', 'Progresso'];

export function TableView() {
  const [newProject, setNewProject] = useState(false);
  const board = useBoardNodes();
  const ui = useBoardUi();
  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: api.members });

  const spaceColor = new Map(spaces.map((s) => [s.id, s.color]));
  const roots = board.byParent.get('__root__') ?? [];
  const select = useTimelineStore((s) => s.select);

  return (
    <div className="flex h-full flex-col">
      <BoardToolbar onNewProject={() => setNewProject(true)}>
        {/* So icone: com texto a barra quebrava em duas linhas na janela padrao do app (1440px). */}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => ui.expandMany(board.visible.filter((n) => !n.isLeaf).map((n) => n.id))}
          title="Expandir todos os subitens"
          aria-label="Expandir todos os subitens"
        >
          <ChevronsUpDown className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={ui.collapseAll}
          title="Recolher os subitens"
          aria-label="Recolher os subitens"
        >
          <ChevronsDownUp className="h-4 w-4" />
        </Button>
      </BoardToolbar>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          <div className="min-w-[1180px] space-y-6 p-4">
            {board.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

            {!board.isLoading && roots.length === 0 && (
              <EmptyState filtering={board.filtering} onNew={() => setNewProject(true)} />
            )}

            {roots.map((root) => (
              <TableGroup
                key={root.id}
                root={root}
                color={(root.space_id && spaceColor.get(root.space_id)) || '#6366F1'}
                members={members}
                board={board}
              />
            ))}
          </div>
        </div>

      </div>

      <NewSpaceProjectDialog
        open={newProject}
        onOpenChange={setNewProject}
        defaultKind="project"
        defaultSpaceId={board.spaceId}
        onCreatedProject={(id) => select(id)}
      />
    </div>
  );
}

type Board = ReturnType<typeof useBoardNodes>;

function TableGroup({
  root,
  color,
  members,
  board,
}: {
  root: NodeDTO;
  color: string;
  members: MemberDTO[];
  board: Board;
}) {
  const ui = useBoardUi();
  const openNode = useTimelineStore((s) => s.openNode);
  const collapsed = ui.collapsedGroups.has(root.id);

  // Linhas visiveis do grupo, ja na ordem da arvore.
  const rows: Array<{ node: NodeDTO; level: number; hasChildren: boolean; open: boolean }> = [];
  const walk = (parentId: string, level: number) => {
    for (const node of board.byParent.get(parentId) ?? []) {
      const hasChildren = (board.byParent.get(node.id)?.length ?? 0) > 0;
      const open = board.forcedOpen.has(node.id) || (ui.expanded.get(node.id) ?? false);
      rows.push({ node, level, hasChildren, open });
      if (hasChildren && open) walk(node.id, level + 1);
    }
  };
  walk(root.id, 0);

  // Resumo do rodape: distribuicao das folhas do grupo por status.
  const leaves: NodeDTO[] = [];
  const collect = (id: string) => {
    const node = board.byId.get(id);
    if (id !== root.id && node?.isLeaf) leaves.push(node);
    (board.byParent.get(id) ?? []).forEach((k) => collect(k.id));
  };
  collect(root.id);
  const directCount = board.byParent.get(root.id)?.length ?? 0;

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => ui.toggleGroup(root.id)}
          className="rounded p-0.5 hover:bg-accent"
          aria-label={collapsed ? 'Abrir grupo' : 'Recolher grupo'}
          style={{ color }}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => openNode(root.id)}
          className="truncate text-[15px] font-semibold hover:underline"
          style={{ color }}
        >
          {root.title}
        </button>
        <span className="text-xs text-muted-foreground">
          {directCount} item(ns) · {leaves.length} tarefa(s)
        </span>
        <span className="font-mono text-xs text-muted-foreground">{Math.round(root.progress)}%</span>
        <UpdatesBubble
          count={root.updates_count ?? 0}
          onClick={() => openNode(root.id, 'updates')}
        />
      </div>

      {!collapsed && (
        <div
          className="overflow-hidden rounded-md border bg-card"
          style={{ borderLeft: `4px solid ${color}` }}
          role="table"
        >
          <div
            role="row"
            className="grid divide-x border-b bg-muted/40 text-[11px] font-medium text-muted-foreground"
            style={{ gridTemplateColumns: GRID }}
          >
            {COLUMNS.map((c, i) => (
              <div key={i} role="columnheader" className={cn('px-2 py-1.5', i > 0 && 'text-center')}>
                {c}
              </div>
            ))}
          </div>

          {rows.map((r) => (
            <TableRow key={r.node.id} {...r} members={members} board={board} />
          ))}

          <AddRow parentId={root.id} />

          <div
            className="grid divide-x border-t bg-muted/20 text-[11px]"
            style={{ gridTemplateColumns: GRID }}
          >
            <div className="col-span-3 px-2 py-1.5 text-muted-foreground" />
            <div className="flex items-center px-2 py-1.5">
              <StatusBar leaves={leaves} />
            </div>
            <div className="col-span-3" />
            <div className="flex items-center gap-2 px-2">
              <Progress value={root.progress} tone={progressTone(root.progress)} />
              <span className="w-9 shrink-0 text-right font-mono text-muted-foreground">
                {Math.round(root.progress)}%
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function TableRow({
  node,
  level,
  hasChildren,
  open,
  members,
  board,
}: {
  node: NodeDTO;
  level: number;
  hasChildren: boolean;
  open: boolean;
  members: MemberDTO[];
  board: Board;
}) {
  const selectedId = useTimelineStore((s) => s.selectedId);
  const openNode = useTimelineStore((s) => s.openNode);
  const setExpanded = useBoardUi((s) => s.setExpanded);
  const update = useUpdateNode();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(node.title);

  const done = node.status === 'COMPLETED' || node.status === 'CANCELLED';
  const kids = board.byParent.get(node.id) ?? [];
  const kidsDone = kids.filter((k) => k.status === 'COMPLETED').length;
  const dim = board.filtering && !board.matched.has(node.id);

  const saveTitle = () => {
    setEditing(false);
    const t = title.trim();
    if (t && t !== node.title) update.mutate({ id: node.id, body: { title: t } });
    else setTitle(node.title);
  };

  return (
    <div
      role="row"
      onClick={() => openNode(node.id)}
      className={cn(
        'group grid h-9 cursor-pointer divide-x border-b text-sm transition-colors last:border-b-0 hover:bg-accent/50',
        selectedId === node.id && 'bg-accent',
        dim && 'opacity-60',
      )}
      style={{ gridTemplateColumns: GRID }}
    >
      <div className="flex min-w-0 items-center gap-1 pr-2" style={{ paddingLeft: 8 + level * 20 }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(node.id, !open);
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={open ? 'Recolher subitens' : 'Abrir subitens'}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-[18px] shrink-0" />
        )}

        {editing ? (
          <input
            autoFocus
            value={title}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') {
                setTitle(node.title);
                setEditing(false);
              }
            }}
            className="h-7 min-w-0 flex-1 rounded border bg-background px-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              setTitle(node.title);
              setEditing(true);
            }}
            title="Clique para abrir · duplo clique para renomear"
            className={cn(
              'min-w-0 truncate',
              done && 'text-muted-foreground line-through',
              hasChildren && 'font-medium',
            )}
          >
            {node.title}
          </span>
        )}

        {hasChildren && !editing && (
          <span className="shrink-0 rounded bg-secondary px-1 font-mono text-[10px] text-muted-foreground">
            {kidsDone}/{kids.length}
          </span>
        )}
        {node.status === 'BLOCKED' && (
          <Lock className="h-3 w-3 shrink-0 text-[hsl(var(--status-critical))]" aria-label="Bloqueada" />
        )}
      </div>

      <div className="flex items-center justify-center">
        <UpdatesBubble count={node.updates_count ?? 0} onClick={() => openNode(node.id, 'updates')} />
      </div>
      <div className="min-w-0">
        <MemberPicker node={node} members={members} />
      </div>
      <div className="p-0">
        <StatusPicker node={node} />
      </div>
      <div className="min-w-0">
        <DueField node={node} />
      </div>
      <div className="flex items-center justify-center text-xs text-muted-foreground">
        {formatDuration(node.estimated_minutes)}
      </div>
      <div>
        <ImportancePicker node={node} />
      </div>
      <div className="flex items-center gap-2 px-2">
        <Progress value={node.progress} tone={progressTone(node.progress)} />
        <span className="w-9 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
          {Math.round(node.progress)}%
        </span>
      </div>
    </div>
  );
}

/** "+ Adicionar tarefa" no pe do grupo, como no Monday: cria filha direta da meta. */
function AddRow({ parentId }: { parentId: string }) {
  const [title, setTitle] = useState('');
  const invalidate = useInvalidateBoard();
  const create = useMutation({
    mutationFn: (t: string) => api.createNode({ title: t, parent_id: parentId }),
    onSuccess: () => {
      setTitle('');
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) create.mutate(title.trim());
      }}
      className="flex h-9 items-center gap-1.5 border-t px-2"
    >
      <Plus className="ml-[22px] h-3.5 w-3.5 text-muted-foreground" />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Adicionar tarefa e pressionar Enter"
        disabled={create.isPending}
        className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
      />
    </form>
  );
}

const BAR_ORDER: NodeStatus[] = ['COMPLETED', 'IN_PROGRESS', 'BLOCKED', 'PENDING', 'CANCELLED'];

/** Barra de distribuicao por status, o resumo que o Monday poe no pe da coluna. */
function StatusBar({ leaves }: { leaves: NodeDTO[] }) {
  if (leaves.length === 0) return <span className="mx-auto text-muted-foreground/50">—</span>;
  const counts = BAR_ORDER.map((s) => ({
    s,
    n: leaves.filter((l) => l.status === s).length,
  })).filter((c) => c.n > 0);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex h-4 w-full overflow-hidden rounded-sm">
          {counts.map((c) => (
            <div
              key={c.s}
              className={STATUS_META[c.s].dot}
              style={{ width: `${(c.n / leaves.length) * 100}%` }}
            />
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {counts.map((c) => `${STATUS_META[c.s].label}: ${c.n}`).join(' · ')}
      </TooltipContent>
    </Tooltip>
  );
}

function EmptyState({ filtering, onNew }: { filtering: boolean; onNew: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <p className="text-sm font-medium">
        {filtering ? 'Nada casa com o filtro.' : 'Nenhuma meta macro ainda.'}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {filtering
          ? 'Mude a busca, o responsavel ou mostre "Tudo".'
          : 'Cada meta vira um grupo desta tabela, com as tarefas como linhas.'}
      </p>
      {!filtering && (
        <Button size="sm" className="mt-4" onClick={onNew}>
          <Plus className="h-3.5 w-3.5" />
          Nova meta macro
        </Button>
      )}
    </div>
  );
}
