import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, Moon, Sun, Sparkles, Eye, EyeOff, AlertTriangle, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateField } from '@/components/DateField';
import { Switch } from '@/components/ui/switch';
import { AjustesDeAvisos } from '@/features/avisos/AjustesDeAvisos';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RESET_PHRASE } from '@shared/schemas/index';
import { useThemeStore } from '@/stores/themeStore';
import { WeeksGrid } from '@/features/life/WeeksGrid';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { theme, toggle } = useThemeStore();
  const { data: user } = useQuery({ queryKey: ['user'], queryFn: api.user });
  const [form, setForm] = useState({
    name: '',
    birth_date: '',
    life_expectancy: 80,
    daily_focus_goal_minutes: 240,
    daily_impact_goal: 1.5,
  });

  useEffect(() => {
    if (!user) return;
    setForm({
      name: user.name,
      birth_date: user.birth_date.slice(0, 10),
      life_expectancy: user.life_expectancy,
      daily_focus_goal_minutes: user.daily_focus_goal_minutes,
      daily_impact_goal: user.daily_impact_goal,
    });
  }, [user]);

  const save = useMutation({
    mutationFn: () =>
      api.updateUser({
        ...form,
        birth_date: new Date(`${form.birth_date}T00:00:00`).toISOString(),
      }),
    onSuccess: () => {
      toast.success('Preferencias salvas.');
      queryClient.invalidateQueries({ queryKey: ['user'] });
      queryClient.invalidateQueries({ queryKey: ['life'] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const recompute = useMutation({
    mutationFn: api.recompute,
    onSuccess: (res) => {
      toast.success(`Cascata recalculada: ${res.nodes} nos em ${res.roots} meta(s).`);
      queryClient.invalidateQueries();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  return (
    /*
      Sem rolagem propria, de proposito.
      No desktop esta tela era a unica coisa na area de conteudo e rolava
      sozinha. Aqui ela divide o espaco com a secao de transferencia, que vem
      logo abaixo: com `h-full overflow-y-auto` esta div ocupava a altura
      inteira e engolia o gesto do dedo, entao o que vinha depois dela ficava
      fora de alcance — existia na tela e nao dava para chegar nele. Quem rola
      e o container de "Mais", um so.
    */
    <div className="w-full">
      {/* Sem titulo: a barra de "Mais" acima ja escreve "Ajustes". */}
      <div className="mx-auto max-w-3xl p-3">
        <AjustesDeAvisos />

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Perfil e metas diarias</CardTitle>
            <CardDescription>
              A expectativa de vida alimenta a grade de semanas; as metas diarias alimentam a faixa
              do Meu Foco.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1 block">Nome</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label className="mb-1 block">Data de nascimento</Label>
                <DateField
                  value={form.birth_date}
                  placeholder="Escolher nascimento"
                  clearable={false}
                  onChange={(birth_date) => setForm({ ...form, birth_date })}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="mb-1 block">Expectativa (anos)</Label>
                <Input
                  type="number"
                  min={1}
                  max={130}
                  value={form.life_expectancy}
                  onChange={(e) =>
                    setForm({ ...form, life_expectancy: Number(e.target.value) || 80 })
                  }
                />
              </div>
              <div>
                <Label className="mb-1 block">Meta de foco (min/dia)</Label>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  step={15}
                  value={form.daily_focus_goal_minutes}
                  onChange={(e) =>
                    setForm({ ...form, daily_focus_goal_minutes: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <Label className="mb-1 block">Meta de impacto (%/dia)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={form.daily_impact_goal}
                  onChange={(e) =>
                    setForm({ ...form, daily_impact_goal: Number(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Salvar
            </Button>
          </CardContent>
        </Card>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Aparencia</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              Modo escuro
            </span>
            <Switch checked={theme === 'dark'} onCheckedChange={toggle} />
          </CardContent>
        </Card>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Manutencao</CardTitle>
            <CardDescription>
              Recalcula path, profundidade, progresso e impacto de toda a base. Seguro de rodar a
              qualquer momento.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => recompute.mutate()}
              disabled={recompute.isPending}
            >
              <RefreshCw className={recompute.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              Recalcular cascata
            </Button>
          </CardContent>
        </Card>

        <AiSettingsCard />

        <div className="mt-5">
          <WeeksGrid />
        </div>

        <DangerZone />
      </div>
    </div>
  );
}


/**
 * Chave do Gemini. Ela fica no banco local (app single-user) e nunca volta
 * inteira para a interface: o servidor devolve mascarada.
 */
function AiSettingsCard() {
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);

  const { data: settings } = useQuery({ queryKey: ['ai-settings'], queryFn: api.aiSettings });
  const { data: modelList } = useQuery({
    queryKey: ['ai-models', settings?.configured],
    queryFn: api.aiModels,
    enabled: Boolean(settings?.configured),
    retry: false,
  });

  const save = useMutation({
    mutationFn: (body: { gemini_api_key?: string | null; gemini_model?: string }) =>
      api.updateAiSettings(body),
    onSuccess: () => {
      toast.success('Configuracao de IA salva.');
      setKey('');
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const models = modelList?.models ?? [];

  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Planejamento assistido (Gemini)
        </CardTitle>
        <CardDescription>
          Usada no Backlog para decompor um item em arvore de tarefas e sugerir os papeis
          necessarios. A chave fica so nesta maquina.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="mb-1 block">Chave da API</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={reveal ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={settings?.maskedKey ?? 'AIza...'}
              />
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                aria-label={reveal ? 'Ocultar chave' : 'Mostrar chave'}
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              >
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button onClick={() => save.mutate({ gemini_api_key: key })} disabled={!key.trim()}>
              Salvar chave
            </Button>
            {settings?.source === 'settings' && (
              <Button variant="outline" onClick={() => save.mutate({ gemini_api_key: null })}>
                Remover
              </Button>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            {settings?.configured ? (
              <>
                <Badge variant="good">Configurada</Badge>
                {settings.source === 'env' && <span>vinda do arquivo .env</span>}
              </>
            ) : (
              <Badge variant="warning">Nao configurada</Badge>
            )}
          </div>
        </div>

        <div>
          <Label className="mb-1 block">Modelo</Label>
          {models.length > 0 ? (
            <Select
              className="h-9 w-full"
              value={settings?.model ?? ''}
              onChange={(e) => save.mutate({ gemini_model: e.target.value })}
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              defaultValue={settings?.model ?? ''}
              onBlur={(e) =>
                e.target.value !== settings?.model && save.mutate({ gemini_model: e.target.value })
              }
            />
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {models.length > 0
              ? `${models.length} modelo(s) disponiveis nessa chave.`
              : 'Salve uma chave valida para listar os modelos da sua conta.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}


/**
 * Zerar tudo. Sem lixeira e sem desfazer, entao a confirmacao e digitada:
 * um clique errado nao pode custar a base inteira.
 */
function DangerZone() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [includeProfile, setIncludeProfile] = useState(false);
  const queryClient = useQueryClient();

  const { data: summary } = useQuery({
    queryKey: ['data-summary'],
    queryFn: api.dataSummary,
    enabled: open,
  });

  const reset = useMutation({
    mutationFn: () => api.resetAll(typed, includeProfile),
    onSuccess: (res) => {
      toast.success('Base zerada.', {
        description: `${res.deleted.nodes} tarefa(s), ${res.deleted.spaces} espaco(s), ${res.deleted.members} membro(s) e ${res.deleted.backlog} item(ns) de backlog apagados.`,
      });
      close();
      queryClient.clear();
      queryClient.invalidateQueries();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const close = () => {
    setOpen(false);
    setTyped('');
    setIncludeProfile(false);
  };

  const matches = typed === RESET_PHRASE;
  const isEmpty = summary && summary.nodes === 0 && summary.spaces === 0 && summary.members === 0;

  return (
    <>
      <Card className="mt-5 border-[hsl(var(--status-critical)/0.4)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[hsl(var(--status-critical))]">
            <AlertTriangle className="h-4 w-4" />
            Zona de risco
          </CardTitle>
          <CardDescription>
            Apaga metas, tarefas, espacos, membros, dependencias e backlog. Nao ha lixeira nem
            desfazer — so restaurar um backup do banco.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Zerar todos os dados
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[hsl(var(--status-critical))]" />
              Zerar todos os dados
            </DialogTitle>
            <DialogDescription>
              Esta acao e permanente. Confira o que vai embora antes de confirmar.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-[hsl(var(--status-critical)/0.4)] p-3">
            {!summary ? (
              <p className="text-sm text-muted-foreground">Contando...</p>
            ) : isEmpty ? (
              <p className="text-sm text-muted-foreground">A base ja esta vazia.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {(
                  [
                    ['Tarefas e metas', summary.nodes],
                    ['Metas macro', summary.roots],
                    ['Espacos', summary.spaces],
                    ['Membros', summary.members],
                    ['Itens de backlog', summary.backlog],
                    ['Dependencias', summary.dependencies],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-mono font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border p-3">
            <Checkbox
              checked={includeProfile}
              onCheckedChange={(v) => setIncludeProfile(v === true)}
              className="mt-0.5"
            />
            <span className="text-sm">
              Apagar tambem meu perfil e a chave da IA
              <span className="block text-[11px] text-muted-foreground">
                Nome, data de nascimento, expectativa de vida, metas diarias e a chave do Gemini.
                Sem isso, so o trabalho e apagado e suas preferencias ficam.
              </span>
            </span>
          </label>

          <div className="mt-3">
            <Label htmlFor="reset-confirm" className="mb-1 block">
              Para confirmar, digite{' '}
              <span className="font-mono font-semibold text-foreground">{RESET_PHRASE}</span>
            </Label>
            <Input
              id="reset-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={RESET_PHRASE}
              autoComplete="off"
              className={
                typed && !matches ? 'border-[hsl(var(--status-critical))]' : undefined
              }
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!matches || reset.isPending}
              onClick={() => reset.mutate()}
            >
              <Trash2 className="h-4 w-4" />
              {reset.isPending ? 'Apagando...' : 'Apagar definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
