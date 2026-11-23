import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';
import { configurarTransporte } from '@desktop/src/lib/api';
import { conferir, normalizar } from '@desktop/electron/enderecos';
import { cofre } from '@/native/chronos';

/**
 * Onde o app trabalha: no proprio iPhone (o SQLite do aparelho, sem conta,
 * como sempre foi) ou num servidor do Chronos — o da empresa, o de um
 * cliente —, com as contas e os projetos de la.
 *
 * O mesmo modelo do app desktop: cada servidor tem o proprio login, guardado
 * separado, entao trocar de servidor e voltar encontra a sessao intacta.
 *
 * O que vai para as Preferences e so a lista (nome e endereco). O token da
 * sessao de cada servidor vai para o Keychain (`cofre`).
 */
export const NO_APARELHO = 'aparelho';

export interface Servidor {
  nome: string;
  url: string;
}

interface Gravado {
  /** `aparelho`, a origem de um servidor, ou null = perguntar ao abrir. */
  atual: string | null;
  servidores: Servidor[];
}

interface EstadoDaConexao extends Gravado {
  carregado: boolean;
  /** Ha token guardado para o servidor atual (a validade quem diz e o servidor). */
  comSessao: boolean;
  /**
   * Muda a cada troca de servidor, entrada ou saida. Entra na chave da consulta
   * do login: cada sessao pergunta ao servidor do zero, sem herdar a resposta
   * (em cache) de quem estava antes.
   */
  geracao: number;
}

const CHAVE = 'chronos.servidores';
const chaveDaSessao = (url: string) => `sessao:${url}`;

/** O token em memoria: lido a cada requisicao pelo transporte, sem ir ao Keychain. */
let tokenAtual: string | null = null;

export const useConexao = create<EstadoDaConexao>(() => ({
  carregado: false,
  atual: null,
  servidores: [],
  comSessao: false,
  geracao: 0,
}));

const novaGeracao = () => useConexao.getState().geracao + 1;

export const noServidor = () => {
  const { atual } = useConexao.getState();
  return atual !== null && atual !== NO_APARELHO;
};

export const servidorAtual = (): Servidor | null => {
  const { atual, servidores } = useConexao.getState();
  return servidores.find((s) => s.url === atual) ?? null;
};

async function gravar(g: Gravado) {
  await Preferences.set({ key: CHAVE, value: JSON.stringify(g) });
}

function ler(bruto: string | null): Gravado {
  try {
    const d = JSON.parse(bruto ?? '');
    return {
      atual: typeof d.atual === 'string' ? d.atual : null,
      servidores: Array.isArray(d.servidores)
        ? d.servidores.filter(
            (s: unknown): s is Servidor =>
              Boolean(s && typeof (s as Servidor).nome === 'string' && typeof (s as Servidor).url === 'string'),
          )
        : [],
    };
  } catch {
    return { atual: null, servidores: [] };
  }
}

/** Aponta o cliente HTTP para o servidor atual, com o token dele. */
async function apontar(atual: string | null) {
  const remoto = atual !== null && atual !== NO_APARELHO;
  tokenAtual = remoto ? await cofre.ler(chaveDaSessao(atual)) : null;
  if (remoto) {
    configurarTransporte({
      base: `${atual}/api`,
      cabecalhos: (): Record<string, string> => (tokenAtual ? { Authorization: `Bearer ${tokenAtual}` } : {}),
    });
  }
  useConexao.setState({ atual, comSessao: Boolean(tokenAtual), geracao: novaGeracao() });
}

/** Na abertura do app, antes de qualquer tela. */
export async function carregarConexao() {
  const g = ler((await Preferences.get({ key: CHAVE })).value);
  // Um servidor que saiu da lista nao pode continuar sendo o atual.
  const atual = g.atual === NO_APARELHO || g.servidores.some((s) => s.url === g.atual) ? g.atual : null;
  useConexao.setState({ servidores: g.servidores });
  await apontar(atual);
  useConexao.setState({ carregado: true });
}

/** Trabalhar no aparelho ou num servidor ja cadastrado. */
export async function escolher(alvo: string) {
  const { servidores } = useConexao.getState();
  if (alvo !== NO_APARELHO && !servidores.some((s) => s.url === alvo)) {
    throw new Error('Servidor fora da lista.');
  }
  await gravar({ atual: alvo, servidores });
  await apontar(alvo);
}

/** Voltar para a tela de escolha (o "Trocar servidor"). A sessao de cada um fica guardada. */
export async function voltarParaEscolha() {
  const { servidores } = useConexao.getState();
  await gravar({ atual: null, servidores });
  await apontar(null);
}

/**
 * Confere que no endereco responde um Chronos, guarda na lista e ja escolhe.
 * Mesmas regras do desktop: so HTTPS, menos a propria maquina.
 */
export async function adicionar(bruto: string, nome?: string) {
  const url = normalizar(bruto);
  await conferir(url);
  const { servidores } = useConexao.getState();
  const resto = servidores.filter((s) => s.url !== url);
  const novos = [...resto, { nome: nome?.trim() || new URL(url).hostname, url }];
  useConexao.setState({ servidores: novos });
  await gravar({ atual: url, servidores: novos });
  await apontar(url);
}

export async function remover(url: string) {
  const { servidores, atual } = useConexao.getState();
  const novos = servidores.filter((s) => s.url !== url);
  await cofre.apagar(chaveDaSessao(url));
  const proximo = atual === url ? null : atual;
  useConexao.setState({ servidores: novos });
  await gravar({ atual: proximo, servidores: novos });
  if (atual === url) await apontar(null);
}

/** Depois de entrar ou criar a conta: o token vai para o Keychain. */
export async function guardarSessao(token: string) {
  const { atual } = useConexao.getState();
  if (!atual || atual === NO_APARELHO) throw new Error('Nenhum servidor escolhido.');
  await cofre.guardar(chaveDaSessao(atual), token);
  tokenAtual = token;
  useConexao.setState({ comSessao: true, geracao: novaGeracao() });
}

/** Saiu, expirou, senha trocada em outro lugar, conta bloqueada: esquece o token. */
export async function esquecerSessao() {
  const { atual } = useConexao.getState();
  if (atual && atual !== NO_APARELHO) await cofre.apagar(chaveDaSessao(atual));
  tokenAtual = null;
  useConexao.setState({ comSessao: false, geracao: novaGeracao() });
}
