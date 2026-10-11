const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Counts working days in [start, end] (both inclusive, UTC dates), skipping Saturdays, Sundays and
 * the given public holidays ("YYYY-MM-DD").
 */
export function countWorkingDays(start: Date, end: Date, holidays: ReadonlySet<string>): number {
  if (end < start) return 0;
  let days = 0;
  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    const date = new Date(time);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (holidays.has(date.toISOString().slice(0, 10))) continue;
    days += 1;
  }
  return days;
}

/** True when the two inclusive date ranges share at least one day. */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
