import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * A ponte para o lado Swift. Do lado de ca ela e so um contrato; quem a
 * implementa e `ios-native/Plugin/ChronosNativePlugin.swift`.
 *
 * Duas coisas moram aqui porque so o iOS sabe faze-las: a Live Activity que
 * aparece na Ilha Dinamica e os widgets da tela inicial. Fora do aparelho
 * tudo vira no-op — assim as telas nao precisam perguntar onde estao rodando,
 * e o app continua abrindo no navegador durante o desenvolvimento.
 */
export interface FocoAtivo {
  /** Id da tarefa: e o que o toque na ilha devolve, via chronosflow://tarefa/<id>. */
  nodeId: string;
  titulo: string;
  /** Caminho curto ate a raiz, para a ilha expandida. Ex.: "Turisky › Site". */
  trilha: string;
  /** Quando o bloco termina. A ilha conta sozinha a partir disso. */
  fim: string;
  /** Duracao cheia do bloco, para desenhar o quanto ja passou. */
  totalSegundos: number;
  pausadoEm?: string | null;
  cor?: string;
}

export interface ResumoDoDia {
  /** Titulo da proxima tarefa, ou null num dia vago. */
  proxima: string | null;
  proximaInicio: string | null;
  pendentes: number;
  concluidasHoje: number;
  minutosFocados: number;
  metaDeMinutos: number;
  impactoDoDia: number;
}

interface ChronosNativePlugin {
  guardarSegredo(dados: { chave: string; valor: string }): Promise<void>;
  lerSegredo(dados: { chave: string }): Promise<{ valor: string | null }>;
  apagarSegredo(dados: { chave: string }): Promise<void>;
  iniciarFoco(dados: FocoAtivo): Promise<{ ativo: boolean }>;
  atualizarFoco(dados: Partial<FocoAtivo> & { nodeId: string }): Promise<{ ativo: boolean }>;
  encerrarFoco(dados: { nodeId?: string }): Promise<{ ativo: boolean }>;
  estadoDoFoco(): Promise<{ ativo: boolean; nodeId?: string }>;
  publicarResumo(dados: ResumoDoDia): Promise<void>;
  /** Abre a pagina do app nos Ajustes do iOS. */
  abrirAjustes(): Promise<void>;
  /** 'granted' | 'denied' | 'prompt' — o estado do microfone segundo o sistema. */
  estadoDoMicrofone(): Promise<{ status: string }>;
  vibrar(dados: { tipo: 'leve' | 'medio' | 'sucesso' }): Promise<void>;
  procurarDesktops(dados: { segundos?: number }): Promise<{
    desktops: Desktop[];
    diagnostico: Diagnostico;
  }>;
  escolherContatos(): Promise<{ contatos: Contato[]; cancelado: boolean }>;
  listarContatos(): Promise<{ permissao: 'ok' | 'negada'; contatos: Contato[] }>;
  estadoDosAvisos(): Promise<{
    permissao: EstadoDaPermissao;
    armados: number;
    totalNoSistema: number;
  }>;
  pedirPermissaoDeAvisos(): Promise<{ permissao: EstadoDaPermissao }>;
  sincronizarAvisos(dados: { avisos: AvisoNativo[] }): Promise<{
    armados: number;
    pedidos: number;
  }>;
}

export type EstadoDaPermissao = 'ok' | 'negada' | 'nao-perguntado';

/** O que o lado nativo precisa saber de cada aviso. */
export interface AvisoNativo {
  id: string;
  nodeId: string;
  titulo: string;
  corpo: string;
  /** Instante ISO. Quem resolveu o fuso foi o app; o nativo so conta o tempo. */
  quando: string;
}

/**
 * Uma pessoa escolhida na agenda do iPhone.
 *
 * `email` e `telefone` vem vazios com frequencia, e nao e erro: o seletor do
 * sistema entrega os contatos com um conjunto parcial de chaves, e muita gente
 * na agenda so tem nome e telefone mesmo. O nome e o unico campo garantido —
 * e e o que o cadastro de membro exige.
 */
export interface Contato {
  id: string;
  nome: string;
  email: string;
  telefone: string;
}

/** Um Chronos de desktop achado na mesma rede. */
export interface Desktop {
  nome: string;
  host: string;
  porta: number;
}

/**
 * Onde a busca parou. `vistos` sao os servicos que o mDNS entregou;
 * `resolvidos`, quantos viraram endereco. A diferenca entre os dois e o caso
 * do firewall: o anuncio chega, a conexao nao.
 */
