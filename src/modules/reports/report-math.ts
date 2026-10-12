import { BadRequestException } from '@nestjs/common';
import { parseDateOnly } from '../../common/dates/date-only';

/** Longest range a report accepts, in days. */
export const MAX_REPORT_DAYS = 731;

/** Validated `[from, to]` dates of a report query. */
export function reportRange(from: string, to: string): { from: Date; to: Date } {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (start > end) throw new BadRequestException('"from" must not be after "to"');
  if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_REPORT_DAYS) {
    throw new BadRequestException(`A report can cover at most ${MAX_REPORT_DAYS} days`);
  }
  return { from: start, to: end };
}

/** "YYYY-MM" of a date. */
export const monthKey = (date: Date) => date.toISOString().slice(0, 7);

/** Every "YYYY-MM" between two dates, both ends included. */
export function monthKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cursor <= to) {
    keys.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}
