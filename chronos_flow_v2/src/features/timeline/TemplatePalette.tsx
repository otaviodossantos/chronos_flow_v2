import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Plus, Repeat2, Trash2, X, Clock, Weight } from 'lucide-react';
import { toast } from 'sonner';
import type { TaskTemplateDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useTimelineStore } from '@/stores/timelineStore';

/**
 * Estante de modelos do espaco ativo. Nao gera nada sozinha: cada item e um
 * preenchedor que so vira tarefa quando voce arrasta para a timeline. Fica
 * colada na arvore porque e para la que o gesto vai.
 */

interface FormState {
  id: string | null;
  title: string;
  description: string;
  estimated_minutes: string;
  weight: string;
  importance: number;
  assignee_id: string;
}

const emptyForm = (): FormState => ({
  id: null,
  title: '',
  description: '',
  estimated_minutes: '',
  weight: '',
  importance: 3,
  assignee_id: '',
});

export function TemplatePalette() {
  const { spaceId, paletteOpen, togglePalette, setDraggingTemplate, draggingTemplateId } =
    useTimelineStore();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);

  const { data: templates = [] } = useQuery({
    queryKey: ['templates', spaceId],
    queryFn: () => api.templates(spaceId),
    enabled: paletteOpen,
  });
  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: api.members,
    enabled: paletteOpen,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['templates'] });

  const save = useMutation({
    mutationFn: (data: FormState) => {
      const minutes = data.estimated_minutes ? Number(data.estimated_minutes) : null;
      const body = {
        title: data.title,
        description: data.description || null,
        estimated_minutes: minutes,
        // Peso em branco segue a mesma regra do resto do app: derivado do
        // tempo estimado, para nao obrigar ninguem a inventar um numero.
        ...(data.weight ? { weight: Number(data.weight) } : {}),
        importance: data.importance,
        assignee_id: data.assignee_id || null,
      };
      return data.id
        ? api.updateTemplate(data.id, body)
        : api.createTemplate({ ...body, space_id: spaceId });
    },
    onSuccess: () => {
      setForm(null);
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: () => {
      toast.success('Modelo removido. As tarefas criadas a partir dele ficam como estao.');
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  if (!paletteOpen) return null;

  const semEspaco = !spaceId;

  return (
    <aside className="flex w-[228px] shrink-0 flex-col border-r bg-card">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Repeat2 className="h-3.5 w-3.5" />
          Modelos
        </span>
        <button
          type="button"
          onClick={togglePalette}
          aria-label="Fechar modelos"
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {semEspaco ? (
          <p className="px-1 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
            Os modelos pertencem a um espaco. Escolha um na barra lateral para ver os dele.
          </p>
        ) : (
          <>
            {templates.length === 0 && !form && (
              <p className="px-1 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
                Nenhum modelo ainda. Cadastre as tarefas que voce repete e arraste para a timeline
                quando precisar.
              </p>
            )}

            {templates.map((t) => (
              <TemplateChip
                key={t.id}
                template={t}
                dragging={draggingTemplateId === t.id}
                onDragStart={() => setDraggingTemplate(t.id)}
                onDragEnd={() => setDraggingTemplate(null)}
                onEdit={() =>
                  setForm({
                    id: t.id,
                    title: t.title,
                    description: t.description ?? '',
                    estimated_minutes: t.estimated_minutes ? String(t.estimated_minutes) : '',
                    weight: String(t.weight),
                    importance: t.importance,
                    assignee_id: t.assignee_id ?? '',
                  })
                }
                onDelete={() => remove.mutate(t.id)}
              />
            ))}

            {form ? (
              <form
                className="mt-2 space-y-2 rounded-md border bg-background p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (form.title.trim()) save.mutate(form);
                }}
              >
                <Input
                  autoFocus
                  value={form.title}
                  placeholder="Nome da tarefa"
                  className="h-8 text-xs"
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
                <Textarea
                  value={form.description}
                  placeholder="Descricao (opcional)"
                  className="min-h-[52px] text-xs"
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="mb-1 block text-[10px]">Tempo (min)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.estimated_minutes}
                      placeholder="30"
                      className="h-8 text-xs"
                      onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-[10px]">Peso</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.weight}
                      placeholder="auto"
                      className="h-8 text-xs"
                      onChange={(e) => setForm({ ...form, weight: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label className="mb-1 block text-[10px]">Responsavel sugerido</Label>
                  <Select
                    className="h-8 w-full"
                    value={form.assignee_id}
                    onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}
                  >
                    <option value="">Ninguem</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    type="submit"
                    size="xs"
                    className="flex-1"
                    disabled={!form.title.trim() || save.isPending}
                  >
                    {form.id ? 'Salvar' : 'Criar'}
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setForm(null)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setForm(emptyForm())}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Novo modelo
              </button>
            )}
          </>
        )}
      </div>

      <p className="shrink-0 border-t p-2 text-[10px] leading-relaxed text-muted-foreground">
        Arraste para a arvore ou para o canvas. No canvas, a coluna onde voce solta vira a data de
        inicio.
      </p>
    </aside>
  );
}

function TemplateChip({
  template,
  dragging,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
}: {
  template: TaskTemplateDTO;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy';
        // O tipo e o que a arvore e o canvas conseguem ler durante o dragover;
        // o id vai pelo store.
        e.dataTransfer.setData('application/x-chronos-template', template.id);
        e.dataTransfer.setData('text/plain', template.title);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDoubleClick={onEdit}
      title={`${template.title}\nClique duplo para editar`}
      className={cn(
        'group mb-1.5 cursor-grab rounded-md border bg-background p-2 transition-colors hover:border-primary/50',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        <span className="min-w-0 flex-1 text-xs font-medium leading-tight">{template.title}</span>
        <button
          type="button"
          aria-label={`Excluir modelo ${template.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <div className="mt-1 flex items-center gap-2 pl-5 text-[10px] text-muted-foreground">
        {template.estimated_minutes && (
          <span className="flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {formatDuration(template.estimated_minutes)}
          </span>
        )}
        <span className="flex items-center gap-0.5">
          <Weight className="h-2.5 w-2.5" />
          {template.weight}
        </span>
        {template.assignee && (
          <span
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-semibold text-white"
            style={{ backgroundColor: template.assignee.color }}
            title={template.assignee.name}
          >
            {template.assignee.name.slice(0, 1)}
          </span>
        )}
        {template.uses > 0 && <span className="ml-auto font-mono">{template.uses}x</span>}
      </div>
    </div>
  );
}
