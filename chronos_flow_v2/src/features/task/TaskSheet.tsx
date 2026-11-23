import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, Check, ChevronRight, History, Link2, ListPlus, ListTree, MessageSquare,
  PictureInPicture2, Plus, Trash2, Undo2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { NodeDTO } from '@shared/types';
import { api, ApiError, type NodeDetail } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  formatShortDate,
  levelLabel,
  progressTone,
  relativeDeadline,
  TONE_TEXT,
} from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { DateTimeField } from '@/components/DateField';
import { useTimelineStore, type DetailTab } from '@/stores/timelineStore';
import {
  DependencyEditor,
  DescriptionField,
  TextOnBlur,
  usePatch,
} from '@/features/timeline/NodeFields';
import {
  Avatar,
  ImportancePicker,
  MemberPicker,
  STATUS_META,
  StatusPicker,
  deadlineTone,
} from '@/features/board/boardShared';
import { UpdatesPanel } from '@/features/updates/UpdatesPanel';
import { BreakdownModal } from '@/features/team/BreakdownModal';

/**
 * A tarefa aberta, no estilo do "item view" do Monday: uma gaveta larga que
 * entra pela direita por cima da tela. Na coluna principal, o que acontece com
 * a tarefa (atualizacoes, subtarefas, dependencias, atividade); na lateral, o
 * que ela e (os campos).
 *
 * Fica montada uma vez so na tela de projetos e segue `selectedId`: Timeline,
 * Tabela e Kanban abrem a mesma gaveta.
 */
