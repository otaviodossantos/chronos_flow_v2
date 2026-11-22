import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users, X, Plus, FolderOpen, Pencil, BookUser } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberDTO, SpaceDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/format';
import { contatos, noAparelho, sistema, type Contato } from '@/native/chronos';
import { corPara, filtrarContatos, jaCadastrado, LINHAS_POR_VEZ } from './daAgenda';
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
  const [daAgenda, setDaAgenda] = useState<Contato[] | null>(null);
  const [buscandoAgenda, setBuscandoAgenda] = useState(false);
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

  /**
   * Varias pessoas de uma vez, vindas da agenda.
   *
   * Uma a uma, em serie, e nao em paralelo: a posicao de cada membro sai de um
   * `select` do ultimo gravado, e quatro inserts simultaneos leriam todos a
   * mesma posicao.
   */
  const adicionarVarios = useMutation({
    mutationFn: async (escolhidos: Contato[]) => {
      let criados = 0;
      for (const c of escolhidos) {
        await api.createMember({
          name: c.nome,
          email: c.email || null,
          whatsapp: c.telefone || null,
          // Uma cor por pessoa, em vez do mesmo indigo para todas: os avatares
          // da timeline sao duas letras num circulo, e sem cor eles viram uma
          // fileira de circulos iguais.
          color: corPara(members.length + criados),
        });
        criados += 1;
      }
      return criados;
    },
    onSuccess: (criados) => {
      setDaAgenda(null);
      toast.success(criados === 1 ? '1 pessoa adicionada.' : `${criados} pessoas adicionadas.`);
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  /**
   * Abre a agenda do iPhone na lista com busca.
   *
   * Se a permissao for negada, cai no seletor do sistema, que funciona sem
   * permissao nenhuma — perde a busca, mas continua dando para cadastrar.
   * Deixar so a mensagem de "sem acesso" seria trocar uma inconveniencia por
   * uma parede.
   */
  const abrirAgenda = async () => {
    setBuscandoAgenda(true);
    const r = await contatos.listar();
    setBuscandoAgenda(false);

    if (r.ok) {
      if (r.contatos.length === 0) {
        toast.info('A agenda deste iPhone esta vazia.');
        return;
      }
      setDaAgenda(r.contatos);
      return;
    }

    if (r.motivo === 'fora-do-aparelho') {
      toast.info('A agenda so abre no iPhone. No navegador, cadastre a mao.');
      return;
    }
    if (r.motivo === 'plugin-ausente') {
      toast.error('Esta versao do app nao tem a agenda.', {
        description: 'Rode npm run sync e recompile no Xcode.',
      });
      return;
    }
    if (r.motivo === 'permissao-negada') {
      toast.warning('Sem acesso aos contatos: a busca fica de fora.', {
        description: 'Abrindo o seletor do sistema.',
        action: { label: 'Ajustes', onClick: () => void sistema.abrirAjustes() },
      });
      await seletorDoSistema();
      return;
    }
    toast.error('Nao foi possivel ler a agenda.', { description: r.detalhe });
  };

  /** O caminho sem permissao: o seletor do iOS, sem busca. */
  const seletorDoSistema = async () => {
    setBuscandoAgenda(true);
    const r = await contatos.escolher();
    setBuscandoAgenda(false);
    if (!r.ok) {
      toast.error('Nao foi possivel abrir a agenda.', { description: r.detalhe });
      return;
    }
    if (r.cancelado || r.contatos.length === 0) return;

    // Uma pessoa so vai direto para o formulario completo: e a hora de dizer
    // o papel e a carga dela. Em lote isso viraria um interrogatorio.
    if (r.contatos.length === 1) {
      const c = r.contatos[0];
      setForm({ ...emptyForm(), name: c.nome, email: c.email, whatsapp: c.telefone });
      return;
    }
    setDaAgenda(r.contatos);
  };

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
      <div className="mx-auto max-w-[1400px] p-3">
        {/*
          Sem titulo proprio: quem chega aqui passou por "Mais", e a barra de
          navegacao logo acima ja escreve "Equipe". Repeti-lo custava um titulo
          de 30px mais tres linhas de explicacao, e a lista de espacos so
          comecava a um terco da altura da tela.
        */}
        <p className="text-xs leading-snug text-muted-foreground">
          Uma pessoa pode atuar em quantos espacos for preciso. As tarefas ja atribuidas continuam
          dela em qualquer caso.
        </p>

        {/* Os dois controles em linhas proprias: lado a lado, "Todos os
            membros" quebrava no meio e o botao ficava com 100px. */}
        <div className="mt-2 flex rounded-lg border p-0.5">
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
                'min-h-[34px] flex-1 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors',
                view === id
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Button className="flex-1" onClick={() => setForm(emptyForm())}>
            <UserPlus className="h-4 w-4" />
            Adicionar
          </Button>
          {/* So no aparelho: no navegador o botao abriria um toast dizendo
              que nao da, que e pior do que nao existir. */}
          {noAparelho() && (
            <Button variant="outline" className="flex-1" disabled={buscandoAgenda} onClick={abrirAgenda}>
              <BookUser className="h-4 w-4" />
              Da agenda
            </Button>
          )}
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

      {daAgenda && (
        <FolhaDeContatos
          contatos={daAgenda}
          jaCadastrados={members}
          salvando={adicionarVarios.isPending}
          onFechar={() => setDaAgenda(null)}
          onConfirmar={(escolhidos) => adicionarVarios.mutate(escolhidos)}
        />
      )}

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

/**
 * A agenda do iPhone, dentro do app, com busca.
 *
 * O seletor do sistema nao tem campo de pesquisa quando esta em selecao
 * multipla: numa agenda de centenas de nomes, achar quatro pessoas vira
 * rolagem pela letra inicial. Esta folha existe por isso, e faz de uma vez o
 * que antes eram duas telas — escolher e conferir.
 *
 * Ela tambem resolve duas coisas que o seletor do sistema nao sabe: marcar
 * quem ja esta no time e deixar tirar quem entrou por engano, tudo antes de
 * gravar, que e quando desfazer custa caro.
 */
function FolhaDeContatos({
  contatos: agenda,
  jaCadastrados,
  salvando,
  onFechar,
  onConfirmar,
}: {
  contatos: Contato[];
  jaCadastrados: MemberDTO[];
  salvando: boolean;
  onFechar: () => void;
  onConfirmar: (escolhidos: Contato[]) => void;
}) {
  const [busca, setBusca] = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [soMarcados, setSoMarcados] = useState(false);

  const repetidos = useMemo(
    () => new Set(agenda.filter((c) => jaCadastrado(c, jaCadastrados)).map((c) => c.id)),
    [agenda, jaCadastrados],
  );

  const alternar = (id: string) =>
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });

  const filtrados = useMemo(() => {
    const base = soMarcados ? agenda.filter((c) => marcados.has(c.id)) : agenda;
    return filtrarContatos(base, busca);
  }, [agenda, busca, soMarcados, marcados]);

  const visiveis = filtrados.slice(0, LINHAS_POR_VEZ);
  const escondidos = filtrados.length - visiveis.length;
  const selecionados = agenda.filter((c) => marcados.has(c.id));

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-background">
      <header className="flex shrink-0 items-center gap-1 border-b px-1 py-1">
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar a agenda"
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Da agenda</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {agenda.length.toLocaleString('pt-BR')} contatos neste iPhone
          </p>
        </div>
      </header>

      <div className="shrink-0 border-b p-2">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, email ou telefone"
          aria-label="Buscar na agenda"
          className="h-10"
          autoComplete="off"
          /* `search` e nao `text`: o teclado do iOS troca o Enter pelo botao
             de busca e ganha o X de limpar dentro do campo. */
          type="search"
        />
        {marcados.size > 0 && (
          <button
            type="button"
            onClick={() => setSoMarcados((v) => !v)}
            className={cn(
              'mt-2 rounded-full border px-2.5 py-1 text-[11px]',
              soMarcados ? 'border-primary text-primary' : 'text-muted-foreground',
            )}
          >
            {/* Marcar alguem e buscar outro nome esconde o primeiro. Este
                atalho traz a selecao de volta a vista sem desfazer a busca. */}
            {soMarcados ? 'Mostrar todos' : `Ver as ${marcados.size} marcadas`}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 divide-y overflow-y-auto">
        {visiveis.map((c) => (
          <label key={c.id} className="flex items-start gap-3 p-3 active:bg-accent/50">
            <Checkbox
              checked={marcados.has(c.id)}
              onCheckedChange={() => alternar(c.id)}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{c.nome}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {[c.email, c.telefone].filter(Boolean).join(' · ') || 'so o nome'}
              </span>
            </span>
            {repetidos.has(c.id) && (
              <Badge variant="secondary" className="shrink-0">
                ja existe
              </Badge>
            )}
          </label>
        ))}

        {filtrados.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Ninguem com "{busca}" na agenda.
          </p>
        )}

        {escondidos > 0 && (
          <p className="p-3 text-center text-[11px] text-muted-foreground">
            +{escondidos.toLocaleString('pt-BR')} contato(s). Refine a busca para chegar neles.
          </p>
        )}
      </div>

      <div className="shrink-0 border-t p-3">
        <Button
          className="w-full"
          disabled={selecionados.length === 0 || salvando}
          onClick={() => onConfirmar(selecionados)}
        >
          <UserPlus className="h-4 w-4" />
          {selecionados.length === 0
            ? 'Marque quem entra no time'
            : selecionados.length === 1
              ? 'Adicionar 1 pessoa'
              : `Adicionar ${selecionados.length} pessoas`}
        </Button>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          Entram sem papel e com 40h por semana. Da para ajustar depois.
        </p>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
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
