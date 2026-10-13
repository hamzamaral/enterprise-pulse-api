import { BudgetAlertLevel, BudgetItemKind, Prisma } from '@prisma/client';

const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
export const ZERO = dec(0);
export const MONTHS = 12;

/** Share of the yearly plan that triggers the first overspend alert. */
export const WARNING_RATIO = 0.9;

/** Deviation from the year-to-date plan that is still tolerated (10%). */
export const TOLERANCE = 0.1;

export const BUDGET_ITEM_STATES = ['ON_TRACK', 'WARNING', 'OVER', 'BEHIND'] as const;
export type BudgetItemState = (typeof BUDGET_ITEM_STATES)[number];

/** Months of `year` that have started by `today`: 0 for a future year, 12 for a past one. */
export function elapsedMonths(year: number, today: Date): number {
  const current = today.getUTCFullYear();
  if (year < current) return MONTHS;
  if (year > current) return 0;
  return today.getUTCMonth() + 1;
}

export const emptyMonths = (): Prisma.Decimal[] => Array.from({ length: MONTHS }, () => ZERO);

export const sumOf = (values: Prisma.Decimal[]) => values.reduce((total, v) => total.plus(v), ZERO);

/** Sum of the first `months` months. */
export const toDate = (values: Prisma.Decimal[], months: number) => sumOf(values.slice(0, months));

/** `actual / planned` in percent with one decimal; null without a plan. */
export function utilization(planned: Prisma.Decimal, actual: Prisma.Decimal): number | null {
  if (planned.lte(0)) return null;
  return actual.dividedBy(planned).times(100).toDecimalPlaces(1).toNumber();
}

/**
 * Year-to-date state of an item: expenses above the plan are `WARNING`, more than 10% above it
 * `OVER` (unplanned spending is always `OVER`); income more than 10% below the plan is `BEHIND`.
 */
export function itemState(
  kind: BudgetItemKind,
  plannedYtd: Prisma.Decimal,
  actualYtd: Prisma.Decimal,
): BudgetItemState {
  if (kind === BudgetItemKind.INCOME) {
    return actualYtd.lt(plannedYtd.times(1 - TOLERANCE)) ? 'BEHIND' : 'ON_TRACK';
  }
  if (actualYtd.gt(plannedYtd.times(1 + TOLERANCE))) return 'OVER';
  if (actualYtd.gt(plannedYtd)) return 'WARNING';
  return 'ON_TRACK';
}

/** Alert level of an expense item against its yearly plan; null below 90% or without a plan. */
export function alertLevel(
  plannedTotal: Prisma.Decimal,
  actualTotal: Prisma.Decimal,
): BudgetAlertLevel | null {
  if (plannedTotal.lte(0)) return null;
  if (actualTotal.gt(plannedTotal)) return BudgetAlertLevel.OVER;
  if (actualTotal.gte(plannedTotal.times(WARNING_RATIO))) return BudgetAlertLevel.WARNING;
  return null;
}

/** Amounts changed by `percent` and rounded to whole currency units, e.g. +10% for next year. */
export function scaleAmounts(values: Prisma.Decimal[], percent: number): Prisma.Decimal[] {
  const factor = dec(100 + percent).dividedBy(100);
  return values.map((v) =>
    Prisma.Decimal.max(ZERO, v.times(factor).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)),
  );
}

/**
 * Maps a category to the item that claims it: the item listing the category, otherwise the
 * catch-all item (one without categories) of the source, otherwise none.
 */
export function categoryResolver(
  items: { id: string; categoryIds: string[] }[],
): (categoryId: string | null) => string | null {
  const byCategory = new Map<string, string>();
  let catchAll: string | null = null;
  for (const item of items) {
    if (!item.categoryIds.length) catchAll ??= item.id;
    for (const categoryId of item.categoryIds) {
      if (!byCategory.has(categoryId)) byCategory.set(categoryId, item.id);
    }
  }
  return (categoryId) => (categoryId && byCategory.get(categoryId)) || catchAll;
}

