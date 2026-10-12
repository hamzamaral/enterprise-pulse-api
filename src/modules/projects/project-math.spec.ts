import {
  budgetUsage,
  entryCost,
  isOverdue,
  progress,
  reorder,
  weekDays,
  weekStart,
} from './project-math';

describe('project math', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekStart('2026-10-15')).toBe('2026-10-12');
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
    expect(weekDays('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });

  it('costs time at the hourly rate and treats a missing rate as free', () => {
    expect(entryCost('7.5', '850.40').toFixed(2)).toBe('6378.00');
    expect(entryCost('1.25', '333.33').toFixed(2)).toBe('416.66');
    expect(entryCost('8', null).toFixed(2)).toBe('0.00');
  });

  it('measures progress by done tasks and budget usage by cost', () => {
    expect(progress({})).toBe(0);
    expect(progress({ TODO: 2, IN_PROGRESS: 1, DONE: 1 })).toBe(25);
    expect(progress({ DONE: 3 })).toBe(100);
    expect(budgetUsage('45000', '120000')).toBe(37.5);
    expect(budgetUsage('130000', '120000')).toBe(108.3);
    expect(budgetUsage('100', null)).toBeNull();
  });

  it('flags open items past their due date', () => {
    const due = new Date('2026-10-10T00:00:00.000Z');
    expect(isOverdue(due, false, '2026-10-11')).toBe(true);
    expect(isOverdue(due, false, '2026-10-10')).toBe(false);
    expect(isOverdue(due, true, '2026-10-11')).toBe(false);
    expect(isOverdue(null, false, '2026-10-11')).toBe(false);
  });

  it('moves a card inside or into a column', () => {
    expect(reorder(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(reorder(['a', 'b', 'c'], 'a', 5)).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b']);
  });
});
