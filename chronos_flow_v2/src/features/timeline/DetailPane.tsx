import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X, CornerDownRight, Check, Plus, AlertTriangle, CircleCheck, PictureInPicture2, Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { NodeDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  levelLabel,
  progressTone,
  relativeDeadline,
  STATUS_LABEL,
  TONE_TEXT,
} from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { DateTimeField } from '@/components/DateField';
import { useTimelineStore } from '@/stores/timelineStore';
import { NodeFields, DependencyEditor } from './NodeFields';
import { BreakdownModal } from '@/features/team/BreakdownModal';

export function DetailPane({
  nodeId,
  onOpenWidget,
}: {
  nodeId: string;
  onOpenWidget?: (node: NodeDTO) => void;
}) {
  const select = useTimelineStore((s) => s.select);
  const queryClient = useQueryClient();
  const [newChild, setNewChild] = useState('');
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading } = useQuery({
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

  const complete = useMutation({
    mutationFn: (id: string) => api.completeNode(id),
    onSuccess: (result) => {
      const climbed = result.cascade
        .map((s) => `${s.title}: ${s.previous.toFixed(1)}% -> ${s.progress.toFixed(1)}%`)
        .join(' · ');
      toast.success(
        result.impact.deltaPercent > 0
          ? `Concluida. +${result.impact.deltaPercent}% em "${result.impact.rootTitle}".`
          : 'Concluida.',
        { description: climbed || undefined },
      );
      if (result.unblocked.length > 0) {
        toast.info(`Destravou ${result.unblocked.length} tarefa(s).`, {
          description: result.unblocked.map((u) => u.title).join(', '),
        });
      }
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const reopen = useMutation({
    mutationFn: (id: string) => api.reopenNode(id),
    onSuccess: (res) => {
      const partes: string[] = [];
      if (res.reopenedAncestors.length > 0) {
        partes.push(
          `Reabriu tambem ${res.reopenedAncestors.map((a) => `"${a.title}"`).join(', ')}.`,
        );
      }
      if (res.reblocked.length > 0) {
        partes.push(`${res.reblocked.length} tarefa(s) voltaram a ficar bloqueadas.`);
      }
      toast.success('Tarefa reaberta.', { description: partes.join(' ') || undefined });
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteNode(nodeId),
    onSuccess: (res) => {
      setConfirmDelete(false);
      // Sair da selecao antes de invalidar: o painel aponta para um no que
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

  const addChild = useMutation({
    mutationFn: (title: string) => api.createNode({ title, parent_id: nodeId }),
    onSuccess: () => {
      setNewChild('');
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return (
      <aside className="flex w-[400px] shrink-0 flex-col border-l">
        <div className="p-4 text-sm text-muted-foreground">Carregando...</div>
      </aside>
    );
  }

  const { node, ancestors, children, dependsOn, blocksNodes, activity, descendants } = data;
  const tone = progressTone(node.progress);
  const doneChildren = children.filter((c) => c.status === 'COMPLETED').length;
  const openBlockers = dependsOn.filter((d) => d.status !== 'COMPLETED');

  return (
    <aside className="flex w-[400px] shrink-0 flex-col overflow-y-auto border-l">
      <div className="flex items-start justify-between gap-2 border-b p-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              {levelLabel(node.depth)}
            </Badge>
            <Badge variant={node.status === 'BLOCKED' ? 'critical' : 'secondary'}>
              {STATUS_LABEL[node.status]}
            </Badge>
          </div>
          <h2 className="text-lg font-semibold leading-tight">{node.title}</h2>
        </div>
        <div className="flex shrink-0 items-center">
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
          <Button variant="ghost" size="icon" onClick={() => select(null)} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>
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
            <Button
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="border-b p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Caminho hierarquico
          </span>
          <span className={cn('font-mono text-xs font-semibold', TONE_TEXT[tone])}>
            +{(node.root_impact * 100).toFixed(1)}% na meta macro
          </span>
        </div>
        <ol className="space-y-1 text-xs">
          {ancestors.map((a, i) => (
            <li key={a.id} style={{ paddingLeft: i * 12 }} className="flex items-center gap-1.5">
              {i > 0 && <CornerDownRight className="h-3 w-3 text-muted-foreground" />}
              <button
                type="button"
                className="truncate text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => select(a.id)}
              >
                {a.title}
              </button>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                {Math.round(a.progress)}%
              </span>
            </li>
          ))}
          <li
            style={{ paddingLeft: ancestors.length * 12 }}
            className="flex items-center gap-1.5 font-medium"
          >
            {ancestors.length > 0 && <CornerDownRight className="h-3 w-3" />}
            <span className="truncate">{node.title}</span>
          </li>
        </ol>
      </section>

      <section className="grid grid-cols-2 gap-px border-b bg-border">
        <div className="bg-background p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Responsavel</div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            {node.assignee ? (
              <>
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                  style={{ backgroundColor: node.assignee.color }}
                >
                  {node.assignee.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="truncate">{node.assignee.name}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Nao atribuida</span>
            )}
          </div>
        </div>
        <div className="bg-background p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Prazo</div>
          <div className="mt-1 text-sm">{formatDateTime(node.due_date, node.all_day)}</div>
          <div className="text-[11px] text-muted-foreground">{relativeDeadline(node.due_date)}</div>
        </div>
      </section>

      <NodeFields node={node} hasChildren={children.length > 0} onSaved={invalidate} />

      <ScheduleSection node={node} onSaved={invalidate} />

      <section className="border-b p-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium uppercase tracking-wide text-muted-foreground">
            {children.length > 0 ? 'Microtarefas (filhas)' : 'Progresso'}
          </span>
          <span className="text-muted-foreground">
            {children.length > 0
              ? `${doneChildren}/${children.length} concluidas`
              : formatDuration(node.estimated_minutes)}
          </span>
        </div>
        <Progress value={node.progress} tone={tone} className="mb-3" />

        {children.map((child) => (
          <div key={child.id} className="flex items-center gap-2 py-1 text-sm">
            <Checkbox
              checked={child.status === 'COMPLETED'}
              disabled={complete.isPending || reopen.isPending}
              aria-label={child.status === 'COMPLETED' ? 'Reabrir subtarefa' : 'Concluir subtarefa'}
              onCheckedChange={() =>
                child.status === 'COMPLETED'
                  ? reopen.mutate(child.id)
                  : complete.mutate(child.id)
              }
            />
            <button
              type="button"
              onClick={() => select(child.id)}
              className={cn(
                'flex-1 truncate text-left hover:underline',
                child.status === 'COMPLETED' && 'text-muted-foreground line-through',
              )}
            >
              {child.title}
            </button>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {Math.round(child.progress)}%
            </span>
          </div>
        ))}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newChild.trim()) addChild.mutate(newChild.trim());
          }}
          className="mt-2 flex items-center gap-1.5"
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={newChild}
            onChange={(e) => setNewChild(e.target.value)}
            placeholder="Adicionar microtarefa e pressionar Enter"
            className="h-7 border-0 px-1 text-xs shadow-none focus-visible:ring-0"
          />
        </form>

        {children.length === 0 && node.status !== 'COMPLETED' && (
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={openBlockers.length > 0 || complete.isPending}
              onClick={() => complete.mutate(node.id)}
            >
              <Check className="h-3.5 w-3.5" />
              Concluir
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBreakdownOpen(true)}>
              Quebrar e delegar
            </Button>
            {onOpenWidget && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenWidget(node)}
                title="Cronometrar em janela flutuante"
              >
                <PictureInPicture2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
        {(node.status === 'COMPLETED' || node.status === 'CANCELLED') && (
          <div className="mt-3 flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={reopen.isPending}
              onClick={() => reopen.mutate(node.id)}
            >
              <Undo2 className="h-3.5 w-3.5" />
              {reopen.isPending ? 'Reabrindo...' : 'Reabrir'}
            </Button>
            <span className="text-[11px] leading-snug text-muted-foreground">
              {node.status === 'CANCELLED'
                ? 'Volta para pendente e recomeca do zero.'
                : 'As tarefas acima voltam a ficar em aberto junto.'}
            </span>
          </div>
        )}

        {children.length > 0 && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            O progresso deste no sobe sozinho conforme as filhas fecham. Ele nao pode ser concluido
            manualmente.
          </p>
        )}
      </section>

      <DependencyEditor
        node={node}
        dependsOn={dependsOn}
        blocksNodes={blocksNodes}
        onSelect={select}
        onSaved={invalidate}
      />

      {activity.length > 0 && (
        <section className="p-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Atividade recente
          </div>
          <ul className="space-y-1.5">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-2 text-xs text-muted-foreground">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                <span>
                  <span className="font-medium text-foreground">{a.actor}</span> {a.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <BreakdownModal
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        parent={node}
        onDone={invalidate}
      />
    </aside>
  );
}


/**
 * Agendamento da tarefa. O interruptor decide a granularidade: em dia inteiro
 * o popover mostra so o calendario; com horario ele ganha o campo de hora
 * logo abaixo, no mesmo popover.
 */
function ScheduleSection({ node, onSaved }: { node: NodeDTO; onSaved: () => void }) {
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
      api.reschedule(node.id, {
        start_date: start,
        due_date: due,
        all_day: allDay,
        cascadeChildren: true,
      }),
    onSuccess: (res) => {
      const moved = res.plan.affected.length;
      const cresceram = res.grew?.length ?? 0;
      toast.success(moved > 0 ? `Agendado. ${moved} subtarefa(s) movida(s).` : 'Agendado.', {
        description:
          cresceram > 0
            ? `${res.grew!.map((g) => `"${g.title}"`).join(', ')} ${
                cresceram > 1 ? 'cresceram' : 'cresceu'
              } para caber.`
            : undefined,
      });
      setDirty(false);
      onSaved();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const change = (setter: (v: string | null) => void) => (value: string | null) => {
    setter(value);
    setDirty(true);
  };

  const durationMinutes =
    start && due ? Math.round((new Date(due).getTime() - new Date(start).getTime()) / 60000) : null;

  return (
    <section className="border-b p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Agendamento
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Dia inteiro
          <Switch
            checked={allDay}
            onCheckedChange={(v) => {
              setAllDay(v);
              setDirty(true);
            }}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] text-muted-foreground" htmlFor={`start-${node.id}`}>
            Inicio
          </label>
          <DateTimeField
            id={`start-${node.id}`}
            size="sm"
            showTime={!allDay}
            value={start}
            onChange={change(setStart)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-muted-foreground" htmlFor={`due-${node.id}`}>
            Termino
          </label>
          <DateTimeField
            id={`due-${node.id}`}
            size="sm"
            showTime={!allDay}
            value={due}
            onChange={change(setDue)}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {durationMinutes != null && durationMinutes > 0
            ? `Ocupa ${formatDuration(durationMinutes)}`
            : 'Defina inicio e termino'}
        </span>
        {dirty && (
          <Button size="xs" onClick={() => save.mutate()} disabled={save.isPending}>
            Salvar agendamento
          </Button>
        )}
      </div>
    </section>
  );
}
