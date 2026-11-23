import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban, Check, Copy, Link2, LogIn, ShieldCheck, ShieldOff, Trash2, Unlock, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AdminUsuarioDTO, AuthEstado, ConviteDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AUTH_KEY, useTrocarEspaco } from '@/features/auth/AuthGate';

/**
 * Administracao do servidor: quem tem conta, o que cada um tem, e os convites.
 * O servidor confere o papel em toda chamada; esconder a aba e so conforto.
 */
export function AdminPage({ onEntrouNoEspaco }: { onEntrouNoEspaco: () => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <ShieldCheck className="h-5 w-5" />
            Administracao
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Contas deste servidor, o que cada uma tem, e os convites para quem ainda vai entrar.
          </p>
        </div>
        <Convites />
        <Usuarios onEntrouNoEspaco={onEntrouNoEspaco} />
      </div>
    </div>
  );
}

/* ── Usuarios ────────────────────────────────────────────────────────────── */

type Acao =
  | { tipo: 'bloquear' | 'desbloquear' | 'promover' | 'rebaixar'; usuario: AdminUsuarioDTO }
  | null;

const TEXTO_DA_ACAO = {
  bloquear: {
    titulo: 'Bloquear conta',
    corpo: 'A pessoa sai na hora de todos os aparelhos, os tokens de API dela sao revogados e ela nao consegue entrar de novo ate voce desbloquear. Os projetos dela ficam intactos.',
    botao: 'Bloquear',
  },
  desbloquear: {
    titulo: 'Desbloquear conta',
    corpo: 'A pessoa volta a poder entrar com a senha dela. Tokens de API revogados no bloqueio nao voltam: ela cria outros se precisar.',
    botao: 'Desbloquear',
  },
  promover: {
    titulo: 'Tornar administrador',
    corpo: 'A pessoa passa a ver e gerenciar todas as contas, entrar no espaco delas e criar convites — os mesmos poderes que voce tem.',
    botao: 'Tornar admin',
  },
  rebaixar: {
    titulo: 'Tirar de administrador',
    corpo: 'A pessoa volta a ser membro: ve so os proprios projetos. Se ela estiver no espaco de alguem agora, volta para o dela.',
    botao: 'Tirar de admin',
  },
} as const;

