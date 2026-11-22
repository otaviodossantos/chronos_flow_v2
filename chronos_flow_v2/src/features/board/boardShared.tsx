import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Lock, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberDTO, NodeDTO, NodeStatus } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { daysUntil } from '@/lib/format';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DateTimeField } from '@/components/DateField';

/**
 * Pecas comuns da Tabela e do Kanban: as cores de status e prioridade e os
 * seletores que editam direto na celula, como no Monday.
 */

export type SettableStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export const STATUS_META: Record<
  NodeStatus,
  { label: string; pill: string; dot: string; column: string }
> = {
  PENDING: {
    label: 'Pendente',
    pill: 'bg-[hsl(0_0%_60%)] text-white',
    dot: 'bg-[hsl(0_0%_60%)]',
    column: 'A fazer',
  },
  IN_PROGRESS: {
    label: 'Em andamento',
    pill: 'bg-[hsl(var(--status-warning))] text-white',
    dot: 'bg-[hsl(var(--status-warning))]',
    column: 'Em andamento',
  },
  BLOCKED: {
    label: 'Bloqueada',
    pill: 'bg-[hsl(var(--status-critical))] text-white',
    dot: 'bg-[hsl(var(--status-critical))]',
    column: 'Bloqueada',
  },
  COMPLETED: {
    label: 'Concluida',
    pill: 'bg-[hsl(var(--status-good))] text-white',
    dot: 'bg-[hsl(var(--status-good))]',
    column: 'Concluida',
  },
  CANCELLED: {
    label: 'Cancelada',
    pill: 'bg-secondary text-muted-foreground line-through',
    dot: 'bg-muted-foreground/50',
    column: 'Cancelada',
  },
};

const SETTABLE: SettableStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

/** Criticidade 1..5 com as mesmas palavras do painel de detalhe. */
export const IMPORTANCE_META: Record<number, { label: string; pill: string }> = {
  5: { label: 'Critico', pill: 'bg-[hsl(var(--status-critical))] text-white' },
  4: { label: 'Alto', pill: 'bg-[hsl(var(--status-warning))] text-white' },
  3: { label: 'Medio', pill: 'bg-[hsl(217_80%_56%)] text-white' },
  2: { label: 'Baixo', pill: 'bg-[hsl(217_80%_56%/0.25)] text-foreground' },
  1: { label: 'Minimo', pill: 'bg-secondary text-muted-foreground' },
};

/** O que precisa recarregar quando uma tarefa muda por uma das visoes. */
export function useInvalidateBoard() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['tree'] });
    queryClient.invalidateQueries({ queryKey: ['node'] });
    queryClient.invalidateQueries({ queryKey: ['focus'] });
    queryClient.invalidateQueries({ queryKey: ['life'] });
    queryClient.invalidateQueries({ queryKey: ['spaces'] });
  };
}

/**
 * Troca de status pelo endpoint unico. O aviso diz o que a cascata fez, que e
 * o que diferencia este app de uma lista de tarefas qualquer.
 */
export function useSetStatus() {
  const invalidate = useInvalidateBoard();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: SettableStatus }) =>
      api.setStatus(id, status),
    onSuccess: (res) => {
      if (res.completed) {
        const { impact, unblocked } = res.completed;
        toast.success(
          impact.deltaPercent > 0
            ? `Concluida. +${impact.deltaPercent}% em "${impact.rootTitle}".`
            : 'Concluida.',
          {
            description: unblocked.length
              ? `Destravou: ${unblocked.map((u) => u.title).join(', ')}`
              : undefined,
          },
        );
      } else if (res.reopened?.reopenedAncestors.length) {
        toast.success('Reaberta.', {
          description: `Reabriu tambem ${res.reopened.reopenedAncestors
            .map((a) => `"${a.title}"`)
            .join(', ')}.`,
        });
      }
      invalidate();
    },
    onError: (e: ApiError) => {
      toast.error(e.message);
      invalidate();
    },
  });
}

export function useUpdateNode() {
  const invalidate = useInvalidateBoard();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.updateNode(id, body),
    onSuccess: invalidate,
    onError: (e: ApiError) => toast.error(e.message),
  });
}

