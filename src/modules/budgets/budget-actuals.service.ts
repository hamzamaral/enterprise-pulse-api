import { Injectable } from '@nestjs/common';
import {
  BudgetSource,
  ExpenseReportStatus,
  InvoiceStatus,
  PayrollPeriodStatus,
  Prisma,
} from '@prisma/client';
import { toDateOnly } from '../../common/dates/date-only';
import { lineAmounts, toBase } from '../../common/money/document-totals';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { categoryResolver } from './budget-math';

export const BUDGET_DOCUMENT_TYPES = [
  'EXPENSE_REPORT',
  'PAYROLL_PERIOD',
  'PURCHASE_INVOICE',
  'SALES_INVOICE',
  'SALES_RETURN',
  'MANUAL_ENTRY',
] as const;
export type BudgetDocumentType = (typeof BUDGET_DOCUMENT_TYPES)[number];

/** One document's contribution to an item in a month, in the company currency. */
export interface ActualRecord {
  itemId: string;
  /** 1–12. */
  month: number;
  departmentId: string | null;
  amount: Prisma.Decimal;
  documentType: BudgetDocumentType;
  documentId: string;
  /** Document number; null for manual entries. */
  reference: string | null;
  date: string;
  description: string;
}

const yearRange = (year: number) => ({
  gte: new Date(Date.UTC(year, 0, 1)),
  lte: new Date(Date.UTC(year, 11, 31)),
});
const monthOf = (date: Date) => date.getUTCMonth() + 1;
const monthName = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('tr-TR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

type SourceItem = { id: string; source: BudgetSource; categoryIds: string[] };

/**
 * Gerçekleşen: reads the actuals of a year from expenses, payroll, purchasing, sales and the
 * manual entries, mapped to the active budget items.
 */
@Injectable()
export class BudgetActualsService {
  constructor(private readonly prisma: PrismaService) {}

  async collect(companyId: string, year: number): Promise<ActualRecord[]> {
    const items = await this.prisma.budgetItem.findMany({
      where: { companyId, isActive: true },
      select: { id: true, source: true, categoryIds: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    const of = (source: BudgetSource) => items.filter((i) => i.source === source);
    const parts = await Promise.all([
      this.expenses(companyId, year, of(BudgetSource.EXPENSES)),
      this.payroll(companyId, year, of(BudgetSource.PAYROLL)),
      this.purchases(companyId, year, of(BudgetSource.PURCHASES)),
      this.sales(companyId, year, of(BudgetSource.SALES)),
      this.entries(companyId, year),
    ]);
    return parts.flat();
  }

  /** Approved and paid expense report lines, one record per report, item and month. */
  private async expenses(companyId: string, year: number, items: SourceItem[]) {
    if (!items.length) return [];
    const resolve = categoryResolver(items);
    const lines = await this.prisma.expenseLine.findMany({
      where: {
        expenseDate: yearRange(year),
        report: {
          companyId,
          status: { in: [ExpenseReportStatus.APPROVED, ExpenseReportStatus.PAID] },
        },
      },
      select: {
        categoryId: true,
        expenseDate: true,
        amountBase: true,
        report: {
          select: {
            id: true,
            number: true,
            title: true,
            employee: { select: { departmentId: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    const records = new Map<string, ActualRecord>();
    for (const line of lines) {
      const itemId = resolve(line.categoryId);
      if (!itemId) continue;
      const month = monthOf(line.expenseDate);
      const key = `${line.report.id}:${itemId}:${month}`;
      const existing = records.get(key);
      if (existing) {
        existing.amount = existing.amount.plus(line.amountBase);
        if (toDateOnly(line.expenseDate) > existing.date)
          existing.date = toDateOnly(line.expenseDate);
        continue;
      }
      const employee = line.report.employee;
      records.set(key, {
        itemId,
        month,
        departmentId: employee.departmentId,
        amount: line.amountBase,
        documentType: 'EXPENSE_REPORT',
        documentId: line.report.id,
        reference: line.report.number,
        date: toDateOnly(line.expenseDate),
        description: `${line.report.title} · ${employee.firstName} ${employee.lastName}`,
      });
    }
    return [...records.values()];
  }

  /** Employer cost of approved and paid payroll periods, per period and department. */
  private async payroll(companyId: string, year: number, items: SourceItem[]) {
    const itemId = items[0]?.id;
    if (!itemId) return [];
    const payslips = await this.prisma.payslip.findMany({
      where: {
        companyId,
        period: {
          year,
          status: { in: [PayrollPeriodStatus.APPROVED, PayrollPeriodStatus.PAID] },
        },
      },
      select: {
        employerCost: true,
        employee: { select: { departmentId: true } },
        period: { select: { id: true, number: true, year: true, month: true } },
      },
    });
    const records = new Map<string, ActualRecord>();
    for (const slip of payslips) {
      const departmentId = slip.employee.departmentId;
      const key = `${slip.period.id}:${departmentId ?? ''}`;
      const existing = records.get(key);
      if (existing) {
        existing.amount = existing.amount.plus(slip.employerCost);
        continue;
      }
      const { year: y, month } = slip.period;
      records.set(key, {
        itemId,
        month,
        departmentId,
        amount: slip.employerCost,
        documentType: 'PAYROLL_PERIOD',
        documentId: slip.period.id,
        reference: slip.period.number,
        date: toDateOnly(new Date(Date.UTC(y, month, 0))),
        description: `${monthName(y, month)} bordrosu · işveren maliyeti`,
      });
    }
    return [...records.values()];
  }

  /**
   * Issued purchase invoices net of VAT, split by the product category of each line. The
   * department is the one of the purchase request behind the order, if any.
   */
  private async purchases(companyId: string, year: number, items: SourceItem[]) {
    if (!items.length) return [];
    const resolve = categoryResolver(items);
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: { companyId, status: InvoiceStatus.ISSUED, invoiceDate: yearRange(year) },
      select: {
        id: true,
        number: true,
        invoiceDate: true,
        exchangeRate: true,
        partner: { select: { title: true } },
        order: { select: { request: { select: { departmentId: true } } } },
        lines: {
          select: {
            quantity: true,
            unitPrice: true,
            discountRate: true,
            vatRate: true,
            variant: { select: { product: { select: { categoryId: true } } } },
          },
        },
      },
    });
    const records: ActualRecord[] = [];
    for (const invoice of invoices) {
      const byItem = new Map<string, Prisma.Decimal>();
      for (const line of invoice.lines) {
        const itemId = resolve(line.variant?.product.categoryId ?? null);
        if (!itemId) continue;
        const net = toBase(lineAmounts(line).net, invoice.exchangeRate);
        byItem.set(itemId, (byItem.get(itemId) ?? new Prisma.Decimal(0)).plus(net));
      }
      for (const [itemId, amount] of byItem) {
        records.push({
          itemId,
          month: monthOf(invoice.invoiceDate),
          departmentId: invoice.order?.request?.departmentId ?? null,
          amount,
          documentType: 'PURCHASE_INVOICE',
          documentId: invoice.id,
          reference: invoice.number,
          date: toDateOnly(invoice.invoiceDate),
          description: invoice.partner.title,
        });
      }
    }
    return records;
  }

  /** Issued sales invoices net of VAT, less sales returns; they have no department. */
  private async sales(companyId: string, year: number, items: SourceItem[]) {
    const itemId = items[0]?.id;
    if (!itemId) return [];
    const select = {
      id: true,
      number: true,
      exchangeRate: true,
      subtotal: true,
      discountTotal: true,
      partner: { select: { title: true } },
    } as const;
    const [invoices, returns] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: { companyId, status: InvoiceStatus.ISSUED, invoiceDate: yearRange(year) },
        select: { ...select, invoiceDate: true },
      }),
      this.prisma.salesReturn.findMany({
        where: { companyId, returnDate: yearRange(year) },
        select: { ...select, returnDate: true },
      }),
    ]);
    const net = (doc: (typeof invoices)[number] | (typeof returns)[number]) =>
      toBase(doc.subtotal.minus(doc.discountTotal), doc.exchangeRate);
    return [
      ...invoices.map((doc): ActualRecord => ({
        itemId,
        month: monthOf(doc.invoiceDate),
        departmentId: null,
        amount: net(doc),
        documentType: 'SALES_INVOICE',
        documentId: doc.id,
        reference: doc.number,
        date: toDateOnly(doc.invoiceDate),
        description: doc.partner.title,
      })),
      ...returns.map((doc): ActualRecord => ({
        itemId,
        month: monthOf(doc.returnDate),
        departmentId: null,
        amount: net(doc).negated(),
        documentType: 'SALES_RETURN',
        documentId: doc.id,
        reference: doc.number,
        date: toDateOnly(doc.returnDate),
        description: doc.partner.title,
      })),
    ];
  }

  private async entries(companyId: string, year: number): Promise<ActualRecord[]> {
    const rows = await this.prisma.budgetEntry.findMany({
      where: { companyId, entryDate: yearRange(year), item: { isActive: true } },
    });
    return rows.map((row) => ({
      itemId: row.itemId,
      month: monthOf(row.entryDate),
      departmentId: row.departmentId,
      amount: row.amount,
      documentType: 'MANUAL_ENTRY',
      documentId: row.id,
      reference: null,
      date: toDateOnly(row.entryDate),
      description: row.description,
    }));
  }
}
