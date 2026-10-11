import { Prisma } from '@prisma/client';

type Amount = Prisma.Decimal | number | string;

export interface DepreciationInput {
  cost: Amount;
  salvageValue: Amount;
  usefulLifeMonths: number;
  purchaseDate: Date;
  asOf: Date;
}

export interface DepreciationYear {
  year: number;
  months: number;
  depreciation: string;
  bookValueEnd: string;
}

export interface DepreciationResult {
  monthlyAmount: string;
  elapsedMonths: number;
  accumulated: string;
  bookValue: string;
  fullyDepreciated: boolean;
  schedule: DepreciationYear[];
}

/** Whole months between two dates; a month counts once its day-of-month has been reached. */
export function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}

/**
 * Straight-line depreciation: (cost - salvage) / useful life per month, starting from the purchase
 * month. The yearly schedule splits the life across calendar years.
 */
export function calculateDepreciation(input: DepreciationInput): DepreciationResult {
  const cost = new Prisma.Decimal(input.cost);
  const salvage = new Prisma.Decimal(input.salvageValue);
  const life = Math.max(1, input.usefulLifeMonths);
  const base = Prisma.Decimal.max(cost.minus(salvage), 0);
  const monthly = base.dividedBy(life);

  const elapsed = Math.min(life, Math.max(0, monthsBetween(input.purchaseDate, input.asOf)));
  // The last month absorbs rounding so the book value lands exactly on the salvage value.
  const accumulatedFor = (months: number) =>
    months >= life ? base : monthly.times(months).toDecimalPlaces(2);
  const accumulated = accumulatedFor(elapsed);

  const schedule: DepreciationYear[] = [];
  const startYear = input.purchaseDate.getUTCFullYear();
  const startMonth = input.purchaseDate.getUTCMonth();
  let consumed = 0;
  for (let year = startYear; consumed < life; year += 1) {
    const available = year === startYear ? 12 - startMonth : 12;
    const months = Math.min(available, life - consumed);
    const before = accumulatedFor(consumed);
    consumed += months;
    const after = accumulatedFor(consumed);
    schedule.push({
      year,
      months,
      depreciation: after.minus(before).toFixed(2),
      bookValueEnd: cost.minus(after).toFixed(2),
    });
  }

  return {
    monthlyAmount: monthly.toFixed(2),
    elapsedMonths: elapsed,
    accumulated: accumulated.toFixed(2),
    bookValue: cost.minus(accumulated).toFixed(2),
    fullyDepreciated: elapsed >= life,
    schedule,
  };
}
