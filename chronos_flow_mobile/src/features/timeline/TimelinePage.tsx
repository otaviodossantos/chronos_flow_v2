import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Plus, SlidersHorizontal, Repeat2, ListTree, Rows3,
  CircleDashed, History, Link2, X, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import type { NodeDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTimelineStore, ZOOM_LABEL, PAN_MINUTES, type ZoomLevel } from '@/stores/timelineStore';
import { useTimeScale } from './useTimeScale';
import { useVisibleNodes, type FlatRow } from './useVisibleNodes';
import { TreePane } from './TreePane';
import { TimeCanvas } from './TimeCanvas';
import { TimeRuler } from './TimeRuler';
import { DetailPane } from './DetailPane';
import { NewSpaceProjectDialog } from '@/components/NewSpaceProjectDialog';
import { TemplatePalette } from './TemplatePalette';
import { useMover } from './moverPorToque';
import { BarraDoItem } from './BarraDoItem';
import type { Ajuste, ModoAjuste } from './ajuste';

const ZOOMS: ZoomLevel[] = ['quarters', 'months', 'weeks', 'days', 'hours'];

/**
 * A mesma timeline do desktop, num aparelho de 390px.
 *
 * O que nao mudou: arvore a esquerda e barras a direita, rolando juntas, com a
 * regua em cima. E o desenho que torna a hierarquia legivel, e troca-lo por uma
 * lista de cartoes jogaria fora justamente o que este app tem de proprio.
 *
 * O que mudou: a arvore encolhe para 150px, os controles do cabecalho — que no
 * desktop ocupam uma faixa inteira — cabem agora numa folha de filtros, e o
 * painel de detalhe deixa de ser a terceira coluna para vir por cima.
 */