export interface Diagnostico {
  estado: 'iniciando' | 'ready' | 'waiting' | 'failed' | 'cancelled' | string;
  detalhe: string;
  vistos: number;
  resolvidos: number;
}

export type ResultadoDaBusca =
  | { ok: true; desktops: Desktop[]; diagnostico: Diagnostico }
  | { ok: false; motivo: 'fora-do-aparelho' | 'plugin-ausente' | 'erro'; detalhe: string };

const plugin = registerPlugin<ChronosNativePlugin>('ChronosNative');

export const noAparelho = () => Capacitor.getPlatform() === 'ios';

/**
 * Engolir o erro e proposital. A Live Activity depende de uma permissao que o
 * usuario pode ter negado e de um limite de atividades simultaneas do sistema:
 * nenhum dos dois e motivo para derrubar o cronometro dentro do app.
 */
async function tentar<T>(oQue: string, trabalho: () => Promise<T>): Promise<T | null> {
  if (!noAparelho()) return null;
  try {
    return await trabalho();
  } catch (erro) {
    console.warn(`[chronos] ${oQue} falhou:`, erro);
    return null;
  }
}

export const ilha = {
  iniciar: (dados: FocoAtivo) => tentar('iniciar a ilha', () => plugin.iniciarFoco(dados)),
  atualizar: (dados: Partial<FocoAtivo> & { nodeId: string }) =>
    tentar('atualizar a ilha', () => plugin.atualizarFoco(dados)),
  encerrar: (nodeId?: string) => tentar('encerrar a ilha', () => plugin.encerrarFoco({ nodeId })),
  estado: () => tentar('ler o estado da ilha', () => plugin.estadoDoFoco()),
};

export const widgets = {
  publicar: (resumo: ResumoDoDia) => tentar('publicar o resumo', () => plugin.publicarResumo(resumo)),
};

export const rede = {
  /**
   * Procura computadores pelo Bonjour.
   *
   * Esta e a unica chamada nativa que **nao** engole o erro. Nas outras, falhar
   * em silencio e o certo: uma Live Activity recusada nao pode derrubar o
   * cronometro. Aqui o erro e a informacao — sem ele, "o plugin nao foi
   * adicionado ao alvo no Xcode" e "nenhum Mac na rede" viram a mesma frase na
   * tela, e so uma das duas tem conserto do lado de quem esta olhando.
   */
  procurar: async (segundos = 2.5): Promise<ResultadoDaBusca> => {
    if (!noAparelho()) {
      return { ok: false, motivo: 'fora-do-aparelho', detalhe: 'Fora do iPhone nao ha rede local.' };
    }
    try {
      const r = await plugin.procurarDesktops({ segundos });
      return { ok: true, desktops: r.desktops ?? [], diagnostico: r.diagnostico };
    } catch (erro) {
      const mensagem = (erro as Error).message ?? String(erro);
      // O Capacitor responde assim quando o metodo nao existe no alvo nativo.
      const ausente = /not implemented|does not have a method|unimplemented/i.test(mensagem);
      return {
        ok: false,
        motivo: ausente ? 'plugin-ausente' : 'erro',
        detalhe: mensagem,
      };
    }
  },
};

/**
 * A agenda do aparelho.
 *
 * Como a busca na rede, esta chamada **nao** engole o erro: "o plugin nao foi
 * recompilado no Xcode" e "a pessoa desistiu" precisam virar frases
 * diferentes na tela — so uma das duas tem conserto do lado de quem esta
 * olhando.
 */
export type ResultadoDaAgenda =
  | { ok: true; contatos: Contato[] }
  | {
      ok: false;
      motivo: 'fora-do-aparelho' | 'plugin-ausente' | 'permissao-negada' | 'erro';
      detalhe: string;
    };

