import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronRight, CircleDot, CheckCircle2, Ban, Users, GripVertical, ChevronsRight,
} from 'lucide-react';
import type { NodeDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { levelLabel, progressTone, TONE_TEXT } from '@/lib/format';
import { ROW_HEIGHT, useTimelineStore } from '@/stores/timelineStore';
import type { FlatRow } from './useVisibleNodes';
import type { useTreeDrag } from './useTreeDrag';

interface Props {
  rows: FlatRow[];
  drag: ReturnType<typeof useTreeDrag>;
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: (top: number) => void;
}

const StatusIcon = ({ node }: { node: NodeDTO }) => {
  if (node.status === 'COMPLETED')
    return <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--status-good))]" />;
  if (node.status === 'BLOCKED')
    return <Ban className="h-3.5 w-3.5 text-[hsl(var(--status-critical))]" />;
  if (node.status === 'IN_PROGRESS')
    return <CircleDot className="h-3.5 w-3.5 text-[hsl(var(--status-warning))]" />;
  return <CircleDot className="h-3.5 w-3.5 text-muted-foreground/40" />;
};

export function TreePane({ rows, drag, scrollRef, onScroll }: Props) {
  const { selectedId, select, setExpanded } = useTimelineStore();
  const queryClient = useQueryClient();
  /** Id da linha em edicao. Uma so por vez, como em qualquer gerenciador. */
  const [renomeando, setRenomeando] = useState<string | null>(null);

  const renomear = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.updateNode(id, { title }),
    onSuccess: (node) => {
      queryClient.invalidateQueries({ queryKey: ['tree'] });
      queryClient.invalidateQueries({ queryKey: ['node', node.id] });
      queryClient.invalidateQueries({ queryKey: ['focus'] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  // F2 renomeia a linha selecionada, como no gerenciador de arquivos. Ignora
  // quando o foco esta num campo: F2 dentro de um input nao e para a arvore.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2' || !selectedId) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      e.preventDefault();
      setRenomeando(selectedId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  return (
    <div className="flex w-[380px] shrink-0 flex-col border-r">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Estrutura de metas
        </span>
        <span className="text-[11px] text-muted-foreground">
          {drag.active ? 'Solte no meio para aninhar' : `${rows.length} visiveis`}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => onScroll(e.currentTarget.scrollTop)}
        onDragOver={(e) => drag.autoScroll(scrollRef.current, e.clientY)}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div style={{ height: rows.length * ROW_HEIGHT }} className="relative">
          {rows.map((row, i) => {
            const { node } = row;
            const tone = progressTone(node.progress);
            const isSelected = selectedId === node.id;

            const drop = drag.target?.id === node.id ? drag.target.where : null;

            return (
              <div
                key={node.id}
                role="button"
                tabIndex={0}
                draggable={renomeando !== node.id}
                onDragStart={(e) => drag.onDragStart(node, e)}
                onDragOver={(e) => drag.onDragOverRow(row, e)}
                onDrop={drag.onDrop}
                onDragEnd={drag.onDragEnd}
                onClick={() => select(node.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenomeando(node.id);
                }}
                onKeyDown={(e) => e.key === 'Enter' && select(node.id)}
                className={cn(
                  'group absolute left-0 flex w-full cursor-pointer items-center gap-1.5 pr-3 text-sm',
                  'border-l-2 hover:bg-accent/50',
                  isSelected ? 'border-l-primary bg-accent' : 'border-l-transparent',
                  drag.draggingId === node.id && 'opacity-40',
                  drop === 'inside' && 'bg-primary/15 ring-1 ring-inset ring-primary',
                )}
                style={{
                  top: i * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  paddingLeft: 8 + (row.indent ?? node.depth) * 14,
                }}
              >
                {(drop === 'before' || drop === 'after') && (
                  <span
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute left-0 right-0 h-0.5 bg-primary',
                      drop === 'before' ? 'top-0' : 'bottom-0',
                    )}
                    style={{ marginLeft: 8 + node.depth * 14 }}
                  />
                )}

                <GripVertical
                  className={cn(
                    'pointer-events-none absolute left-0.5 h-3.5 w-3.5 text-muted-foreground/50',
                    'opacity-0 transition-opacity group-hover:opacity-100',
                  )}
                />
                {row.indent === undefined ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded(node.id, !row.isExpanded);
                    }}
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded transition-transform hover:bg-secondary',
                      !row.hasChildren && 'invisible',
                      row.isExpanded && 'rotate-90',
                    )}
                    aria-label={row.isExpanded ? 'Recolher' : 'Expandir'}
                  >
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                ) : (
                  <ChevronsRight
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-muted-foreground',
                      !row.isGroup && 'invisible',
                    )}
                  />
                )}

                <StatusIcon node={node} />

                {renomeando === node.id ? (
                  <CampoNome
                    valor={node.title}
                    salvando={renomear.isPending}
                    onCancelar={() => setRenomeando(null)}
                    onSalvar={(title) => {
                      setRenomeando(null);
                      if (title && title !== node.title) renomear.mutate({ id: node.id, title });
                    }}
                  />
                ) : (
                  <span
                    className={cn(
                      'flex min-w-0 flex-1 flex-col justify-center leading-tight',
                      (node.depth === 0 || row.isGroup) && 'font-semibold',
                      node.status === 'COMPLETED' && 'text-muted-foreground line-through',
                    )}
                    title={
                      (row.crumbs?.length ? `${row.crumbs.join(' › ')} › ` : '') +
                      `${node.title}\nClique duplo ou F2 para renomear`
                    }
                  >
                    {/*
                      Os niveis intermediarios somem como linha, nao como
                      informacao: voltam aqui, em cinza, numa linha propria.
                      Lado a lado, o rastro comia a largura e o nome do grupo
                      chegava a sobrar uma letra so.
                    */}
                    {row.crumbs && row.crumbs.length > 0 && (
                      <span className="truncate text-[9px] font-normal uppercase tracking-wide text-muted-foreground">
                        {row.crumbs.join(' › ')}
                      </span>
                    )}
                    <span className="truncate">{node.title}</span>
                  </span>
                )}

                {node.assignee && (
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                    style={{ backgroundColor: node.assignee.color }}
                    title={node.assignee.name}
                  >
                    {node.assignee.name.slice(0, 1)}
                  </span>
                )}

                <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                  {levelLabel(node.depth)}
                </span>

                <span
                  className={cn('w-10 shrink-0 text-right font-mono text-[11px]', TONE_TEXT[tone])}
                >
                  {Math.round(node.progress)}%
                </span>
              </div>
            );
          })}

          {rows.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <Users className="h-6 w-6 opacity-40" />
              Nenhuma meta encontrada com os filtros atuais.
            </div>
          )}
        </div>
      </div>

      {/*
        Faixa de raiz: soltar aqui tira a tarefa de qualquer pai e a promove a
        meta macro. Fica no rodape do painel, nao no fim da lista: numa arvore
        longa o fim da lista esta fora da tela justamente quando se arrasta.
      */}
      {drag.active && (
        <div
          onDragOver={drag.onDragOverRoot}
          onDrop={drag.onDrop}
          className={cn(
            'm-2 flex h-9 shrink-0 items-center justify-center rounded-md border border-dashed text-[11px] transition-colors',
            drag.target?.id === null
              ? 'border-primary bg-primary/15 text-foreground'
              : 'border-border text-muted-foreground',
          )}
        >
          Soltar aqui para virar meta macro
        </div>
      )}
    </div>
  );
}

/**
 * Campo de renomear na propria linha. Selecionar o texto inteiro ao abrir e o
 * que faz "renomear" valer a pena: quase sempre o nome antigo e descartado,
 * e sem isso o primeiro gesto seria apagar.
 */
function CampoNome({
  valor,
  salvando,
  onSalvar,
  onCancelar,
}: {
  valor: string;
  salvando: boolean;
  onSalvar: (title: string) => void;
  onCancelar: () => void;
}) {
  const [rascunho, setRascunho] = useState(valor);
  const ref = useRef<HTMLInputElement>(null);
  /** Esc precisa impedir o salvamento que o blur dispararia logo depois. */
  const cancelado = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={rascunho}
      disabled={salvando}
      aria-label="Novo nome da tarefa"
      onChange={(e) => setRascunho(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => {
        if (cancelado.current) return;
        onSalvar(rascunho.trim());
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          onSalvar(rascunho.trim());
        } else if (e.key === 'Escape') {
          cancelado.current = true;
          onCancelar();
        }
      }}
      className="h-6 min-w-0 flex-1 rounded border border-primary bg-background px-1.5 text-sm outline-none"
    />
  );
}
