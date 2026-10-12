import { Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { lineAmounts, toBase } from '../../common/money/document-totals';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  TradeReportGroupBy,
  type TradeReportDto,
  type TradeReportQueryDto,
  type TradeReportRowDto,
} from './dto/reports.dto';
import { monthKey, monthKeys, reportRange } from './report-math';

const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const ZERO = dec(0);

export type TradeSide = 'sales' | 'purchases';

const lineSelect = {
  variantId: true,
  description: true,
  quantity: true,
  unitPrice: true,
  discountRate: true,
  vatRate: true,
  variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
} as const;

const documentSelect = {
  id: true,
  partnerId: true,
  exchangeRate: true,
  subtotal: true,
  discountTotal: true,
  vatTotal: true,
  grandTotal: true,
  partner: { select: { code: true, title: true } },
  lines: { select: lineSelect },
} as const;

interface ReportLine {
  variantId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountRate: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  variant: { sku: string; name: string | null; product: { name: string } } | null;
}

interface ReportDocument {
  id: string;
  date: Date;
  partnerId: string;
  exchangeRate: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  partner: { code: string; title: string };
  lines: ReportLine[];
}

interface Group {
  key: string;
  label: string;
  code: string | null;
  documents: Set<string>;
  quantity: Prisma.Decimal | null;
  net: Prisma.Decimal;
  vat: Prisma.Decimal;
  gross: Prisma.Decimal;
  returns: Prisma.Decimal;
}

interface Amounts {
  quantity?: Prisma.Decimal;
  net: Prisma.Decimal;
  vat: Prisma.Decimal;
  gross: Prisma.Decimal;
}

/** Sales and purchase analysis by month, partner or product, in the company currency. */
@Injectable()
export class TradeReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(companyId: string, side: TradeSide, query: TradeReportQueryDto) {
    const { from, to } = reportRange(query.from, query.to);
    const groupBy = query.groupBy ?? TradeReportGroupBy.MONTH;
    const [company, invoices, returns] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { baseCurrency: true },
      }),
      this.invoices(companyId, side, from, to, query.partnerId),
      side === 'sales' ? this.salesReturns(companyId, from, to, query.partnerId) : [],
    ]);

    const groups = new Map<string, Group>();
    const group = (key: string, label: string, code: string | null): Group => {
      let entry = groups.get(key);
      if (!entry) {
        entry = {
          key,
          label,
          code,
          documents: new Set(),
          quantity: groupBy === TradeReportGroupBy.PRODUCT ? ZERO : null,
          net: ZERO,
          vat: ZERO,
          gross: ZERO,
          returns: ZERO,
        };
        groups.set(key, entry);
      }
      return entry;
    };
    if (groupBy === TradeReportGroupBy.MONTH) {
      for (const key of monthKeys(from, to)) group(key, key, null);
    }

    const visit = (doc: ReportDocument, sign: 1 | -1) => {
      for (const { key, label, code, amounts } of this.split(doc, groupBy)) {
        const entry = group(key, label, code);
        if (sign === 1) {
          entry.documents.add(doc.id);
          entry.net = entry.net.plus(amounts.net);
          entry.vat = entry.vat.plus(amounts.vat);
          entry.gross = entry.gross.plus(amounts.gross);
        } else {
          entry.returns = entry.returns.plus(amounts.net);
        }
        if (entry.quantity && amounts.quantity) {
          entry.quantity = entry.quantity.plus(amounts.quantity.times(sign));
        }
      }
    };
    invoices.forEach((doc) => visit(doc, 1));
    returns.forEach((doc) => visit(doc, -1));

    const rows: TradeReportRowDto[] = [...groups.values()].map((g) => ({
      key: g.key,
      label: g.label,
      code: g.code,
      documentCount: g.documents.size,
      quantity: g.quantity?.toFixed(3) ?? null,
      net: g.net.toFixed(2),
      vat: g.vat.toFixed(2),
      gross: g.gross.toFixed(2),
      returns: g.returns.toFixed(2),
      netTotal: g.net.minus(g.returns).toFixed(2),
    }));
    if (groupBy === TradeReportGroupBy.MONTH) rows.sort((a, b) => a.key.localeCompare(b.key));
    else rows.sort((a, b) => Number(b.netTotal) - Number(a.netTotal));

    const sum = (pick: (g: Group) => Prisma.Decimal) =>
      [...groups.values()].reduce((total, g) => total.plus(pick(g)), ZERO);
    const net = sum((g) => g.net);
    const returnsTotal = sum((g) => g.returns);
    const result: TradeReportDto = {
      from: query.from,
      to: query.to,
      groupBy,
      currencyCode: company.baseCurrency,
      totals: {
        documentCount: invoices.length,
        net: net.toFixed(2),
        vat: sum((g) => g.vat).toFixed(2),
        gross: sum((g) => g.gross).toFixed(2),
        returns: returnsTotal.toFixed(2),
        netTotal: net.minus(returnsTotal).toFixed(2),
      },
      rows,
    };
    return result;
  }

  /** The parts of a document that fall into each group, converted to the company currency. */
  private split(doc: ReportDocument, groupBy: TradeReportGroupBy) {
    const rate = doc.exchangeRate;
    if (groupBy !== TradeReportGroupBy.PRODUCT) {
      const amounts: Amounts = {
        net: toBase(doc.subtotal.minus(doc.discountTotal), rate),
        vat: toBase(doc.vatTotal, rate),
        gross: toBase(doc.grandTotal, rate),
      };
      return groupBy === TradeReportGroupBy.MONTH
        ? [{ key: monthKey(doc.date), label: monthKey(doc.date), code: null, amounts }]
        : [{ key: doc.partnerId, label: doc.partner.title, code: doc.partner.code, amounts }];
    }
    return doc.lines.map((line) => {
      const parts = lineAmounts(line);
      const variant = line.variant;
      return {
        key: line.variantId ?? `text:${line.description}`,
        label: variant
          ? [variant.product.name, variant.name].filter(Boolean).join(' — ')
          : line.description,
        code: variant?.sku ?? null,
        amounts: {
          quantity: dec(line.quantity),
          net: toBase(parts.net, rate),
          vat: toBase(parts.vat, rate),
          gross: toBase(parts.total, rate),
        } satisfies Amounts,
      };
    });
  }

  private async invoices(
    companyId: string,
    side: TradeSide,
    from: Date,
    to: Date,
    partnerId?: string,
  ): Promise<ReportDocument[]> {
    const where = {
      companyId,
      status: InvoiceStatus.ISSUED,
      invoiceDate: { gte: from, lte: to },
      ...(partnerId ? { partnerId } : {}),
    };
    const rows =
      side === 'sales'
        ? await this.prisma.salesInvoice.findMany({
            where,
            select: { ...documentSelect, invoiceDate: true },
          })
        : await this.prisma.purchaseInvoice.findMany({
            where,
            select: { ...documentSelect, invoiceDate: true },
          });
    return rows.map(({ invoiceDate, ...row }) => ({ ...row, date: invoiceDate }));
  }

  private async salesReturns(
    companyId: string,
    from: Date,
    to: Date,
    partnerId?: string,
  ): Promise<ReportDocument[]> {
    const rows = await this.prisma.salesReturn.findMany({
      where: {
        companyId,
        returnDate: { gte: from, lte: to },
        ...(partnerId ? { partnerId } : {}),
      },
      select: { ...documentSelect, returnDate: true },
    });
    return rows.map(({ returnDate, ...row }) => ({ ...row, date: returnDate }));
  }
}
