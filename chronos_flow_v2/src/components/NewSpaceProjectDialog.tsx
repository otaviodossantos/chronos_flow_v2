import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Target } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateField } from '@/components/DateField';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

/**
 * Espaco e a pasta (cliente, area, produto); projeto e a meta macro, o no raiz
 * que a timeline desenha. Como os dois nascem do mesmo "+" da sidebar, moram no
 * mesmo dialogo em abas em vez de dois modais quase iguais.
 */
export type NewKind = 'space' | 'project';

const SWATCHES = [
  '#22c55e', '#0ea5e9', '#8b5cf6', '#f97316',
  '#ec4899', '#eab308', '#14b8a6', '#64748b',
];

const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const plusMonths = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * "2026-10-01" vira meia-noite UTC se for direto pro `new Date`, e no fuso de
 * Brasilia isso volta como dia 30. Ancorar no horario local resolve.
 */
const atLocal = (input: string, hour: number) => {
  const [y, m, d] = input.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).toISOString();
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultKind?: NewKind;
  /** Espaco pre-selecionado na aba de projeto (o que esta ativo na sidebar). */
  defaultSpaceId?: string | null;
  onCreatedSpace?: (spaceId: string) => void;
  onCreatedProject?: (nodeId: string) => void;
}

export function NewSpaceProjectDialog({
  open,
  onOpenChange,
  defaultKind = 'space',
  defaultSpaceId = null,
  onCreatedSpace,
  onCreatedProject,
}: Props) {
  const queryClient = useQueryClient();
  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });

  const [kind, setKind] = useState<NewKind>(defaultKind);
  const [spaceName, setSpaceName] = useState('');
  const [spaceDescription, setSpaceDescription] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);

  const [title, setTitle] = useState('');
  const [spaceId, setSpaceId] = useState<string>(defaultSpaceId ?? '');
  const [start, setStart] = useState(todayInput);
  const [due, setDue] = useState(() => plusMonths(3));
  const [importance, setImportance] = useState(4);

  // Reabrir com o formulario anterior preenchido e pior que reabrir vazio: o
  // usuario acaba criando duplicado sem perceber.
  useEffect(() => {
    if (!open) return;
    setKind(defaultKind);
    setSpaceName('');
    setSpaceDescription('');
    setColor(SWATCHES[spaces.length % SWATCHES.length]);
    setTitle('');
    setSpaceId(defaultSpaceId ?? '');
    setStart(todayInput());
    setDue(plusMonths(3));
    setImportance(4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const createSpace = useMutation({
    mutationFn: () =>
      api.createSpace({
        name: spaceName.trim(),
        description: spaceDescription.trim() || null,
        color,
      }),
    onSuccess: (space) => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      toast.success(`Espaco "${space.name}" criado.`);
      onCreatedSpace?.(space.id);
      onOpenChange(false);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const createProject = useMutation({
    mutationFn: () =>
      api.createNode({
        title: title.trim(),
        space_id: spaceId || null,
        start_date: start ? atLocal(start, 9) : null,
        due_date: due ? atLocal(due, 18) : null,
        importance,
      }),
    onSuccess: (node) => {
      queryClient.invalidateQueries({ queryKey: ['tree'] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      toast.success(`Projeto "${node.title}" criado.`);
      onCreatedProject?.(node.id);
      onOpenChange(false);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const dueBeforeStart = Boolean(start && due && due < start);
  const canSubmit =
    kind === 'space'
      ? spaceName.trim().length > 0 && !createSpace.isPending
      : title.trim().length > 0 && !dueBeforeStart && !createProject.isPending;

  const submit = () => {
    if (!canSubmit) return;
    if (kind === 'space') createSpace.mutate();
    else createProject.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        }}
      >
        <DialogHeader>
          <DialogTitle>Novo</DialogTitle>
          <DialogDescription>
            Espacos agrupam o trabalho. Projetos sao as metas macro dentro deles.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={kind} onValueChange={(v) => setKind(v as NewKind)}>
          <TabsList className="mb-4 w-full">
            <TabsTrigger value="space" className="flex-1 gap-1.5">
              <FolderPlus className="h-3.5 w-3.5" />
              Espaco
            </TabsTrigger>
            <TabsTrigger value="project" className="flex-1 gap-1.5">
              <Target className="h-3.5 w-3.5" />
              Projeto
            </TabsTrigger>
          </TabsList>

          <TabsContent value="space" className="space-y-3 focus-visible:outline-none">
            <div>
              <Label className="mb-1 block" htmlFor="space-name">
                Nome
              </Label>
              <Input
                id="space-name"
                autoFocus
                value={spaceName}
                placeholder="Ex: Plataforma v2.0"
                onChange={(e) => setSpaceName(e.target.value)}
              />
            </div>

            <div>
              <Label className="mb-1.5 block">Cor</Label>
              <div className="flex flex-wrap gap-2">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Cor ${c}`}
                    aria-pressed={color === c}
                    onClick={() => setColor(c)}
                    className={cn(
                      'h-7 w-7 rounded-full transition-transform',
                      color === c
                        ? 'ring-2 ring-foreground ring-offset-2 ring-offset-popover'
                        : 'hover:scale-110',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            <div>
              <Label className="mb-1 block" htmlFor="space-desc">
                Descricao <span className="font-normal">(opcional)</span>
              </Label>
              <Textarea
                id="space-desc"
                value={spaceDescription}
                placeholder="O que entra neste espaco"
                className="min-h-[60px] text-xs"
                onChange={(e) => setSpaceDescription(e.target.value)}
              />
            </div>
          </TabsContent>

          <TabsContent value="project" className="space-y-3 focus-visible:outline-none">
            <div>
              <Label className="mb-1 block" htmlFor="project-title">
                Titulo
              </Label>
              <Input
                id="project-title"
                autoFocus
                value={title}
                placeholder="Ex: Lancar o app no fim do trimestre"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block" htmlFor="project-space">
                  Espaco
                </Label>
                <Select
                  id="project-space"
                  className="h-9 w-full text-sm"
                  value={spaceId}
                  onChange={(e) => setSpaceId(e.target.value)}
                >
                  <option value="">Sem espaco</option>
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label className="mb-1 block" htmlFor="project-importance">
                  Criticidade
                </Label>
                <Select
                  id="project-importance"
                  className="h-9 w-full text-sm"
                  value={importance}
                  onChange={(e) => setImportance(Number(e.target.value))}
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
                <Label className="mb-1 block" htmlFor="project-start">
                  Inicio
                </Label>
                <DateField id="project-start" value={start} onChange={setStart} />
              </div>
              <div>
                <Label className="mb-1 block" htmlFor="project-due">
                  Entrega
                </Label>
                <DateField
                  id="project-due"
                  value={due}
                  min={start || undefined}
                  onChange={setDue}
                />
              </div>
            </div>

            {dueBeforeStart && (
              <p className="text-xs text-destructive">A entrega esta antes do inicio.</p>
            )}
            {spaces.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Ainda nao ha espacos. Da pra criar o projeto solto e mover depois.
              </p>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {kind === 'space' ? 'Criar espaco' : 'Criar projeto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
