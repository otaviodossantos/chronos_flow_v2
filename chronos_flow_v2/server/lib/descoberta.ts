import dgram from 'node:dgram';
import { enderecosDaRede } from './rede.js';

/**
 * Como o celular acha este computador sem ninguem digitar um IP.
 *
 * Sao dois anuncios porque sao dois mundos:
 *
 * 1. **UDP** na porta 45678. Simples e direto: quem procura joga um datagrama
 *    no endereco de broadcast da rede e quem e Chronos responde com o proprio
 *    endereco. Serve entre computadores e para qualquer ferramenta de linha de
 *    comando.
 *
 * 2. **Bonjour/mDNS** (`_chronos._tcp`). E o unico caminho que o iPhone pode
 *    usar: desde o iOS 14 a Apple exige a permissao
 *    `com.apple.developer.networking.multicast` para um app *enviar ou
 *    receber* broadcast e multicast, e ela e concedida sob pedido, caso a
 *    caso. Bonjour com um tipo de servico declarado fica fora dessa exigencia
 *    — pede so a permissao de rede local, aquela que o sistema pergunta na
 *    primeira vez.
 *
 * Nenhum dos dois carrega dado nenhum do banco: eles dizem "existe um Chronos
 * aqui, neste endereco, nesta porta". O que vale alguma coisa so sai depois do
 * codigo de pareamento.
 */
export const PORTA_DESCOBERTA = 45678;
export const PERGUNTA = 'CHRONOS_QUEM_E';
export const SERVICO_BONJOUR = 'chronos';

export interface Anuncio {
  app: 'chronos-flow';
  tipo: 'desktop';
  nome: string;
  porta: number;
  enderecos: string[];
  formato: number;
}

/** O que vai dentro do datagrama. Fora daqui para poder ser testado sem rede. */
export function montarAnuncio(dados: Omit<Anuncio, 'app' | 'tipo' | 'enderecos'>): Anuncio {
  return {
    app: 'chronos-flow',
    tipo: 'desktop',
    enderecos: enderecosDaRede(),
    ...dados,
  };
}

/** Uma pergunta valida e exatamente a nossa palavra, e nada mais. */
export function ehPergunta(datagrama: Buffer): boolean {
  return datagrama.toString('utf8').trim() === PERGUNTA;
}

export interface Descoberta {
  parar: () => Promise<void>;
}

/**
 * Sobe o respondedor UDP e, se o pacote `bonjour-service` estiver instalado,
 * o anuncio mDNS.
 *
 * O Bonjour entra por import dinamico de proposito: ele e util e nao e
 * essencial, e um `npm install` esquecido nao pode impedir o servidor de
 * subir — a mensagem no console diz o que falta e a vida segue com o UDP.
 */
export async function anunciar(opcoes: {
  nome: string;
  porta: number;
  formato: number;
}): Promise<Descoberta> {
  const anuncio = montarAnuncio(opcoes);
  const corpo = Buffer.from(JSON.stringify(anuncio));

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('message', (datagrama, remetente) => {
    if (!ehPergunta(datagrama)) return;
    // Responde ao remetente, nunca em broadcast: a resposta interessa a quem
    // perguntou, e espalha-la de volta so faria barulho na rede.
    socket.send(corpo, remetente.port, remetente.address);
  });

  socket.on('error', (erro) => {
    console.warn('[descoberta] UDP indisponivel:', erro.message);
  });

  await new Promise<void>((resolve) => {
    socket.bind(PORTA_DESCOBERTA, () => {
      // Sem isto o socket nem chega a receber os datagramas de broadcast.
      try {
        socket.setBroadcast(true);
      } catch {
        /* algumas redes recusam; o Bonjour continua valendo */
      }
      resolve();
    });
  });

  let pararBonjour: (() => Promise<void>) | null = null;
  try {
    // Via `unknown`: o tipo real do pacote pede opcoes no construtor e no
    // publish que nao usamos, e a conversao direta nao compilava (travava o
    // `npm run build`).
    const { Bonjour } = (await import('bonjour-service')) as unknown as {
      Bonjour: new () => {
        publish: (o: Record<string, unknown>) => { stop: (cb?: () => void) => void };
        destroy: () => void;
      };
    };
    const bonjour = new Bonjour();
    const servico = bonjour.publish({
      name: `Chronos Flow — ${opcoes.nome}`,
      type: SERVICO_BONJOUR,
      port: opcoes.porta,
      // O TXT e lido pelo iPhone antes de abrir conexao: e o que deixa a lista
      // mostrar o nome certo sem uma ida a API.
      txt: { nome: opcoes.nome, formato: String(opcoes.formato), tipo: 'desktop' },
    });
    pararBonjour = () =>
      new Promise<void>((resolve) => {
        servico.stop(() => {
          bonjour.destroy();
          resolve();
        });
      });
  } catch {
    console.warn(
      '[descoberta] bonjour-service nao instalado: o iPhone nao vera este' +
        ' computador sozinho. Rode: npm i bonjour-service',
    );
  }

  return {
    parar: async () => {
      await pararBonjour?.();
      await new Promise<void>((resolve) => socket.close(() => resolve()));
    },
  };
}

/**
 * O lado de quem procura. Usado por outro desktop e pela linha de comando —
 * o iPhone nao pode usar este caminho (veja a nota sobre a permissao da Apple
 * no topo) e usa o Bonjour.
 */
export function procurar(timeoutMs = 1200): Promise<Anuncio[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const achados = new Map<string, Anuncio>();

    socket.on('message', (datagrama, remetente) => {
      try {
        const anuncio = JSON.parse(datagrama.toString('utf8')) as Anuncio;
        if (anuncio?.app !== 'chronos-flow') return;
        // O endereco de quem respondeu vale mais que o que ele diz ser: numa
        // maquina com varias interfaces, a lista interna pode trazer um
        // endereco que nao e o que alcanca este lado da rede.
        achados.set(remetente.address, {
          ...anuncio,
          enderecos: [...new Set([remetente.address, ...(anuncio.enderecos ?? [])])],
        });
      } catch {
        /* datagrama de outro programa na mesma porta */
      }
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(PERGUNTA, PORTA_DESCOBERTA, '255.255.255.255');
    });

    setTimeout(() => {
      socket.close();
      resolve([...achados.values()]);
    }, timeoutMs);
  });
}
