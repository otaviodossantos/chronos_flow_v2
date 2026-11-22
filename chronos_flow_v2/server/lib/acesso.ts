import { createHash, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type { Request, RequestHandler } from 'express';

/** A propria maquina: e de onde o app desktop fala com o servidor. */
export function ehLocal(endereco: string | undefined): boolean {
  if (!endereco) return false;
  const limpo = endereco.replace(/^::ffff:/, '');
  return limpo === '127.0.0.1' || limpo === '::1';
}

/** Digests do mesmo tamanho para poder comparar em tempo constante. */
function igual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

/** O token pode vir no cabecalho proprio ou como senha do Basic do navegador. */
function apresentado(req: Request): string | null {
  const direto = req.get('x-chronos-token');
  if (direto) return direto;

  const auth = req.get('authorization');
  if (!auth?.startsWith('Basic ')) return null;

  const decodificado = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const senha = decodificado.slice(decodificado.indexOf(':') + 1);
  return senha || null;
}

/**
 * Este servidor nao tem login: `currentUserId` devolve o primeiro usuario do
 * banco. Enquanto ele so escutava a propria maquina isso era inofensivo — de
 * fora, qualquer um que alcance a porta manda no banco inteiro.
 *
 * Dai a regra: de fora so entra quem apresentar o token, e sem token definido
 * nao se entra de fora nenhuma. Nao e autenticacao de verdade, e sim o minimo
 * para abrir na rede de casa sem publicar o banco junto.
 *
 * O endereco vem do socket, nunca de `X-Forwarded-For`: cabecalho e coisa que
 * quem esta chamando escreve, e seria justamente o que um estranho forjaria
 * para se passar por local.
 */
export function exigeAcesso(): RequestHandler {
  const token = (process.env.CHRONOS_ACCESS_TOKEN ?? '').trim();

  return (req, res, next) => {
    if (ehLocal(req.socket.remoteAddress)) return next();

    if (!token) {
      res.status(403).json({
        error: {
          code: 'SOMENTE_LOCAL',
          message:
            'Este servidor so aceita conexoes da propria maquina. Defina ' +
            'CHRONOS_ACCESS_TOKEN no .env para liberar o acesso pela rede.',
        },
      });
      return;
    }

    const oferecido = apresentado(req);
    if (oferecido && igual(oferecido, token)) return next();

    // O Basic faz o navegador perguntar uma vez e lembrar — inclusive no celular.
    res.setHeader('WWW-Authenticate', 'Basic realm="Chronos Flow", charset="UTF-8"');
    res.status(401).json({
      error: { code: 'NAO_AUTORIZADO', message: 'Token de acesso ausente ou incorreto.' },
    });
  };
}

/** Enderecos de rede desta maquina, para dizer por onde entrar. */
export function enderecosDaRede(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((lista) => lista ?? [])
    .filter((n) => n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}
