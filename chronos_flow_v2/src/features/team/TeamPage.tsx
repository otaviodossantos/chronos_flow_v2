import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users, X, Plus, FolderOpen, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberDTO, SpaceDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const TRAINING_LABEL: Record<string, string> = {
  NOT_STARTED: 'Supervisao direta',
  IN_TRAINING: 'Em treinamento',
  AUTONOMOUS: 'Autonomo',
};

type View = 'by-space' | 'all';

interface FormState {
  id: string | null;
  name: string;
  role: string;
  whatsapp: string;
  email: string;
  capacity_hours_week: number;
  training_level: string;
  space_ids: string[];
}

const emptyForm = (space_ids: string[] = []): FormState => ({
  id: null,
  name: '',
  role: '',
  whatsapp: '',
  email: '',
  capacity_hours_week: 40,
  training_level: 'NOT_STARTED',
  space_ids,
});

function loadTone(load: number) {
  return load > 100 ? 'critical' : load > 80 ? 'warning' : 'good';
}

export function TeamPage() {
  const [view, setView] = useState<View>('by-space');
  const [form, setForm] = useState<FormState | null>(null);
  const queryClient = useQueryClient();

  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: api.members });
  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['members'] });
    queryClient.invalidateQueries({ queryKey: ['spaces'] });
  };

  const save = useMutation({
    mutationFn: (data: FormState) => {
      const body = {
        name: data.name,
        role: data.role || null,
        whatsapp: data.whatsapp || null,
        email: data.email || null,
        capacity_hours_week: data.capacity_hours_week,
        training_level: data.training_level,
        space_ids: data.space_ids,
      };
      return data.id ? api.updateMember(data.id, body) : api.createMember(body);
    },
    onSuccess: (_r, data) => {
      toast.success(data.id ? 'Membro atualizado.' : 'Membro adicionado.');
      setForm(null);
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const link = useMutation({
    mutationFn: ({ spaceId, memberId }: { spaceId: string; memberId: string }) =>
      api.addMemberToSpace(spaceId, memberId),
    onSuccess: () => invalidate(),
    onError: (e: ApiError) => toast.error(e.message),
  });

  const unlink = useMutation({
    mutationFn: ({ spaceId, memberId }: { spaceId: string; memberId: string }) =>
      api.removeMemberFromSpace(spaceId, memberId),
    onSuccess: (res) => {
      // Desvincular nao mexe em tarefa nenhuma — se sobrou trabalho, avisa.
      if (res.stillAssigned > 0) {
        toast.warning(
          `Desvinculado. ${res.stillAssigned} tarefa(s) em aberto continuam com essa pessoa.`,
        );
      } else {
        toast.success('Desvinculado do espaco.');
      }
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const membersOf = useMemo(() => {
    const map = new Map<string, MemberDTO[]>();
    for (const space of spaces) {
      map.set(
        space.id,
        members.filter((m) => m.spaces?.some((s) => s.id === space.id)),
      );
    }
    return map;
  }, [members, spaces]);

  const unassigned = members.filter((m) => (m.spaces?.length ?? 0) === 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Equipe e delegacao</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Uma pessoa pode atuar em quantos espacos for preciso. O vinculo controla onde ela
              aparece; as tarefas ja atribuidas continuam dela em qualquer caso.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border p-0.5">
              {(
                [
                  ['by-space', 'Por espaco'],
                  ['all', 'Todos os membros'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    view === id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button onClick={() => setForm(emptyForm())}>
              <UserPlus className="h-4 w-4" />
              Adicionar membro
            </Button>
          </div>
        </div>

        {members.length === 0 && (
          <Card className="mt-6">
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <Users className="h-6 w-6 opacity-40" />
              Nenhum membro cadastrado ainda.
            </CardContent>
          </Card>
        )}

        {view === 'by-space' && members.length > 0 && (
          <div className="mt-6 space-y-4">
            {spaces.map((space) => (
              <SpaceGroup
                key={space.id}
                space={space}
                members={membersOf.get(space.id) ?? []}
                allMembers={members}
                onLink={(memberId) => link.mutate({ spaceId: space.id, memberId })}
                onUnlink={(memberId) => unlink.mutate({ spaceId: space.id, memberId })}
                onCreate={() => setForm(emptyForm([space.id]))}
                onEdit={(m) => setForm(toForm(m))}
              />
            ))}

            {unassigned.length > 0 && (
              <Card className="border-dashed">
                <CardContent className="p-4">
                  <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Sem espaco vinculado ({unassigned.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {unassigned.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setForm(toForm(m))}
                        className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm hover:bg-accent"
                      >
                        <Avatar member={m} />
                        {m.name}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {view === 'all' && members.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {members.map((m) => (
              <MemberCard
                key={m.id}
                member={m}
                spaces={spaces}
                onEdit={() => setForm(toForm(m))}
                onLink={(spaceId) => link.mutate({ spaceId, memberId: m.id })}
                onUnlink={(spaceId) => unlink.mutate({ spaceId, memberId: m.id })}
              />
            ))}
          </div>
        )}
      </div>

      <MemberDialog
        form={form}
        spaces={spaces}
        onChange={setForm}
        onClose={() => setForm(null)}
        onSave={() => form && save.mutate(form)}
        saving={save.isPending}
      />
    </div>
  );
}

function toForm(m: MemberDTO): FormState {
  return {
    id: m.id,
    name: m.name,
    role: m.role ?? '',
    whatsapp: m.whatsapp ?? '',
    email: m.email ?? '',
    capacity_hours_week: m.capacity_hours_week,
    training_level: m.training_level,
    space_ids: m.spaces?.map((s) => s.id) ?? [],
  };
}

function Avatar({ member, size = 'sm' }: { member: MemberDTO; size?: 'sm' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        size === 'lg' ? 'h-10 w-10 text-sm' : 'h-6 w-6 text-[10px]',
      )}
      style={{ backgroundColor: member.color }}
    >
      {member.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function SpaceGroup({
  space,
  members,
  allMembers,
  onLink,
  onUnlink,
  onCreate,
  onEdit,
}: {
  space: SpaceDTO;
  members: MemberDTO[];
  allMembers: MemberDTO[];
  onLink: (memberId: string) => void;
  onUnlink: (memberId: string) => void;
  onCreate: () => void;
  onEdit: (m: MemberDTO) => void;
}) {
  const available = allMembers.filter((m) => !members.some((x) => x.id === m.id));

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: space.color }} />
          <h2 className="font-semibold">{space.name}</h2>
          <Badge variant="secondary">{members.length} pessoa(s)</Badge>
          <span className="text-xs text-muted-foreground">
            {space.nodeCount} tarefa(s) · {Math.round(space.progress)}% concluido
          </span>

          <div className="ml-auto flex items-center gap-2">
            <Select
              value=""
              onChange={(e) => e.target.value && onLink(e.target.value)}
              disabled={available.length === 0}
              aria-label={`Vincular membro a ${space.name}`}
            >
              <option value="">
                {available.length === 0 ? 'Todos ja vinculados' : 'Vincular membro...'}
              </option>
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.role ? ` — ${m.role}` : ''}
                </option>
              ))}
            </Select>
            <Button variant="outline" size="sm" onClick={onCreate}>
              <Plus className="h-3.5 w-3.5" />
              Novo membro aqui
            </Button>
          </div>
        </div>

        {members.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            Nenhuma pessoa neste espaco ainda.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {members.map((m) => {
              const here = m.spaceLoad?.find((l) => l.space_id === space.id);
              const others = (m.spaces ?? []).filter((s) => s.id !== space.id);

              return (
                <div
                  key={m.id}
                  className="flex items-center gap-2.5 rounded-lg border p-2.5"
                >
                  <Avatar member={m} />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onEdit(m)}
                      className="block max-w-full truncate text-left text-sm font-medium hover:underline"
                    >
                      {m.name}
                    </button>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {here
                        ? `${here.openLeaves} tarefa(s) · ${formatDuration(here.openMinutes)} aqui`
                        : 'sem tarefas neste espaco'}
                    </div>
                  </div>

                  {others.length > 0 && (
                    <Badge
                      variant="outline"
                      className="shrink-0"
                      title={`Tambem em: ${others.map((o) => o.name).join(', ')}`}
                    >
                      +{others.length} espaco{others.length > 1 ? 's' : ''}
                    </Badge>
                  )}

                  <Badge variant={loadTone(m.loadPercent ?? 0)} className="shrink-0">
                    {m.loadPercent ?? 0}%
                  </Badge>

                  <button
                    type="button"
                    onClick={() => onUnlink(m.id)}
                    title={`Desvincular de ${space.name}`}
                    aria-label={`Desvincular ${m.name} de ${space.name}`}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MemberCard({
  member,
  spaces,
  onEdit,
  onLink,
  onUnlink,
}: {
  member: MemberDTO;
  spaces: SpaceDTO[];
  onEdit: () => void;
  onLink: (spaceId: string) => void;
  onUnlink: (spaceId: string) => void;
}) {
  const linked = member.spaces ?? [];
  const available = spaces.filter((s) => !linked.some((l) => l.id === s.id));
  const load = member.loadPercent ?? 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar member={member} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{member.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {member.role ?? 'Sem cargo definido'}
            </div>
          </div>
          <Badge variant={loadTone(load)}>{load}%</Badge>
          <button
            type="button"
            onClick={onEdit}
            title="Editar membro"
            aria-label={`Editar ${member.name}`}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-3">
          <Progress value={Math.min(load, 100)} tone={loadTone(load)} />
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {formatDuration(member.openMinutes)} abertos de {member.capacity_hours_week}h/semana
            </span>
            <span>{member.openLeaves ?? 0} tarefa(s)</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{TRAINING_LABEL[member.training_level]}</Badge>

          {linked.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
              <button
                type="button"
                onClick={() => onUnlink(s.id)}
                title={`Desvincular de ${s.name}`}
                aria-label={`Desvincular de ${s.name}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}

          {available.length > 0 && (
            <Select
              value=""
              onChange={(e) => e.target.value && onLink(e.target.value)}
              className="h-6 text-[11px]"
              aria-label={`Vincular ${member.name} a um espaco`}
            >
              <option value="">+ espaco</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}

          {linked.length === 0 && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <FolderOpen className="h-3 w-3" />
              sem espaco
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MemberDialog({
  form,
  spaces,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  form: FormState | null;
  spaces: SpaceDTO[];
  onChange: (f: FormState) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  if (!form) return null;

  const toggleSpace = (id: string) =>
    onChange({
      ...form,
      space_ids: form.space_ids.includes(id)
        ? form.space_ids.filter((x) => x !== id)
        : [...form.space_ids, id],
    });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.id ? 'Editar membro' : 'Adicionar membro'}</DialogTitle>
          <DialogDescription>
            Marque todos os espacos em que a pessoa atua — ela aparece em cada um deles.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="mb-1 block">Nome</Label>
            <Input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block">Cargo</Label>
              <Input value={form.role} onChange={(e) => onChange({ ...form, role: e.target.value })} />
            </div>
            <div>
              <Label className="mb-1 block">WhatsApp</Label>
              <Input
                value={form.whatsapp}
                onChange={(e) => onChange({ ...form, whatsapp: e.target.value })}
                placeholder="+55 11 90000-0000"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block">Capacidade (h/semana)</Label>
              <Input
                type="number"
                min={1}
                max={80}
                value={form.capacity_hours_week}
                onChange={(e) =>
                  onChange({ ...form, capacity_hours_week: Number(e.target.value) || 40 })
                }
              />
            </div>
            <div>
              <Label className="mb-1 block">Autonomia</Label>
              <Select
                className="h-9 w-full"
                value={form.training_level}
                onChange={(e) => onChange({ ...form, training_level: e.target.value })}
              >
                {Object.entries(TRAINING_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">
              Espacos ({form.space_ids.length} de {spaces.length})
            </Label>
            {spaces.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum espaco criado ainda. Crie um na Timeline.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {spaces.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      checked={form.space_ids.includes(s.id)}
                      onCheckedChange={() => toggleSpace(s.id)}
                    />
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="truncate">{s.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={!form.name.trim() || saving}>
            {form.id ? 'Salvar' : 'Adicionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
