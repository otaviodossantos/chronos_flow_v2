import { describe, it, expect } from 'vitest';
import {
  validateAgainstParent,
  inheritDates,
  planReschedule,
  shiftDate,
} from '../../server/domain/scheduling.js';

const parent = {
  id: 'p',
  title: 'Pai',
  start_date: new Date('2026-08-01'),
  due_date: new Date('2026-08-18'),
};

describe('validateAgainstParent', () => {
  it('aceita filho dentro do prazo do pai', () => {
    expect(
      validateAgainstParent(
        { start_date: new Date('2026-08-05'), due_date: new Date('2026-08-17') },
        parent,
      ),
    ).toEqual([]);
  });

  it('acusa prazo que ultrapassa o do pai', () => {
    const v = validateAgainstParent({ start_date: null, due_date: new Date('2026-08-20') }, parent);
    expect(v.map((x) => x.code)).toEqual(['DUE_AFTER_PARENT']);
  });

  it('acusa inicio depois do proprio prazo', () => {
    const v = validateAgainstParent(
      { start_date: new Date('2026-08-17'), due_date: new Date('2026-08-05') },
      null,
    );
    expect(v.map((x) => x.code)).toEqual(['START_AFTER_DUE']);
  });
});

describe('inheritDates', () => {
  it('filho sem prazo herda o do pai', () => {
    expect(inheritDates({}, parent).due_date).toEqual(parent.due_date);
  });

  it('prazo proprio vence a heranca', () => {
    const own = new Date('2026-08-10');
    expect(inheritDates({ due_date: own }, parent).due_date).toEqual(own);
  });
});

describe('planReschedule', () => {
  const node = {
    id: 'n',
    title: 'No',
    start_date: new Date('2026-08-01'),
    due_date: new Date('2026-08-10'),
  };
  const children = [
    { id: 'c1', title: 'Filho 1', start_date: new Date('2026-08-02'), due_date: new Date('2026-08-05') },
  ];

  it('calcula o deslocamento e move os filhos quando pedido', () => {
    const plan = planReschedule(
      node,
      { start_date: new Date('2026-08-06'), due_date: new Date('2026-08-15') },
      children,
      null,
      true,
    );
    expect(plan.shiftedDays).toBe(5);
    expect(plan.affected).toHaveLength(1);
    expect(plan.affected[0].to.due_date).toEqual(new Date('2026-08-10'));
  });

  it('acusa filho que estoura quando nada e movido junto', () => {
    const plan = planReschedule(
      node,
      { start_date: new Date('2026-08-01'), due_date: new Date('2026-08-03') },
      children,
      null,
      false,
    );
    expect(plan.violations.some((v) => v.id === 'c1')).toBe(true);
  });
});

describe('shiftDate', () => {
  it('desloca em dias', () => {
    expect(shiftDate(new Date('2026-08-01'), 5)).toEqual(new Date('2026-08-06'));
  });

  it('preserva null', () => {
    expect(shiftDate(null, 5)).toBeNull();
  });
});
