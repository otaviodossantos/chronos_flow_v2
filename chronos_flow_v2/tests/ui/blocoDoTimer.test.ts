import { describe, it, expect } from 'vitest';
import {
  duracaoDoBloco,
  ressincronizarBloco,
  restanteAoAbrir,
  BLOCO_PADRAO_MIN,
} from '../../src/features/focus/timerBlock.js';

const min = (n: number) => n * 60;

describe('duracaoDoBloco', () => {
  it('usa a estimativa da tarefa', () => {
    expect(duracaoDoBloco(45)).toBe(min(45));
  });

  it('cai no bloco padrao sem estimativa', () => {
    expect(duracaoDoBloco(null)).toBe(min(BLOCO_PADRAO_MIN));
    expect(duracaoDoBloco(undefined)).toBe(min(BLOCO_PADRAO_MIN));
    expect(duracaoDoBloco(0)).toBe(min(BLOCO_PADRAO_MIN));
  });

  it('corta estimativa absurda no teto de 8h', () => {
    expect(duracaoDoBloco(3000)).toBe(min(480));
  });
});

describe('ressincronizarBloco', () => {
  it('estender a estimativa devolve o tempo novo, nao o bloco inteiro', () => {
    // 30 min de bloco, 10 ja gastos. Estimativa vai para 60.
    const r = ressincronizarBloco(
      { totalSeconds: min(30), secondsRemaining: min(20) },
      min(60),
    );
    expect(r.totalSeconds).toBe(min(60));
    expect(r.secondsRemaining).toBe(min(50));
  });

  it('encurtar a estimativa nao apaga o tempo ja gasto', () => {
    const r = ressincronizarBloco(
      { totalSeconds: min(60), secondsRemaining: min(45) },
      min(30),
    );
    expect(r.secondsRemaining).toBe(min(15));
  });

  it('encurtar para menos do que ja se gastou joga o bloco em atraso', () => {
    const r = ressincronizarBloco(
      { totalSeconds: min(60), secondsRemaining: min(20) },
      min(30),
    );
    // 40 min gastos contra um bloco de 30: 10 min de estouro.
    expect(r.secondsRemaining).toBe(-min(10));
    expect(r.reabriu).toBe(false);
  });

  it('bloco intocado apenas troca de tamanho', () => {
    const r = ressincronizarBloco(
      { totalSeconds: min(25), secondsRemaining: min(25) },
      min(50),
    );
    expect(r.secondsRemaining).toBe(min(50));
  });

  it('esticar um bloco ja estourado o reabre', () => {
    const r = ressincronizarBloco(
      { totalSeconds: min(20), secondsRemaining: -min(5) },
      min(45),
    );
    expect(r.secondsRemaining).toBe(min(20)); // 25 gastos de 45
    expect(r.reabriu).toBe(true);
  });

  it('bloco estourado que continua estourado nao reabre', () => {
    const r = ressincronizarBloco(
      { totalSeconds: min(20), secondsRemaining: -min(5) },
      min(22),
    );
    expect(r.secondsRemaining).toBeLessThan(0);
    expect(r.reabriu).toBe(false);
  });

  it('preserva o gasto mesmo depois de um "+5 minutos"', () => {
    // O +5 deixa total (35) maior que a estimativa (30); 10 min ja gastos.
    const r = ressincronizarBloco(
      { totalSeconds: min(35), secondsRemaining: min(25) },
      min(90),
    );
    expect(r.secondsRemaining).toBe(min(80));
  });

  it('o gasto nunca e negativo', () => {
    const r = ressincronizarBloco(
      { totalSeconds: min(10), secondsRemaining: min(30) },
      min(40),
    );
    expect(r.secondsRemaining).toBe(min(40));
  });
});

describe('restanteAoAbrir', () => {
  const as = (h: number, m = 0) => new Date(2026, 8, 29, h, m, 0, 0);
  const bloco30 = min(30);
  // Tarefa das 9h as 9h30, com hora marcada.
  const janela = { start_date: as(9), due_date: as(9, 30), all_day: false };

  it('abrir no meio da janela mostra o que sobra dela, nao o bloco inteiro', () => {
    expect(restanteAoAbrir(janela, bloco30, as(9, 15))).toBe(min(15));
  });

  it('cinco minutos antes do fim, restam cinco', () => {
    expect(restanteAoAbrir(janela, bloco30, as(9, 25))).toBe(min(5));
  });

  it('abrir antes da hora da o bloco inteiro', () => {
    expect(restanteAoAbrir(janela, bloco30, as(8, 30))).toBe(bloco30);
  });

  it('exatamente na hora de comecar, o bloco inteiro', () => {
    expect(restanteAoAbrir(janela, bloco30, as(9))).toBe(bloco30);
  });

  it('janela mais larga que o bloco nao estica o bloco', () => {
    const larga = { start_date: as(9), due_date: as(17), all_day: false };
    expect(restanteAoAbrir(larga, bloco30, as(9, 10))).toBe(bloco30);
  });

  it('logo depois do fim, o bloco abre em atraso', () => {
    expect(restanteAoAbrir(janela, bloco30, as(9, 40))).toBe(-min(10));
  });

  it('plano velho demais recomeca cheio em vez de contar horas negativas', () => {
    // Mais de um bloco depois do fim: aquele plano ja passou.
    expect(restanteAoAbrir(janela, bloco30, as(14))).toBe(bloco30);
    expect(restanteAoAbrir(janela, bloco30, as(10, 1))).toBe(bloco30);
  });

  it('tarefa de dia inteiro ignora a agenda: o prazo ali e data-limite', () => {
    const diaInteiro = { ...janela, all_day: true };
    expect(restanteAoAbrir(diaInteiro, bloco30, as(9, 15))).toBe(bloco30);
  });

  it('sem termino nao ha o que descontar', () => {
    const semFim = { start_date: as(9), due_date: null, all_day: false };
    expect(restanteAoAbrir(semFim, bloco30, as(9, 15))).toBe(bloco30);
  });

  it('data em texto (como vem da API) funciona igual', () => {
    const texto = {
      start_date: as(9).toISOString(),
      due_date: as(9, 30).toISOString(),
      all_day: false,
    };
    expect(restanteAoAbrir(texto, bloco30, as(9, 15))).toBe(min(15));
  });

  it('data invalida nao quebra o bloco', () => {
    const ruim = { start_date: null, due_date: 'nao e data', all_day: false };
    expect(restanteAoAbrir(ruim, bloco30, as(9, 15))).toBe(bloco30);
  });

  it('nunca devolve mais do que o bloco', () => {
    for (const h of [6, 8, 9, 10, 12, 20]) {
      expect(restanteAoAbrir(janela, bloco30, as(h))).toBeLessThanOrEqual(bloco30);
    }
  });
});
