import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { GanttChartSquare, Loader2, LogIn, UserPlus } from 'lucide-react';
import type { AuthEstado } from '@shared/types';
import { api, ApiError, SESSAO_EXPIRADA } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTimelineStore } from '@/stores/timelineStore';
import { useBoardUi } from '@/features/board/useBoardNodes';
import { ServidorAtual } from './ServidorAtual';

export const AUTH_KEY = ['auth'] as const;

/**
 * Tira do cache tudo o que e de uma conta, menos o proprio estado de login.
 *
 * `queryClient.clear()` parece o certo, mas remove tambem a consulta que a
 * porteira esta observando: o `setQueryData` seguinte cria outra, e a
 * porteira continua presa na antiga — o login dava 200 e a tela nao saia da
 * entrada.
 */
function limparDadosDaConta(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== AUTH_KEY[0] });
  // Selecao, busca e filtros tambem sao da conta: a proxima pessoa nao herda.
  useTimelineStore.getState().esquecerConta();
  useBoardUi.setState({ expanded: new Map(), collapsedGroups: new Set() });
}

/**
 * Porteira do app: sem sessao, mostra a entrada; com sessao, o app.
 *
 * Trocar de conta limpa os dados do cache (ver `limparDadosDaConta`). Sem
 * isso, quem entrasse depois veria por um instante a arvore da conta
 * anterior, que continuava guardada na memoria da aba.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: AUTH_KEY,
    queryFn: api.authEstado,
    staleTime: Infinity,
    retry: 1,
  });

  useEffect(() => {
    const expirou = () => {
      limparDadosDaConta(queryClient);
      void refetch();
    };
    window.addEventListener(SESSAO_EXPIRADA, expirou);
    return () => window.removeEventListener(SESSAO_EXPIRADA, expirou);
  }, [queryClient, refetch]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-sm">
        <p>Nao foi possivel falar com o servidor do Chronos.</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  if (!data.autenticado) {
    return (
      <EntradaPage
        estado={data}
        onEntrou={(novo) => {
          limparDadosDaConta(queryClient);
          queryClient.setQueryData(AUTH_KEY, novo);
        }}
      />
    );
  }

  return <>{children}</>;
}

/** Sair: encerra a sessao no servidor e volta para a entrada com o cache limpo. */
export function useSair() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.sair,
    onSettled: (estado) => {
      limparDadosDaConta(queryClient);
      if (estado) queryClient.setQueryData(AUTH_KEY, estado);
      else void queryClient.invalidateQueries({ queryKey: AUTH_KEY });
    },
  });
}

function EntradaPage({
  estado,
  onEntrou,
}: {
  estado: AuthEstado;
  onEntrou: (estado: AuthEstado) => void;
}) {
  const [modo, setModo] = useState<'entrar' | 'cadastro'>(
    estado.primeiroAcesso && estado.cadastroAberto ? 'cadastro' : 'entrar',
  );
  const [form, setForm] = useState({ nome: '', email: '', senha: '', convite: '' });
  const [erro, setErro] = useState<string | null>(null);

  const enviar = useMutation({
    mutationFn: () =>
      modo === 'entrar'
        ? api.entrar({ email: form.email, senha: form.senha })
        : api.cadastro({
            nome: form.nome,
            email: form.email,
            senha: form.senha,
            ...(estado.conviteExigido ? { convite: form.convite } : {}),
          }),
    onSuccess: onEntrou,
    onError: (e: ApiError) => {
      const detalhe = Array.isArray(e.details)
        ? (e.details as Array<{ message: string }>)[0]?.message
        : null;
      setErro(detalhe ?? e.message);
    },
  });

  const campo = (nome: keyof typeof form) => ({
    value: form[nome],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setErro(null);
      setForm((f) => ({ ...f, [nome]: e.target.value }));
    },
  });

  const cadastro = modo === 'cadastro';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <GanttChartSquare className="h-5 w-5" />
          <span className="text-lg font-semibold">Chronos Flow</span>
          <span className="rounded bg-secondary px-1 font-mono text-[10px] text-muted-foreground">v2</span>
        </div>

        {/* Qual servidor e este login: no app instalado, da para trocar aqui. */}
        <ServidorAtual className="mb-4" />

        {estado.avisoCadastro && (
          <p className="mb-4 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs">
            {estado.avisoCadastro}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar.mutate();
          }}
          className="space-y-4 rounded-lg border bg-card p-6 shadow-sm"
        >
          <div>
            <h1 className="text-base font-semibold">
              {cadastro ? (estado.primeiroAcesso ? 'Criar a primeira conta' : 'Criar conta') : 'Entrar'}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {cadastro && estado.primeiroAcesso
                ? 'Os projetos que ja estao neste servidor passam a ser desta conta.'
                : cadastro
                  ? 'Cada conta ve so os proprios projetos.'
                  : 'Use o e-mail e a senha da sua conta.'}
            </p>
          </div>

          {cadastro && (
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" autoComplete="name" autoFocus required {...campo('nome')} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus={!cadastro}
              required
              {...campo('email')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="senha">Senha</Label>
            <Input
              id="senha"
              type="password"
              autoComplete={cadastro ? 'new-password' : 'current-password'}
              minLength={cadastro ? 8 : undefined}
              required
              {...campo('senha')}
            />
            {cadastro && <p className="text-[11px] text-muted-foreground">Pelo menos 8 caracteres.</p>}
          </div>
          {cadastro && estado.conviteExigido && (
            <div className="space-y-1.5">
              <Label htmlFor="convite">Codigo de convite</Label>
              <Input id="convite" autoComplete="off" required {...campo('convite')} />
            </div>
          )}

          {erro && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
              {erro}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={enviar.isPending}>
            {enviar.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : cadastro ? (
              <UserPlus className="h-4 w-4" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {cadastro ? 'Criar conta' : 'Entrar'}
          </Button>
        </form>

        {estado.cadastroAberto && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            {cadastro ? 'Ja tem conta? ' : 'Nao tem conta? '}
            <button
              type="button"
              className="font-medium text-foreground underline-offset-2 hover:underline"
              onClick={() => {
                setErro(null);
                setModo(cadastro ? 'entrar' : 'cadastro');
              }}
            >
              {cadastro ? 'Entrar' : 'Criar conta'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
