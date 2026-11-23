import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2, LogIn, Plus, Server, Smartphone, UserPlus, X } from 'lucide-react';
import { SESSAO_EXPIRADA } from '@desktop/src/lib/api';
import type { AuthEstado } from '@shared/types';
import { ApiError, conta } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTimelineStore } from '@/stores/timelineStore';
import {
  adicionar,
  carregarConexao,
  escolher,
  esquecerSessao,
  guardarSessao,
  NO_APARELHO,
  remover,
  servidorAtual,
  useConexao,
  voltarParaEscolha,
} from '@/data/servidores';

export const AUTH_KEY = ['auth'] as const;

/**
 * Troca de lado (aparelho <-> servidor, um servidor <-> outro, uma conta <->
 * outra): o que esta no cache e da origem anterior e nao pode aparecer nem por
 * um instante na tela da proxima.
 *
 * Menos a consulta do login: a porteira esta observando ela, e remove-la no
 * meio do caminho cancela a resposta em silencio — a tela ficava girando para
 * sempre. Ela nao precisa sair: a chave tem servidor e geracao, entao cada
 * sessao ja nasce com a sua.
 */
export function limparDados(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== AUTH_KEY[0] });
  useTimelineStore.getState().select(null);
}

/** A chave da consulta do login da sessao atual. */
export const chaveDoLogin = (atual: string | null, geracao: number) => [...AUTH_KEY, atual, geracao] as const;

/**
 * Quem passa para o app.
 *
 * - Nada escolhido ainda: a tela de escolha (este iPhone ou um servidor).
 * - Neste iPhone: entra direto, sem conta, como sempre foi.
 * - Num servidor: so com sessao valida la; sem ela, a tela de entrada.
 */
export function Porteira({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { carregado, atual, comSessao, geracao } = useConexao();
  const remoto = atual !== null && atual !== NO_APARELHO;

  useEffect(() => {
    void carregarConexao();
  }, []);

  // O servidor disse que a sessao acabou (saiu em outro lugar, senha trocada,
  // conta bloqueada): esquece o token e volta para a entrada.
  useEffect(() => {
    const expirou = () => {
      void esquecerSessao().then(() => limparDados(queryClient));
    };
    window.addEventListener(SESSAO_EXPIRADA, expirou);
    return () => window.removeEventListener(SESSAO_EXPIRADA, expirou);
  }, [queryClient]);

  const auth = useQuery({
    queryKey: chaveDoLogin(atual, geracao),
    queryFn: conta.estado,
    enabled: remoto && comSessao,
    staleTime: Infinity,
    retry: 1,
  });

  // Token guardado, mas o servidor nao reconhece mais: esquece.
  useEffect(() => {
    if (auth.data && !auth.data.autenticado) void esquecerSessao();
  }, [auth.data]);

  if (!carregado) return <Girando />;
  if (atual === null) return <EscolherServidor />;
  if (!remoto) return <>{children}</>;
  if (!comSessao) return <Entrada />;
  if (auth.isLoading) return <Girando />;
  if (auth.isError) {
    return (
      <Tela>
        <p className="text-center text-sm">{(auth.error as Error).message}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" onClick={() => auth.refetch()}>
            Tentar de novo
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              limparDados(queryClient);
              void voltarParaEscolha();
            }}
          >
            Trocar servidor
          </Button>
        </div>
      </Tela>
    );
  }
  if (!auth.data?.autenticado) return <Girando />;
  return <>{children}</>;
}

