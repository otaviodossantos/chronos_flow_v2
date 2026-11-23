import { describe, it, expect } from 'vitest';
import { stepsToStatus } from '../../server/domain/status.js';

describe('troca de status (Kanban e MCP)', () => {
  it('nao faz nada quando o status ja e o pedido', () => {
    expect(stepsToStatus('PENDING', 'PENDING', true)).toEqual([]);
    expect(stepsToStatus('COMPLETED', 'COMPLETED', true)).toEqual([]);
  });

  it('conclui folha pelo caminho da cascata, nao pelo update comum', () => {
    expect(stepsToStatus('PENDING', 'COMPLETED', true)).toEqual(['complete']);
    expect(stepsToStatus('IN_PROGRESS', 'COMPLETED', true)).toEqual(['complete']);
  });

  it('conclui pai pelo update, que recusa filha pendente', () => {
    expect(stepsToStatus('IN_PROGRESS', 'COMPLETED', false)).toEqual(['patch']);
  });

  it('cancelada precisa reabrir antes de concluir', () => {
    expect(stepsToStatus('CANCELLED', 'COMPLETED', true)).toEqual(['reopen', 'complete']);
    expect(stepsToStatus('CANCELLED', 'COMPLETED', false)).toEqual(['reopen', 'patch']);
  });

  it('tirar de concluida reabre, para os ancestrais acompanharem', () => {
    expect(stepsToStatus('COMPLETED', 'PENDING', true)).toEqual(['reopen']);
    expect(stepsToStatus('COMPLETED', 'IN_PROGRESS', true)).toEqual(['reopen', 'patch']);
    expect(stepsToStatus('CANCELLED', 'PENDING', true)).toEqual(['reopen']);
  });

  it('cancelar nunca dispara a cascata de conclusao', () => {
    expect(stepsToStatus('PENDING', 'CANCELLED', true)).toEqual(['patch']);
    expect(stepsToStatus('COMPLETED', 'CANCELLED', true)).toEqual(['patch']);
  });

  it('entre status abertos e so gravar', () => {
    expect(stepsToStatus('PENDING', 'IN_PROGRESS', true)).toEqual(['patch']);
    expect(stepsToStatus('IN_PROGRESS', 'PENDING', false)).toEqual(['patch']);
    expect(stepsToStatus('BLOCKED', 'IN_PROGRESS', true)).toEqual(['patch']);
  });
});
