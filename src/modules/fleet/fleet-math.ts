import { Prisma } from '@prisma/client';

const DAY = 86_400_000;

/** Days before an expiry or a due service when the reminder goes out. */
export const WARN_DAYS = 30;
/** Distance before the next service km when the service counts as due soon. */
export const WARN_KM = 1000;

export const DOCUMENT_STATES = ['VALID', 'EXPIRING', 'EXPIRED', 'MISSING'] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

export const SERVICE_STATES = ['OK', 'DUE_SOON', 'OVERDUE'] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

/** Documents every vehicle on the road must have; a missing one is flagged. */
export const REQUIRED_DOCUMENTS = ['INSPECTION', 'TRAFFIC_INSURANCE'] as const;

/** City code 01–81, 1–3 letters, 2–4 digits (Turkish civil plates). */
const PLATE = /^(0[1-9]|[1-7]\d|8[01])([A-Z]{1,3})(\d{2,4})$/;

/** "34abc123", "34 ABC 123" → "34 ABC 123"; null when it is not a Turkish plate. */
export function normalizePlate(value: string): string | null {
  const compact = value.toUpperCase().replace(/[\s-]/g, '');
  const match = PLATE.exec(compact);
  if (!match) return null;
  return `${match[1]} ${match[2]} ${match[3]}`;
}

export const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / DAY);

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}

export interface Reading {
  readingDate: Date;
  odometer: number;
}

/**
 * Allowed odometer range on `date`: not below any reading up to that day and not above any later
 * reading, so the history stays monotonic.
 */
export function odometerRange(
  readings: Reading[],
  date: Date,
): { min: number; max: number | null } {
  let min = 0;
  let max: number | null = null;
  for (const r of readings) {
    if (r.readingDate.getTime() <= date.getTime()) min = Math.max(min, r.odometer);
    else max = max === null ? r.odometer : Math.min(max, r.odometer);
  }
  return { min, max };
}

export interface FuelRow {
  id: string;
  entryDate: Date;
  odometer: number;
  liters: Prisma.Decimal;
  fullTank: boolean;
}

export interface FuelFigures {
  distance: number | null;
  consumption: Prisma.Decimal | null;
}

const byOdometer = <T extends { entryDate: Date; odometer: number }>(a: T, b: T) =>
  a.odometer - b.odometer || a.entryDate.getTime() - b.entryDate.getTime();

/**
 * Full-tank method: the litres bought after a full tank up to and including the next full tank,
 * over the km between the two, give that stretch's L/100 km.
 */
export function fuelFigures(entries: FuelRow[]): Map<string, FuelFigures> {
  const sorted = [...entries].sort(byOdometer);
  const result = new Map<string, FuelFigures>();
  let lastFull: FuelRow | null = null;
  let litersSince = new Prisma.Decimal(0);
  sorted.forEach((entry, index) => {
    const previous = index > 0 ? sorted[index - 1] : null;
    const distance = previous ? entry.odometer - previous.odometer : null;
    let consumption: Prisma.Decimal | null = null;
    litersSince = litersSince.plus(entry.liters);
    if (entry.fullTank) {
      const km = lastFull ? entry.odometer - lastFull.odometer : 0;
      if (lastFull && km > 0) {
        consumption = litersSince.dividedBy(km).times(100).toDecimalPlaces(2);
      }
      lastFull = entry;
      litersSince = new Prisma.Decimal(0);
    }
    result.set(entry.id, { distance, consumption });
  });
  return result;
}

/** L/100 km between the first and the last full tank; null with fewer than two. */
export function averageConsumption(entries: FuelRow[]): Prisma.Decimal | null {
  const sorted = [...entries].sort(byOdometer);
  const fulls = sorted.filter((e) => e.fullTank);
  if (fulls.length < 2) return null;
  const first = fulls[0];
  const last = fulls[fulls.length - 1];
  const km = last.odometer - first.odometer;
  if (km <= 0) return null;
  const liters = sorted
    .filter((e) => e.odometer > first.odometer && e.odometer <= last.odometer)
    .reduce((sum, e) => sum.plus(e.liters), new Prisma.Decimal(0));
  return liters.dividedBy(km).times(100).toDecimalPlaces(2);
}

export function documentState(endDate: Date | null, today: Date): DocumentState {
  if (!endDate) return 'MISSING';
  const days = daysBetween(today, endDate);
  if (days < 0) return 'EXPIRED';
  return days <= WARN_DAYS ? 'EXPIRING' : 'VALID';
}

export interface ServiceSchedule {
  odometer: number;
  nextServiceKm: number | null;
  nextServiceDate: Date | null;
}

/** Null without a schedule; otherwise whichever of km and date comes first decides. */
export function serviceState(vehicle: ServiceSchedule, today: Date): ServiceState | null {
  const { odometer, nextServiceKm, nextServiceDate } = vehicle;
  if (nextServiceKm === null && nextServiceDate === null) return null;
  const kmLeft = nextServiceKm === null ? null : nextServiceKm - odometer;
  const daysLeft = nextServiceDate === null ? null : daysBetween(today, nextServiceDate);
  if ((kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft < 0)) return 'OVERDUE';
  if ((kmLeft !== null && kmLeft <= WARN_KM) || (daysLeft !== null && daysLeft <= WARN_DAYS)) {
    return 'DUE_SOON';
  }
  return 'OK';
}

/** Next periodic service after one done on `date` at `km`. */
export function nextService(
  date: Date,
  km: number | null,
  intervalKm: number | null,
  intervalMonths: number | null,
): { nextServiceKm: number | null; nextServiceDate: Date | null } {
  return {
    nextServiceKm: intervalKm && km !== null ? km + intervalKm : null,
    nextServiceDate: intervalMonths ? addMonths(date, intervalMonths) : null,
  };
}

/**
 * km driven in each month of `year`: the highest reading of the month minus the highest reading
 * before it (months without a reading carry the previous value, so they show 0). Without an earlier
 * reading, the first month counts from its own lowest reading.
 */
export function monthlyKm(readings: Reading[], year: number): number[] {
  const start = Date.UTC(year, 0, 1);
  const before = readings
    .filter((r) => r.readingDate.getTime() < start)
    .reduce<number | null>(
      (max, r) => (max === null ? r.odometer : Math.max(max, r.odometer)),
      null,
    );
  const highest: (number | null)[] = Array.from({ length: 12 }, () => null);
  const lowest: number[] = Array.from({ length: 12 }, () => Number.MAX_SAFE_INTEGER);
  for (const r of readings) {
    if (r.readingDate.getUTCFullYear() !== year) continue;
    const month = r.readingDate.getUTCMonth();
    highest[month] = Math.max(highest[month] ?? 0, r.odometer);
    lowest[month] = Math.min(lowest[month], r.odometer);
  }
  let previous = before;
  return highest.map((value, month) => {
    if (value === null) return 0;
    const km = Math.max(0, value - (previous ?? lowest[month]));
    previous = Math.max(previous ?? 0, value);
    return km;
  });
}

/** Cost per km with two decimals; null without distance. */
export function costPerKm(cost: Prisma.Decimal, km: number): Prisma.Decimal | null {
  if (km <= 0) return null;
  return cost.dividedBy(km).toDecimalPlaces(2);
}
