import { describe, it, expect, beforeEach } from 'vitest';
import { PX_PER_DAY, useTimelineStore, type ZoomLevel } from '../../src/stores/timelineStore';

const DIA = 86_400_000;
const LARGURA = 900;

/** Data que fica no meio da area visivel, com a rolagem zerada. */
function centroVisivel(): Date {
  const { zoom, viewportStart } = useTimelineStore.getState();
  return new Date(viewportStart.getTime() + (LARGURA / 2 / PX_PER_DAY[zoom]) * DIA);
}

function trocar(zoom: ZoomLevel) {
  useTimelineStore.getState().setZoom(zoom, { centro: centroVisivel(), largura: LARGURA });
}

describe('troca de zoom da timeline', () => {
  beforeEach(() => {
    useTimelineStore.getState().setZoom('months', { centro: new Date('2026-11-23T12:00:00'), largura: LARGURA });
  });

  it('mantem no meio da tela a data que estava no meio', () => {
    const antes = centroVisivel();
    trocar('weeks');
    // Tolerancia de 1 dia: o inicio da janela encaixa na meia-noite.
    expect(Math.abs(centroVisivel().getTime() - antes.getTime())).toBeLessThanOrEqual(DIA);
  });

  it('ida e volta entre os zooms nao escorrega para o passado', () => {
    const antes = centroVisivel();
    for (const z of ['quarters', 'months', 'weeks', 'days', 'weeks', 'months', 'quarters', 'months'] as ZoomLevel[]) {
      trocar(z);
    }
    expect(Math.abs(centroVisivel().getTime() - antes.getTime())).toBeLessThanOrEqual(2 * DIA);
  });

  it('o zoom de horas abre no comeco do dia do centro', () => {
    useTimelineStore.getState().setZoom('hours', { centro: new Date(), largura: LARGURA });
    const inicio = useTimelineStore.getState().viewportStart;
    expect(inicio.getHours()).toBe(0);
    expect(inicio.getMinutes()).toBe(0);
  });
});

describe('troca de zoom sem ancora (hoje a vista)', () => {
  it('abre cada zoom com hoje dentro da janela, perto da borda esquerda', () => {
    for (const z of ['quarters', 'months', 'weeks', 'days'] as ZoomLevel[]) {
      useTimelineStore.getState().setZoom(z);
      const { viewportStart } = useTimelineStore.getState();
      const diasAteHoje = (Date.now() - viewportStart.getTime()) / DIA;
      const diasVisiveis = LARGURA / PX_PER_DAY[z];
      expect(diasAteHoje).toBeGreaterThan(0);
      expect(diasAteHoje).toBeLessThan(diasVisiveis / 2);
    }
  });
});