export const contatos = {
  /**
   * A agenda inteira, para o app montar a lista com busca.
   *
   * Pede a permissao de Contatos na primeira vez. Negar nao e erro: volta
   * `permissao-negada` e a tela oferece os Ajustes ou o seletor do sistema,
   * que funciona sem permissao nenhuma.
   */
  listar: async (): Promise<ResultadoDaAgenda> => {
    if (!noAparelho()) {
      return { ok: false, motivo: 'fora-do-aparelho', detalhe: 'A agenda so existe no iPhone.' };
    }
    try {
      const r = await plugin.listarContatos();
      if (r.permissao !== 'ok') {
        return {
          ok: false,
          motivo: 'permissao-negada',
          detalhe: 'O Chronos nao tem acesso aos contatos.',
        };
      }
      return { ok: true, contatos: r.contatos ?? [] };
    } catch (erro) {
      const mensagem = (erro as Error).message ?? String(erro);
      const ausente = /not implemented|does not have a method|unimplemented/i.test(mensagem);
      return { ok: false, motivo: ausente ? 'plugin-ausente' : 'erro', detalhe: mensagem };
    }
  },

  escolher: async (): Promise<
    | { ok: true; contatos: Contato[]; cancelado: boolean }
    | { ok: false; motivo: 'fora-do-aparelho' | 'plugin-ausente' | 'erro'; detalhe: string }
  > => {
    if (!noAparelho()) {
      return { ok: false, motivo: 'fora-do-aparelho', detalhe: 'A agenda so existe no iPhone.' };
    }
    try {
      const r = await plugin.escolherContatos();
      return { ok: true, contatos: r.contatos ?? [], cancelado: Boolean(r.cancelado) };
    } catch (erro) {
      const mensagem = (erro as Error).message ?? String(erro);
      const ausente = /not implemented|does not have a method|unimplemented/i.test(mensagem);
      return { ok: false, motivo: ausente ? 'plugin-ausente' : 'erro', detalhe: mensagem };
    }
  },
};

/**
 * Avisos de tarefa.
 *
 * Fora do iPhone tudo vira no-op em silencio, como a ilha e os widgets: a tela
 * de ajustes continua abrindo no navegador durante o desenvolvimento, so nao
 * arma nada.
 */
export const avisos = {
  estado: async (): Promise<{
    permissao: EstadoDaPermissao;
    armados: number;
    totalNoSistema: number;
  }> => {
    if (!noAparelho()) return { permissao: 'nao-perguntado', armados: 0, totalNoSistema: 0 };
    try {
      return await plugin.estadoDosAvisos();
    } catch {
      return { permissao: 'nao-perguntado', armados: 0, totalNoSistema: 0 };
    }
  },

  pedirPermissao: async (): Promise<EstadoDaPermissao> => {
    if (!noAparelho()) return 'nao-perguntado';
    try {
      return (await plugin.pedirPermissaoDeAvisos()).permissao;
    } catch {
      return 'negada';
    }
  },

  /**
   * Substitui no sistema todos os avisos de tarefa por este plano.
   *
   * Engole o erro como as outras chamadas nativas de conveniencia: falhar em
   * armar um lembrete nao pode derrubar a tela que estava sendo usada.
   */
  sincronizar: (avisosDoPlano: AvisoNativo[]) =>
    tentar('sincronizar os avisos', () =>
      plugin.sincronizarAvisos({ avisos: avisosDoPlano }),
    ),
};

export const sistema = {
  abrirAjustes: () => tentar('abrir os Ajustes', () => plugin.abrirAjustes()),
  microfone: () => tentar('ler a permissao do microfone', () => plugin.estadoDoMicrofone()),
  vibrar: (tipo: 'leve' | 'medio' | 'sucesso' = 'leve') =>
    tentar('vibrar', () => plugin.vibrar({ tipo })),
};

/**
 * Cofre para o login dos servidores (Keychain no iPhone). Fora do aparelho —
 * o `npm run dev` no navegador — cai no localStorage, que so existe para
 * desenvolver: la nao ha Keychain.
 *
 * Aqui o erro NAO e engolido como no resto deste arquivo: perder um token em
 * silencio deixaria o app logado na tela e deslogado no servidor.
 */
const PREFIXO_DO_COFRE = 'chronos.cofre.';
export const cofre = {
  guardar: async (chave: string, valor: string): Promise<void> => {
    if (!noAparelho()) {
      localStorage.setItem(PREFIXO_DO_COFRE + chave, valor);
      return;
    }
    await plugin.guardarSegredo({ chave, valor });
  },
  ler: async (chave: string): Promise<string | null> => {
    if (!noAparelho()) return localStorage.getItem(PREFIXO_DO_COFRE + chave);
    return (await plugin.lerSegredo({ chave })).valor ?? null;
  },
  apagar: async (chave: string): Promise<void> => {
    if (!noAparelho()) {
      localStorage.removeItem(PREFIXO_DO_COFRE + chave);
      return;
    }
    await plugin.apagarSegredo({ chave });
  },
};
