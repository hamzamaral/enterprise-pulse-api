import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { documentAmounts, lineAmounts, toBase } from '../../common/money/document-totals';
import type { PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { DocumentTotalsDto, TradeLineDto, TradeLineInputDto } from './dto/trade.dto';

const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

export const tradeVariantSelect = {
  id: true,
  sku: true,
  name: true,
  productId: true,
  isActive: true,
  product: {
    select: {
      name: true,
      type: true,
      trackingType: true,
      isActive: true,
      deletedAt: true,
      unit: { select: { code: true } },
    },
  },
} satisfies Prisma.ProductVariantSelect;

export type TradeVariant = Prisma.ProductVariantGetPayload<{ select: typeof tradeVariantSelect }>;

export interface PricedLine {
  lineNo: number;
  variantId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountRate: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

export interface PricedDocument {
  lines: PricedLine[];
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
}

/** Stored line shape shared by quotes, orders and invoices, with the variant for display. */
export interface StoredLine {
  id: string;
  lineNo: number;
  variantId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountRate: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  variant: TradeVariant | null;
}

/** Helpers shared by purchasing and sales documents. */
@Injectable()
export class TradeService {
  /**
   * The exchange rate of a document: 1 for the base currency, the given rate, or the latest
   * stored selling rate on or before `date`.
   */
  async resolveCurrency(
    tx: PrismaTx,
    companyId: string,
    currencyCode: string,
    exchangeRate: number | undefined,
    date: Date,
  ): Promise<{ currencyCode: string; exchangeRate: Prisma.Decimal; baseCurrency: string }> {
    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { baseCurrency: true },
    });
    const baseCurrency = company.baseCurrency;
    if (currencyCode === baseCurrency) {
      return { currencyCode, exchangeRate: dec(1), baseCurrency };
    }
    const currency = await tx.currency.findUnique({ where: { code: currencyCode } });
    if (!currency?.isActive) throw new BadRequestException(`Unknown currency ${currencyCode}`);
    if (exchangeRate !== undefined) {
      return { currencyCode, exchangeRate: dec(exchangeRate), baseCurrency };
    }
    const latest = await tx.exchangeRate.findFirst({
      where: { currencyCode, rateDate: { lte: date } },
      orderBy: { rateDate: 'desc' },
    });
    if (!latest) {
      throw new BadRequestException(`No exchange rate for ${currencyCode}; enter one`);
    }
    return { currencyCode, exchangeRate: latest.selling, baseCurrency };
  }

  /** Loads the variants used by the lines; inactive items are rejected. */
  async loadVariants(
    tx: PrismaTx,
    companyId: string,
    variantIds: (string | null | undefined)[],
  ): Promise<Map<string, TradeVariant>> {
    const ids = [...new Set(variantIds.filter((id): id is string => !!id))];
    const rows = await tx.productVariant.findMany({
      where: { id: { in: ids }, companyId },
      select: tradeVariantSelect,
    });
    if (rows.length !== ids.length)
      throw new BadRequestException('One or more items were not found');
    for (const row of rows) {
      if (!row.isActive || !row.product.isActive || row.product.deletedAt) {
        throw new BadRequestException(`${row.sku} is inactive`);
      }
    }
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Numbers the lines, fills descriptions and computes line and document totals. */
  priceLines(
    inputs: TradeLineInputDto[],
    variants: Map<string, TradeVariant>,
    { requireItem = false } = {},
  ): PricedDocument {
    const lines = inputs.map((input, index) => {
      const variant = input.variantId ? variants.get(input.variantId) : undefined;
      if (requireItem && !variant) {
        throw new BadRequestException(`Line ${index + 1}: a product is required`);
      }
      const description = input.description?.trim() || (variant ? variantLabel(variant) : '');
      if (!description) {
        throw new BadRequestException(`Line ${index + 1}: description is required`);
      }
      const amounts = lineAmounts(input);
      return {
        lineNo: index + 1,
        variantId: variant?.id ?? null,
        description,
        quantity: dec(input.quantity),
        unitPrice: dec(input.unitPrice),
        discountRate: dec(input.discountRate ?? 0),
        vatRate: dec(input.vatRate ?? 0),
        lineTotal: amounts.total,
      };
    });
    const totals = documentAmounts(inputs);
    return {
      lines,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      vatTotal: totals.vatTotal,
      grandTotal: totals.grandTotal,
    };
  }
}

export const variantLabel = (variant: Pick<TradeVariant, 'name' | 'product'>) =>
  variant.name ? `${variant.product.name} (${variant.name})` : variant.product.name;

export const isStocked = (variant: TradeVariant | null | undefined) =>
  variant?.product.type === ProductType.GOODS;

export function toLineDto(line: StoredLine): TradeLineDto {
  return {
    id: line.id,
    lineNo: line.lineNo,
    variantId: line.variantId,
    productId: line.variant?.productId ?? null,
    sku: line.variant?.sku ?? null,
    productType: line.variant?.product.type ?? null,
    unitCode: line.variant?.product.unit.code ?? null,
    description: line.description,
    quantity: qty(line.quantity),
    unitPrice: line.unitPrice.toFixed(4),
    discountRate: line.discountRate.toFixed(2),
    vatRate: line.vatRate.toFixed(2),
    lineTotal: line.lineTotal.toFixed(2),
  };
}

export function toTotalsDto(doc: {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  exchangeRate: Prisma.Decimal;
}): DocumentTotalsDto {
  return {
    subtotal: doc.subtotal.toFixed(2),
    discountTotal: doc.discountTotal.toFixed(2),
    vatTotal: doc.vatTotal.toFixed(2),
    grandTotal: doc.grandTotal.toFixed(2),
    grandTotalBase: toBase(doc.grandTotal, doc.exchangeRate).toFixed(2),
  };
}

/** Quantities as plain strings with up to 3 decimals ("12", "1.5"). */
export const qty = (value: Prisma.Decimal.Value) => dec(value).toDecimalPlaces(3).toFixed();

/** Unit price after line discount, in base currency: the stock cost of a received unit. */
export function netUnitCostBase(
  line: { unitPrice: Prisma.Decimal; discountRate: Prisma.Decimal },
  exchangeRate: Prisma.Decimal,
): Prisma.Decimal {
  return line.unitPrice
    .times(dec(100).minus(line.discountRate))
    .dividedBy(100)
    .times(exchangeRate)
    .toDecimalPlaces(4);
}
