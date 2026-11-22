import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Inbox, Sparkles, Plus, Trash2, ArrowRight, ArrowLeft, KeyRound, Loader2, CheckCircle2,
  CalendarRange,
} from 'lucide-react';
import { toast } from 'sonner';
import type { BacklogItemDTO } from '@shared/types';
import { contarTarefas, type AiPlan } from '@shared/schemas/index';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate, formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateField } from '@/components/DateField';
import { DictationTextarea } from '@/components/DictationTextarea';
import { Select } from '@/components/ui/select';
import { PlanEditor } from './PlanEditor';

const STATUS_LABEL = {
  INBOX: 'Na caixa',
  PLANNING: 'Planejando',
  CONVERTED: 'Virou meta',
  ARCHIVED: 'Arquivado',
} as const;

export function BacklogPage({ onGoToTimeline }: { onGoToTimeline: (nodeId: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AiPlan | null>(null);
  const [extra, setExtra] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: '',
    notes: '',
    context: '',
    start_date: '',
    target_date: '',
  });
  const queryClient = useQueryClient();

  const { data: items = [], error: backlogError } = useQuery({
    queryKey: ['backlog'],
    queryFn: api.backlog,
    retry: false,
  });
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: api.members });
  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });
  const { data: ai } = useQuery({ queryKey: ['ai-settings'], queryFn: api.aiSettings });

  const selected = items.find((i) => i.id === selectedId) ?? null;

  /**
   * Edicao ainda nao gravada. Fica num ref, e nao no estado, porque quem
   * precisa dela e o efeito que troca de item — e nesse instante o estado ja
   * foi substituido pelo rascunho do item novo.
   */
  const pendenteRef = useRef<{ id: string; plan: AiPlan } | null>(null);

  const salvarRascunho = useMutation({
    mutationFn: ({ id, plan: p }: { id: string; plan: AiPlan }) => api.saveBacklogPlan(id, p),
    onSuccess: (item) => {
      if (pendenteRef.current?.id === item.id) pendenteRef.current = null;
      // Escrito direto no cache: refazer a busca traria o item de volta e, com
      // ele, o risco de atropelar o que esta sendo editado agora.
      queryClient.setQueryData<BacklogItemDTO[]>(['backlog'], (antigos) =>
        (antigos ?? []).map((i) => (i.id === item.id ? item : i)),
      );
    },
  });

  // O rascunho local acompanha o item aberto, sem sobrescrever edicoes em curso.
  useEffect(() => {
    // Trocar de item nao pode engolir o que ainda nao foi gravado do anterior.
    const pendente = pendenteRef.current;
    if (pendente && pendente.id !== selectedId) salvarRascunho.mutate(pendente);

    setDraft((selected?.ai_plan as AiPlan | null) ?? null);
    setExtra('');
  }, [selectedId, selected?.ai_planned_at]);

  // Lido no render, e nao do ref: ref nao provoca redesenho e o rotulo ficaria
  // sempre um passo atras do que esta na tela.
  const rascunhoSujo = Boolean(
    selected &&
      draft &&
      JSON.stringify((selected.ai_plan as AiPlan | null) ?? null) !== JSON.stringify(draft),
  );

  /**
   * Salva sozinho pouco depois de parar de mexer. Um botao de salvar aqui seria
   * facil de esquecer, e esquecer significa refazer a triagem inteira.
   */
  useEffect(() => {
    if (!selected || !draft) return;

    const gravado = (selected.ai_plan as AiPlan | null) ?? null;
    if (gravado && JSON.stringify(gravado) === JSON.stringify(draft)) {
      pendenteRef.current = null;
      return;
    }

    pendenteRef.current = { id: selected.id, plan: draft };
    const id = window.setTimeout(
      () => salvarRascunho.mutate({ id: selected.id, plan: draft }),
      800,
    );
    return () => window.clearTimeout(id);
  }, [draft, selected?.id]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['backlog'] });

  const create = useMutation({
    mutationFn: () =>
      api.createBacklog({
        title: form.title,
        notes: form.notes || null,
        context: form.context || null,
        start_date: form.start_date ? new Date(`${form.start_date}T09:00:00`).toISOString() : null,
        target_date: form.target_date ? new Date(`${form.target_date}T18:00:00`).toISOString() : null,
      }),
    onSuccess: (item) => {
      setForm({ title: '', notes: '', context: '', start_date: '', target_date: '' });
      setCreating(false);
      setSelectedId(item.id);
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  /**
   * O teto de tarefas, gravado na hora em que e escolhido.
   *
   * Nao espera o "Planejar": quem define um limite esta descrevendo o item
   * ("isto aqui e coisa de no maximo 10 tarefas"), e isso vale para a proxima
   * rodada e para todas as seguintes.
   */
  const definirLimite = useMutation({
    mutationFn: ({ id, max_tasks }: { id: string; max_tasks: number | null }) =>
      api.updateBacklog(id, { max_tasks }),
    onSuccess: () => invalidate(),
    onError: (e: ApiError) => toast.error(e.message),
  });

  const plan = useMutation({
    mutationFn: (id: string) => api.planBacklog(id, extra || undefined),
    onSuccess: (item) => {
      setDraft(item.ai_plan as AiPlan);
      toast.success('Rascunho pronto. Revise antes de aplicar.');
      invalidate();
    },
    onError: (e: ApiError, id) => toastApiError(e, () => plan.mutate(id)),
  });

  const apply = useMutation({
    mutationFn: ({ id, plan: p, spaceId }: { id: string; plan: AiPlan; spaceId: string | null }) =>
      api.applyBacklogPlan(id, { plan: p, space_id: spaceId }),
    onSuccess: (res) => {
      const extras = [
        res.roles > 0 ? `${res.roles} papel(is)` : null,
        res.dependencies > 0 ? `${res.dependencies} dependencia(s)` : null,
      ].filter(Boolean);
      const ate = `Encadeada ate ${formatDateTime(res.fimPrevisto, false)}.`;
      toast.success(`Meta macro criada com ${res.nodesCreated} nos.`, {
        description: [ate, extras.length > 0 ? `${extras.join(' e ')} registrada(s).` : null]
          .filter(Boolean)
          .join(' '),
      });
      // Encurtar o plano para caber na entrega seria mentir sobre o esforco.
      if (res.atrasaEntrega) {
        toast.warning('O plano encadeado passa da data de entrega.', {
          description:
            'As tarefas foram criadas no tempo que de fato pedem. Reduza o escopo, ' +
            'divida entre mais pessoas ou mova a entrega.',
        });
      }
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['tree'] });
      onGoToTimeline(res.rootId);
    },
    onError: (e: ApiError, vars) => toastApiError(e, () => apply.mutate(vars)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteBacklog(id),
    onSuccess: () => {
      setSelectedId(null);
      invalidate();
    },
  });

  const [applySpace, setApplySpace] = useState<string>('');

  return (
    /*
      Uma coluna, nao duas.

      O desktop poe a lista a esquerda e o item escolhido a direita. Num iPhone
      a segunda coluna comecava em 360px — fora de uma tela de 390 — e o item
      simplesmente nao existia: via-se a lista e uma faixa de letras cortadas na
      borda. Aqui a lista ocupa a tela inteira e o item vem por cima, com botao
      de voltar, como o painel de detalhe da timeline.
    */
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Lista */}
      <div className="flex h-full w-full min-w-0 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            <h1 className="font-semibold">Backlog</h1>
            <Badge variant="secondary">{items.length}</Badge>
          </div>
          <Button size="xs" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            Novo
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {backlogError && (
            <Card className="mb-2 border-[hsl(var(--status-critical)/0.5)]">
              <CardContent className="p-3 text-xs">
                <p className="mb-1 font-medium text-[hsl(var(--status-critical))]">
                  O backlog nao esta disponivel
                </p>
                <p className="text-muted-foreground">{(backlogError as ApiError).message}</p>
              </CardContent>
            </Card>
          )}

          {creating && (
            <Card className="mb-2 border-primary/40">
              <CardContent className="space-y-2 p-3">
                <Input
                  autoFocus
                  placeholder="O que voce precisa organizar?"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
                <DictationTextarea
                  placeholder="Notas soltas, o que ja sabe..."
                  value={form.notes}
                  onChange={(notes) => setForm({ ...form, notes })}
                  className="min-h-[72px] text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="mb-1 block">Inicio</Label>
                    <DateField
                      value={form.start_date}
                      onChange={(start_date) => setForm({ ...form, start_date })}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block">Entrega</Label>
                    <DateField
                      value={form.target_date}
                      min={form.start_date || undefined}
                      onChange={(target_date) => setForm({ ...form, target_date })}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={!form.title.trim() || create.isPending}
                    onClick={() => create.mutate()}
                  >
                    Adicionar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCreating(false)}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {items.length === 0 && !creating && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nada no backlog. Jogue aqui o que ainda nao virou plano.
            </p>
          )}

          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={cn(
                'mb-1.5 flex w-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                selectedId === item.id && 'border-primary bg-accent',
              )}
            >
              <div className="flex w-full items-start gap-2">
                {/*
                  Duas linhas, e nao uma cortada. "Abrir uma filial em
                  Florianopolis ate o segundo semestre" virava "Abrir uma filial
                  em Florianopolis ate ..." — some justamente a parte que
                  distingue um item do outro.
                */}
                <span className="min-w-0 flex-1 text-sm font-medium leading-snug line-clamp-2">
                  {item.title}
                </span>
                {/* "Na caixa" e o estado de quase tudo aqui: repeti-lo em cada
                    linha gasta 90px para nao dizer nada. */}
                {item.status !== 'INBOX' && (
                  <Badge variant={item.status === 'CONVERTED' ? 'good' : 'secondary'}>
                    {STATUS_LABEL[item.status]}
                  </Badge>
                )}
              </div>
              {item.notes && (
                <p className="w-full truncate text-[11px] leading-tight text-muted-foreground">
                  {item.notes}
                </p>
              )}
              <div className="flex w-full flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                {(item.start_date || item.target_date) && (
                  <span>
                    {item.start_date ? formatDate(item.start_date) : '?'} ate{' '}
                    {item.target_date ? formatDate(item.target_date) : '?'}
                  </span>
                )}
                {item.ai_planned_at && <span>· rascunho pronto</span>}
                {item.roles.length > 0 && <span>· {item.roles.length} papel(is)</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detalhe, por cima da lista */}
      {selected && (
        <div className="absolute inset-0 z-50 flex flex-col bg-background">
          {/*
            Cabecalho fixo: o item do backlog e uma tela longa — janela, notas,
            instrucoes, rascunho da IA e a lista de tarefas propostas — e sem um
            botao de voltar parado no topo so se sai dela rolando ate o fim.
          */}
          <header className="flex h-12 shrink-0 items-center gap-1 border-b px-1">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Voltar ao backlog"
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            {/* "Backlog", e nao o titulo do item: o titulo inteiro esta
                logo abaixo, e repeti-lo aqui so o mostraria cortado. */}
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Backlog</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => remove.mutate(selected.id)}
              aria-label="Excluir item"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl p-3">
              <h3 className="mb-1 text-lg font-semibold leading-tight tracking-tight">
                {selected.title}
              </h3>

            <WindowCard item={selected} onSaved={invalidate} />

            <NotesCard item={selected} onSaved={invalidate} />

            {selected.status === 'CONVERTED' && selected.converted_node_id && (
              <Card className="mt-4 border-[hsl(var(--status-good)/0.4)]">
                <CardContent className="flex items-center gap-3 p-4">
                  <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-good))]" />
                  <span className="flex-1 text-sm">Este item ja virou uma meta macro.</span>
                  <Button size="sm" onClick={() => onGoToTimeline(selected.converted_node_id!)}>
                    Ver na timeline
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            )}

            {!ai?.configured && (
              <Card className="mt-4 border-[hsl(var(--status-warning)/0.4)]">
                <CardContent className="flex items-center gap-3 p-4 text-sm">
                  <KeyRound className="h-4 w-4 text-[hsl(var(--status-warning))]" />
                  Configure a chave do Gemini em Configuracoes para usar o planejamento assistido.
                </CardContent>
              </Card>
            )}

            <Card className="mt-4">
              <CardContent className="space-y-3 p-4">
                <LimiteDeTarefas
                  valor={selected.max_tasks}
                  rascunho={draft}
                  salvando={definirLimite.isPending}
                  onMudar={(max_tasks) => definirLimite.mutate({ id: selected.id, max_tasks })}
                />

                <DictationTextarea
                  label="Instrucoes para o planejamento"
                  value={extra}
                  onChange={setExtra}
                  placeholder="Ex: evento presencial para 200 pessoas, orcamento apertado, equipe de voluntarios"
                  className="min-h-[60px] text-sm"
                />
                <Button
                  onClick={() => plan.mutate(selected.id)}
                  disabled={plan.isPending || !ai?.configured}
                >
                  {plan.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {selected.ai_plan ? 'Gerar outro rascunho' : 'Planejar com IA'}
                </Button>
              </CardContent>
            </Card>

            {draft && (
              <div className="mt-5">
                <PlanEditor
                  plan={draft}
                  members={members}
                  window={{ start: selected.start_date, end: selected.target_date }}
                  onChange={setDraft}
                />

                <Card className="mt-4 border-primary/40">
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    {/* Salvar sozinho sem dizer nada e pedir para o usuario
                        confiar no escuro; o estado fica a vista, e o erro tem
                        saida em vez de virar trabalho perdido. */}
                    <span
                      aria-live="polite"
                      className={cn(
                        'text-[11px]',
                        salvarRascunho.isError
                          ? 'text-[hsl(var(--status-critical))]'
                          : 'text-muted-foreground',
                      )}
                    >
                      {salvarRascunho.isPending
                        ? 'Salvando o rascunho...'
                        : salvarRascunho.isError
                          ? 'Nao foi possivel salvar o rascunho.'
                          : rascunhoSujo
                            ? 'Alteracoes por salvar'
                            : 'Rascunho salvo'}
                    </span>
                    {salvarRascunho.isError && selected && draft && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => salvarRascunho.mutate({ id: selected.id, plan: draft })}
                      >
                        Tentar de novo
                      </Button>
                    )}

                    <div className="flex items-center gap-2">
                      <Label htmlFor="apply-space">Criar no espaco</Label>
                      <Select
                        id="apply-space"
                        value={applySpace}
                        onChange={(e) => setApplySpace(e.target.value)}
                        className="h-8"
                      >
                        <option value="">Sem espaco</option>
                        {spaces.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      className="ml-auto"
                      disabled={apply.isPending}
                      onClick={() =>
                        apply.mutate({
                          id: selected.id,
                          plan: draft,
                          spaceId: applySpace || selected.space_id,
                        })
                      }
                    >
                      {apply.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      Aplicar e criar a meta macro
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Teto de tarefas que a IA pode propor para este item.
 *
 * Conta a arvore inteira — frentes, etapas e folhas somadas —, e nao so o
 * primeiro nivel: um plano de "3 frentes" pode ter trinta tarefas embaixo
 * delas, e era exatamente esse numero que escapava.
 *
 * Um `<select>` e nao um campo numerico: no iPhone um campo numerico abre o
 * teclado e exige confirmar; o select abre a roda nativa e resolve num toque.
 * Os degraus sao grossos de proposito — a diferenca entre 10 e 11 tarefas nao
 * muda nada, a diferenca entre 10 e 30 muda tudo.
 */
const DEGRAUS_DO_LIMITE = [5, 8, 10, 15, 20, 30, 40, 60];

function LimiteDeTarefas({
  valor,
  rascunho,
  salvando,
  onMudar,
}: {
  valor: number | null;
  rascunho: AiPlan | null;
  salvando: boolean;
  onMudar: (max_tasks: number | null) => void;
}) {
  const noRascunho = rascunho ? contarTarefas(rascunho.tasks) : null;
  const estourou = valor != null && noRascunho != null && noRascunho > valor;

  return (
    <div>
      <Label className="mb-1 block">Limite de tarefas</Label>
      <div className="flex items-center gap-2">
        <Select
          value={valor == null ? '' : String(valor)}
          disabled={salvando}
          onChange={(e) => onMudar(e.target.value ? Number(e.target.value) : null)}
          className="h-9 min-w-0 flex-1"
          aria-label="Limite de tarefas que a IA pode criar"
        >
          <option value="">Sem limite</option>
          {DEGRAUS_DO_LIMITE.map((n) => (
            <option key={n} value={n}>
              Ate {n} tarefas
            </option>
          ))}
        </Select>

        {noRascunho != null && (
          <span
            className={cn(
              'shrink-0 rounded-full border px-2 py-1 text-[11px]',
              estourou
                ? 'border-[hsl(var(--status-warning)/0.5)] text-[hsl(var(--status-warning))]'
                : 'text-muted-foreground',
            )}
          >
            {noRascunho} no rascunho
          </span>
        )}
      </div>

      <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
        {estourou
          ? 'O rascunho atual foi feito com outro limite. Gere de novo para caber neste.'
          : 'Conta tarefas e subtarefas juntas, em todos os niveis. O que passar e cortado.'}
      </p>
    </div>
  );
}

function describe(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const d = details as Record<string, unknown>;
  if (Array.isArray(d.issues)) return d.issues.join(' · ');
  if (typeof d.detail === 'string') return d.detail.slice(0, 200);
  return undefined;
}

/**
 * Erro de chamada a IA. Quando a culpa e da fila do provedor, a mensagem ja
 * diz tudo e o corpo cru da resposta dele (um JSON com "UNAVAILABLE") so
 * atrapalha — some, e no lugar dele entra o botao de tentar de novo.
 */
function toastApiError(e: ApiError, retry?: () => void) {
  const busy = e.code === 'UPSTREAM_BUSY';
  toast.error(e.message, {
    description: busy ? undefined : describe(e.details),
    duration: busy ? 10_000 : undefined,
    action: busy && retry ? { label: 'Tentar de novo', onClick: retry } : undefined,
  });
}


/** Nota do item, editavel e ditavel. Salva sob demanda, nao a cada tecla. */
function NotesCard({ item, onSaved }: { item: BacklogItemDTO; onSaved: () => void }) {
  const [notes, setNotes] = useState(item.notes ?? '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setNotes(item.notes ?? '');
    setDirty(false);
  }, [item.id, item.notes]);

  const save = useMutation({
    mutationFn: () => api.updateBacklog(item.id, { notes: notes || null }),
    onSuccess: () => {
      toast.success('Nota salva.');
      setDirty(false);
      onSaved();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <DictationTextarea
          label="Nota"
          value={notes}
          onChange={(v) => {
            setNotes(v);
            setDirty(true);
          }}
          placeholder="Escreva ou dite o que voce sabe sobre isso..."
          className="min-h-[110px] text-sm"
        />
        {dirty && (
          <div className="mt-2 flex justify-end">
            <Button size="xs" onClick={() => save.mutate()} disabled={save.isPending}>
              Salvar nota
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/**
 * Janela de execucao do projeto. E o que ancora os offsets que a IA propoe:
 * sem inicio e entrega, "comeca no dia 12" nao diz respeito a nada.
 */
function WindowCard({ item, onSaved }: { item: BacklogItemDTO; onSaved: () => void }) {
  const toInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
  const [start, setStart] = useState(toInput(item.start_date));
  const [end, setEnd] = useState(toInput(item.target_date));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setStart(toInput(item.start_date));
    setEnd(toInput(item.target_date));
    setDirty(false);
  }, [item.id, item.start_date, item.target_date]);

  const save = useMutation({
    mutationFn: () =>
      api.updateBacklog(item.id, {
        start_date: start ? new Date(`${start}T09:00:00`).toISOString() : null,
        target_date: end ? new Date(`${end}T18:00:00`).toISOString() : null,
      }),
    onSuccess: () => {
      toast.success('Janela do projeto salva.');
      setDirty(false);
      onSaved();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const days =
    start && end
      ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000)
      : null;
  const invalid = days != null && days < 0;

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-1.5">
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            Janela de execucao
          </span>
          {days != null && !invalid && (
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {days} dia{days === 1 ? '' : 's'}
              {days >= 14 && ` · ~${Math.round((days / 7) * 10) / 10} semanas`}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1 block" htmlFor={`start-${item.id}`}>
              Inicio
            </Label>
            <DateField
              id={`start-${item.id}`}
              value={start}
              onChange={(v) => {
                setStart(v);
                setDirty(true);
              }}
            />
          </div>
          <div>
            <Label className="mb-1 block" htmlFor={`end-${item.id}`}>
              Entrega
            </Label>
            <DateField
              id={`end-${item.id}`}
              value={end}
              min={start || undefined}
              onChange={(v) => {
                setEnd(v);
                setDirty(true);
              }}
            />
          </div>
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          {invalid
            ? 'A entrega esta antes do inicio.'
            : days == null
              ? 'Com as duas datas, a IA distribui as tarefas ao longo do periodo e propoe o que depende do que.'
              : 'A IA encaixa as tarefas nessa janela e respeita a ordem das dependencias.'}
        </p>

        {dirty && (
          <div className="mt-2 flex justify-end">
            <Button size="xs" onClick={() => save.mutate()} disabled={save.isPending || invalid}>
              Salvar janela
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
