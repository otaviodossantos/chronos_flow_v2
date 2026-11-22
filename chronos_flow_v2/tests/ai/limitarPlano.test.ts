import { describe, expect, it } from 'vitest';
import { limitarPlano } from '../../server/modules/ai/planner.js';
import { contarTarefas, type AiPlan, type PlanTask } from '../../shared/schemas/index.js';

const t = (ref: string, children: PlanTask[] = [], depends_on?: string[]): PlanTask => ({
  ref,
  title: `Tarefa ${ref}`,
  ...(children.length > 0 ? { children } : {}),
  ...(depends_on ? { depends_on } : {}),
});

/** Tres frentes, cada uma com duas etapas: 9 tarefas no total. */
const plano = (): AiPlan => ({
  summary: 'plano',
  tasks: [
    t('a', [t('a1'), t('a2')]),
    t('b', [t('b1'), t('b2')]),
    t('c', [t('c1'), t('c2')]),
  ],
  roles: [],
});

describe('limite de tarefas do backlog', () => {
  it('conta todos os niveis, nao so o primeiro', () => {
    expect(contarTarefas(plano().tasks)).toBe(9);
  });

  it('nao mexe no plano quando ele ja cabe', () => {
    const p = plano();
    expect(limitarPlano(p, 9)).toBe(p);
    expect(limitarPlano(p, 50)).toBe(p);
  });

  it('sem teto, devolve o plano como veio', () => {
    const p = plano();
    expect(limitarPlano(p, null)).toBe(p);
    expect(limitarPlano(p, undefined)).toBe(p);
  });

  it('corta em largura: guarda as frentes antes das subtarefas', () => {
    const cortado = limitarPlano(plano(), 5);
    expect(contarTarefas(cortado.tasks)).toBe(5);
    // As tres frentes sobrevivem inteiras...
    expect(cortado.tasks.map((x) => x.ref)).toEqual(['a', 'b', 'c']);
    // ...e o que sobra do orcamento vai para as primeiras etapas.
    expect(cortado.tasks[0].children?.map((x) => x.ref)).toEqual(['a1', 'a2']);
    expect(cortado.tasks[1].children).toBeUndefined();
  });

  it('com teto menor que o numero de frentes, sobram so as primeiras', () => {
    const cortado = limitarPlano(plano(), 2);
    expect(cortado.tasks.map((x) => x.ref)).toEqual(['a', 'b']);
    expect(cortado.tasks.every((x) => x.children === undefined)).toBe(true);
  });

  it('nao deixa dependencia apontando para tarefa cortada', () => {
    const p: AiPlan = {
      tasks: [t('a'), t('b', [], ['a', 'c']), t('c')],
      roles: [],
    };
    const cortado = limitarPlano(p, 2);
    expect(cortado.tasks.map((x) => x.ref)).toEqual(['a', 'b']);
    // "c" foi cortada: a espera por ela sai junto, senao "b" ficaria
    // esperando por algo que nunca vai acontecer.
    expect(cortado.tasks[1].depends_on).toEqual(['a']);
  });

  it('apaga depends_on que ficou vazio em vez de deixar array vazio', () => {
    // "a" so dependia de "b", e "b" nao coube: a chave sai inteira, em vez de
    // ficar um array vazio que o editor do plano desenharia como uma secao de
    // dependencias sem nada dentro.
    const p: AiPlan = { tasks: [t('a', [], ['b']), t('b')], roles: [] };
    const cortado = limitarPlano(p, 1);
    expect(cortado.tasks.map((x) => x.ref)).toEqual(['a']);
    expect('depends_on' in cortado.tasks[0]).toBe(false);
  });

  it('nao altera o plano original', () => {
    const p = plano();
    limitarPlano(p, 3);
    expect(contarTarefas(p.tasks)).toBe(9);
  });

  it('preserva o resto do plano: resumo, papeis e riscos', () => {
    const p: AiPlan = {
      summary: 'resumo',
      tasks: [t('a', [t('a1')])],
      roles: [{ title: 'Coordenador' }],
      risks: ['chuva'],
    };
    const cortado = limitarPlano(p, 1);
    expect(cortado.summary).toBe('resumo');
    expect(cortado.roles).toHaveLength(1);
    expect(cortado.risks).toEqual(['chuva']);
  });
});
