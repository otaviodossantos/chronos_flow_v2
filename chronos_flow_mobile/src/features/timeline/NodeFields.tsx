import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, Search, X, AlertTriangle, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { NodeDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import type { NodeDetail } from '@/lib/api';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, formatDateTime, formatDuration } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DictationTextarea } from '@/components/DictationTextarea';

/**
 * Tudo o que se define depois que a tarefa ja existe. Antes daqui, o painel
 * de detalhe so deixava mexer no agendamento: nome, responsavel, peso e
 * dependencias eram decididos na criacao e nunca mais.
 *
 * Os campos salvam sozinhos — select ao trocar, texto ao sair do campo. Um
 * botao "salvar" por campo transformaria cada ajuste em dois cliques.
 */

function usePatch(nodeId: string, onSaved: () => void) {
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateNode(nodeId, body),
    onSuccess: onSaved,
    onError: (e: ApiError) => toast.error(e.message),
  });
}

/** Campo de texto que so dispara ao sair, para nao salvar a cada tecla. */
function TextOnBlur({
  value,
  onCommit,
  className,
  ...props
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };

  return (
    <Input
      {...props}
      value={draft}
      className={className}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

/**
 * Descricao com ditado. O rascunho fica local para o ditado poder anexar
 * texto sem uma ida ao servidor por palavra; o salvamento e ao sair do campo.
 */
function DescriptionField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <DictationTextarea
      value={draft}
      label="Descricao"
      placeholder="Escreva ou dite o contexto da tarefa..."
      className="min-h-[64px] text-xs"
      onChange={setDraft}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

export function NodeFields({
  node,
  hasChildren,
  onSaved,
}: {
  node: NodeDTO;
  hasChildren: boolean;
  onSaved: () => void;
}) {
  const patch = usePatch(node.id, onSaved);
  // Mesma regra do servidor, so que para explicar antes de acontecer.
  const fimSegueEstimativa = !hasChildren && !node.all_day && Boolean(node.start_date);
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: api.members });
  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });

  return (
    <section className="space-y-3 border-b p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Detalhes
      </div>

      {/*
        O titulo nao mora mais aqui.

        Ele aparecia duas vezes na mesma tela: grande no cabecalho do painel e,
        dez pixels abaixo, de novo como o primeiro campo do formulario. Agora o
        do cabecalho e o editavel — toca-se nele e escreve-se por cima.
      */}
      <div>
        <DescriptionField
          value={node.description ?? ''}
          onCommit={(description) => patch.mutate({ description: description || null })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="mb-1 block text-[10px]">Responsavel</Label>
          <Select
            className="h-8 w-full"
            aria-label="Responsavel"
            value={node.assignee_id ?? ''}
            onChange={(e) => patch.mutate({ assignee_id: e.target.value || null })}
          >
            <option value="">Nao atribuida</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="mb-1 block text-[10px]">Criticidade</Label>
          <Select
            className="h-8 w-full"
            aria-label="Criticidade"
            value={node.importance}
            onChange={(e) => patch.mutate({ importance: Number(e.target.value) })}
          >
            <option value={5}>5 - Critico</option>
            <option value={4}>4 - Alto</option>
            <option value={3}>3 - Medio</option>
            <option value={2}>2 - Baixo</option>
            <option value={1}>1 - Minimo</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="mb-1 block text-[10px]">Tempo estimado (min)</Label>
          <TextOnBlur
            type="number"
            min={1}
            aria-label="Tempo estimado em minutos"
            className="h-8 text-xs"
            value={node.estimated_minutes ? String(node.estimated_minutes) : ''}
            onCommit={(v) =>
              patch.mutate({ estimated_minutes: v ? Number(v) : null })
            }
          />
        </div>
        <div>
          <Label className="mb-1 block text-[10px]">Peso na cascata</Label>
          <TextOnBlur
            type="number"
            min={1}
            aria-label="Peso na cascata"
            className="h-8 text-xs"
            value={String(node.weight)}
            onCommit={(v) => v && patch.mutate({ weight: Number(v) })}
          />
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {hasChildren
          ? 'Mudar o peso reescreve a fatia desta tarefa entre as irmas e recalcula a meta macro.'
          : 'Sem peso proprio, ele vem do tempo estimado. Mudar qualquer um dos dois muda a fatia desta tarefa na meta macro.'}
      </p>

      {fimSegueEstimativa ? (
        <p className="rounded-md bg-secondary/60 p-2 text-[10px] leading-relaxed text-muted-foreground">
          O termino acompanha a estimativa: mudar o tempo move o fim da barra na timeline. Hoje
          termina as{' '}
          <strong className="font-mono text-foreground">
            {formatDateTime(node.due_date, false)}
          </strong>
          {node.estimated_minutes ? ` (${formatDuration(node.estimated_minutes)})` : ''}.
        </p>
      ) : (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {hasChildren
            ? 'A janela desta tarefa vem das filhas, entao o tempo estimado aqui nao move a barra.'
            : node.all_day
              ? 'Em tarefa de dia inteiro o termino e prazo, nao duracao: ele nao se mexe sozinho. Desligue "Dia inteiro" no agendamento para o fim acompanhar a estimativa.'
              : 'Defina um inicio no agendamento para o termino passar a acompanhar a estimativa.'}
        </p>
      )}

      <div>
        <Label className="mb-1 block text-[10px]">Espaco</Label>
        <Select
          className="h-8 w-full"
          aria-label="Espaco"
          value={node.space_id ?? ''}
          onChange={(e) => patch.mutate({ space_id: e.target.value || null })}
        >
          <option value="">Sem espaco</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        {/* Dito antes, e nao depois: mover um ramo inteiro de espaco sem aviso
            seria uma surpresa de escala imprevisivel. */}
        {hasChildren && (
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Trocar o espaco leva todas as subtarefas deste ramo junto.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Dependencias editaveis. O servidor ja recusava ciclo e parentesco; aqui a
 * tela so precisa do gesto e de mostrar o motivo quando ele recusa.
 */
export function DependencyEditor({
  node,
  dependsOn,
  blocksNodes,
  onSelect,
  onSaved,
}: {
  node: NodeDTO;
  dependsOn: NodeDetail['dependsOn'];
  blocksNodes: NodeDetail['blocksNodes'];
  onSelect: (id: string) => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const invalidate = () => {
    onSaved();
    queryClient.invalidateQueries({ queryKey: ['tree'] });
    queryClient.invalidateQueries({ queryKey: ['focus'] });
  };

  const { data: found = [] } = useQuery({
    queryKey: ['tree', 'search-dep', term],
    queryFn: () => api.tree({ search: term, maxDepth: 99 }),
    enabled: adding && term.trim().length >= 2,
  });

  const add = useMutation({
    mutationFn: (blockerId: string) => api.createDependency(blockerId, node.id),
    onSuccess: () => {
      setTerm('');
      setAdding(false);
      toast.success('Dependencia criada.');
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const drop = useMutation({
    mutationFn: (dependencyId: string) => api.deleteDependency(dependencyId),
    onSuccess: () => {
      toast.success('Dependencia removida.');
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const jaLigados = new Set([
    node.id,
    ...dependsOn.map((d) => d.id),
    ...blocksNodes.map((b) => b.id),
  ]);
  const sugestoes = found.filter((n) => !jaLigados.has(n.id)).slice(0, 8);

  return (
    <section className="border-b p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Dependencias e bloqueios
        </span>
        <Button size="xs" variant="ghost" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3 w-3" />
          Depende de
        </Button>
      </div>

      {adding && (
        <div className="mb-2 rounded-md border p-2">
          <div className="flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={term}
              placeholder="Buscar a tarefa que precisa terminar antes..."
              className="h-7 border-0 px-1 text-xs shadow-none focus-visible:ring-0"
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            />
            <button
              type="button"
              aria-label="Cancelar busca"
              onClick={() => setAdding(false)}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {term.trim().length >= 2 && (
            <div
              role="listbox"
              aria-label="Tarefas que podem bloquear esta"
              className="mt-1.5 max-h-44 overflow-y-auto"
            >
              {sugestoes.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-muted-foreground">
                  Nenhuma tarefa nova com esse nome.
                </p>
              ) : (
                sugestoes.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={add.isPending}
                    onClick={() => add.mutate(n.id)}
                    className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                    <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                      N{n.depth}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {dependsOn.length === 0 && blocksNodes.length === 0 && !adding && (
        <p className="text-[11px] text-muted-foreground">
          Nenhuma. Use "Depende de" para travar esta tarefa ate outra fechar.
        </p>
      )}

      {dependsOn.map((d) => (
        <Vinculo
          key={d.dependency_id}
          kind="Depende de"
          title={d.title}
          status={d.status}
          onOpen={() => onSelect(d.id)}
          onRemove={() => drop.mutate(d.dependency_id)}
          removing={drop.isPending}
        />
      ))}

      {blocksNodes.map((b) => (
        <Vinculo
          key={b.dependency_id}
          kind="Bloqueia"
          title={b.title}
          status={b.status}
          onOpen={() => onSelect(b.id)}
          onRemove={() => drop.mutate(b.dependency_id)}
          removing={drop.isPending}
        />
      ))}
    </section>
  );
}

function Vinculo({
  kind,
  title,
  status,
  onOpen,
  onRemove,
  removing,
}: {
  kind: string;
  title: string;
  status: string;
  onOpen: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const bloqueia = kind === 'Bloqueia';
  const ok = status === 'COMPLETED';

  return (
    <div className="group mb-1.5 flex items-center gap-2 rounded-md border p-2">
      {ok ? (
        <CircleCheck className="h-4 w-4 shrink-0 text-[hsl(var(--status-good))]" />
      ) : (
        <AlertTriangle
          className={cn(
            'h-4 w-4 shrink-0',
            bloqueia
              ? 'text-[hsl(var(--status-warning))]'
              : 'text-[hsl(var(--status-critical))]',
          )}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase text-muted-foreground">{kind}</div>
        <button
          type="button"
          onClick={onOpen}
          className="block w-full truncate text-left font-mono text-xs hover:underline"
        >
          {title}
        </button>
      </div>
      <Badge variant={ok ? 'good' : 'critical'}>{STATUS_LABEL[status] ?? status}</Badge>
      <button
        type="button"
        aria-label={`Remover vinculo com ${title}`}
        disabled={removing}
        onClick={onRemove}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
