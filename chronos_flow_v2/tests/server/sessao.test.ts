import { describe, it, expect, vi } from 'vitest';
import { conferirSenha, hashSegredo, hashSenha, novoSegredo } from '../../server/lib/senha.js';
import { lerBearer, lerCookie } from '../../server/lib/sessao.js';
import { Freio } from '../../server/lib/freio.js';

describe('senha', () => {
  it('confere a certa e recusa a errada', async () => {
    const hash = await hashSenha('uma senha boa');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await conferirSenha('uma senha boa', hash)).toBe(true);
    expect(await conferirSenha('uma senha ruim', hash)).toBe(false);
  });

  it('nunca guarda a senha nem repete o hash (sal aleatorio)', async () => {
    const [a, b] = await Promise.all([hashSenha('igual123'), hashSenha('igual123')]);
    expect(a).not.toBe(b);
    expect(a).not.toContain('igual123');
  });

  it('trata hash ausente ou estranho como senha errada, sem estourar', async () => {
    expect(await conferirSenha('x', null)).toBe(false);
    expect(await conferirSenha('x', 'bcrypt$algo')).toBe(false);
    expect(await conferirSenha('x', 'scrypt$16384$8$1$$')).toBe(false);
  });

  it('acentos digitados de formas diferentes viram a mesma senha', async () => {
    const hash = await hashSenha('sação');
    expect(await conferirSenha('sação', hash)).toBe(true);
  });
});

describe('segredos de sessao e token', () => {
  it('gera segredos longos e unicos, e guarda so o hash', () => {
    const a = novoSegredo('chr_');
    const b = novoSegredo('chr_');
    expect(a).not.toBe(b);
    expect(a.startsWith('chr_')).toBe(true);
    expect(a.length).toBeGreaterThan(40);
    expect(hashSegredo(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSegredo(a)).toBe(hashSegredo(a));
  });
});

describe('leitura de credenciais', () => {
  it('acha o cookie certo no meio de outros', () => {
    expect(lerCookie('a=1; chronos_sessao=abc%2Fd; b=2', 'chronos_sessao')).toBe('abc/d');
    expect(lerCookie('a=1', 'chronos_sessao')).toBeNull();
    expect(lerCookie(undefined, 'chronos_sessao')).toBeNull();
    expect(lerCookie('chronos_sessao=%E0%A4%A', 'chronos_sessao')).toBeNull();
  });

  it('le so Bearer no Authorization', () => {
    expect(lerBearer('Bearer chr_xyz')).toBe('chr_xyz');
    expect(lerBearer('Basic abc')).toBeNull();
    expect(lerBearer('Bearer ')).toBeNull();
    expect(lerBearer(undefined)).toBeNull();
  });
});


describe('freio de tentativas', () => {
  it('conta antes e trava no limite, por chave', () => {
    const freio = new Freio(3, 60_000);
    expect([1, 2, 3].map(() => freio.tentar('a'))).toEqual([true, true, true]);
    expect(freio.tentar('a')).toBe(false);
    expect(freio.tentar('b')).toBe(true);
  });

  it('liberar zera a chave', () => {
    const freio = new Freio(1, 60_000);
    freio.tentar('a');
    expect(freio.tentar('a')).toBe(false);
    freio.liberar('a');
    expect(freio.tentar('a')).toBe(true);
  });

  it('a janela passa e a chave volta', () => {
    vi.useFakeTimers();
    try {
      const freio = new Freio(1, 1000);
      freio.tentar('a');
      expect(freio.tentar('a')).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(freio.tentar('a')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('nao cresce sem limite: descarta as chaves mais antigas', () => {
    const freio = new Freio(1, 60_000, 3);
    for (const k of ['a', 'b', 'c', 'd']) freio.tentar(k);
    // 'a' foi descartada para caber 'd': volta a ser aceita.
    expect(freio.tentar('a')).toBe(true);
    expect(freio.tentar('d')).toBe(false);
  });
});
