import { describe, it, expect } from 'vitest';
import { comTrabalhoAberto } from '../../src/features/timeline/useVisibleNodes.js';

interface Cru {
  id: string;
  parent_id: string | null;
  title: string;
  status?: string;
  progress?: number;
  isLeaf?: boolean;
  position?: number;
}

const no = (c: Cru) =>
  ({ status: 'PENDING', progress: 0, isLeaf: true, position: 0, path: c.id, ...c }) as never;

const agrupar = (nodes: unknown[]) => {
  const mapa = new Map<string, never[]>();
  for (const n of nodes as Array<{ parent_id: string | null }>) {
    const key = n.parent_id ?? '__root__';
    const lista = mapa.get(key) ?? [];
    lista.push(n as never);
    mapa.set(key, lista);
  }
  return mapa;
};

const visiveis = (nodes: unknown[]): string[] =>
  comTrabalhoAberto(nodes as never[], agrupar(nodes) as never).map((n) => n.id);

describe('comTrabalhoAberto', () => {
  it('bloco com uma filha aberta mantem o grupo inteiro, concluidas incluidas', () => {
    const arvore = [
      no({ id: 'p', parent_id: null, title: 'Bloco', isLeaf: false, progress: 50 }),
      no({ id: 'a', parent_id: 'p', title: 'Feita', status: 'COMPLETED' }),
      no({ id: 'b', parent_id: 'p', title: 'Aberta' }),
    ];
    expect(visiveis(arvore)).toEqual(['p', 'a', 'b']);
  });

  it('bloco com todas as filhas concluidas some, e a mae junto', () => {
    const arvore = [
      no({ id: 'p', parent_id: null, title: 'Bloco', isLeaf: false, progress: 100 }),
      no({ id: 'a', parent_id: 'p', title: 'Feita', status: 'COMPLETED' }),
      no({ id: 'b', parent_id: 'p', title: 'Outra feita', status: 'COMPLETED' }),
    ];
    expect(visiveis(arvore)).toEqual([]);
  });

  /**
   *  Avo
   *   +- Ramo fechado  (tudo concluido)
   *   |    +- x, y  concluidas
   *   +- Ramo vivo
   *        +- z concluida, w aberta
   */
  it('ramo fechado some mesmo com o avo cheio de trabalho em outro ramo', () => {
    const arvore = [
      no({ id: 'g', parent_id: null, title: 'Avo', isLeaf: false, progress: 60 }),
      no({ id: 'fechado', parent_id: 'g', title: 'Ramo fechado', isLeaf: false, progress: 100, position: 0 }),
      no({ id: 'x', parent_id: 'fechado', title: 'x', status: 'COMPLETED' }),
      no({ id: 'y', parent_id: 'fechado', title: 'y', status: 'COMPLETED' }),
      no({ id: 'vivo', parent_id: 'g', title: 'Ramo vivo', isLeaf: false, progress: 50, position: 1 }),
      no({ id: 'z', parent_id: 'vivo', title: 'z', status: 'COMPLETED' }),
      no({ id: 'w', parent_id: 'vivo', title: 'w' }),
    ];
    expect(visiveis(arvore)).toEqual(['g', 'vivo', 'z', 'w']);
  });

  it('cancelada conta como resolvida', () => {
    const arvore = [
      no({ id: 'p', parent_id: null, title: 'Bloco', isLeaf: false, progress: 100 }),
      no({ id: 'a', parent_id: 'p', title: 'Feita', status: 'COMPLETED' }),
      no({ id: 'b', parent_id: 'p', title: 'Cancelada', status: 'CANCELLED' }),
    ];
    expect(visiveis(arvore)).toEqual([]);
  });

  it('folha solta na raiz some quando concluida', () => {
    const arvore = [
      no({ id: 'feita', parent_id: null, title: 'Feita', status: 'COMPLETED' }),
      no({ id: 'aberta', parent_id: null, title: 'Aberta' }),
    ];
    expect(visiveis(arvore)).toEqual(['aberta']);
  });

  /**
   * O caso que o status sozinho erraria: a cascata fecha o progresso do pai
   * mas deixa o status em "Pendente" para sempre.
   */
  it('galho recolhido a 100% some, mesmo com status pendente', () => {
    const arvore = [
      no({ id: 'raiz', parent_id: null, title: 'Raiz', isLeaf: false, progress: 40 }),
      no({ id: 'cheio', parent_id: 'raiz', title: 'Recolhido cheio', isLeaf: false, progress: 100, position: 0 }),
      no({ id: 'meio', parent_id: 'raiz', title: 'Recolhido pela metade', isLeaf: false, progress: 50, position: 1 }),
    ];
    expect(visiveis(arvore)).toEqual(['raiz', 'meio']);
  });

  it('folha a 100% sem estar concluida continua aberta', () => {
    // Progresso manual nao conclui a tarefa: so o status conclui.
    const arvore = [no({ id: 'quase', parent_id: null, title: 'Quase la', progress: 100 })];
    expect(visiveis(arvore)).toEqual(['quase']);
  });

  it('arvore inteira concluida some por completo', () => {
    const arvore = [
      no({ id: 'r', parent_id: null, title: 'Raiz', isLeaf: false, progress: 100 }),
      no({ id: 'p', parent_id: 'r', title: 'Bloco', isLeaf: false, progress: 100 }),
      no({ id: 'a', parent_id: 'p', title: 'a', status: 'COMPLETED' }),
    ];
    expect(visiveis(arvore)).toEqual([]);
  });

  it('nada concluido nao esconde nada', () => {
    const arvore = [
      no({ id: 'r', parent_id: null, title: 'Raiz', isLeaf: false, progress: 0 }),
      no({ id: 'a', parent_id: 'r', title: 'a' }),
      no({ id: 'b', parent_id: 'r', title: 'b' }),
    ];
    expect(visiveis(arvore)).toEqual(['r', 'a', 'b']);
  });

  it('bloqueada nao e concluida', () => {
    const arvore = [
      no({ id: 'p', parent_id: null, title: 'Bloco', isLeaf: false, progress: 50 }),
      no({ id: 'a', parent_id: 'p', title: 'a', status: 'COMPLETED' }),
      no({ id: 'b', parent_id: 'p', title: 'b', status: 'BLOCKED' }),
    ];
    expect(visiveis(arvore)).toEqual(['p', 'a', 'b']);
  });

  it('preserva a ordem original da lista', () => {
    const arvore = [
      no({ id: 'r', parent_id: null, title: 'Raiz', isLeaf: false, progress: 50 }),
      no({ id: 'a', parent_id: 'r', title: 'a', position: 0 }),
      no({ id: 'b', parent_id: 'r', title: 'b', position: 1, status: 'COMPLETED' }),
    ];
    expect(visiveis(arvore)).toEqual(['r', 'a', 'b']);
  });
});
