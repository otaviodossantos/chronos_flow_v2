import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exigeAcesso } from '../../server/lib/acesso.js';

const basic = (senha: string, usuario = '') =>
  `Basic ${Buffer.from(`${usuario}:${senha}`).toString('base64')}`;

/** Requisicao e resposta de mentira, so com o que o porteiro olha. */
function cenario(de: string, cabecalhos: Record<string, string> = {}) {
  const req = {
    socket: { remoteAddress: de },
    get: (nome: string) => cabecalhos[nome.toLowerCase()],
  };
  const res = {
    status: 0,
    corpo: null as unknown,
    cabecalhos: {} as Record<string, string>,
    setHeader(nome: string, valor: string) {
      this.cabecalhos[nome] = valor;
    },
    json(corpo: unknown) {
      this.corpo = corpo;
      return this;
    },
  };
  Object.defineProperty(res, 'status', {
    value: function (codigo: number) {
      (this as { codigoUsado?: number }).codigoUsado = codigo;
      return this;
    },
  });
  return { req, res: res as never, passou: { valor: false } };
}

const rodar = (de: string, cabecalhos: Record<string, string> = {}) => {
  const c = cenario(de, cabecalhos);
  exigeAcesso()(c.req as never, c.res, (() => {
    c.passou.valor = true;
  }) as never);
  const res = c.res as unknown as {
    codigoUsado?: number;
    corpo?: { error?: { code: string } };
    cabecalhos: Record<string, string>;
  };
  return { passou: c.passou.valor, codigo: res.codigoUsado, corpo: res.corpo, res };
};

const TOKEN = 'segredo-de-casa';

describe('exigeAcesso — sem token definido', () => {
  beforeEach(() => {
    delete process.env.CHRONOS_ACCESS_TOKEN;
  });

  it('a propria maquina entra sempre', () => {
    expect(rodar('127.0.0.1').passou).toBe(true);
    expect(rodar('::1').passou).toBe(true);
  });

  it('IPv4 mapeado em IPv6 tambem e a propria maquina', () => {
    expect(rodar('::ffff:127.0.0.1').passou).toBe(true);
  });

  it('de fora, recusa e explica como liberar', () => {
    const r = rodar('192.168.0.42');
    expect(r.passou).toBe(false);
    expect(r.codigo).toBe(403);
    expect(r.corpo?.error?.code).toBe('SOMENTE_LOCAL');
  });

  it('token apresentado nao vale nada enquanto nao houver token definido', () => {
    expect(rodar('192.168.0.42', { 'x-chronos-token': 'qualquer' }).passou).toBe(false);
  });
});

describe('exigeAcesso — com token definido', () => {
  beforeEach(() => {
    process.env.CHRONOS_ACCESS_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.CHRONOS_ACCESS_TOKEN;
  });

  it('a propria maquina continua entrando sem apresentar nada', () => {
    expect(rodar('127.0.0.1').passou).toBe(true);
  });

  it('de fora, com o token no cabecalho proprio, entra', () => {
    expect(rodar('192.168.0.42', { 'x-chronos-token': TOKEN }).passou).toBe(true);
  });

  it('de fora, com o token como senha do Basic, entra', () => {
    expect(rodar('192.168.0.42', { authorization: basic(TOKEN) }).passou).toBe(true);
  });

  it('senha com dois-pontos no meio nao e cortada', () => {
    process.env.CHRONOS_ACCESS_TOKEN = 'a:b:c';
    expect(rodar('192.168.0.42', { authorization: basic('a:b:c') }).passou).toBe(true);
  });

  it('token errado nao entra, e o navegador e convidado a perguntar', () => {
    const r = rodar('192.168.0.42', { 'x-chronos-token': 'chute' });
    expect(r.passou).toBe(false);
    expect(r.codigo).toBe(401);
    expect(r.res.cabecalhos['WWW-Authenticate']).toContain('Basic');
  });

  it('sem apresentar nada, tambem e convidado a perguntar', () => {
    expect(rodar('192.168.0.42').codigo).toBe(401);
  });

  it('dizer-se local por cabecalho nao funciona: vale o socket', () => {
    const r = rodar('203.0.113.9', {
      'x-forwarded-for': '127.0.0.1',
      'x-real-ip': '127.0.0.1',
    });
    expect(r.passou).toBe(false);
    expect(r.codigo).toBe(401);
  });

  it('prefixo parecido nao passa', () => {
    expect(rodar('192.168.0.42', { 'x-chronos-token': TOKEN.slice(0, -1) }).passou).toBe(false);
    expect(rodar('192.168.0.42', { 'x-chronos-token': `${TOKEN}x` }).passou).toBe(false);
  });

  it('Basic malformado nao derruba o servidor', () => {
    expect(rodar('192.168.0.42', { authorization: 'Basic !!!nao-e-base64' }).passou).toBe(false);
    expect(rodar('192.168.0.42', { authorization: 'Bearer algo' }).passou).toBe(false);
  });
});