export function TaskSheet({ onOpenWidget }: { onOpenWidget?: (node: NodeDTO) => void }) {
  const selectedId = useTimelineStore((s) => s.selectedId);
  const select = useTimelineStore((s) => s.select);

  return (
    <Sheet open={Boolean(selectedId)} onOpenChange={(aberto) => !aberto && select(null)}>
      <SheetContent
        className="w-full max-w-none sm:w-[min(1180px,94vw)]"
        // Primeiro Esc dentro de um campo so sai do campo (ele mesmo desfaz a
        // edicao, se for o caso); o segundo fecha a gaveta.
        onEscapeKeyDown={(e) => {
          const ativo = document.activeElement as HTMLElement | null;
          if (ativo && (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA')) {
            e.preventDefault();
            requestAnimationFrame(() => ativo.blur());
          }
        }}
      >
        {selectedId && <ConteudoDaTarefa nodeId={selectedId} onOpenWidget={onOpenWidget} />}
      </SheetContent>
    </Sheet>
  );
}

function ConteudoDaTarefa({
  nodeId,
  onOpenWidget,
}: {
  nodeId: string;
  onOpenWidget?: (node: NodeDTO) => void;
}) {
  const select = useTimelineStore((s) => s.select);
  const aba = useTimelineStore((s) => s.detailTab);
  const setAba = useTimelineStore((s) => s.setDetailTab);
  const queryClient = useQueryClient();
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['node', nodeId],
    queryFn: () => api.nodeDetail(nodeId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tree'] });
    queryClient.invalidateQueries({ queryKey: ['node', nodeId] });
    queryClient.invalidateQueries({ queryKey: ['focus'] });
    queryClient.invalidateQueries({ queryKey: ['life'] });
    // A contagem por espaco na barra lateral muda junto quando um ramo troca.
    queryClient.invalidateQueries({ queryKey: ['spaces'] });
  };

  const patch = usePatch(nodeId, invalidate);

  const remove = useMutation({
    mutationFn: () => api.deleteNode(nodeId),
    onSuccess: (res) => {
      setConfirmDelete(false);
      // Sair da selecao antes de invalidar: a gaveta aponta para um no que
      // acabou de deixar de existir e a proxima busca daria 404.
      select(null);
      queryClient.removeQueries({ queryKey: ['node', nodeId] });
      queryClient.invalidateQueries({ queryKey: ['tree'] });
      queryClient.invalidateQueries({ queryKey: ['focus'] });
      queryClient.invalidateQueries({ queryKey: ['life'] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      toast.success(
        res.removed > 1 ? `Excluida com ${res.removed - 1} subtarefa(s).` : 'Tarefa excluida.',
      );
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
        <SheetTitle>Tarefa nao encontrada</SheetTitle>
        <SheetDescription className="text-muted-foreground">
          Ela pode ter sido excluida.
        </SheetDescription>
        <Button variant="outline" size="sm" onClick={() => select(null)}>
          Fechar
        </Button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <SheetTitle className="sr-only">Carregando tarefa</SheetTitle>
        <SheetDescription className="sr-only">Carregando</SheetDescription>
        <div className="h-4 w-48 animate-pulse rounded bg-secondary" />
        <div className="mt-4 h-8 w-2/3 animate-pulse rounded bg-secondary" />
        <div className="mt-6 h-40 animate-pulse rounded bg-secondary/60" />
      </div>
    );
  }

  const { node, ancestors, children, dependsOn, blocksNodes, activity, descendants } = data;
  const tone = progressTone(node.progress);
  const feitas = children.filter((c) => c.status === 'COMPLETED').length;
  const aberta = node.status !== 'COMPLETED' && node.status !== 'CANCELLED';

  const ABAS: Array<{ id: DetailTab; rotulo: string; extra?: string; icone: React.ReactNode }> = [
    {
      id: 'updates',
      rotulo: 'Atualizacoes',
      extra: node.updates_count ? String(node.updates_count) : undefined,
      icone: <MessageSquare className="h-3.5 w-3.5" />,
    },
    {
      id: 'subtarefas',
      rotulo: 'Subtarefas',
      extra: children.length ? `${feitas}/${children.length}` : undefined,
      icone: <ListTree className="h-3.5 w-3.5" />,
    },
    {
      id: 'dependencias',
      rotulo: 'Dependencias',
      extra: dependsOn.length + blocksNodes.length ? String(dependsOn.length + blocksNodes.length) : undefined,
      icone: <Link2 className="h-3.5 w-3.5" />,
    },
    { id: 'atividade', rotulo: 'Atividade', icone: <History className="h-3.5 w-3.5" /> },
  ];

  return (
    <>
      <SheetDescription className="sr-only">Detalhes, atualizacoes e campos da tarefa</SheetDescription>

      {/* ── Cabecalho ─────────────────────────────────────────────── */}
      <header className="shrink-0 border-b px-6 pb-4 pt-4">
        <div className="flex items-center gap-2">
          <nav aria-label="Caminho da tarefa" className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground">
            <Badge variant="outline" className="mr-1 shrink-0 font-mono text-[10px]">
              {levelLabel(node.depth)}
            </Badge>
            {ancestors.map((a) => (
              <span key={a.id} className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => select(a.id)}
                  className="max-w-[220px] truncate hover:text-foreground hover:underline"
                  title={a.title}
                >
                  {a.title}
                </button>
                <ChevronRight className="h-3 w-3 shrink-0" />
              </span>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-0.5">
            {onOpenWidget && node.isLeaf && aberta && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenWidget(node)}
                aria-label="Cronometrar em janela flutuante"
                title="Cronometrar em janela flutuante"
              >
                <PictureInPicture2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              aria-label="Excluir tarefa"
              title="Excluir tarefa"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" aria-label="Fechar" title="Fechar (Esc)">
                <X className="h-4 w-4" />
              </Button>
            </SheetClose>
          </div>
        </div>

        <SheetTitle className="sr-only">{node.title}</SheetTitle>
        <div className="mt-2">
          <TituloEditavel value={node.title} onCommit={(title) => patch.mutate({ title })} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-2 text-xs">
          <div className="h-8 w-40 overflow-hidden rounded-md">
            <StatusPicker node={node} />
          </div>
          <div className="flex w-56 items-center gap-2">
            <Progress value={node.progress} tone={tone} />
            <span className="w-9 shrink-0 text-right font-mono text-muted-foreground">
              {Math.round(node.progress)}%
            </span>
          </div>
          <span className={cn('font-mono font-semibold', TONE_TEXT[tone])} title="Quanto esta tarefa vale na meta macro">
            +{(node.root_impact * 100).toFixed(1)}% na meta
          </span>
          {node.due_date && (
            <span className={cn('flex items-center gap-1.5', deadlineTone(node))}>
              <CalendarDays className="h-3.5 w-3.5" />
              {formatDateTime(node.due_date, node.all_day)}
              <span className="text-muted-foreground">· {relativeDeadline(node.due_date)}</span>
            </span>
          )}
        </div>
      </header>

      {/* ── Corpo: abas a esquerda, campos a direita ─────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px]">
        <main className="flex min-h-0 flex-col">
          <div role="tablist" aria-label="Secoes da tarefa" className="flex shrink-0 gap-5 border-b px-6">
            {ABAS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={aba === t.id}
                onClick={() => setAba(t.id)}
                className={cn(
                  '-mb-px flex items-center gap-1.5 border-b-2 py-2.5 text-sm transition-colors',
                  aba === t.id
                    ? 'border-foreground font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t.icone}
                {t.rotulo}
                {t.extra && (
                  <span className="rounded bg-secondary px-1.5 font-mono text-[10px] text-muted-foreground">
                    {t.extra}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {aba === 'updates' && (
              <div className="mx-auto max-w-3xl">
                <UpdatesPanel nodeId={node.id} />
              </div>
            )}
            {aba === 'subtarefas' && (
              <Subtarefas
                node={node}
                filhas={children}
                dependsOn={dependsOn}
                onSaved={invalidate}
                onQuebrar={() => setBreakdownOpen(true)}
              />
            )}
            {aba === 'dependencias' && (
              <div className="mx-auto max-w-3xl">
                <DependencyEditor
                  node={node}
                  dependsOn={dependsOn}
                  blocksNodes={blocksNodes}
                  onSelect={select}
                  onSaved={invalidate}
                />
              </div>
            )}
            {aba === 'atividade' && <Atividade itens={activity} />}
          </div>
        </main>

        <aside className="min-h-0 overflow-y-auto border-t bg-muted/20 md:border-l md:border-t-0">
          <Informacoes node={node} temFilhas={children.length > 0} onSaved={invalidate} />
        </aside>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir "{node.title}"?</DialogTitle>
            <DialogDescription>
              {descendants > 0
                ? `Vao junto ${descendants} subtarefa(s) em todos os niveis abaixo dela.`
                : 'Essa tarefa nao tem subtarefas.'}
            </DialogDescription>
          </DialogHeader>
          {blocksNodes.length > 0 && (
            <p className="rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5 text-xs text-foreground">
              {blocksNodes.length} tarefa(s) dependem desta e ficam sem esse bloqueio:{' '}
              {blocksNodes.map((bn) => bn.title).join(', ')}.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            O progresso das tarefas acima e recalculado. Nao da para desfazer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BreakdownModal open={breakdownOpen} onOpenChange={setBreakdownOpen} parent={node} onDone={invalidate} />
    </>
  );
}

/**
 * Titulo grande que se edita no lugar, como no Monday. Textarea em vez de
 * input para nome longo quebrar linha em vez de sumir rolando para o lado.
 */
function TituloEditavel({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      aria-label="Titulo da tarefa"
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ' '))}
      onBlur={() => {
        const t = draft.trim();
        if (t && t !== value) onCommit(t);
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') setDraft(value);
      }}
      className="block w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold leading-tight outline-none transition-colors [overflow-wrap:anywhere] hover:border-input focus:border-input focus:bg-background"
    />
  );
}

/* ── Aba Subtarefas ─────────────────────────────────────────────────────── */

function Subtarefas({
  node,
  filhas,
  dependsOn,
  onSaved,
  onQuebrar,
}: {
  node: NodeDTO;
  filhas: NodeDTO[];
  dependsOn: NodeDetail['dependsOn'];
  onSaved: () => void;
  onQuebrar: () => void;
}) {
  const select = useTimelineStore((s) => s.select);
  const [nova, setNova] = useState('');
  const feitas = filhas.filter((c) => c.status === 'COMPLETED').length;
  const bloqueadores = dependsOn.filter((d) => d.status !== 'COMPLETED');

  const complete = useMutation({
    mutationFn: (id: string) => api.completeNode(id),
    onSuccess: (result) => {
      const subiu = result.cascade
        .map((s) => `${s.title}: ${s.previous.toFixed(1)}% -> ${s.progress.toFixed(1)}%`)
        .join(' · ');
      toast.success(
        result.impact.deltaPercent > 0
          ? `Concluida. +${result.impact.deltaPercent}% em "${result.impact.rootTitle}".`
          : 'Concluida.',
        { description: subiu || undefined },
      );
      if (result.unblocked.length > 0) {
        toast.info(`Destravou ${result.unblocked.length} tarefa(s).`, {
          description: result.unblocked.map((u) => u.title).join(', '),
        });
      }
      onSaved();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const reopen = useMutation({
    mutationFn: (id: string) => api.reopenNode(id),
    onSuccess: (res) => {
      const partes: string[] = [];
      if (res.reopenedAncestors.length > 0) {
        partes.push(`Reabriu tambem ${res.reopenedAncestors.map((a) => `"${a.title}"`).join(', ')}.`);
      }
      if (res.reblocked.length > 0) {
        partes.push(`${res.reblocked.length} tarefa(s) voltaram a ficar bloqueadas.`);
      }
      toast.success('Tarefa reaberta.', { description: partes.join(' ') || undefined });
      onSaved();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const adicionar = useMutation({
    mutationFn: (title: string) => api.createNode({ title, parent_id: node.id }),
    onSuccess: () => {
      setNova('');
      onSaved();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const ocupado = complete.isPending || reopen.isPending;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      {filhas.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Progress value={node.progress} tone={progressTone(node.progress)} />
          <span className="shrink-0">
            {feitas}/{filhas.length} concluidas
          </span>
        </div>
      )}

      {filhas.length > 0 && (
        <ul className="divide-y rounded-md border bg-card">
          {filhas.map((f) => {
            const meta = STATUS_META[f.status];
            const fechada = f.status === 'COMPLETED' || f.status === 'CANCELLED';
            return (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Checkbox
                  checked={f.status === 'COMPLETED'}
                  disabled={ocupado || !f.isLeaf}
                  title={f.isLeaf ? undefined : 'Tem subtarefas: conclui sozinha quando elas fecharem'}
                  aria-label={f.status === 'COMPLETED' ? 'Reabrir subtarefa' : 'Concluir subtarefa'}
                  onCheckedChange={() => (f.status === 'COMPLETED' ? reopen.mutate(f.id) : complete.mutate(f.id))}
                />
                <button
                  type="button"
                  onClick={() => select(f.id)}
                  className={cn(
                    'min-w-0 flex-1 text-left [overflow-wrap:anywhere] hover:underline',
                    fechada && 'text-muted-foreground line-through',
                  )}
                >
                  {f.title}
                  {f.childCount > 0 && (
                    <span className="ml-2 rounded bg-secondary px-1 font-mono text-[10px] text-muted-foreground">
                      {f.childCount} sub
                    </span>
                  )}
                </button>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
                  {meta.label}
                </span>
                {f.assignee ? <Avatar member={f.assignee} size={20} /> : <span className="w-5" />}
                <span className={cn('w-14 shrink-0 text-right text-[11px]', deadlineTone(f))}>
                  {f.due_date ? formatShortDate(f.due_date) : '—'}
                </span>
                <span className="w-9 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                  {Math.round(f.progress)}%
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (nova.trim()) adicionar.mutate(nova.trim());
        }}
        className="flex items-center gap-2 rounded-md border border-dashed px-3"
      >
        <Plus className="h-4 w-4 text-muted-foreground" />
        <Input
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          placeholder="Adicionar subtarefa e pressionar Enter"
          disabled={adicionar.isPending}
          className="h-10 border-0 px-0 shadow-none focus-visible:ring-0"
        />
      </form>

      {filhas.length === 0 && node.status !== 'COMPLETED' && node.status !== 'CANCELLED' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={bloqueadores.length > 0 || complete.isPending}
            onClick={() => complete.mutate(node.id)}
            title={bloqueadores.length > 0 ? 'Bloqueada por dependencia' : undefined}
          >
            <Check className="h-4 w-4" />
            Concluir tarefa
          </Button>
          <Button variant="outline" onClick={onQuebrar}>
            <ListPlus className="h-4 w-4" />
            Quebrar e delegar
          </Button>
          {bloqueadores.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Esperando: {bloqueadores.map((b) => b.title).join(', ')}
            </span>
          )}
        </div>
      )}

      {(node.status === 'COMPLETED' || node.status === 'CANCELLED') && (
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled={reopen.isPending} onClick={() => reopen.mutate(node.id)}>
            <Undo2 className="h-4 w-4" />
            {reopen.isPending ? 'Reabrindo...' : 'Reabrir'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {node.status === 'CANCELLED'
              ? 'Volta para pendente e recomeca do zero.'
              : 'As tarefas acima voltam a ficar em aberto junto.'}
          </span>
        </div>
      )}

      {filhas.length > 0 && (
        <p className="text-xs text-muted-foreground">
          O progresso desta tarefa sobe sozinho conforme as subtarefas fecham. Ela nao pode ser
          concluida manualmente.
        </p>
      )}
    </div>
  );
}

/* ── Aba Atividade ──────────────────────────────────────────────────────── */

function Atividade({ itens }: { itens: NodeDetail['activity'] }) {
  if (itens.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">Nenhuma atividade registrada ainda.</p>;
  }
  return (
    <ol className="mx-auto max-w-3xl space-y-3 p-6">
      {itens.map((a) => (
        <li key={a.id} className="flex gap-3 text-sm">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
          <div className="min-w-0">
            <span className="font-medium">{a.actor}</span>{' '}
            <span className="text-muted-foreground">{a.message}</span>
            <div className="text-[11px] text-muted-foreground" title={formatDateTime(a.created_at)}>
              {formatRelativeTime(a.created_at)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── Lateral: Informacoes ───────────────────────────────────────────────── */

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b px-5 py-4 last:border-b-0">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

function Informacoes({
  node,
  temFilhas,
  onSaved,
}: {
  node: NodeDTO;
  temFilhas: boolean;
  onSaved: () => void;
}) {
  const patch = usePatch(node.id, onSaved);
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: api.members });
  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });
  // Mesma regra do servidor, so que para explicar antes de acontecer.
  const fimSegueEstimativa = !temFilhas && !node.all_day && Boolean(node.start_date);

  return (
    <>
      <Secao titulo="Descricao">
        <DescriptionField
          label=""
          className="min-h-[96px] bg-background text-sm"
          value={node.description ?? ''}
          onCommit={(description) => patch.mutate({ description: description || null })}
        />
      </Secao>

      <Secao titulo="Informacoes">
        <Linha rotulo="Status">
          <div className="h-8 overflow-hidden rounded-md">
            <StatusPicker node={node} />
          </div>
        </Linha>
        <Linha rotulo="Responsavel">
          <div className="h-8 overflow-hidden rounded-md border bg-background">
            <MemberPicker node={node} members={members} />
          </div>
        </Linha>
        <Linha rotulo="Criticidade">
          <div className="h-8 overflow-hidden rounded-md">
            <ImportancePicker node={node} />
          </div>
        </Linha>
        <Linha rotulo="Espaco">
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
        </Linha>
        {temFilhas && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Trocar o espaco leva todas as subtarefas deste ramo junto.
          </p>
        )}
      </Secao>

      <Secao titulo="Esforco">
        <Linha rotulo="Estimativa (min)">
          <TextOnBlur
            type="number"
            min={1}
            aria-label="Tempo estimado em minutos"
            className="h-8 bg-background text-xs"
            value={node.estimated_minutes ? String(node.estimated_minutes) : ''}
            onCommit={(v) => patch.mutate({ estimated_minutes: v ? Number(v) : null })}
          />
        </Linha>
        <Linha rotulo="Peso na cascata">
          <TextOnBlur
            type="number"
            min={1}
            aria-label="Peso na cascata"
            className="h-8 bg-background text-xs"
            value={String(node.weight)}
            onCommit={(v) => v && patch.mutate({ weight: Number(v) })}
          />
        </Linha>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {temFilhas
            ? 'Mudar o peso reescreve a fatia desta tarefa entre as irmas e recalcula a meta macro.'
            : 'Sem peso proprio, ele vem do tempo estimado. Mudar qualquer um dos dois muda a fatia desta tarefa na meta macro.'}
          {fimSegueEstimativa &&
            ` O termino acompanha a estimativa${node.estimated_minutes ? ` (${formatDuration(node.estimated_minutes)})` : ''}.`}
        </p>
      </Secao>

      <Agendamento node={node} onSaved={onSaved} />

      <Secao titulo="Registro">
        <dl className="space-y-1 text-[11px] text-muted-foreground">
          <div className="flex justify-between gap-2">
            <dt>Criada</dt>
            <dd>{formatDateTime(node.created_at)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Atualizada</dt>
            <dd>{formatRelativeTime(node.updated_at)}</dd>
          </div>
          {node.completed_at && (
            <div className="flex justify-between gap-2">
              <dt>Concluida</dt>
              <dd>{formatDateTime(node.completed_at)}</dd>
            </div>
          )}
        </dl>
      </Secao>
    </>
  );
}

/**
 * Agendamento. O interruptor decide a granularidade: em dia inteiro o
 * calendario basta; com horario, a hora aparece no mesmo popover.
 */
function Agendamento({ node, onSaved }: { node: NodeDTO; onSaved: () => void }) {
  const [allDay, setAllDay] = useState(node.all_day);
  const [start, setStart] = useState(node.start_date);
  const [due, setDue] = useState(node.due_date);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setAllDay(node.all_day);
    setStart(node.start_date);
    setDue(node.due_date);
    setDirty(false);
  }, [node.id, node.all_day, node.start_date, node.due_date]);

  const save = useMutation({
    mutationFn: () =>
      api.reschedule(node.id, { start_date: start, due_date: due, all_day: allDay, cascadeChildren: true }),
    onSuccess: (res) => {
      const movidas = res.plan.affected.length;
      const cresceram = res.grew?.length ?? 0;
      toast.success(movidas > 0 ? `Agendado. ${movidas} subtarefa(s) movida(s).` : 'Agendado.', {
        description:
          cresceram > 0
            ? `${res.grew!.map((g) => `"${g.title}"`).join(', ')} ${cresceram > 1 ? 'cresceram' : 'cresceu'} para caber.`
            : undefined,
      });
      setDirty(false);
      onSaved();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const mudar = (setter: (v: string | null) => void) => (value: string | null) => {
    setter(value);
    setDirty(true);
  };

  const duracao =
    start && due ? Math.round((new Date(due).getTime() - new Date(start).getTime()) / 60000) : null;

  return (
    <Secao titulo="Agendamento">
      <Linha rotulo="Inicio">
        <DateTimeField size="sm" showTime={!allDay} value={start} onChange={mudar(setStart)} className="bg-background" />
      </Linha>
      <Linha rotulo="Termino">
        <DateTimeField size="sm" showTime={!allDay} value={due} onChange={mudar(setDue)} className="bg-background" />
      </Linha>
      <Linha rotulo="Dia inteiro">
        <Switch
          checked={allDay}
          aria-label="Dia inteiro"
          onCheckedChange={(v) => {
            setAllDay(v);
            setDirty(true);
          }}
        />
      </Linha>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {duracao != null && duracao > 0 ? `Ocupa ${formatDuration(duracao)}` : 'Defina inicio e termino'}
        </span>
        {dirty && (
          <Button size="xs" onClick={() => save.mutate()} disabled={save.isPending}>
            Salvar agendamento
          </Button>
        )}
      </div>
    </Secao>
  );
}