export function StatusPicker({
  node,
  className,
  compact,
}: {
  node: NodeDTO;
  className?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const setStatus = useSetStatus();
  const meta = STATUS_META[node.status];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'flex h-full w-full items-center justify-center truncate text-xs font-medium transition-opacity hover:opacity-90',
            compact ? 'rounded px-2 py-0.5 text-[10px]' : 'px-2',
            meta.pill,
            setStatus.isPending && 'opacity-60',
            className,
          )}
        >
          {meta.label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1.5" onClick={(e) => e.stopPropagation()}>
        {SETTABLE.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setOpen(false);
              if (s !== node.status) setStatus.mutate({ id: node.id, status: s });
            }}
            className={cn(
              'mb-1 flex w-full items-center justify-center rounded px-2 py-1.5 text-xs font-medium last:mb-0',
              STATUS_META[s].pill,
              s === node.status && 'ring-2 ring-ring ring-offset-1 ring-offset-popover',
            )}
          >
            {STATUS_META[s].label}
          </button>
        ))}
        <p className="mt-1.5 flex items-start gap-1.5 px-1 text-[10px] leading-snug text-muted-foreground">
          <Lock className="mt-px h-3 w-3 shrink-0" />
          "Bloqueada" vem das dependencias: liga e desliga sozinha.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function Avatar({ member, size = 20 }: { member: MemberDTO; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ backgroundColor: member.color, width: size, height: size, fontSize: size * 0.42 }}
      title={member.name}
    >
      {member.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function MemberPicker({ node, members }: { node: NodeDTO; members: MemberDTO[] }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateNode();
  const current = members.find((m) => m.id === node.assignee_id) ?? node.assignee ?? null;

  const pick = (id: string | null) => {
    setOpen(false);
    if (id !== node.assignee_id) update.mutate({ id: node.id, body: { assignee_id: id } });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="flex h-full w-full items-center gap-1.5 px-2 text-xs hover:bg-accent"
        >
          {current ? (
            <>
              <Avatar member={current} />
              <span className="truncate">{current.name}</span>
            </>
          ) : (
            <span className="mx-auto text-muted-foreground/60">—</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" onClick={(e) => e.stopPropagation()}>
        {members.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">
            Nenhum membro ainda. Cadastre na tela Equipe.
          </p>
        )}
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => pick(m.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
          >
            <Avatar member={m} />
            <span className="flex-1 truncate text-left">{m.name}</span>
            {m.id === node.assignee_id && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}
        {node.assignee_id && (
          <button
            type="button"
            onClick={() => pick(null)}
            className="mt-1 w-full rounded border-t px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
          >
            Tirar responsavel
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ImportancePicker({ node }: { node: NodeDTO }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateNode();
  const meta = IMPORTANCE_META[node.importance] ?? IMPORTANCE_META[3];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'flex h-full w-full items-center justify-center px-2 text-xs font-medium hover:opacity-90',
            meta.pill,
          )}
        >
          {meta.label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1.5" onClick={(e) => e.stopPropagation()}>
        {[5, 4, 3, 2, 1].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setOpen(false);
              if (v !== node.importance) update.mutate({ id: node.id, body: { importance: v } });
            }}
            className={cn(
              'mb-1 flex w-full items-center justify-center rounded px-2 py-1.5 text-xs font-medium last:mb-0',
              IMPORTANCE_META[v].pill,
              v === node.importance && 'ring-2 ring-ring ring-offset-1 ring-offset-popover',
            )}
          >
            {IMPORTANCE_META[v].label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Cor do prazo: vermelho em atraso, ambar ate amanha. Concluida nao assusta ninguem. */
export function deadlineTone(node: NodeDTO): string {
  if (node.status === 'COMPLETED' || node.status === 'CANCELLED') return 'text-muted-foreground';
  const days = daysUntil(node.due_date);
  if (days == null) return 'text-muted-foreground';
  if (days < 0) return 'text-[hsl(var(--status-critical))] font-medium';
  if (days <= 1) return 'text-[hsl(var(--status-warning))] font-medium';
  return 'text-foreground';
}

/**
 * Prazo editavel na celula. Passa pelo reagendamento, como o painel de
 * detalhe: mexer no fim de um pai redimensiona as filhas na mesma proporcao.
 */
export function DueField({ node }: { node: NodeDTO }) {
  const invalidate = useInvalidateBoard();
  const save = useMutation({
    mutationFn: (due: string | null) =>
      api.reschedule(node.id, {
        start_date: node.start_date,
        due_date: due,
        all_day: node.all_day,
        cascadeChildren: true,
      }),
    onSuccess: invalidate,
    onError: (e: ApiError) => toast.error(e.message),
  });

  return (
    <div onClick={(e) => e.stopPropagation()} className="h-full w-full">
      <DateTimeField
        size="sm"
        showTime={!node.all_day}
        value={node.due_date}
        onChange={(v) => save.mutate(v)}
        placeholder="—"
        className={cn(
          'h-full rounded-none border-0 bg-transparent px-2 shadow-none hover:bg-accent',
          deadlineTone(node),
        )}
      />
    </div>
  );
}

export function UpdatesBubble({
  count,
  onClick,
  className,
}: {
  count: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={count > 0 ? `${count} atualizacao(oes)` : 'Escrever uma atualizacao'}
      aria-label={count > 0 ? `Ver ${count} atualizacoes` : 'Escrever uma atualizacao'}
      className={cn(
        'relative flex items-center justify-center rounded p-1 transition-colors',
        count > 0
          ? 'text-[hsl(217_80%_56%)] hover:bg-accent'
          : 'text-muted-foreground/40 hover:bg-accent hover:text-muted-foreground',
        className,
      )}
    >
      <MessageSquare className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 min-w-3.5 rounded-full bg-[hsl(217_80%_56%)] px-1 text-center text-[9px] font-semibold leading-3.5 text-white">
          {count}
        </span>
      )}
    </button>
  );
}

