import { Prisma, ProjectStatus, ProjectTaskStatus } from '@prisma/client';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';

/** Statuses in which members may log time and charge expenses. */
export const WORKING_STATUSES: ProjectStatus[] = [ProjectStatus.PLANNED, ProjectStatus.ACTIVE];
export const CLOSED_STATUSES: ProjectStatus[] = [ProjectStatus.COMPLETED, ProjectStatus.CANCELLED];
export const MAX_DAY_HOURS = 24;

const DAY_MS = 86_400_000;

/** Monday of the ISO week containing `date` ("YYYY-MM-DD"). */
export function weekStart(date: string): string {
  const day = parseDateOnly(date);
  const offset = (day.getUTCDay() + 6) % 7;
  return toDateOnly(new Date(day.getTime() - offset * DAY_MS));
}

/** The seven dates of the week starting on `start`. */
export function weekDays(start: string): string[] {
  const first = parseDateOnly(start).getTime();
  return Array.from({ length: 7 }, (_, i) => toDateOnly(new Date(first + i * DAY_MS)));
}

/** Labour cost of an entry; members without an hourly cost cost nothing. */
export function entryCost(
  hours: Prisma.Decimal.Value,
  hourlyCost: Prisma.Decimal.Value | null,
): Prisma.Decimal {
  if (hourlyCost === null) return new Prisma.Decimal(0);
  return new Prisma.Decimal(hours).mul(hourlyCost).toDecimalPlaces(2);
}

/** Share of done tasks, 0–100. */
export function progress(counts: Partial<Record<ProjectTaskStatus, number>>): number {
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  if (total === 0) return 0;
  return Math.round(((counts.DONE ?? 0) / total) * 100);
}

/** Cost as a share of the budget (one decimal), or null without a budget. */
export function budgetUsage(
  cost: Prisma.Decimal.Value,
  budget: Prisma.Decimal.Value | null,
): number | null {
  if (budget === null || new Prisma.Decimal(budget).isZero()) return null;
  return new Prisma.Decimal(cost).div(budget).mul(100).toDecimalPlaces(1).toNumber();
}

/** Open projects and tasks are late once their due date has passed. */
export function isOverdue(dueDate: Date | null, done: boolean, today: string): boolean {
  return !done && dueDate !== null && toDateOnly(dueDate) < today;
}

/** Positions 0..n-1 for a column after moving `id` to `position`. */
export function reorder(ids: string[], id: string, position: number): string[] {
  const rest = ids.filter((other) => other !== id);
  const index = Math.max(0, Math.min(position, rest.length));
  return [...rest.slice(0, index), id, ...rest.slice(index)];
}
