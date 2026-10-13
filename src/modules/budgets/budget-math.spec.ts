import { BudgetItemKind, Prisma } from '@prisma/client';
import {
  alertLevel,
  categoryResolver,
  compare,
  departmentScope,
  elapsedMonths,
  itemState,
  scaleAmounts,
  utilization,
} from './budget-math';

const d = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('budget math', () => {
  it('counts the months of a year that have started', () => {
    expect(elapsedMonths(2025, date('2026-10-13'))).toBe(12);
    expect(elapsedMonths(2026, date('2026-10-13'))).toBe(10);
    expect(elapsedMonths(2026, date('2026-01-01'))).toBe(1);
    expect(elapsedMonths(2027, date('2026-10-13'))).toBe(0);
  });

  it('classifies expense and income items year to date', () => {
    const { EXPENSE, INCOME } = BudgetItemKind;
    expect(itemState(EXPENSE, d(1000), d(500))).toBe('ON_TRACK');
    expect(itemState(EXPENSE, d(1000), d(1000))).toBe('ON_TRACK');
    expect(itemState(EXPENSE, d(1000), d(1000.01))).toBe('WARNING');
    expect(itemState(EXPENSE, d(1000), d(1100))).toBe('WARNING');
    expect(itemState(EXPENSE, d(1000), d(1100.01))).toBe('OVER');
    expect(itemState(EXPENSE, d(0), d(10))).toBe('OVER');
    expect(itemState(EXPENSE, d(0), d(0))).toBe('ON_TRACK');
    expect(itemState(INCOME, d(1000), d(899))).toBe('BEHIND');
    expect(itemState(INCOME, d(1000), d(900))).toBe('ON_TRACK');
    expect(itemState(INCOME, d(0), d(0))).toBe('ON_TRACK');
  });

  it('computes utilization and the yearly alert level', () => {
    expect(utilization(d(0), d(50))).toBeNull();
    expect(utilization(d(3000), d(1000))).toBe(33.3);
    expect(alertLevel(d(0), d(50))).toBeNull();
    expect(alertLevel(d(1000), d(899.99))).toBeNull();
    expect(alertLevel(d(1000), d(900))).toBe('WARNING');
    expect(alertLevel(d(1000), d(1000.5))).toBe('OVER');
  });

  it('scales amounts to whole units and never below zero', () => {
    expect(scaleAmounts([d(1000), d(333.33), d(0)], 10).map(String)).toEqual(['1100', '367', '0']);
    expect(scaleAmounts([d(1000)], -100).map(String)).toEqual(['0']);
  });

  it('resolves categories to the listing item, then the catch-all', () => {
    const resolve = categoryResolver([
      { id: 'travel', categoryIds: ['taxi', 'hotel'] },
      { id: 'other', categoryIds: [] },
      { id: 'meals', categoryIds: ['meal'] },
    ]);
    expect(resolve('hotel')).toBe('travel');
    expect(resolve('meal')).toBe('meals');
    expect(resolve('phone')).toBe('other');
    expect(resolve(null)).toBe('other');
    expect(categoryResolver([{ id: 'travel', categoryIds: ['taxi'] }])('phone')).toBeNull();
  });

  it('collects a department with its sub-departments', () => {
    const departments = [
      { id: 'root', parentId: null },
      { id: 'sales', parentId: 'root' },
      { id: 'export', parentId: 'sales' },
      { id: 'it', parentId: 'root' },
    ];
    expect([...departmentScope(departments, 'sales')].sort()).toEqual(['export', 'sales']);
    expect(departmentScope(departments, 'root').size).toBe(4);
  });

  it('compares plan and actuals per item with year-to-date totals', () => {
    const items = [
      { id: 'rent', code: '750', name: 'Kira', kind: BudgetItemKind.EXPENSE, sortOrder: 0 },
      { id: 'sales', code: '600', name: 'Satış', kind: BudgetItemKind.INCOME, sortOrder: 0 },
      { id: 'idle', code: '760', name: 'Boş', kind: BudgetItemKind.EXPENSE, sortOrder: 0 },
    ];
    const plan = [
      ...Array.from({ length: 12 }, (_, i) => ({ itemId: 'rent', month: i + 1, amount: d(100) })),
      { itemId: 'sales', month: 1, amount: d(500) },
      { itemId: 'sales', month: 6, amount: d(500) },
    ];
    const actuals = [
      { itemId: 'rent', month: 1, amount: d(100) },
      { itemId: 'rent', month: 2, amount: d(150) },
      { itemId: 'rent', month: 2, amount: d(60) },
      { itemId: 'sales', month: 1, amount: d(400) },
    ];
    const result = compare(items, plan, actuals, 3);
    expect(result.rows.map((r) => r.item.id)).toEqual(['sales', 'rent']);
    const rent = result.rows[1];
    expect(rent.plannedYtd.toString()).toBe('300');
    expect(rent.actualYtd.toString()).toBe('310');
    expect(rent.plannedTotal.toString()).toBe('1200');
    expect(rent.state).toBe('WARNING');
    expect(result.rows[0].state).toBe('BEHIND');
    expect(result.expense.actual.map(String).slice(0, 3)).toEqual(['100', '210', '0']);
    expect(result.income.plannedTotal.toString()).toBe('1000');
    expect(result.income.plannedYtd.toString()).toBe('500');
  });
});
