import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Trash2, Plus, CheckCheck, CalendarDays, Timer, Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { NodeDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate, levelLabel } from '@/lib/format';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateField } from '@/components/DateField';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

interface Draft {
  title: string;
  assignee_id: string;
  estimated_minutes: number;
  due_date: string;
}

const emptyDraft = (due: string): Draft => ({
  title: '',
  assignee_id: '',
  estimated_minutes: 120,
  due_date: due,
});

export function BreakdownModal({
  open,
  onOpenChange,
  parent,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  parent: NodeDTO;
  onDone: () => void;
}) {
  const parentDue = parent.due_date ? parent.due_date.slice(0, 10) : '';
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft(parentDue)]);
  const [notify, setNotify] = useState(true);

  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: api.members });

  const submit = useMutation({
    mutationFn: () =>
      api.breakdown(parent.id, {
        children: drafts
          .filter((d) => d.title.trim())
          .map((d) => ({
            title: d.title.trim(),
            assignee_id: d.assignee_id || null,
            estimated_minutes: d.estimated_minutes,
            due_date: d.due_date ? new Date(`${d.due_date}T12:00:00`).toISOString() : null,
          })),
        notify_on_delay: notify,
      }),
    onSuccess: (res) => {
      toast.success(
        `${res.children.length} subtarefa(s) criada(s). O peso foi dividido na cascata.`,
      );
      setDrafts([emptyDraft(parentDue)]);
      onOpenChange(false);
      onDone();
    },
    onError: (e: ApiError) => toast.error(e.message, { description: describeDetails(e.details) }),
  });

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const loadOf = (id: string) => members.find((m) => m.id === id)?.loadPercent ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Quebrar e delegar subtarefa</DialogTitle>
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" />
              Heranca de restricoes temporais
            </Badge>
          </div>
          <DialogDescription>
            Criacao de nos filhos vinculados ao fluxo de progresso cascateado.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-4 rounded-lg border p-3">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Tarefa pai de origem</span>
            <span className="font-mono">{levelLabel(parent.depth)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="truncate font-medium">{parent.title}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              Prazo max: <strong>{formatDate(parent.due_date)}</strong>
            </span>
          </div>
          <p className="mt-2 rounded bg-secondary/60 p-2 text-xs text-muted-foreground">
            As novas tarefas filhas herdam o prazo maximo de {formatDate(parent.due_date)} e dividem
            o peso na cascata da meta pai.
          </p>
        </div>

        <div className="max-h-[320px] space-y-3 overflow-y-auto">
          {drafts.map((draft, i) => {
            const load = loadOf(draft.assignee_id);
            const overParent = Boolean(
              parentDue && draft.due_date && draft.due_date > parentDue,
            );

            return (
              <div key={i} className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Label>Titulo da subtarefa folha</Label>
                  {drafts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDrafts((p) => p.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remover"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Input
                  value={draft.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder="Ex: Calculo de colisao de curvas Bezier"
                  className="mb-3"
                />

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="mb-1 block">Responsavel</Label>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={draft.assignee_id}
                        onChange={(e) => update(i, { assignee_id: e.target.value })}
                        className="h-9 flex-1"
                      >
                        <option value="">Nao atribuida</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} — {m.role ?? 'sem cargo'}
                          </option>
                        ))}
                      </Select>
                      {draft.assignee_id && (
                        <Badge variant={load > 100 ? 'critical' : load > 80 ? 'warning' : 'good'}>
                          {load}%
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div>
                    <Label className="mb-1 block">Estimativa de esforco</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        min={15}
                        step={15}
                        value={draft.estimated_minutes}
                        onChange={(e) =>
                          update(i, { estimated_minutes: Number(e.target.value) || 60 })
                        }
                      />
                      <Timer className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Vira o peso do no na cascata.
                    </p>
                  </div>

                  <div>
                    <Label className="mb-1 block">Prazo limite</Label>
                    <DateField
                      value={draft.due_date}
                      max={parentDue || undefined}
                      placeholder="Sem prazo"
                      onChange={(due_date) => update(i, { due_date })}
                    />
                    <p
                      className={cn(
                        'mt-1 text-[10px]',
                        overParent
                          ? 'text-[hsl(var(--status-critical))]'
                          : 'text-[hsl(var(--status-good))]',
                      )}
                    >
                      {overParent
                        ? 'Ultrapassa o prazo da tarefa pai'
                        : `Dentro do prazo da tarefa pai (${formatDate(parent.due_date)})`}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          onClick={() => setDrafts((p) => [...p, emptyDraft(parentDue)])}
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar outra subtarefa
        </Button>

        <label className="mt-4 flex items-center justify-between rounded-lg border p-3">
          <span>
            <span className="block text-sm">Notificar sobre dependencia em caso de atraso</span>
            <span className="block text-xs text-muted-foreground">
              Alerta na abertura do app e nos responsaveis ancestrais
            </span>
          </span>
          <Switch checked={notify} onCheckedChange={setNotify} />
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || !drafts.some((d) => d.title.trim())}
          >
            <CheckCheck className="h-4 w-4" />
            Criar subtarefas e transferir responsabilidade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describeDetails(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const d = details as Record<string, unknown>;
  if (Array.isArray(d.pending)) return `Pendentes: ${d.pending.join(', ')}`;
  if (Array.isArray(d.path)) return `Ciclo: ${d.path.join(' -> ')}`;
  return undefined;
}
