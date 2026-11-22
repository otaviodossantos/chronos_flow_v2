import { describe, expect, it } from 'vitest';
import type { NodeDTO } from '@shared/types';
import {
  HORIZONTE_DIAS, TETO, mesmoPlano, planoDeAvisos, type AjustesDeAviso,
} from '../src/features/avisos/planoDeAvisos';

const AGORA = new Date('2026-10-20T09:00:00.000Z');
const MIN = 60_000;
const daqui = (minutos: number) => new Date(AGORA.getTime() + minutos * MIN).toISOString();

const tarefa = (p: Partial<NodeDTO> & { id: string }): NodeDTO =>
  ({
    title: `Tarefa ${p.id}`,
    isLeaf: true,
    status: 'PENDING',
    all_day: false,
    alarme: false,
    ...p,
  } as NodeDTO);

const ligado = (antecedencia = 5): AjustesDeAviso => ({ ligado: true, antecedencia });

describe('plano de avisos', () => {
  it('avisa antes do inicio, pela antecedencia escolhida', () => {
    const plano = planoDeAvisos([tarefa({ id: 'a', start_date: daqui(60) })], ligado(5), AGORA);
    expect(plano).toHaveLength(1);
    expect(plano[0].quando).toBe(daqui(55));
    expect(plano[0].corpo).toContain('5 min');
    expect(plano[0].titulo).toBe('Tarefa a');
  });

  it('nao arma nada com o interruptor desligado', () => {
    const tarefas = [tarefa({ id: 'a', start_date: daqui(60) })];
    expect(planoDeAvisos(tarefas, { ligado: false, antecedencia: 5 }, AGORA)).toEqual([]);
  });

  it('ignora metas macro: a janela delas comeca junto com a primeira filha', () => {
    // Avisar as duas tocaria duas vezes, no mesmo segundo, pela mesma coisa.
    const plano = planoDeAvisos(
      [
        tarefa({ id: 'mae', isLeaf: false, start_date: daqui(60) }),
        tarefa({ id: 'filha', start_date: daqui(60) }),
      ],
      ligado(),
      AGORA,
    );
    expect(plano.map((a) => a.nodeId)).toEqual(['filha']);
  });

  it('ignora concluidas, sem data e de dia inteiro', () => {
    const plano = planoDeAvisos(
      [
        tarefa({ id: 'feita', start_date: daqui(60), status: 'COMPLETED' }),
        tarefa({ id: 'sem-data', start_date: null }),
        tarefa({ id: 'dia-inteiro', start_date: daqui(60), all_day: true }),
      ],
      ligado(),
      AGORA,
    );
    expect(plano).toEqual([]);
  });

  it('nao arma no passado', () => {
    // O iOS aceitaria em silencio e nunca tocaria — pior que nao agendar.
    const plano = planoDeAvisos(
      [
        tarefa({ id: 'ja-passou', start_date: daqui(-30) }),
        // Comeca em 3 min, com antecedencia de 5: o aviso cairia ha 2 min.
        tarefa({ id: 'tarde-demais', start_date: daqui(3) }),
      ],
      ligado(5),
      AGORA,
    );
    expect(plano).toEqual([]);
  });

  it('nao olha alem do horizonte', () => {
    const alem = HORIZONTE_DIAS * 24 * 60 + 60;
    const plano = planoDeAvisos(
      [
        tarefa({ id: 'perto', start_date: daqui(120) }),
        tarefa({ id: 'longe', start_date: daqui(alem) }),
      ],
      ligado(),
      AGORA,
    );
    expect(plano.map((a) => a.nodeId)).toEqual(['perto']);
  });

  it('ordena pelo mais proximo e corta no teto do iOS', () => {
    // O iOS guarda 64 e descarta as mais distantes sem avisar. Cortando aqui,
    // quem fica de fora e escolhido por nos, e nao pelo sistema.
    const muitas = Array.from({ length: TETO + 20 }, (_, i) =>
      tarefa({ id: `t${i}`, start_date: daqui(TETO + 20 - i + 30) }),
    );
    const plano = planoDeAvisos(muitas, ligado(0), AGORA);
    expect(plano).toHaveLength(TETO);
    expect(plano[0].quando < plano[1].quando).toBe(true);
    // O corte tirou os mais distantes, nao os mais proximos.
    expect(plano.at(-1)!.nodeId).toBe('t20');
  });

  it('o despertador toca na hora, e o aviso continua vindo antes', () => {
    const plano = planoDeAvisos(
      [tarefa({ id: 'a', start_date: daqui(60), alarme: true })],
      ligado(5),
      AGORA,
    );
    expect(plano.map((a) => [a.tipo, a.quando])).toEqual([
      ['aviso', daqui(55)],
      ['alarme', daqui(60)],
    ]);
  });

  it('com antecedencia zero o aviso cede o lugar ao despertador', () => {
    const plano = planoDeAvisos(
      [tarefa({ id: 'a', start_date: daqui(60), alarme: true })],
      ligado(0),
      AGORA,
    );
    expect(plano.map((a) => a.tipo)).toEqual(['alarme']);
  });

  it('desligar os avisos nao cancela um despertador marcado na tarefa', () => {
    // Quem marcou "me acorde" pediu aquilo para aquela tarefa; o interruptor
    // geral e sobre a rotina de avisos, nao sobre um alarme escolhido a dedo.
    const plano = planoDeAvisos(
      [tarefa({ id: 'a', start_date: daqui(60), alarme: true })],
      { ligado: false, antecedencia: 5 },
      AGORA,
    );
    expect(plano.map((a) => a.tipo)).toEqual(['alarme']);
  });

  it('o id e estavel: rearmar duas vezes da o mesmo plano', () => {
    const tarefas = [tarefa({ id: 'a', start_date: daqui(60), alarme: true })];
    const um = planoDeAvisos(tarefas, ligado(), AGORA);
    const dois = planoDeAvisos(tarefas, ligado(), AGORA);
    expect(mesmoPlano(um, dois)).toBe(true);
    expect(new Set(um.map((a) => a.id)).size).toBe(um.length);
  });

  it('mudar a data da tarefa muda o plano', () => {
    const antes = planoDeAvisos([tarefa({ id: 'a', start_date: daqui(60) })], ligado(), AGORA);
    const depois = planoDeAvisos([tarefa({ id: 'a', start_date: daqui(90) })], ligado(), AGORA);
    expect(mesmoPlano(antes, depois)).toBe(false);
  });
});
