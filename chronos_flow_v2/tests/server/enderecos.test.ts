import { describe, it, expect, vi, afterEach } from 'vitest';
import { conferir, normalizar } from '../../electron/enderecos.js';

describe('endereco de servidor no app instalado', () => {
  it('aceita https e guarda so a origem', () => {
    expect(normalizar('https://flow.exemplo.com.br/qualquer/caminho?x=1')).toBe('https://flow.exemplo.com.br');
    expect(normalizar('  flow.exemplo.com.br  ')).toBe('https://flow.exemplo.com.br');
    expect(normalizar('https://flow.exemplo.com.br:8443')).toBe('https://flow.exemplo.com.br:8443');
  });

  it('recusa http fora da propria maquina: senha e cookie atravessam a conexao', () => {
    expect(() => normalizar('http://flow.exemplo.com.br')).toThrow(/https/);
    expect(() => normalizar('ftp://flow.exemplo.com.br')).toThrow(/https/);
    expect(() => normalizar('javascript:alert(1)')).toThrow();
    expect(() => normalizar('file:///etc/passwd')).toThrow();
  });

  it('aceita http so para a propria maquina', () => {
    expect(normalizar('http://localhost:5173')).toBe('http://localhost:5173');
    expect(normalizar('http://127.0.0.1:3101/')).toBe('http://127.0.0.1:3101');
  });

  it('recusa vazio e lixo', () => {
    expect(() => normalizar('')).toThrow(/Informe/);
    expect(() => normalizar('http://')).toThrow();
  });
});

describe('conferir se o servidor e um Chronos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('aceita quem responde o health do Chronos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok', app: 'Chronos Flow v2' }))));
    await expect(conferir('https://flow.exemplo.com.br')).resolves.toBeUndefined();
  });

  it('recusa um site que responde mas nao e Chronos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>oi</html>')));
    await expect(conferir('https://exemplo.com')).rejects.toThrow(/nao e um servidor do Chronos/);
  });

  it('explica quando nem conecta', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(conferir('https://fora-do-ar.exemplo.com')).rejects.toThrow(/Nao foi possivel falar/);
  });
});