export function TimelinePage({
  onOpenWidget,
}: {
  onOpenWidget: (node?: NodeDTO | null) => void;
}) {
  const store = useTimelineStore();
  const queryClient = useQueryClient();
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [newProject, setNewProject] = useState(false);
  const [filtros, setFiltros] = useState(false);
  const { modelo, largar } = useMover();

  const scale = useTimeScale(store.zoom, store.viewportStart);

  const { data: nodes = [], isLoading } = useQuery({
    queryKey: [
      'tree', store.spaceId, store.assigneeId, store.maxDepth, store.viewMode,
      store.statusFilter.join(','), store.search,
    ],
    queryFn: () =>
      api.tree({
        spaceId: store.spaceId ?? undefined,
        assigneeId: store.assigneeId ?? undefined,
        maxDepth: store.viewMode === 'compact' ? 12 : Math.max(store.maxDepth, 5),
        status: store.statusFilter.join(',') || undefined,
        search: store.search || undefined,
      }),
  });

  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: api.members });

  const rows = useVisibleNodes(
    nodes, store.overrides, store.maxDepth, store.viewMode, store.conclusao,
  );
  const ocultos = store.conclusao === 'abertas' ? nodes.length - rows.length : 0;

  const syncScroll = useCallback((source: 'tree' | 'canvas', top: number) => {
    if (syncing.current) return;
    syncing.current = true;
    const target = source === 'tree' ? canvasScrollRef.current : treeScrollRef.current;
    if (target) target.scrollTop = top;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);

  const reschedule = useMutation({
    mutationFn: ({ id, start, due, cascade = true }: {
      id: string; start: string | null; due: string | null; cascade?: boolean;
    }) => api.reschedule(id, { start_date: start, due_date: due, cascadeChildren: cascade }),
    onSuccess: (res) => {
      const moved = res.plan.affected.length;
      const encolheu = Math.abs(res.plan.scale - 1) > 0.001;
      const pct = Math.round(res.plan.scale * 100);

      if (res.clampedToChildren) {
        toast.warning('Parou no limite: a janela nao pode cortar a ultima filha.');
      } else {
        toast.success(
          moved === 0
            ? 'Datas ajustadas.'
            : encolheu
              ? `Janela em ${pct}%. ${moved} subtarefa(s) na mesma proporcao.`
              : `Datas ajustadas. ${moved} subtarefa(s) movida(s) junto.`,
          {
            description:
              res.plan.violations.length > 0
                ? `Conflito em "${res.plan.violations[0].title}": ${res.plan.violations[0].violations[0].message}`
                : res.grew?.length
                  ? `${res.grew.map((g) => `"${g.title}"`).join(', ')} cresceu para caber.`
                  : undefined,
          },
        );
      }

      queryClient.invalidateQueries({ queryKey: ['tree'] });
      queryClient.invalidateQueries({ queryKey: ['node'] });
      queryClient.invalidateQueries({ queryKey: ['focus'] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  /*
    Ajuste pela barra de botoes.

    Cada toque numa seta soma ao `ajuste` e redesenha a barra na hora; o envio
    ao banco espera meio segundo de silencio. Sem essa espera, cinco toques
    seriam cinco reagendamentos concorrentes sobre a mesma tarefa — cada um com
    sua cascata de pesos — e o ultimo a chegar decidiria o resultado.

    `enviando` guarda o que ja foi mandado e ainda nao voltou: durante esses
    poucos milissegundos o no na tela ainda tem as datas antigas, e sem ele a
    barra daria um pulo para tras antes de assentar no lugar certo.
  */
  const [ajuste, setAjusteState] = useState<Ajuste | null>(null);
  const [enviando, setEnviando] = useState<Ajuste | null>(null);
  const ajusteRef = useRef<Ajuste | null>(null);
  const relogio = useRef<number | undefined>(undefined);

  /*
    Modo, passo e cascata sao do arraste E das setas, e por isso moram aqui.

    Pegar a borda direita da barra com o dedo passa o modo para "Fim"; largar o
    dedo e tocar na seta continua esticando o fim. Eram dois controles
    discordando enquanto cada um guardava o seu proprio estado.
  */
  const [modo, setModo] = useState<ModoAjuste>('move');
  const [passo, setPasso] = useState(1440);
  const [cascata, setCascata] = useState(true);

  const porAjuste = useCallback((a: Ajuste | null) => {
    ajusteRef.current = a;
    setAjusteState(a);
  }, []);

  const marcado = rows.find((r) => r.node.id === store.marcadoId)?.node ?? null;

  const enviar = useCallback(() => {
    window.clearTimeout(relogio.current);
    const a = ajusteRef.current;
    porAjuste(null);
    if (!a || a.minutos === 0) return;

    const node = nodes.find((n) => n.id === a.id);
    if (!node) return;

    const mover = (iso: string | null) =>
      iso ? new Date(new Date(iso).getTime() + a.minutos * 60_000).toISOString() : null;

    const start = a.modo === 'resize-end' ? node.start_date : mover(node.start_date);
    const due = a.modo === 'resize-start' ? node.due_date : mover(node.due_date);

    setEnviando(a);
    reschedule.mutate(
      { id: a.id, start, due, cascade: a.cascata },
      { onSettled: () => setEnviando((e) => (e === a ? null : e)) },
    );
  }, [nodes, porAjuste, reschedule]);

  const andar = useCallback(
    (modo: ModoAjuste, minutos: number, cascata: boolean) => {
      const id = store.marcadoId;
      if (!id) return;
      const atual = ajusteRef.current;

      // Trocar de operacao no meio do caminho fecha a conta anterior: somar
      // "mover" com "mudar o fim" no mesmo deslocamento nao quer dizer nada.
      if (atual && (atual.id !== id || atual.modo !== modo || atual.cascata !== cascata)) {
        enviar();
      }

      const base = ajusteRef.current;
      porAjuste({ id, modo, cascata, minutos: (base?.minutos ?? 0) + minutos });

      window.clearTimeout(relogio.current);
      relogio.current = window.setTimeout(enviar, 500);
    },
    [enviar, porAjuste, store.marcadoId],
  );

  /*
    O arraste por dedo entra pela mesma porta das setas, so que o deslocamento
    e absoluto — vem da distancia ate onde o dedo pousou — em vez de somado.
    Enquanto o dedo anda nao ha relogio nenhum: gravar no meio do gesto moveria
    o chao debaixo dele.
  */
  const arrastando = useCallback(
    (m: ModoAjuste, minutos: number, c: boolean) => {
      const id = store.marcadoId;
      if (!id) return;
      window.clearTimeout(relogio.current);
      setModo(m);
      porAjuste(minutos === 0 ? null : { id, modo: m, cascata: c, minutos });
    },
    [porAjuste, store.marcadoId],
  );

  const soltou = useCallback(
    (m: ModoAjuste, minutos: number, c: boolean) => {
      const id = store.marcadoId;
      if (!id) return;
      porAjuste(minutos === 0 ? null : { id, modo: m, cascata: c, minutos });
      window.clearTimeout(relogio.current);
      // O dedo ja disse que terminou; nao ha o que esperar em silencio.
      relogio.current = window.setTimeout(enviar, 60);
    },
    [enviar, porAjuste, store.marcadoId],
  );

  // Desmarcar, trocar de tarefa ou sair da tela nao pode engolir um ajuste que
  // ja esta desenhado na barra.
  useEffect(() => {
    if (ajusteRef.current && ajusteRef.current.id !== store.marcadoId) enviar();
  }, [store.marcadoId, enviar]);

  // Pela referencia, e nao pela dependencia: `enviar` muda de identidade a cada
  // resposta da arvore, e com ele na lista a limpeza dispararia a cada recarga
  // — mandando ao banco um ajuste que a pessoa ainda estava montando.
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;
  useEffect(() => () => enviarRef.current(), []);

  /*
    Trazer a tarefa marcada para a vista.

    Marcar passou a acontecer tambem pela arvore, onde os titulos sao legiveis
    e a barra correspondente pode estar a meses de distancia na horizontal. Sem
    isto, as setas funcionariam contra uma tela onde nada se mexe.

    Pela referencia, de novo: `scale` e refeito a cada batida do relogio da
    linha de hoje, e na lista de dependencias faria a tela puxar a barra de
    volta toda vez que a pessoa rolasse para o lado.
  */
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    const ancora = marcado?.start_date ?? marcado?.due_date;
    const el = canvasScrollRef.current;
    if (!ancora || !el) return;

    const s = scaleRef.current;
    const x = s.xOf(ancora);

    // Fora da janela de tempo inteira: nao ha para onde rolar, a janela e que
    // precisa andar. O efeito roda de novo com a escala nova e ai sim rola.
    if (x < 0 || x > s.width) {
      store.setViewportStart(new Date(new Date(ancora).getTime() - 2 * 1440 * 60_000));
      return;
    }
    if (x < el.scrollLeft + 24 || x > el.scrollLeft + el.clientWidth - 24) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marcado?.id, store.zoom, store.viewportStart]);

  const previa = useMemo<Ajuste | null>(() => {
    if (!ajuste) return enviando;
    if (!enviando || enviando.id !== ajuste.id || enviando.modo !== ajuste.modo) return ajuste;
    return { ...ajuste, minutos: ajuste.minutos + enviando.minutos };
  }, [ajuste, enviando]);

  /** Modelo escolhido na paleta + um toque na timeline = tarefa criada ali. */
  const soltarModelo = useMutation({
    mutationFn: ({ row, startISO }: { row: FlatRow; startISO: string }) =>
      api.instantiateTemplate(modelo!.id, {
        parent_id: row.node.id,
        start_date: startISO,
        // No zoom de horas o toque carrega horario de verdade; nos zooms
        // longos a coluna e um dia inteiro, e fingir uma hora seria mentira.
        all_day: store.zoom !== 'hours',
      }),
    onSuccess: ({ node }) => {
      largar();
      // Marcar, e nao abrir: a tarefa recem-criada quase sempre precisa de um
      // empurrao no horario, e para isso e preciso continuar vendo a timeline.
      store.marcar(node.id);
      queryClient.invalidateQueries({ queryKey: ['tree'] });
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success(`"${node.title}" criada.`);
    },
    onError: (e: ApiError) => {
      largar();
      toast.error(e.message);
    },
  });

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => store.panMinutes(-PAN_MINUTES[store.zoom])}
            aria-label="Voltar"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={store.goToNow}
            className="rounded-md px-2 py-1.5 text-xs font-medium active:bg-accent"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => store.panMinutes(PAN_MINUTES[store.zoom])}
            aria-label="Avancar"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* O zoom e o controle mais usado da tela: fica fora da folha. */}
        <Select
          value={store.zoom}
          onChange={(e) => store.setZoom(e.target.value as ZoomLevel)}
          aria-label="Zoom da timeline"
          className="h-9 w-[104px] text-xs"
        >
          {ZOOMS.map((z) => (
            <option key={z} value={z}>
              {ZOOM_LABEL[z]}
            </option>
          ))}
        </Select>

        <button
          type="button"
          onClick={() => setFiltros(true)}
          aria-label="Filtros e visao"
          className={cn(
            'ml-auto flex h-9 w-9 items-center justify-center rounded-md active:bg-accent',
            store.spaceId || store.assigneeId || store.search
              ? 'text-primary'
              : 'text-muted-foreground',
          )}
        >
          <SlidersHorizontal className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={store.togglePalette}
          aria-label="Modelos de tarefa"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md active:bg-accent',
            store.paletteOpen ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <Repeat2 className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setNewProject(true)}
          aria-label="Nova meta macro"
          className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground active:opacity-80"
        >
          <Plus className="h-5 w-5" />
        </button>
      </header>

      {/* Um modelo na mao muda o que o proximo toque significa; sem este aviso
          a timeline ficaria "estranhamente clicavel" sem explicacao. */}
      {modelo && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-primary/10 px-3 py-2 text-xs">
          <Repeat2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            Toque na linha e na hora em que <strong>{modelo.title}</strong> entra.
          </span>
          <button
            type="button"
            onClick={largar}
            aria-label="Cancelar"
            className="flex h-8 w-8 items-center justify-center rounded-full active:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <TreePane
          rows={rows}
          scrollRef={treeScrollRef}
          onScroll={(top) => syncScroll('tree', top)}
          largura={164}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <TimeRuler scale={scale} scrollLeft={scrollLeft} />
          <div
            className="flex min-h-0 flex-1"
            onScrollCapture={(e) => setScrollLeft((e.target as HTMLElement).scrollLeft ?? 0)}
          >
            <TimeCanvas
              rows={rows}
              scale={scale}
              scrollRef={canvasScrollRef}
              onScroll={(top) => syncScroll('canvas', top)}
              onSoltarModelo={(row, startISO) => soltarModelo.mutate({ row, startISO })}
              onReschedule={(id, start, due, cascade) =>
                reschedule.mutate({ id, start, due, cascade })
              }
              previa={previa}
              passo={passo}
              cascata={cascata}
              onArrastar={arrastando}
              onSoltar={soltou}
            />
          </div>
        </div>
      </div>

      {marcado && (
        <BarraDoItem
          node={marcado}
          previa={previa}
          zoom={store.zoom}
          modo={modo}
          passo={passo}
          cascata={cascata}
          onModo={setModo}
          onPasso={setPasso}
          onCascata={setCascata}
          onAndar={andar}
          onAbrir={() => store.select(marcado.id)}
          onFechar={() => store.marcar(null)}
        />
      )}

      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-[10px] text-muted-foreground">
        <span>{rows.length} visiveis</span>
        {ocultos > 0 && (
          <button
            type="button"
            onClick={() => store.setConclusao('tudo')}
            className="underline underline-offset-2"
          >
            {ocultos} concluida(s) fora da vista
          </button>
        )}
        <span className="ml-auto">
          {isLoading
            ? 'Carregando...'
            : marcado
              ? 'Arraste a barra marcada ou use as setas'
              : 'Toque numa barra para ajustar'}
        </span>
      </footer>

      {store.paletteOpen && <TemplatePalette />}

      {filtros && (
        <FolhaDeFiltros onFechar={() => setFiltros(false)} spaces={spaces} members={members} />
      )}

      {/* Detalhe por cima, nao ao lado: num iPhone nao ha terceira coluna. */}
      {store.selectedId && (
        <div className="absolute inset-0 z-50 bg-background">
          <DetailPane nodeId={store.selectedId} onOpenWidget={onOpenWidget} />
        </div>
      )}

      <NewSpaceProjectDialog
        open={newProject}
        onOpenChange={setNewProject}
        defaultKind="project"
        defaultSpaceId={store.spaceId}
        onCreatedProject={(id) => store.select(id)}
      />
    </div>
  );
}

