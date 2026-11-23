import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Clock, Lock } from 'lucide-react';
import type { NodeDTO, NodeStatus } from '@shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDuration, formatShortDate } from '@/lib/format';
import { NewSpaceProjectDialog } from '@/components/NewSpaceProjectDialog';
import { useTimelineStore } from '@/stores/timelineStore';
import { DetailPane } from '@/features/timeline/DetailPane';
import { BoardToolbar } from './BoardToolbar';
import { boardQueryKey, useBoardNodes } from './useBoardNodes';
import {
  Avatar,
  IMPORTANCE_META,
  STATUS_META,
  UpdatesBubble,
  deadlineTone,
  useSetStatus,
  type SettableStatus,
} from './boardShared';

/**
 * Kanban das tarefas que se executam de fato: as folhas. Um no com filhas nao
 * vira cartao porque o status dele nao e trabalho — e o resumo das filhas, e
 * arrasta-lo para "Concluida" seria pular a cascata.
 *
 * Arrastar entre colunas troca o status pelo mesmo endpoint que o MCP usa.
 * Nao ha ordem manual dentro da coluna: os cartoes saem por prazo e depois
 * criticidade, que e a pergunta que um quadro precisa responder.
 */

/** Concluidas ha mais de uma semana saem da coluna no modo "Em aberto". */
const DONE_WINDOW_DAYS = 7;
const DRAG_TYPE = 'application/x-chronos-node';

