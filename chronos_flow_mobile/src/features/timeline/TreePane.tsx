import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronRight, CircleDot, CheckCircle2, Ban, Users, ChevronsRight, CornerUpLeft, X,
} from 'lucide-react';
import type { NodeDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { progressTone, TONE_TEXT } from '@/lib/format';
import { ROW_HEIGHT, useTimelineStore } from '@/stores/timelineStore';
import { sistema } from '@/native/chronos';
import type { FlatRow } from './useVisibleNodes';
import { useMover, podeReceber } from './moverPorToque';

interface Props {
  rows: FlatRow[];
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: (top: number) => void;
  /** Largura do painel. A timeline a encolhe no retrato. */
  largura: number;
}

/** Quanto tempo o dedo precisa ficar parado para "pegar" a tarefa. */
const PRESSAO_MS = 450;

const StatusIcon = ({ node }: { node: NodeDTO }) => {
  if (node.status === 'COMPLETED')
    return <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--status-good))]" />;
  if (node.status === 'BLOCKED')
    return <Ban className="h-3.5 w-3.5 text-[hsl(var(--status-critical))]" />;
  if (node.status === 'IN_PROGRESS')
    return <CircleDot className="h-3.5 w-3.5 text-[hsl(var(--status-warning))]" />;
  return <CircleDot className="h-3.5 w-3.5 text-muted-foreground/40" />;
};

export function TreePane({ rows, scrollRef, onScroll, largura }: Props) {
  const { marcadoId, marcar, select, setExpanded } = useTimelineStore();
  const queryClient = useQueryClient();
  /** Id da linha em edicao. Uma so por vez, como em qualquer gerenciador. */
  const [renomeando, setRenomeando] = useState<string | null>(null);

  const { tarefa: movendo, pegarTarefa, largar } = useMover();

  const reparentear = useMutation({
    mutationFn: ({ id, parent_id }: { id: string; parent_id: string | null }) =>
      api.moveNode(id, parent_id),
    onSuccess: (node) => {
      void sistema.vibrar('sucesso');
      largar();
      queryClient.invalidateQueries({ queryKey: ['tree'] });
      queryClient.invalidateQueries({ queryKey: ['node', node.id] });
      toast.success(
        node.parent_id ? 'Tarefa movida para o novo pai.' : 'Tarefa virou meta macro.',
      );
    },
    onError: (e: ApiError) => {
      largar();
      toast.error(e.message);
    },
  });

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
      if (e.key !== 'F2' || !marcadoId) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      e.preventDefault();
      setRenomeando(marcadoId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [marcadoId]);

  /**
   * Segurar o dedo numa linha "pega" a tarefa. O temporizador e cancelado
   * assim que o dedo anda: rolar a lista nao pode virar um gesto de mover.
   */
  const pressao = useRef<number | null>(null);
  /**
   * Soltar o dedo depois da pressao dispara um `click` na mesma linha — e esse
   * clique, com a tarefa ja em mao, significaria "toquei no que estou movendo",
   * que cancela o movimento. O gesto se desfazia sozinho no ato.
   */
  const acabouDePegar = useRef(false);
  const cancelarPressao = () => {
    if (pressao.current != null) window.clearTimeout(pressao.current);
    pressao.current = null;
  };
  useEffect(() => cancelarPressao, []);

  return (
    <div className="flex shrink-0 flex-col border-r" style={{ width: largura }}>
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-2">
        <span className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {movendo ? 'Toque no novo pai' : 'Metas'}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{rows.length}</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => onScroll(e.currentTarget.scrollTop)}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div style={{ height: rows.length * ROW_HEIGHT }} className="relative">
          {rows.map((row, i) => {
            const { node } = row;
            const tone = progressTone(node.progress);
            const isSelected = marcadoId === node.id;

            const alvoValido = movendo ? podeReceber(movendo, node) : false;

            return (
              <div
                key={node.id}
                role="button"
                tabIndex={0}
                onPointerDown={() => {
                  if (movendo || renomeando === node.id) return;
                  cancelarPressao();
                  pressao.current = window.setTimeout(() => {
                    pressao.current = null;
                    acabouDePegar.current = true;
                    void sistema.vibrar('medio');
                    pegarTarefa(node);
                  }, PRESSAO_MS);
                }}
                onPointerMove={cancelarPressao}
                onPointerUp={cancelarPressao}
                onPointerCancel={cancelarPressao}
                onClick={() => {
                  if (acabouDePegar.current) {
                    acabouDePegar.current = false;
                    return;
                  }
                  if (!movendo) return marcar(marcadoId === node.id ? null : node.id);
                  if (movendo.id === node.id) return largar();
                  if (!alvoValido) {
                    return toast.error('Uma tarefa nao pode entrar debaixo de si mesma.');
                  }
                  reparentear.mutate({ id: movendo.id, parent_id: node.id });
                }}
                onKeyDown={(e) => e.key === 'Enter' && select(node.id)}
                className={cn(
                  'group absolute left-0 flex w-full items-center gap-1 pr-1.5 text-[13px]',
                  'border-l-2 active:bg-accent/60',
                  isSelected && !movendo ? 'border-l-primary bg-accent' : 'border-l-transparent',
                  movendo?.id === node.id && 'opacity-40',
                  movendo && alvoValido && 'bg-primary/10',
                  movendo && !alvoValido && movendo.id !== node.id && 'opacity-30',
                )}
                style={{
                  top: i * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  // 10px por nivel, e nao os 14 do desktop: em 164px, quatro
                  // niveis de recuo a 14 ja nao deixariam titulo nenhum.
                  paddingLeft: 6 + (row.indent ?? node.depth) * 10,
                }}
              >
                {row.indent === undefined ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded(node.id, !row.isExpanded);
                    }}
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-transform active:bg-secondary',
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
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!movendo) setRenomeando(node.id);
                    }}
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
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                    style={{ backgroundColor: node.assignee.color }}
                    title={node.assignee.name}
                  >
                    {node.assignee.name.slice(0, 1)}
                  </span>
                )}

                {/*
                  O nivel (N0, N1...) saiu da linha. Em 164px ele custava 36px
                  — quase tudo o que sobrava do titulo — para repetir o que o
                  recuo ja diz. O numero continua no painel de detalhe.
                */}
                <span
                  className={cn('w-7 shrink-0 text-right font-mono text-[10px]', TONE_TEXT[tone])}
                >
                  {Math.round(node.progress)}
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
      {movendo && (
        <div className="flex shrink-0 gap-1 border-t p-1.5">
          <button
            type="button"
            disabled={!podeReceber(movendo, null) || reparentear.isPending}
            onClick={() => reparentear.mutate({ id: movendo.id, parent_id: null })}
            className={cn(
              'flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed text-[11px]',
              'active:bg-accent disabled:opacity-40',
            )}
          >
            <CornerUpLeft className="h-3.5 w-3.5" />
            Virar meta macro
          </button>
          <button
            type="button"
            onClick={largar}
            aria-label="Cancelar o movimento"
            className="flex min-h-[38px] w-10 items-center justify-center rounded-md border text-muted-foreground active:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
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