function Usuarios({ onEntrouNoEspaco }: { onEntrouNoEspaco: () => void }) {
  const queryClient = useQueryClient();
  const eu = queryClient.getQueryData<AuthEstado>(AUTH_KEY)?.usuario?.id;
  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ['admin', 'usuarios'],
    queryFn: api.adminUsuarios,
  });
  const [acao, setAcao] = useState<Acao>(null);
  const espaco = useTrocarEspaco();

  const aplicar = useMutation({
    mutationFn: ({ tipo, usuario }: NonNullable<Acao>) =>
      api.adminAtualizarUsuario(
        usuario.id,
        tipo === 'bloquear' || tipo === 'desbloquear'
          ? { bloqueado: tipo === 'bloquear' }
          : { papel: tipo === 'promover' ? 'ADMIN' : 'MEMBRO' },
      ),
    onSuccess: (_r, { tipo, usuario }) => {
      const feito = {
        bloquear: 'bloqueada',
        desbloquear: 'desbloqueada',
        promover: 'agora e admin',
        rebaixar: 'agora e membro',
      }[tipo];
      toast.success(`${usuario.name}: ${feito}.`);
      setAcao(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'usuarios'] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const entrar = (u: AdminUsuarioDTO) =>
    espaco.mutate(u.id, {
      onSuccess: () => {
        toast.success(`Voce esta no espaco de ${u.name}.`, {
          description: 'O que fizer aqui fica registrado no seu nome.',
        });
        onEntrouNoEspaco();
      },
      onError: (e) => toast.error((e as ApiError).message),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Usuarios</CardTitle>
        <CardDescription>
          {usuarios.length} {usuarios.length === 1 ? 'conta' : 'contas'}. Entrar no espaco de alguem abre os
          projetos dessa pessoa para voce ver e editar; tudo o que fizer la fica assinado como voce.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <ul className="divide-y border-t">
            {usuarios.map((u) => {
              const souEu = u.id === eu;
              const bloqueado = Boolean(u.bloqueado_em);
              return (
                <li
                  key={u.id}
                  className={cn(
                    'grid items-start gap-x-6 gap-y-3 px-6 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_24rem]',
                    bloqueado && 'opacity-60',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{u.name}</span>
                      {souEu && <span className="text-xs text-muted-foreground">(voce)</span>}
                      {u.dono ? (
                        <Badge variant="secondary" title="A primeira conta do servidor: sempre admin">
                          Dona do servidor
                        </Badge>
                      ) : (
                        u.papel === 'ADMIN' && <Badge variant="secondary">Admin</Badge>
                      )}
                      {bloqueado && <Badge variant="critical">Bloqueada</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{u.email}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Desde {formatDate(u.created_at)} ·{' '}
                      {u.ultimo_acesso ? `ultimo acesso ${formatRelativeTime(u.ultimo_acesso)}` : 'nunca entrou'}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-xs">
                      <span className="font-medium">{u.metas}</span>{' '}
                      <span className="text-muted-foreground">{u.metas === 1 ? 'meta' : 'metas'}</span> ·{' '}
                      <span className="font-medium">{u.tarefas_abertas}</span>{' '}
                      <span className="text-muted-foreground">
                        {u.tarefas_abertas === 1 ? 'tarefa aberta' : 'tarefas abertas'}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {u.espacos.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground">Sem espacos</span>
                      ) : (
                        u.espacos.map((s) => (
                          <span
                            key={s.id}
                            className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                    {!souEu && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => entrar(u)}
                        disabled={espaco.isPending}
                        title={`Ver e editar os projetos de ${u.name}`}
                      >
                        <LogIn className="h-3.5 w-3.5" />
                        Entrar no espaco
                      </Button>
                    )}
                    {/* A conta dona e sempre admin: nao ha o que tirar nem bloquear. */}
                    {!u.dono && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAcao({ tipo: u.papel === 'ADMIN' ? 'rebaixar' : 'promover', usuario: u })}
                        title={u.papel === 'ADMIN' ? 'Tirar de administrador' : 'Tornar administrador'}
                      >
                        {u.papel === 'ADMIN' ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                        {u.papel === 'ADMIN' ? 'Tirar admin' : 'Tornar admin'}
                      </Button>
                    )}
                    {!souEu && !u.dono && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className={cn(!bloqueado && 'text-destructive hover:text-destructive')}
                        onClick={() => setAcao({ tipo: bloqueado ? 'desbloquear' : 'bloquear', usuario: u })}
                      >
                        {bloqueado ? <Unlock className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                        {bloqueado ? 'Desbloquear' : 'Bloquear'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={Boolean(acao)} onOpenChange={(o) => !o && setAcao(null)}>
        {acao && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {TEXTO_DA_ACAO[acao.tipo].titulo}: {acao.usuario.name}
              </DialogTitle>
              <DialogDescription>{TEXTO_DA_ACAO[acao.tipo].corpo}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAcao(null)}>
                Cancelar
              </Button>
              <Button
                variant={acao.tipo === 'bloquear' ? 'destructive' : 'default'}
                onClick={() => aplicar.mutate(acao)}
                disabled={aplicar.isPending}
              >
                {TEXTO_DA_ACAO[acao.tipo].botao}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}

/* ── Convites ────────────────────────────────────────────────────────────── */

const ROTULO_DO_ESTADO: Record<ConviteDTO['estado'], { texto: string; variant: 'good' | 'secondary' | 'outline' | 'critical' }> = {
  pendente: { texto: 'Aguardando', variant: 'good' },
  usado: { texto: 'Usado', variant: 'secondary' },
  expirado: { texto: 'Expirado', variant: 'outline' },
  revogado: { texto: 'Revogado', variant: 'outline' },
};

/** O link que a pessoa abre. A origem e a desta tela: no app instalado, e a do servidor escolhido. */
const linkDoConvite = (token: string) => `${window.location.origin}/#convite=${token}`;

function Convites() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [dias, setDias] = useState('7');
  const [novo, setNovo] = useState<{ link: string; email: string | null } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const { data: convites = [] } = useQuery({ queryKey: ['admin', 'convites'], queryFn: api.adminConvites });

  const criar = useMutation({
    mutationFn: () => api.adminCriarConvite({ email: email.trim() || undefined, dias: Number(dias) }),
    onSuccess: (r) => {
      setNovo({ link: linkDoConvite(r.token), email: r.email });
      setCopiado(false);
      setEmail('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'convites'] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const revogar = useMutation({
    mutationFn: (id: string) => api.adminRevogarConvite(id),
    onSuccess: () => {
      toast.success('Convite revogado. O link deixa de funcionar.');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'convites'] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const copiar = async () => {
    if (!novo) return;
    try {
      await navigator.clipboard.writeText(novo.link);
      setCopiado(true);
    } catch {
      toast.error('Nao deu para copiar. Selecione o link e copie na mao.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-4 w-4" />
          Convidar pessoa
        </CardTitle>
        <CardDescription>
          Gera um link que serve uma vez. Com e-mail, so essa pessoa consegue usar. Mande o link por onde preferir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            criar.mutate();
          }}
          className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end"
        >
          <div className="space-y-1.5">
            <Label htmlFor="convite-email">E-mail da pessoa (opcional)</Label>
            <Input
              id="convite-email"
              type="email"
              placeholder="pessoa@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="convite-dias">Vale por</Label>
            <Select id="convite-dias" className="h-9" value={dias} onChange={(e) => setDias(e.target.value)}>
              <option value="1">1 dia</option>
              <option value="7">7 dias</option>
              <option value="30">30 dias</option>
            </Select>
          </div>
          <Button type="submit" disabled={criar.isPending}>
            <Link2 className="h-4 w-4" />
            Gerar link
          </Button>
        </form>

        {novo && (
          <div className="space-y-2 rounded-md border border-status-good/40 bg-status-good/5 p-3">
            <div className="text-xs font-medium">
              Link pronto{novo.email ? ` para ${novo.email}` : ''}. Ele so aparece agora: copie antes de sair da tela.
            </div>
            <div className="flex gap-2">
              <Input readOnly value={novo.link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button type="button" variant="outline" onClick={copiar}>
                {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiado ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
          </div>
        )}

        {convites.length > 0 && (
          <div>
            <div className="mb-2 text-sm font-medium">Convites recentes</div>
            <ul className="divide-y rounded-md border">
              {convites.map((c) => {
                const r = ROTULO_DO_ESTADO[c.estado];
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs">
                    <span className="min-w-[160px] flex-1 truncate font-medium">{c.email ?? 'Qualquer e-mail'}</span>
                    <Badge variant={r.variant}>{r.texto}</Badge>
                    <span className="text-muted-foreground">
                      {c.estado === 'usado' && c.usado_por
                        ? `por ${c.usado_por.name} ${formatRelativeTime(c.usado_em)}`
                        : c.estado === 'pendente'
                          ? `expira ${formatDate(c.expira_em)}`
                          : `criado ${formatRelativeTime(c.criado_em)}`}
                    </span>
                    {c.estado === 'pendente' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-destructive hover:text-destructive"
                        onClick={() => revogar.mutate(c.id)}
                        disabled={revogar.isPending}
                        aria-label="Revogar convite"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Revogar
                      </Button>
                    ) : (
                      <span className="w-[76px]" />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