/**
 * Os controles que no desktop moram no cabecalho. Numa folha, porque sao
 * decisoes de sessao — escolhidas uma vez e esquecidas — e nao mereciam
 * disputar os 390px com a propria timeline.
 */
function FolhaDeFiltros({
  onFechar,
  spaces,
  members,
}: {
  onFechar: () => void;
  spaces: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
}) {
  const store = useTimelineStore();

  const grupo = <T extends string>(
    atual: T,
    itens: Array<{ id: T; label: string; icon?: React.ReactNode }>,
    escolher: (id: T) => void,
  ) => (
    <div className="flex rounded-lg border p-0.5">
      {itens.map((i) => (
        <button
          key={i.id}
          type="button"
          onClick={() => escolher(i.id)}
          className={cn(
            'flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium',
            atual === i.id ? 'bg-secondary text-foreground' : 'text-muted-foreground',
          )}
        >
          {i.icon}
          {i.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onFechar}>
      <div
        className="max-h-[80%] overflow-y-auto rounded-t-2xl border-t bg-card p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Visao e filtros</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <Input
            value={store.search}
            onChange={(e) => store.setSearch(e.target.value)}
            placeholder="Buscar tarefas..."
            className="h-10"
          />

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Estrutura</p>
            {grupo(
              store.viewMode,
              [
                { id: 'tree' as const, label: 'Arvore', icon: <ListTree className="h-3.5 w-3.5" /> },
                { id: 'compact' as const, label: 'Folhas', icon: <Rows3 className="h-3.5 w-3.5" /> },
              ],
              store.setViewMode,
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Conclusao</p>
            {grupo(
              store.conclusao,
              [
                { id: 'abertas' as const, label: 'Em aberto', icon: <CircleDashed className="h-3.5 w-3.5" /> },
                { id: 'tudo' as const, label: 'Tudo', icon: <History className="h-3.5 w-3.5" /> },
              ],
              store.setConclusao,
            )}
          </div>

          {store.viewMode === 'tree' && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                Profundidade
              </p>
              <div className="flex rounded-lg border p-0.5">
                {[0, 1, 2, 3, 5].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => store.setMaxDepth(d)}
                    className={cn(
                      'min-h-[36px] flex-1 rounded-md text-xs font-medium',
                      store.maxDepth === d ? 'bg-secondary text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {d === 0 ? 'N0' : d === 5 ? 'Tudo' : `N${d}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Espaco</p>
            <Select
              value={store.spaceId ?? ''}
              onChange={(e) => store.setSpace(e.target.value || null)}
              className="h-10 w-full"
            >
              <option value="">Todos os espacos</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Responsavel</p>
            <Select
              value={store.assigneeId ?? ''}
              onChange={(e) => store.setAssignee(e.target.value || null)}
              className="h-10 w-full"
            >
              <option value="">Todos</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </div>

          <label className="flex items-center gap-2 py-1">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 text-sm">Linhas de dependencia</span>
            <Switch
              aria-label="Mostrar as linhas de dependencia"
              checked={store.showDependencies}
              onCheckedChange={store.toggleDependencies}
            />
          </label>
        </div>

        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    </div>
  );
}
