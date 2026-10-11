import { Prisma } from '@prisma/client';

type Numeric = Prisma.Decimal | number | string;

const dec = (value: Numeric) => new Prisma.Decimal(value);

/** Quantities are stored with 3 decimals and sent as plain strings ("12", "1.5"). */
export const qty = (value: Numeric | null | undefined): string =>
  dec(value ?? 0)
    .toDecimalPlaces(3)
    .toFixed();

export const money = (value: Numeric | null | undefined): string => dec(value ?? 0).toFixed(2);

export const unitCost = (value: Numeric | null | undefined): string => dec(value ?? 0).toFixed(4);

/**
 * Moving weighted average cost after a receipt:
 * (onHand × average + received × cost) / (onHand + received).
 * A non-positive on-hand quantity carries no value, so the receipt cost becomes the new average.
 */
export function weightedAverageCost(
  onHand: Numeric,
  average: Numeric,
  received: Numeric,
  cost: Numeric,
): Prisma.Decimal {
  const current = dec(onHand);
  const incoming = dec(received);
  if (current.lte(0)) return dec(cost).toDecimalPlaces(4);
  const total = current.plus(incoming);
  if (total.lte(0)) return dec(average);
  return current.times(average).plus(incoming.times(cost)).dividedBy(total).toDecimalPlaces(4);
}

/** True when a movement takes on-hand stock from at/above the reorder point to below it. */
export function crossedBelowMinimum(before: Numeric, after: Numeric, minimum: Numeric): boolean {
  const min = dec(minimum);
  return min.gt(0) && dec(before).gte(min) && dec(after).lt(min);
}

export const isWholeNumber = (value: Numeric): boolean => dec(value).isInteger();
