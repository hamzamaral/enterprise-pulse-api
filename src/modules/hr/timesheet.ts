const DAY_MINUTES = 24 * 60;

/** Check-ins up to this many minutes after the shift start are not counted as late. */
export const LATE_GRACE_MINUTES = 5;

/** Extra time below this is not counted as overtime (leaving a few minutes late is routine). */
export const OVERTIME_THRESHOLD_MINUTES = 30;

/** Schedule applied on weekdays when no shift is planned for the employee. */
export const DEFAULT_SHIFT = { code: null, startTime: '09:00', endTime: '18:00', breakMinutes: 60 };

export type DayStatus =
  'PRESENT' | 'LATE' | 'ABSENT' | 'INCOMPLETE' | 'LEAVE' | 'HOLIDAY' | 'OFF' | 'UPCOMING';

export interface ShiftTimes {
  code: string | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
}

export interface DayInput {
  /** Planned shift, or null for a day off. */
  shift: ShiftTimes | null;
  holiday: boolean;
  leave: boolean;
  /** Minutes since local midnight of the work date; may exceed 1440 for night shifts. */
  checkIn: number | null;
  checkOut: number | null;
  /** Current time in minutes since local midnight of the work date (negative for future dates). */
  now: number;
}

export interface DayResult {
  status: DayStatus;
  plannedMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
}

/** Parses "HH:mm" into minutes since midnight. */
export function parseClock(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Formats minutes since midnight as "HH:mm" (wrapping past midnight). */
export function formatClock(minutes: number): string {
  const value = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hours = Math.floor(value / 60);
  return `${String(hours).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/** Start and end of a shift in minutes since midnight of the work date; the end may pass 1440. */
export function shiftWindow(shift: ShiftTimes): { start: number; end: number } {
  const start = parseClock(shift.startTime);
  let end = parseClock(shift.endTime);
  if (end <= start) end += DAY_MINUTES;
  return { start, end };
}

export function plannedMinutes(shift: ShiftTimes): number {
  const { start, end } = shiftWindow(shift);
  return Math.max(0, end - start - shift.breakMinutes);
}

/** Worked time of a check-in/out pair; the break is deducted only from spans longer than it. */
export function workedMinutes(checkIn: number, checkOut: number, breakMinutes: number): number {
  const span = checkOut - checkIn;
  if (span <= 0) return 0;
  return span > breakMinutes * 2 ? span - breakMinutes : span;
}

/** Evaluates one employee day of the timesheet. */
export function evaluateDay(input: DayInput): DayResult {
  const { shift, checkIn, checkOut } = input;
  const planned = shift && !input.holiday && !input.leave ? plannedMinutes(shift) : 0;
  const breakMinutes = shift?.breakMinutes ?? DEFAULT_SHIFT.breakMinutes;
  const worked =
    checkIn !== null && checkOut !== null ? workedMinutes(checkIn, checkOut, breakMinutes) : 0;
  const extra = worked - planned;
  const result = (status: DayStatus, lateMinutes = 0): DayResult => ({
    status,
    plannedMinutes: planned,
    workedMinutes: worked,
    lateMinutes,
    overtimeMinutes: extra >= OVERTIME_THRESHOLD_MINUTES ? extra : 0,
  });

  if (input.holiday) return result('HOLIDAY');
  if (input.leave) return result('LEAVE');
  if (!shift) return result('OFF');

  const { start, end } = shiftWindow(shift);
  if (checkIn === null) {
    return result(input.now < end ? 'UPCOMING' : 'ABSENT');
  }
  const late = checkIn - start > LATE_GRACE_MINUTES ? checkIn - start : 0;
  if (checkOut === null) return result('INCOMPLETE', late);
  return result(late > 0 ? 'LATE' : 'PRESENT', late);
}

/**
 * Offset of a time zone from UTC in minutes at the given instant (e.g. 180 for Europe/Istanbul).
 */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((local - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** Minutes between local midnight of `workDate` (UTC date) and the instant `at`. */
export function minutesSinceWorkDate(at: Date, workDate: Date, offsetMinutes: number): number {
  return Math.floor((at.getTime() - workDate.getTime()) / 60_000) + offsetMinutes;
}

/** Instant of `minutes` after local midnight of `workDate`. */
export function instantOf(workDate: Date, minutes: number, offsetMinutes: number): Date {
  return new Date(workDate.getTime() + (minutes - offsetMinutes) * 60_000);
}