/** A department and all of its sub-departments. */
export function departmentScope(
  departments: { id: string; parentId: string | null }[],
  rootId: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const d of departments) {
    if (!d.parentId) continue;
    children.set(d.parentId, [...(children.get(d.parentId) ?? []), d.id]);
  }
  const scope = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (scope.has(id)) continue;
    scope.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return scope;
}

export interface ComparisonItem {
  id: string;
  code: string;
  name: string;
  kind: BudgetItemKind;
  sortOrder: number;
}

export interface MonthAmount {
  itemId: string;
  /** 1–12. */
  month: number;
  amount: Prisma.Decimal;
}

export interface ComparisonRow {
  item: ComparisonItem;
  planned: Prisma.Decimal[];
  actual: Prisma.Decimal[];
  plannedTotal: Prisma.Decimal;
  actualTotal: Prisma.Decimal;
  plannedYtd: Prisma.Decimal;
  actualYtd: Prisma.Decimal;
  state: BudgetItemState;
}

export interface ComparisonTotals {
  planned: Prisma.Decimal[];
  actual: Prisma.Decimal[];
  plannedTotal: Prisma.Decimal;
  actualTotal: Prisma.Decimal;
  plannedYtd: Prisma.Decimal;
  actualYtd: Prisma.Decimal;
}

/**
 * Planned versus actual per item and month. Items appear when they have a plan or an actual;
 * income items come first.
 */
export function compare(
  items: ComparisonItem[],
  plan: MonthAmount[],
  actuals: MonthAmount[],
  elapsed: number,
): { rows: ComparisonRow[]; income: ComparisonTotals; expense: ComparisonTotals } {
  const byItem = new Map<string, { planned: Prisma.Decimal[]; actual: Prisma.Decimal[] }>();
  const slot = (itemId: string) => {
    let entry = byItem.get(itemId);
    if (!entry) {
      entry = { planned: emptyMonths(), actual: emptyMonths() };
      byItem.set(itemId, entry);
    }
    return entry;
  };
  for (const p of plan) {
    const entry = slot(p.itemId);
    entry.planned[p.month - 1] = entry.planned[p.month - 1].plus(p.amount);
  }
  for (const a of actuals) {
    const entry = slot(a.itemId);
    entry.actual[a.month - 1] = entry.actual[a.month - 1].plus(a.amount);
  }

  const rows: ComparisonRow[] = [];
  for (const item of items) {
    const entry = byItem.get(item.id);
    if (!entry) continue;
    const plannedYtd = toDate(entry.planned, elapsed);
    const actualYtd = toDate(entry.actual, elapsed);
    rows.push({
      item,
      planned: entry.planned,
      actual: entry.actual,
      plannedTotal: sumOf(entry.planned),
      actualTotal: sumOf(entry.actual),
      plannedYtd,
      actualYtd,
      state: itemState(item.kind, plannedYtd, actualYtd),
    });
  }
  rows.sort(
    (a, b) =>
      (a.item.kind === b.item.kind ? 0 : a.item.kind === BudgetItemKind.INCOME ? -1 : 1) ||
      a.item.sortOrder - b.item.sortOrder ||
      a.item.code.localeCompare(b.item.code),
  );

  const totals = (kind: BudgetItemKind): ComparisonTotals => {
    const planned = emptyMonths();
    const actual = emptyMonths();
    for (const row of rows) {
      if (row.item.kind !== kind) continue;
      row.planned.forEach((v, i) => (planned[i] = planned[i].plus(v)));
      row.actual.forEach((v, i) => (actual[i] = actual[i].plus(v)));
    }
    return {
      planned,
      actual,
      plannedTotal: sumOf(planned),
      actualTotal: sumOf(actual),
      plannedYtd: toDate(planned, elapsed),
      actualYtd: toDate(actual, elapsed),
    };
  };
  return { rows, income: totals(BudgetItemKind.INCOME), expense: totals(BudgetItemKind.EXPENSE) };
}
