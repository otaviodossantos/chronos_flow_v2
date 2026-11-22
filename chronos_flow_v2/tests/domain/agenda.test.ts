import { describe, it, expect } from 'vitest';
import {
  agendarExecucao,
  ordemDeExecucao,
  proximoUtil,
  fimDoTrabalho,
  envelope,
  minutosDeJornada,
  EXPEDIENTE_PADRAO,
  janelasDoPlano,
  type TarefaAgendavel,
  type ItemDePlano,
} from '../../server/domain/agenda.js';

/** Segunda-feira, 2026-09-28. Todas as contas partem daqui. */
const seg = (h = 9, m = 0) => new Date(2026, 8, 28, h, m, 0, 0);
const dia = (d: number, h = 9, m = 0) => new Date(2026, 8, d, h, m, 0, 0);
const hhmm = (d: Date) =>
  `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const tarefa = (t: Partial<TarefaAgendavel> & { id: string }): TarefaAgendavel => ({
  minutos: 60,
  dependeDe: [],
  agenda: 'eu',
  ordem: 0,
  ...t,
});

describe('proximoUtil', () => {
  it('dentro do expediente nao mexe', () => {
    expect(proximoUtil(seg(10, 30))).toEqual(seg(10, 30));
  });

  it('antes de abrir espera abrir', () => {
    expect(proximoUtil(seg(6))).toEqual(seg(9));
  });

  it('depois de fechar vai para o dia seguinte', () => {
    expect(proximoUtil(seg(21))).toEqual(dia(29, 9));
  });

  it('sabado cai na segunda', () => {
    // 2026-10-03 e sabado.
    expect(proximoUtil(new Date(2026, 9, 3, 11))).toEqual(new Date(2026, 9, 5, 9));
  });
});

describe('fimDoTrabalho', () => {
  it('cabe no dia', () => {
    expect(fimDoTrabalho(seg(9), 90)).toEqual(seg(10, 30));
  });

  it('a jornada tem 9 horas', () => {
    expect(minutosDeJornada(EXPEDIENTE_PADRAO)).toBe(540);
    expect(fimDoTrabalho(seg(9), 540)).toEqual(seg(18));
  });

  it('o que nao cabe vira no dia seguinte, sem contar a noite', () => {
    // Comeca 17h, gasta 2h: 1h hoje, 1h amanha.
    expect(fimDoTrabalho(seg(17), 120)).toEqual(dia(29, 10));
  });

  it('atravessa o fim de semana sem gastar esforco nele', () => {
    // Sexta 02/10 as 17h + 2h -> segunda 05/10 as 10h.
    expect(fimDoTrabalho(new Date(2026, 9, 2, 17), 120)).toEqual(new Date(2026, 9, 5, 10));
  });

  it('duracao maior que varios dias se espalha', () => {
    // 3 jornadas cheias a partir de segunda 9h -> quarta 18h.
    expect(fimDoTrabalho(seg(9), 540 * 3)).toEqual(dia(30, 18));
  });
});

describe('ordemDeExecucao', () => {
  it('quem bloqueia vem antes, mesmo declarado depois', () => {
    const ordem = ordemDeExecucao([
      tarefa({ id: 'b', dependeDe: ['a'], ordem: 0 }),
      tarefa({ id: 'a', ordem: 1 }),
    ]);
    expect(ordem.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('sem dependencia, vale a ordem do plano', () => {
    const ordem = ordemDeExecucao([
      tarefa({ id: 'x', ordem: 1 }),
      tarefa({ id: 'y', ordem: 0 }),
    ]);
    expect(ordem.map((t) => t.id)).toEqual(['y', 'x']);
  });

  it('dependencia para fora da lista e ignorada', () => {
    const ordem = ordemDeExecucao([tarefa({ id: 'a', dependeDe: ['descartada'] })]);
    expect(ordem.map((t) => t.id)).toEqual(['a']);
  });

  it('ciclo nao trava: devolve todas', () => {
    const ordem = ordemDeExecucao([
      tarefa({ id: 'a', dependeDe: ['b'] }),
      tarefa({ id: 'b', dependeDe: ['a'] }),
    ]);
    expect(ordem).toHaveLength(2);
  });
});

describe('agendarExecucao', () => {
  it('a mesma pessoa faz uma coisa de cada vez', () => {
    const j = agendarExecucao(
      [
        tarefa({ id: 'a', minutos: 120, ordem: 0 }),
        tarefa({ id: 'b', minutos: 60, ordem: 1 }),
      ],
      seg(9),
    );
    expect(hhmm(j.get('a')!.start_date)).toBe('28/9 09:00');
    expect(hhmm(j.get('a')!.due_date)).toBe('28/9 11:00');
    // Comeca onde a anterior terminou, e nao no mesmo instante.
    expect(hhmm(j.get('b')!.start_date)).toBe('28/9 11:00');
    expect(hhmm(j.get('b')!.due_date)).toBe('28/9 12:00');
  });

  it('cada tarefa dura a sua estimativa', () => {
    const j = agendarExecucao([tarefa({ id: 'a', minutos: 45 })], seg(9));
    const { start_date, due_date } = j.get('a')!;
    expect((due_date.getTime() - start_date.getTime()) / 60_000).toBe(45);
  });

  it('pessoas diferentes trabalham em paralelo', () => {
    const j = agendarExecucao(
      [
        tarefa({ id: 'a', minutos: 120, agenda: 'ana', ordem: 0 }),
        tarefa({ id: 'b', minutos: 120, agenda: 'bruno', ordem: 1 }),
      ],
      seg(9),
    );
    expect(j.get('a')!.start_date).toEqual(j.get('b')!.start_date);
  });

  it('dependencia atravessa agendas: ninguem comeca antes do bloqueador fechar', () => {
    const j = agendarExecucao(
      [
        tarefa({ id: 'a', minutos: 120, agenda: 'ana', ordem: 0 }),
        tarefa({ id: 'b', minutos: 60, agenda: 'bruno', dependeDe: ['a'], ordem: 1 }),
      ],
      seg(9),
    );
    expect(j.get('b')!.start_date).toEqual(j.get('a')!.due_date);
  });

  it('a corrente de tres respeita a ordem toda', () => {
    const j = agendarExecucao(
      [
        tarefa({ id: 'c', minutos: 60, dependeDe: ['b'], ordem: 2 }),
        tarefa({ id: 'a', minutos: 60, ordem: 0 }),
        tarefa({ id: 'b', minutos: 60, dependeDe: ['a'], ordem: 1 }),
      ],
      seg(9),
    );
    expect(hhmm(j.get('a')!.start_date)).toBe('28/9 09:00');
    expect(hhmm(j.get('b')!.start_date)).toBe('28/9 10:00');
    expect(hhmm(j.get('c')!.start_date)).toBe('28/9 11:00');
  });

  it('nenhuma tarefa nasce fora do expediente', () => {
    const muitas = Array.from({ length: 12 }, (_, i) =>
      tarefa({ id: `t${i}`, minutos: 120, ordem: i }),
    );
    for (const j of agendarExecucao(muitas, seg(9)).values()) {
      const h = j.start_date.getHours();
      expect(h).toBeGreaterThanOrEqual(9);
      expect(h).toBeLessThan(18);
      expect([1, 2, 3, 4, 5]).toContain(j.start_date.getDay());
    }
  });

  it('duas tarefas da mesma agenda nunca se sobrepoem', () => {
    const muitas = Array.from({ length: 10 }, (_, i) =>
      tarefa({ id: `t${i}`, minutos: 200, ordem: i }),
    );
    const janelas = [...agendarExecucao(muitas, seg(9)).values()].sort(
      (a, b) => a.start_date.getTime() - b.start_date.getTime(),
    );
    for (let i = 1; i < janelas.length; i += 1) {
      expect(janelas[i].start_date.getTime()).toBeGreaterThanOrEqual(
        janelas[i - 1].due_date.getTime(),
      );
    }
  });

  it('o piso do plano adia, mas nunca antecipa', () => {
    const j = agendarExecucao(
      [
        tarefa({ id: 'cedo', minutos: 60, ordem: 0 }),
        tarefa({ id: 'so-depois', minutos: 60, naoAntesDe: 7, ordem: 1 }),
      ],
      seg(9),
    );
    // Sete dias depois de segunda cai num sabado; vai para a segunda seguinte.
    expect(hhmm(j.get('so-depois')!.start_date)).toBe('5/10 09:00');
  });

  it('inicio fora do expediente e puxado para a abertura', () => {
    const j = agendarExecucao([tarefa({ id: 'a' })], seg(3, 30));
    expect(hhmm(j.get('a')!.start_date)).toBe('28/9 09:00');
  });

  it('lista vazia devolve mapa vazio', () => {
    expect(agendarExecucao([], seg(9)).size).toBe(0);
  });
});

describe('envelope', () => {
  it('cobre da primeira a ultima', () => {
    const e = envelope([
      { start_date: seg(10), due_date: seg(12) },
      { start_date: seg(9), due_date: seg(11) },
    ])!;
    expect(e.start_date).toEqual(seg(9));
    expect(e.due_date).toEqual(seg(12));
  });

  it('sem janelas, nada', () => {
    expect(envelope([])).toBeNull();
  });
});

describe('janelasDoPlano', () => {
  const inicio = seg(9);
  const vazio = { refParaId: new Map<string, string>(), papelParaAgenda: new Map<string, string>() };

  /**
   *  raiz
   *   +- bloco A
   *   |    +- a1 (2h, ref 't1')
   *   |    +- a2 (1h, depende de t1)
   *   +- bloco B
   *        +- b1 (3h, depende do bloco A inteiro)
   */
  const refs = new Map([['t1', 'a1'], ['blocoA', 'A']]);
  const plano: ItemDePlano[] = [
    { id: 'A', parentId: 'raiz', folha: false },
    { id: 'a1', parentId: 'A', folha: true, estimated_minutes: 120 },
    { id: 'a2', parentId: 'A', folha: true, estimated_minutes: 60, depends_on: ['t1'] },
    { id: 'B', parentId: 'raiz', folha: false },
    { id: 'b1', parentId: 'B', folha: true, estimated_minutes: 180, depends_on: ['blocoA'] },
  ];

  it('as folhas se encadeiam pela estimativa, sem empilhar no mesmo horario', () => {
    const j = janelasDoPlano(plano, { inicio, refParaId: refs, papelParaAgenda: new Map() });
    expect(hhmm(j.get('a1')!.start_date)).toBe('28/9 09:00');
    expect(hhmm(j.get('a1')!.due_date)).toBe('28/9 11:00');
    expect(hhmm(j.get('a2')!.start_date)).toBe('28/9 11:00');
    expect(hhmm(j.get('a2')!.due_date)).toBe('28/9 12:00');
  });

  it('depender de um bloco espera o bloco inteiro, nao so o rotulo', () => {
    const j = janelasDoPlano(plano, { inicio, refParaId: refs, papelParaAgenda: new Map() });
    // O bloco A so fecha as 12:00, quando a2 termina.
    expect(hhmm(j.get('b1')!.start_date)).toBe('28/9 12:00');
  });

  it('a mae cobre exatamente as filhas', () => {
    const j = janelasDoPlano(plano, { inicio, refParaId: refs, papelParaAgenda: new Map() });
    expect(j.get('A')!.start_date).toEqual(j.get('a1')!.start_date);
    expect(j.get('A')!.due_date).toEqual(j.get('a2')!.due_date);
  });

  it('folha sem estimativa recebe uma hora, e nao o dia inteiro', () => {
    const j = janelasDoPlano(
      [{ id: 'solta', parentId: 'raiz', folha: true }],
      { inicio, ...vazio },
    );
    const { start_date, due_date } = j.get('solta')!;
    expect((due_date.getTime() - start_date.getTime()) / 60_000).toBe(60);
  });

  it('sem estimativa mas com duration_days, vale a jornada', () => {
    const j = janelasDoPlano(
      [{ id: 'dois-dias', parentId: 'raiz', folha: true, duration_days: 2 }],
      { inicio, ...vazio },
    );
    // Duas jornadas de 9h a partir de segunda 9h -> terca 18h.
    expect(hhmm(j.get('dois-dias')!.due_date)).toBe('29/9 18:00');
  });

  it('papeis com membros diferentes correm em paralelo', () => {
    const j = janelasDoPlano(
      [
        { id: 'x', parentId: 'raiz', folha: true, estimated_minutes: 120, role: 'Design' },
        { id: 'y', parentId: 'raiz', folha: true, estimated_minutes: 120, role: 'Backend' },
      ],
      {
        inicio,
        refParaId: new Map(),
        papelParaAgenda: new Map([['Design', 'marina'], ['Backend', 'carlos']]),
      },
    );
    expect(j.get('x')!.start_date).toEqual(j.get('y')!.start_date);
  });

  it('sem membro atribuido, tudo cai na mesma agenda e enfileira', () => {
    const j = janelasDoPlano(
      [
        { id: 'x', parentId: 'raiz', folha: true, estimated_minutes: 120, role: 'Design' },
        { id: 'y', parentId: 'raiz', folha: true, estimated_minutes: 120, role: 'Backend' },
      ],
      { inicio, refParaId: new Map(), papelParaAgenda: new Map() },
    );
    expect(j.get('y')!.start_date).toEqual(j.get('x')!.due_date);
  });

  it('ref para tarefa descartada nao trava o agendamento', () => {
    const j = janelasDoPlano(
      [{ id: 'a', parentId: 'raiz', folha: true, estimated_minutes: 60, depends_on: ['sumiu'] }],
      { inicio, ...vazio },
    );
    expect(hhmm(j.get('a')!.start_date)).toBe('28/9 09:00');
  });

  it('nenhuma janela nasce invertida', () => {
    const j = janelasDoPlano(plano, { inicio, refParaId: refs, papelParaAgenda: new Map() });
    for (const janela of j.values()) {
      expect(janela.due_date.getTime()).toBeGreaterThan(janela.start_date.getTime());
    }
  });
});