export function KanbanView({ onOpenWidget }: { onOpenWidget: (node?: NodeDTO | null) => void }) {
  const selectedId = useTimelineStore((s) => s.selectedId);
  const select = useTimelineStore((s) => s.select);
  const conclusao = useTimelineStore((s) => s.conclusao);
  const setConclusao = useTimelineStore((s) => s.setConclusao);
  const [newProject, setNewProject] = useState(false);
  const [dragging, setDragging] = useState<NodeDTO | null>(null);
  const [over, setOver] = useState<NodeStatus | null>(null);

  const board = useBoardNodes();
  const queryClient = useQueryClient();
  const setStatus = useSetStatus();
  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });
  const spaceColor = new Map(spaces.map((s) => [s.id, s.color]));

  // A coluna de concluidas precisa existir mesmo no modo "Em aberto" — e o
  // destino do arraste. Por isso o corte de concluidas aqui e por data, e a
  // lista de partida e a arvore inteira, nao a que ja escondeu o que fechou.
  const source = conclusao === 'tudo' ? board.visible : leavesWithRecentDone(board);
  const leaves = source.filter((n) => n.isLeaf);

  const columns: NodeStatus[] =
    conclusao === 'tudo'
      ? ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']
      : ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED'];

  const hiddenDone =
    conclusao === 'tudo'
      ? 0
      : board.all.filter((n) => n.isLeaf && n.status === 'COMPLETED' && board.matches(n)).length -
        leaves.filter((n) => n.status === 'COMPLETED').length;

  const drop = (status: NodeStatus) => {
    const node = dragging;
    setDragging(null);
    setOver(null);
    if (!node || status === node.status || status === 'BLOCKED') return;

    // Otimista: o cartao muda de coluna na hora. Se o servidor recusar (pai com
    // filha aberta, dependencia pendente), a invalidacao do erro o devolve.
    queryClient.setQueryData<NodeDTO[]>(boardQueryKey(board.spaceId), (old) =>
      old?.map((n) => (n.id === node.id ? { ...n, status } : n)),
    );
    setStatus.mutate({ id: node.id, status: status as SettableStatus });
  };

  return (
    <div className="flex h-full flex-col">
      <BoardToolbar onNewProject={() => setNewProject(true)} />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto p-4">
          {columns.map((status) => {
            const cards = sortCards(leaves.filter((n) => n.status === status));
            const accepts = dragging && status !== 'BLOCKED' && status !== dragging.status;
            const meta = STATUS_META[status];
            const minutos = cards.reduce((s, c) => s + (c.estimated_minutes ?? 0), 0);

            return (
              <section
                key={status}
                onDragOver={(e) => {
                  if (!accepts) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setOver(status);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(status);
                }}
                className={cn(
                  'flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30 transition-colors',
                  over === status && 'border-foreground/40 bg-accent',
                  dragging && status === 'BLOCKED' && 'opacity-60',
                )}
              >
                <header className="flex items-center gap-2 border-b px-3 py-2">
                  <span className={cn('h-2.5 w-2.5 rounded-full', meta.dot)} />
                  <span className="text-sm font-medium">{meta.column}</span>
                  <span className="rounded bg-secondary px-1.5 font-mono text-[10px] text-muted-foreground">
                    {cards.length}
                  </span>
                  {status === 'BLOCKED' && (
                    <span
                      className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground"
                      title="Uma tarefa entra e sai daqui sozinha, conforme as dependencias dela"
                    >
                      <Lock className="h-3 w-3" />
                      automatico
                    </span>
                  )}
                  {status !== 'BLOCKED' && minutos > 0 && (
                    <span
                      className="ml-auto text-[10px] text-muted-foreground"
                      title="Soma das estimativas da coluna"
                    >
                      {formatDuration(minutos)}
                    </span>
                  )}
                </header>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                  {cards.map((node) => (
                    <KanbanCard
                      key={node.id}
                      node={node}
                      crumbs={board.crumbs(node)}
                      color={(node.space_id && spaceColor.get(node.space_id)) || '#6366F1'}
                      selected={selectedId === node.id}
                      onDragStart={() => setDragging(node)}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    />
                  ))}

                  {cards.length === 0 && (
                    <div className="rounded-md border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground">
                      {status === 'BLOCKED'
                        ? 'Nada travado por dependencia.'
                        : dragging
                          ? 'Solte aqui'
                          : 'Vazio'}
                    </div>
                  )}

                  {status === 'COMPLETED' && hiddenDone > 0 && (
                    <button
                      type="button"
                      onClick={() => setConclusao('tudo')}
                      className="w-full py-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                    >
                      +{hiddenDone} concluida(s) ha mais de {DONE_WINDOW_DAYS} dias
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {selectedId && <DetailPane nodeId={selectedId} onOpenWidget={onOpenWidget} />}
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

function KanbanCard({
  node,
  crumbs,
  color,
  selected,
  onDragStart,
  onDragEnd,
}: {
  node: NodeDTO;
  crumbs: string[];
  color: string;
  selected: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const openNode = useTimelineStore((s) => s.openNode);
  const done = node.status === 'COMPLETED' || node.status === 'CANCELLED';
  const importance = IMPORTANCE_META[node.importance];

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, node.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => openNode(node.id)}
      className={cn(
        'cursor-grab rounded-md border bg-card p-2.5 shadow-sm transition-colors hover:border-foreground/30 active:cursor-grabbing',
        selected && 'ring-2 ring-ring',
      )}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      {crumbs.length > 0 && (
        <div className="mb-1 truncate text-[10px] text-muted-foreground" title={crumbs.join(' › ')}>
          {crumbs.join(' › ')}
        </div>
      )}
      <div className={cn('text-sm font-medium leading-snug', done && 'text-muted-foreground line-through')}>
        {node.title}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px]">
        {node.assignee && <Avatar member={node.assignee} size={18} />}
        {node.due_date && (
          <span className={cn('flex items-center gap-1', deadlineTone(node))}>
            <CalendarDays className="h-3 w-3" />
            {formatShortDate(node.due_date)}
          </span>
        )}
        {node.estimated_minutes && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatDuration(node.estimated_minutes)}
          </span>
        )}
        {node.importance >= 4 && importance && (
          <span className={cn('rounded px-1 text-[9px] font-semibold', importance.pill)}>
            {importance.label}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {node.status === 'BLOCKED' && (
            <Lock className="h-3 w-3 text-[hsl(var(--status-critical))]" aria-label="Bloqueada" />
          )}
          <UpdatesBubble
            count={node.updates_count ?? 0}
            onClick={() => openNode(node.id, 'updates')}
          />
        </span>
      </div>
    </article>
  );
}

type Board = ReturnType<typeof useBoardNodes>;

/**
 * No modo "Em aberto": tudo o que esta aberto mais o que fechou na ultima
 * semana. Respeita a busca e o responsavel da mesma forma que o resto.
 */
function leavesWithRecentDone(board: Board): NodeDTO[] {
  const limite = Date.now() - DONE_WINDOW_DAYS * 86_400_000;
  const visiveis = new Set(board.visible.map((n) => n.id));
  return board.all.filter((n) => {
    if (n.status === 'COMPLETED') {
      const recente = n.completed_at && new Date(n.completed_at).getTime() >= limite;
      return recente && board.matches(n);
    }
    if (n.status === 'CANCELLED') return false;
    return visiveis.has(n.id);
  });
}

/** Prazo mais proximo primeiro (sem prazo no fim), depois o mais critico. */
function sortCards(cards: NodeDTO[]): NodeDTO[] {
  return [...cards].sort((a, b) => {
    const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    if (da !== db) return da - db;
    if (a.importance !== b.importance) return b.importance - a.importance;
    return a.title.localeCompare(b.title);
  });
}
