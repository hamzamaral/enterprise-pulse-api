import { Injectable } from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  PurchaseOrderStatus,
  SalesOrderStatus,
} from '@prisma/client';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { toBase } from '../../common/money/document-totals';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  AgingBucketsDto,
  AgingQueryDto,
  AgingReportDto,
  AgingRowDto,
  FinanceSummaryDto,
} from './dto/finance.dto';
import { AGING_BUCKETS, agingBucket, type AgingBucket } from './finance-math';
import { TreasuryService } from './treasury.service';

const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal.Value) => dec(value).toFixed(2);
const today = () => parseDateOnly(new Date().toISOString().slice(0, 10));

const openInvoiceWhere = (companyId: string) => ({
  companyId,
  status: InvoiceStatus.ISSUED,
  paymentStatus: { not: PaymentStatus.PAID },
});

const openInvoiceSelect = {
  partnerId: true,
  dueDate: true,
  grandTotal: true,
  paidAmount: true,
  exchangeRate: true,
} as const;

interface OpenRow {
  partnerId: string;
  dueDate: Date;
  grandTotal: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  exchangeRate: Prisma.Decimal;
}

type Buckets = Record<AgingBucket, Prisma.Decimal>;
const emptyBuckets = (): Buckets =>
  Object.fromEntries(AGING_BUCKETS.map((b) => [b, dec(0)])) as Buckets;

/** Open amount of an invoice in company currency at its own rate. */
const openBase = (row: OpenRow) => toBase(row.grandTotal.minus(row.paidAmount), row.exchangeRate);

/** Aging of open invoices and the finance figures of the dashboard. */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly treasury: TreasuryService,
  ) {}

  async aging(companyId: string, query: AgingQueryDto): Promise<AgingReportDto> {
    const asOf = query.asOf ? parseDateOnly(query.asOf) : today();
    const rows = await this.openInvoices(companyId, query.side === 'RECEIVABLE');
    const byPartner = new Map<string, { buckets: Buckets; count: number; oldest: Date }>();
    const totals = emptyBuckets();
    for (const row of rows) {
      const amount = openBase(row);
      if (!amount.greaterThan(0)) continue;
      const bucket = agingBucket(row.dueDate, asOf);
      const entry = byPartner.get(row.partnerId) ?? {
        buckets: emptyBuckets(),
        count: 0,
        oldest: row.dueDate,
      };
      entry.buckets[bucket] = entry.buckets[bucket].plus(amount);
      entry.count += 1;
      if (row.dueDate < entry.oldest) entry.oldest = row.dueDate;
      byPartner.set(row.partnerId, entry);
      totals[bucket] = totals[bucket].plus(amount);
    }
    const partners = await this.prisma.businessPartner.findMany({
      where: { id: { in: [...byPartner.keys()] } },
      select: { id: true, code: true, title: true },
    });
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { baseCurrency: true },
    });
    const result: AgingRowDto[] = partners.map((partner) => {
      const entry = byPartner.get(partner.id)!;
      return {
        partnerId: partner.id,
        partnerCode: partner.code,
        partnerTitle: partner.title,
        invoiceCount: entry.count,
        oldestDueDate: toDateOnly(entry.oldest),
        ...toBucketsDto(entry.buckets),
      };
    });
    result.sort((a, b) => dec(b.total).comparedTo(a.total));
    return {
      side: query.side,
      asOf: toDateOnly(asOf),
      baseCurrency: company.baseCurrency,
      rows: result,
      totals: toBucketsDto(totals),
    };
  }

  async summary(companyId: string): Promise<FinanceSummaryDto> {
    const now = today();
    const [sales, purchases, position, openPurchaseOrders, openSalesOrders] = await Promise.all([
      this.openInvoices(companyId, true),
      this.openInvoices(companyId, false),
      this.treasury.position(companyId),
      this.prisma.purchaseOrder.count({
        where: {
          companyId,
          status: { in: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        },
      }),
      this.prisma.salesOrder.count({
        where: {
          companyId,
          status: { in: [SalesOrderStatus.APPROVED, SalesOrderStatus.PARTIALLY_DELIVERED] },
        },
      }),
    ]);
    const sum = (rows: OpenRow[], overdueOnly: boolean) =>
      rows
        .filter((row) => !overdueOnly || row.dueDate < now)
        .reduce((total, row) => total.plus(openBase(row)), dec(0));
    return {
      baseCurrency: position.baseCurrency,
      receivables: money(sum(sales, false)),
      overdueReceivables: money(sum(sales, true)),
      payables: money(sum(purchases, false)),
      overduePayables: money(sum(purchases, true)),
      cashPosition: position.totalBase,
      chequesInPortfolio: position.chequesInPortfolioBase,
      openPurchaseOrders,
      openSalesOrders,
    };
  }

  private openInvoices(companyId: string, sales: boolean): Promise<OpenRow[]> {
    return sales
      ? this.prisma.salesInvoice.findMany({
          where: openInvoiceWhere(companyId),
          select: openInvoiceSelect,
        })
      : this.prisma.purchaseInvoice.findMany({
          where: openInvoiceWhere(companyId),
          select: openInvoiceSelect,
        });
  }
}

function toBucketsDto(buckets: Buckets): AgingBucketsDto {
  const total = AGING_BUCKETS.reduce((sum, b) => sum.plus(buckets[b]), dec(0));
  return {
    current: money(buckets.current),
    d1_30: money(buckets.d1_30),
    d31_60: money(buckets.d31_60),
    d61_90: money(buckets.d61_90),
    d90plus: money(buckets.d90plus),
    total: money(total),
  };
}
