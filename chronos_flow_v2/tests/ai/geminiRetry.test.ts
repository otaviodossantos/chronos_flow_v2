import { describe, it, expect } from 'vitest';
import {
  isRetriable,
  shouldRetry,
  backoffMs,
  retryAfterMs,
  waitMs,
  upstreamMessage,
  MAX_ATTEMPTS,
} from '../../server/modules/ai/geminiRetry.js';

describe('isRetriable', () => {
  it('repete fila cheia e falha do servidor', () => {
    expect(isRetriable(429)).toBe(true);
    expect(isRetriable(503)).toBe(true);
    expect(isRetriable(500)).toBe(true);
  });

  it('nao repete o que so vai falhar de novo', () => {
    expect(isRetriable(400)).toBe(false); // chave ou payload invalido
    expect(isRetriable(404)).toBe(false); // modelo inexistente
    expect(isRetriable(403)).toBe(false);
  });
});

describe('shouldRetry', () => {
  it('para no limite de tentativas', () => {
    expect(shouldRetry(503, 1)).toBe(true);
    expect(shouldRetry(503, MAX_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetry(503, MAX_ATTEMPTS)).toBe(false);
  });
});

describe('backoffMs', () => {
  it('dobra a cada tentativa', () => {
    expect(backoffMs(1, 0)).toBe(1200);
    expect(backoffMs(2, 0)).toBe(2400);
  });

  it('soma jitter para nao sincronizar as repeticoes', () => {
    expect(backoffMs(1, 1)).toBe(1600);
  });
});

describe('retryAfterMs', () => {
  it('aceita segundos', () => {
    expect(retryAfterMs('7')).toBe(7000);
  });

  it('aceita data HTTP', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(retryAfterMs('Thu, 01 Jan 2026 00:00:05 GMT', now)).toBe(5000);
  });

  it('nunca espera mais que 30s', () => {
    expect(retryAfterMs('600')).toBe(30_000);
  });

  it('ignora cabecalho ausente ou sem sentido', () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('logo mais')).toBeNull();
  });

  it('nao devolve espera negativa para data no passado', () => {
    const now = Date.parse('2026-01-01T00:00:10Z');
    expect(retryAfterMs('Thu, 01 Jan 2026 00:00:00 GMT', now)).toBe(0);
  });
});

describe('waitMs', () => {
  it('prefere o cabecalho do servidor ao backoff local', () => {
    expect(waitMs('3', 1, 0)).toBe(3000);
  });

  it('cai no backoff quando nao ha cabecalho', () => {
    expect(waitMs(null, 2, 0)).toBe(2400);
  });
});

describe('upstreamMessage', () => {
  it('explica o 503 sem jargao e diz o que fazer', () => {
    const msg = upstreamMessage(503, 3);
    expect(msg).toContain('sobrecarregado');
    expect(msg).toContain('Tentei 3 vezes');
    expect(msg).not.toContain('UNAVAILABLE');
  });

  it('separa limite de cota de instabilidade', () => {
    expect(upstreamMessage(429, 3)).toContain('limite de uso');
  });

  it('nao fala em tentativas quando so houve uma', () => {
    expect(upstreamMessage(500, 1)).not.toContain('Tentei');
  });
});
