import { Prisma } from '@prisma/client';

type Numeric = Prisma.Decimal | number | string;

const dec = (value: Numeric) => new Prisma.Decimal(value);
const round2 = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface LineAmountsInput {
  quantity: Numeric;
  unitPrice: Numeric;
  /** Percentage, 0–100. */
  discountRate?: Numeric;
  /** Percentage, e.g. 20 for 20% VAT. */
  vatRate?: Numeric;
}

export interface LineAmounts {
  /** quantity × unit price */
  gross: Prisma.Decimal;
  discount: Prisma.Decimal;
  /** gross − discount: the VAT base */
  net: Prisma.Decimal;
  vat: Prisma.Decimal;
  /** net + VAT */
  total: Prisma.Decimal;
}

export interface VatBreakdown {
  rate: Prisma.Decimal;
  base: Prisma.Decimal;
  vat: Prisma.Decimal;
}

export interface DocumentAmounts {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  netTotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  vatBreakdown: VatBreakdown[];
}

/** Line amounts rounded to 2 decimals; every derived amount uses the rounded parts. */
export function lineAmounts(line: LineAmountsInput): LineAmounts {
  const gross = round2(dec(line.quantity).times(line.unitPrice));
  const discount = round2(gross.times(dec(line.discountRate ?? 0)).dividedBy(100));
  const net = gross.minus(discount);
  const vat = round2(net.times(dec(line.vatRate ?? 0)).dividedBy(100));
  return { gross, discount, net, vat, total: net.plus(vat) };
}

/** Document totals: the sum of rounded line amounts, plus a VAT breakdown per rate. */
export function documentAmounts(lines: LineAmountsInput[]): DocumentAmounts {
  const zero = dec(0);
  const totals = {
    subtotal: zero,
    discountTotal: zero,
    netTotal: zero,
    vatTotal: zero,
    grandTotal: zero,
  };
  const byRate = new Map<string, VatBreakdown>();
  for (const line of lines) {
    const amounts = lineAmounts(line);
    totals.subtotal = totals.subtotal.plus(amounts.gross);
    totals.discountTotal = totals.discountTotal.plus(amounts.discount);
    totals.netTotal = totals.netTotal.plus(amounts.net);
    totals.vatTotal = totals.vatTotal.plus(amounts.vat);
    totals.grandTotal = totals.grandTotal.plus(amounts.total);

    const rate = dec(line.vatRate ?? 0);
    const key = rate.toFixed(2);
    const entry = byRate.get(key) ?? { rate, base: zero, vat: zero };
    byRate.set(key, {
      rate,
      base: entry.base.plus(amounts.net),
      vat: entry.vat.plus(amounts.vat),
    });
  }
  const vatBreakdown = [...byRate.values()].sort((a, b) => a.rate.comparedTo(b.rate));
  return { ...totals, vatBreakdown };
}

/** Converts a document-currency amount to the base currency (2 decimals). */
export function toBase(amount: Numeric, exchangeRate: Numeric): Prisma.Decimal {
  return round2(dec(amount).times(exchangeRate));
}