function Girando() {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function Tela({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-[100dvh] flex-col items-center justify-center overflow-y-auto bg-background px-5 text-foreground"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="w-full max-w-sm py-8">
        <div className="mb-6 text-center text-lg font-semibold">
          Chronos Flow{' '}
          <span className="rounded bg-secondary px-1 align-middle font-mono text-[10px] text-muted-foreground">v2</span>
        </div>
        {children}
      </div>
    </div>
  );
}

const mensagem = (e: unknown) => {
  if (e instanceof ApiError && Array.isArray(e.details)) {
    return (e.details as Array<{ message: string }>)[0]?.message ?? e.message;
  }
  return (e as Error)?.message ?? 'Algo deu errado.';
};

/* ── Escolher onde trabalhar ─────────────────────────────────────────────── */

function EscolherServidor() {
  const queryClient = useQueryClient();
  const { servidores } = useConexao();
  const [url, setUrl] = useState('');
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  // Limpa antes de trocar: depois, a tela do outro lado ja estaria lendo.
  const ir = useMutation({
    mutationFn: async (alvo: string) => {
      limparDados(queryClient);
      await escolher(alvo);
    },
    onError: (e) => setErro(mensagem(e)),
  });

  const conectar = useMutation({
    mutationFn: async () => {
      limparDados(queryClient);
      await adicionar(url, nome);
    },
    onError: (e) => setErro(mensagem(e)),
  });

  return (
    <Tela>
      <div className="rounded-xl border bg-card p-5">
        <h1 className="text-base font-semibold">Onde voce quer trabalhar?</h1>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Neste iPhone, os projetos ficam so no aparelho, sem conta. Num servidor, voce entra com a sua conta e ve os
          mesmos projetos do computador. Da para trocar depois em Mais.
        </p>

        <ul className="mt-4 space-y-2">
          <li>
            <Opcao
              icone={<Smartphone className="h-5 w-5" />}
              titulo="Neste iPhone"
              nota="Sem conta, funciona sem internet"
              onClick={() => ir.mutate(NO_APARELHO)}
            />
          </li>
          {servidores.map((s) => (
            <li key={s.url} className="flex items-center gap-1">
              <Opcao
                icone={<Server className="h-5 w-5" />}
                titulo={s.nome}
                nota={s.url.replace(/^https?:\/\//, '')}
                onClick={() => ir.mutate(s.url)}
              />
              <button
                type="button"
                aria-label={`Tirar ${s.nome} da lista`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-accent"
                onClick={() => void remover(s.url)}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>

        <form
          className="mt-5 space-y-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErro(null);
            conectar.mutate();
          }}
        >
          <Label htmlFor="servidor-url">Conectar a um servidor</Label>
          <Input
            id="servidor-url"
            placeholder="flow.suaempresa.com.br"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            value={url}
            onChange={(e) => {
              setErro(null);
              setUrl(e.target.value);
            }}
            required
          />
          <Input
            placeholder="Nome (opcional), ex.: Empresa"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          {erro && (
            <p role="alert" className="text-xs text-destructive">
              {erro}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={conectar.isPending}>
            {conectar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {conectar.isPending ? 'Conferindo...' : 'Conectar'}
          </Button>
        </form>
      </div>
    </Tela>
  );
}

function Opcao({
  icone,
  titulo,
  nota,
  onClick,
}: {
  icone: React.ReactNode;
  titulo: string;
  nota: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full min-w-0 items-center gap-3 rounded-lg border bg-background px-3 py-2.5 text-left active:bg-accent"
    >
      <span className="text-muted-foreground">{icone}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{titulo}</span>
        <span className="block truncate text-xs text-muted-foreground">{nota}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/* ── Entrar ou criar conta no servidor ───────────────────────────────────── */

/**
 * Aceita o codigo ou o link inteiro do convite: no celular, o que a pessoa
 * recebe e o link, e copiar so o pedaco depois de `#convite=` e pedir demais.
 */
export function codigoDoConvite(texto: string): string {
  const t = texto.trim();
  return t.match(/#convite=([A-Za-z0-9_-]+)/)?.[1] ?? t;
}

function Entrada() {
  const queryClient = useQueryClient();
  const servidor = servidorAtual();
  const [modo, setModo] = useState<'entrar' | 'cadastro'>('entrar');
  const [form, setForm] = useState({ nome: '', email: '', senha: '', convite: '' });
  const [erro, setErro] = useState<string | null>(null);

  const { data: estado } = useQuery<AuthEstado>({
    queryKey: [...AUTH_KEY, 'publico', servidor?.url],
    queryFn: conta.estado,
    retry: 1,
  });

  const enviar = useMutation({
    mutationFn: () =>
      modo === 'entrar'
        ? conta.entrar(form.email, form.senha)
        : conta.cadastro({
            nome: form.nome,
            email: form.email,
            senha: form.senha,
            ...(form.convite.trim() ? { convite: codigoDoConvite(form.convite) } : {}),
          }),
    onSuccess: async (r) => {
      if (!r.tokenDoApp) {
        setErro('O servidor nao entregou a sessao do app. Ele pode estar desatualizado.');
        return;
      }
      limparDados(queryClient);
      await guardarSessao(r.tokenDoApp);
    },
    onError: (e) => setErro(mensagem(e)),
  });

  const campo = (nome: keyof typeof form) => ({
    value: form[nome],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setErro(null);
      setForm((f) => ({ ...f, [nome]: e.target.value }));
    },
  });

  const cadastro = modo === 'cadastro';
  const podeCadastrar = estado?.cadastroAberto ?? true;

  return (
    <Tela>
      <button
        type="button"
        onClick={() => {
          limparDados(queryClient);
          void voltarParaEscolha();
        }}
        className="mb-4 flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground"
      >
        <Server className="h-3.5 w-3.5" />
        <span className="truncate">{servidor?.nome ?? 'Servidor'}</span>
        <span>·</span>
        <span className="font-medium text-foreground underline underline-offset-2">Trocar</span>
      </button>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar.mutate();
        }}
        className="space-y-4 rounded-xl border bg-card p-5"
      >
        <div>
          <h1 className="text-base font-semibold">{cadastro ? 'Criar conta' : 'Entrar'}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {cadastro
              ? 'Use o convite que voce recebeu (o codigo ou o link inteiro).'
              : 'Use o e-mail e a senha da sua conta neste servidor.'}
          </p>
        </div>

        {cadastro && (
          <div className="space-y-1.5">
            <Label htmlFor="nome">Nome</Label>
            <Input id="nome" autoComplete="name" required {...campo('nome')} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="email"
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
        {cadastro && (
          <div className="space-y-1.5">
            <Label htmlFor="convite">Convite</Label>
            <Input
              id="convite"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Cole o link ou o codigo"
              required={estado?.conviteExigido ?? true}
              {...campo('convite')}
            />
          </div>
        )}

        {erro && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            {erro}
          </p>
        )}

        <Button type="submit" className="h-11 w-full" disabled={enviar.isPending}>
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

      {podeCadastrar && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {cadastro ? 'Ja tem conta? ' : 'Recebeu um convite? '}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-2"
            onClick={() => {
              setErro(null);
              setModo(cadastro ? 'entrar' : 'cadastro');
            }}
          >
            {cadastro ? 'Entrar' : 'Criar conta'}
          </button>
        </p>
      )}
    </Tela>
  );
}
