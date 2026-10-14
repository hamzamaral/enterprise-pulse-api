import { Injectable, Logger } from '@nestjs/common';
import {
  ExpenseReportStatus,
  InvoiceStatus,
  JournalEntryStatus,
  JournalSource,
  LedgerDocumentType,
  PaymentDirection,
  PaymentRecordStatus,
  PayrollPeriodStatus,
  Prisma,
  ProductType,
  StockMovementType,
  TreasuryDocumentType,
} from '@prisma/client';
import { lineAmounts } from '../../common/money/document-totals';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import {
  accountingToday,
  installChart,
  isLocked,
  localDate,
  lockAccounting,
  lockedUntil,
  postEntry,
  reverseEntry,
  ZERO,
} from './accounting-helpers';
import { fingerprint, normalizeLines, toBase, type DraftLine } from './accounting-math';
import {
  chequeCollectionLines,
  chequePaymentLines,
  collectionLines,
  deliveryCostLines,
  employeePaymentLines,
  expenseReportLines,
  partnerOpeningLines,
  paymentLines,
  payrollLines,
  productionLines,
  purchaseInvoiceLines,
  salesInvoiceLines,
  salesReturnLines,
  stockMovementLines,
  treasuryOpeningLines,
} from './accounting-rules';
import type { PendingPostingDto, PostingRunResultDto } from './dto/accounting.dto';

type Dec = Prisma.Decimal;

/** A source document and whether it should currently have a posted entry. */
interface Candidate {
  source: JournalSource;
  sourceId: string;
  sourceNumber: string;
  description: string;
  date: Date;
  amount: Dec;
  /** Issued, approved, posted: the document should be in the books. */
  wanted: boolean;
  /** Date of the reversal once the document was cancelled or reopened. */
  reverseDate: Date;
  /** Author of automatic entries when no user runs the posting. */
  ownerId: string;
  /** Payrolls can be recalculated after reopening: re-post when the lines changed. */
  mutable?: boolean;
  /** Null when the document cannot be posted, e.g. without an exchange rate. */
  lines: () => Promise<DraftLine[] | null>;
}

type Action = 'POST' | 'REVERSE' | 'REPOST';

interface Planned {
  candidate: Candidate;
  action: Action;
  openEntryId: string | null;
  locked: boolean;
}

const TREASURY_SOURCES: Partial<Record<TreasuryDocumentType, JournalSource>> = {
  [TreasuryDocumentType.OPENING]: JournalSource.TREASURY_OPENING,
  [TreasuryDocumentType.CHEQUE_COLLECTION]: JournalSource.CHEQUE,
  [TreasuryDocumentType.CHEQUE_PAYMENT]: JournalSource.CHEQUE,
  [TreasuryDocumentType.EXPENSE_PAYMENT]: JournalSource.EXPENSE_PAYMENT,
  [TreasuryDocumentType.PAYROLL_PAYMENT]: JournalSource.PAYROLL_PAYMENT,
};

const key = (source: JournalSource, sourceId: string) => `${source}:${sourceId}`;

/**
 * Muhasebeleştirme: turns source documents into journal entries. Idempotent — each run compares
 * the documents with their open entries and posts what is missing, reverses what was cancelled
 * and re-posts recalculated payrolls. Documents dated in a locked period are left pending.
 */
@Injectable()
export class AccountingPostingService {
  private readonly logger = new Logger(AccountingPostingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  /** Documents waiting to be posted or reversed. */
  async pending(companyId: string): Promise<PendingPostingDto[]> {
    const plan = await this.plan(companyId);
    return plan
      .map((p) => ({
        source: p.candidate.source,
        sourceId: p.candidate.sourceId,
        sourceNumber: p.candidate.sourceNumber,
        description: p.candidate.description,
        date: (p.action === 'REVERSE' ? p.candidate.reverseDate : p.candidate.date)
          .toISOString()
          .slice(0, 10),
        amount: p.candidate.amount.toFixed(2),
        action: p.action,
        locked: p.locked,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.sourceNumber.localeCompare(b.sourceNumber));
  }

  async run(companyId: string, userId?: string): Promise<PostingRunResultDto> {
    await installChart(this.prisma, companyId);
    const plan = await this.plan(companyId);
    const result = { posted: 0, reversed: 0, skipped: 0 };
    for (const item of plan) {
      if (item.locked) {
        result.skipped++;
        continue;
      }
      const outcome = await this.apply(companyId, userId, item);
      if (outcome === 'skipped') result.skipped++;
      else {
        result.posted += outcome.posted;
        result.reversed += outcome.reversed;
      }
    }
    return result;
  }

  async runAll(): Promise<void> {
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    for (const company of companies) {
      try {
        await this.run(company.id);
      } catch (error) {
        this.logger.error(`Posting failed for company ${company.id}`, error as Error);
      }
    }
  }

  private async plan(companyId: string): Promise<Planned[]> {
    const [candidates, entries, until] = await Promise.all([
      this.collect(companyId),
      this.prisma.journalEntry.findMany({
        where: {
          companyId,
          status: JournalEntryStatus.POSTED,
          source: { not: JournalSource.MANUAL },
        },
        select: { id: true, source: true, sourceId: true, reversesId: true },
      }),
      lockedUntil(this.prisma, companyId),
    ]);
    const reversed = new Set(entries.map((e) => e.reversesId).filter(Boolean));
    const open = new Map<string, string>();
    for (const e of entries) {
      if (!e.sourceId || e.reversesId || reversed.has(e.id)) continue;
      open.set(key(e.source, e.sourceId), e.id);
    }

    const plan: Planned[] = [];
    for (const candidate of candidates) {
      const openEntryId = open.get(key(candidate.source, candidate.sourceId)) ?? null;
      let action: Action | null = null;
      if (candidate.wanted && !openEntryId) action = 'POST';
      else if (!candidate.wanted && openEntryId) action = 'REVERSE';
      else if (candidate.wanted && openEntryId && candidate.mutable) {
        if (await this.changed(openEntryId, candidate)) action = 'REPOST';
      }
      if (!action) continue;
      const locked =
        (action !== 'POST' && isLocked(candidate.reverseDate, until)) ||
        (action !== 'REVERSE' && isLocked(candidate.date, until));
      plan.push({ candidate, action, openEntryId, locked });
    }
    return plan;
  }

  private async changed(entryId: string, candidate: Candidate): Promise<boolean> {
    const draft = await candidate.lines();
    if (!draft) return false;
    const lines = await this.prisma.journalLine.findMany({
      where: { entryId },
      include: { account: { select: { code: true } } },
    });
    const posted = lines.map((l) => ({ ...l, code: l.account.code }));
    return fingerprint(posted) !== fingerprint(normalizeLines(draft));
  }

  private async apply(
    companyId: string,
    userId: string | undefined,
    item: Planned,
  ): Promise<{ posted: number; reversed: number } | 'skipped'> {
    const { candidate } = item;
    const lines = item.action === 'REVERSE' ? [] : await candidate.lines();
    if (item.action !== 'REVERSE' && (!lines || !normalizeLines(lines).length)) return 'skipped';
    return this.prisma.$transaction(async (tx) => {
      await lockAccounting(tx, companyId);
      // Another run may have handled the document since the plan was made.
      const current = await tx.journalEntry.findMany({
        where: {
          companyId,
          source: candidate.source,
          sourceId: candidate.sourceId,
          status: JournalEntryStatus.POSTED,
        },
        select: { id: true, reversesId: true },
      });
      const reversedIds = new Set(current.map((e) => e.reversesId).filter(Boolean));
      const openEntry = current.find((e) => !e.reversesId && !reversedIds.has(e.id));
      if ((openEntry?.id ?? null) !== item.openEntryId) return 'skipped' as const;

      const actor = userId ?? candidate.ownerId;
      const outcome = { posted: 0, reversed: 0 };
      if (openEntry) {
        await reverseEntry(tx, this.numbering, {
          companyId,
          userId: actor,
          entryId: openEntry.id,
          date: item.action === 'REPOST' ? accountingToday() : candidate.reverseDate,
        });
        outcome.reversed++;
      }
      if (item.action !== 'REVERSE') {
        await postEntry(tx, this.numbering, {
          companyId,
          userId: actor,
          date: candidate.date,
          source: candidate.source,
          sourceId: candidate.sourceId,
          sourceNumber: candidate.sourceNumber,
          description: candidate.description,
          lines: lines!,
        });
        outcome.posted++;
      }
      return outcome;
    });
  }

  // ---------- Collectors ----------

  private async collect(companyId: string): Promise<Candidate[]> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { baseCurrency: true },
    });
    const costs = await this.movementCosts(companyId);
    const groups = await Promise.all([
      this.salesInvoices(companyId),
      this.salesReturns(companyId, costs),
      this.purchaseInvoices(companyId),
      this.deliveries(companyId, costs),
      this.stockMovements(companyId, costs),
      this.payments(companyId),
      this.treasury(companyId, company.baseCurrency),
      this.partnerOpenings(companyId),
      this.expenseReports(companyId),
      this.payrolls(companyId),
      this.production(companyId),
    ]);
    return groups.flat();
  }

  private async salesInvoices(companyId: string): Promise<Candidate[]> {
    const rows = await this.prisma.salesInvoice.findMany({
      where: { companyId, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.CANCELLED] } },
      include: { partner: { select: { title: true } } },
    });
    return rows.map((r) => {
      const total = toBase(r.grandTotal, r.exchangeRate);
      return {
        source: JournalSource.SALES_INVOICE,
        sourceId: r.id,
        sourceNumber: r.number,
        description: `Satış faturası — ${r.partner.title}`,
        date: r.invoiceDate,
        amount: total,
        wanted: r.status === InvoiceStatus.ISSUED,
        reverseDate: localDate(r.cancelledAt ?? new Date()),
        ownerId: r.createdById,
        lines: () =>
          Promise.resolve(
            salesInvoiceLines({
              partnerId: r.partnerId,
              total,
              vat: toBase(r.vatTotal, r.exchangeRate),
            }),
          ),
      };
    });
  }

  private async salesReturns(companyId: string, costs: MovementCosts): Promise<Candidate[]> {
    const rows = await this.prisma.salesReturn.findMany({
      where: { companyId },
      include: { partner: { select: { title: true } } },
    });
    return rows.map((r) => {
      const total = toBase(r.grandTotal, r.exchangeRate);
      return {
        source: JournalSource.SALES_RETURN,
        sourceId: r.id,
        sourceNumber: r.number,
        description: `Satış iadesi — ${r.partner.title}`,
        date: r.returnDate,
        amount: total,
        wanted: true,
        reverseDate: r.returnDate,
        ownerId: r.createdById,
        lines: () =>
          Promise.resolve(
            salesReturnLines({
              partnerId: r.partnerId,
              total,
              vat: toBase(r.vatTotal, r.exchangeRate),
              cost: (r.stockMovementId && costs.get(r.stockMovementId)?.increase) || ZERO,
            }),
          ),
      };
    });
  }

  private async purchaseInvoices(companyId: string): Promise<Candidate[]> {
    const rows = await this.prisma.purchaseInvoice.findMany({
      where: { companyId, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.CANCELLED] } },
      include: {
        partner: { select: { title: true } },
        lines: { include: { variant: { select: { product: { select: { type: true } } } } } },
      },
    });
    return rows.map((r) => {
      const total = toBase(r.grandTotal, r.exchangeRate);
      const goods = r.lines
        .filter((l) => l.variant?.product.type === ProductType.GOODS)
        .reduce((sum, l) => sum.plus(lineAmounts(l).net), ZERO);
      return {
        source: JournalSource.PURCHASE_INVOICE,
        sourceId: r.id,
        sourceNumber: r.number,
        description: `Alış faturası ${r.supplierInvoiceNo} — ${r.partner.title}`,
        date: r.invoiceDate,
        amount: total,
        wanted: r.status === InvoiceStatus.ISSUED,
        reverseDate: localDate(r.cancelledAt ?? new Date()),
        ownerId: r.createdById,
        lines: () =>
          Promise.resolve(
            purchaseInvoiceLines({
              partnerId: r.partnerId,
              total,
              vat: toBase(r.vatTotal, r.exchangeRate),
              goods: toBase(goods, r.exchangeRate),
            }),
          ),
      };
    });
  }

  private async deliveries(companyId: string, costs: MovementCosts): Promise<Candidate[]> {
    const rows = await this.prisma.deliveryNote.findMany({
      where: { companyId, stockMovementId: { not: null } },
      include: { partner: { select: { title: true } } },
    });
    return rows.map((r) => {
      const cost = costs.get(r.stockMovementId!)?.decrease ?? ZERO;
      return {
        source: JournalSource.DELIVERY_NOTE,
        sourceId: r.id,
        sourceNumber: r.number,
        description: `Satılan malın maliyeti — ${r.partner.title}`,
        date: r.deliveryDate,
        amount: cost,
        wanted: true,
        reverseDate: r.deliveryDate,
        ownerId: r.createdById,
        lines: () => Promise.resolve(deliveryCostLines(cost)),
      };
    });
  }

  /** Receipts, issues and adjustments that no purchasing or sales document covers. */
  private async stockMovements(companyId: string, costs: MovementCosts): Promise<Candidate[]> {
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        companyId,
        type: { not: StockMovementType.TRANSFER },
        goodsReceipt: null,
        deliveryNote: null,
        salesReturn: null,
        productionIssue: null,
        productionReceipt: null,
      },
    });
    const descriptions: Record<StockMovementType, string> = {
      RECEIPT: 'Faturasız stok girişi',
      ISSUE: 'Stok çıkışı (sarf)',
      ADJUSTMENT: 'Stok sayım farkı',
      TRANSFER: 'Depo transferi',
    };
    return rows.map((r) => {
      const value = costs.get(r.id) ?? { increase: ZERO, decrease: ZERO };
      return {
        source: JournalSource.STOCK_MOVEMENT,
        sourceId: r.id,
        sourceNumber: r.number,
        description: [descriptions[r.type], r.reference].filter(Boolean).join(' — '),
        date: r.movementDate,
        amount: value.increase.plus(value.decrease),
        wanted: true,
        reverseDate: r.movementDate,
        ownerId: r.createdById,
        lines: () => Promise.resolve(stockMovementLines(r.type, value)),
      };
    });
  }

  private async payments(companyId: string): Promise<Candidate[]> {
    const rows = await this.prisma.partnerPayment.findMany({
      where: { companyId },
      include: {
        partner: { select: { title: true } },
        endorsedCheque: { select: { id: true } },
      },
    });
    return rows.map((r) => {
      const incoming = r.direction === PaymentDirection.IN;
      return {
        source: incoming ? JournalSource.COLLECTION : JournalSource.PAYMENT,
        sourceId: r.id,
        sourceNumber: r.number,
        description: `${incoming ? 'Tahsilat' : 'Ödeme'} — ${r.partner.title}`,
        date: r.paymentDate,
        amount: r.amountBase,
        wanted: r.status === PaymentRecordStatus.POSTED,
        reverseDate: localDate(r.cancelledAt ?? new Date()),
        ownerId: r.createdById,
        lines: () =>
          Promise.resolve(
            incoming
              ? collectionLines({ partnerId: r.partnerId, method: r.method, amount: r.amountBase })
              : paymentLines({
                  partnerId: r.partnerId,
                  method: r.method,
                  amount: r.amountBase,
                  endorsed: !!r.endorsedCheque,
                }),
          ),
      };
    });
  }

  /** Treasury postings without a partner document; a reversing transaction cancels them. */
  private async treasury(companyId: string, baseCurrency: string): Promise<Candidate[]> {
    const rows = await this.prisma.treasuryTransaction.findMany({
      where: {
        companyId,
        reversesId: null,
        documentType: { in: Object.keys(TREASURY_SOURCES) as TreasuryDocumentType[] },
      },
      include: {
        account: { select: { type: true, currencyCode: true, name: true } },
        reversal: { select: { txDate: true } },
      },
    });
    const chequeIds = rows
      .filter((r) => r.documentType.startsWith('CHEQUE_') && r.documentId)
      .map((r) => r.documentId!);
    const reportIds = rows
      .filter((r) => r.documentType === TreasuryDocumentType.EXPENSE_PAYMENT && r.documentId)
      .map((r) => r.documentId!);
    const [cheques, reports] = await Promise.all([
      this.prisma.cheque.findMany({
        where: { id: { in: chequeIds } },
        include: { partner: { select: { title: true } } },
      }),
      this.prisma.expenseReport.findMany({
        where: { id: { in: reportIds } },
        include: { employee: { select: { firstName: true, lastName: true } } },
      }),
    ]);
    const chequeById = new Map(cheques.map((c) => [c.id, c]));
    const reportById = new Map(reports.map((r) => [r.id, r]));

    return rows.map((r) => {
      const signed = r.amountIn.minus(r.amountOut);
      const cheque = r.documentId ? chequeById.get(r.documentId) : undefined;
      const report = r.documentId ? reportById.get(r.documentId) : undefined;
      const base = async (): Promise<Dec | null> => {
        if (r.account.currencyCode === baseCurrency) return signed;
        const rate = cheque?.exchangeRate ?? (await this.rateOn(r.account.currencyCode, r.txDate));
        return rate ? toBase(signed, rate) : null;
      };
      let description: string;
      let lines: (amount: Dec) => DraftLine[];
      switch (r.documentType) {
        case TreasuryDocumentType.OPENING:
          description = `Açılış bakiyesi — ${r.account.name}`;
          lines = (amount) => treasuryOpeningLines(r.account.type, amount);
          break;
        case TreasuryDocumentType.CHEQUE_COLLECTION:
          description = `${cheque?.kind === 'NOTE' ? 'Senet' : 'Çek'} tahsili — ${cheque?.partner.title ?? ''}`;
          lines = (amount) =>
            chequeCollectionLines({
              kind: cheque!.kind,
              treasuryType: r.account.type,
              amount,
              partnerId: cheque!.partnerId,
            });
          break;
        case TreasuryDocumentType.CHEQUE_PAYMENT:
          description = `${cheque?.kind === 'NOTE' ? 'Senet' : 'Çek'} ödemesi — ${cheque?.partner.title ?? ''}`;
          lines = (amount) =>
            chequePaymentLines({
              kind: cheque!.kind,
              treasuryType: r.account.type,
              amount: amount.negated(),
              partnerId: cheque!.partnerId,
            });
          break;
        case TreasuryDocumentType.EXPENSE_PAYMENT:
          description = `Masraf ödemesi — ${report ? `${report.employee.firstName} ${report.employee.lastName}` : ''}`;
          lines = (amount) =>
            employeePaymentLines({
              treasuryType: r.account.type,
              amount: amount.negated(),
              employeeId: report?.employeeId,
            });
          break;
        default:
          description = 'Net maaş ödemesi';
          lines = (amount) =>
            employeePaymentLines({ treasuryType: r.account.type, amount: amount.negated() });
      }
      const needsCheque = r.documentType.startsWith('CHEQUE_');
      return {
        source: TREASURY_SOURCES[r.documentType]!,
        sourceId: r.id,
        sourceNumber: r.documentNumber,
        description: description.replace(/ — $/, ''),
        date: r.txDate,
        amount: signed.abs(),
        wanted: !r.reversal,
        reverseDate: r.reversal?.txDate ?? accountingToday(),
        ownerId: r.createdById,
        lines: async () => {
          if (needsCheque && !cheque) return null;
          const amount = await base();
          return amount ? lines(amount) : null;
        },
      };
    });
  }

  private async partnerOpenings(companyId: string): Promise<Candidate[]> {
    const rows = await this.prisma.partnerLedgerEntry.findMany({
      where: { companyId, documentType: LedgerDocumentType.OPENING, reversesId: null },
      include: {
        partner: { select: { title: true } },
        reversal: { select: { entryDate: true } },
      },
    });
    return rows.map((r) => ({
      source: JournalSource.PARTNER_OPENING,
      sourceId: r.id,
      sourceNumber: r.documentNumber,
      description: `Cari açılış bakiyesi — ${r.partner.title}`,
      date: r.entryDate,
      amount: r.debitBase.plus(r.creditBase),
      wanted: !r.reversal,
      reverseDate: r.reversal?.entryDate ?? accountingToday(),
      ownerId: r.createdById,
      lines: () =>
        Promise.resolve(
          partnerOpeningLines({ partnerId: r.partnerId, debit: r.debitBase, credit: r.creditBase }),
        ),
    }));
  }

  private async expenseReports(companyId: string): Promise<Candidate[]> {
    const rows = await this.prisma.expenseReport.findMany({
      where: { companyId, decidedAt: { not: null } },
      include: {
        employee: { select: { firstName: true, lastName: true } },
        lines: { select: { vatAmount: true, exchangeRate: true } },
      },
    });
    return rows.map((r) => {
      const vat = r.lines.reduce((sum, l) => sum.plus(toBase(l.vatAmount, l.exchangeRate)), ZERO);
      return {
        source: JournalSource.EXPENSE_REPORT,
        sourceId: r.id,
        sourceNumber: r.number,
        description: `Masraf formu — ${r.employee.firstName} ${r.employee.lastName}`,
        date: localDate(r.decidedAt!),
        amount: r.totalAmount,
        wanted: r.status === ExpenseReportStatus.APPROVED || r.status === ExpenseReportStatus.PAID,
        reverseDate: localDate(r.updatedAt),
        ownerId: r.createdById,
        lines: () =>
          Promise.resolve(
            expenseReportLines({ employeeId: r.employeeId, total: r.totalAmount, vat }),
          ),
      };
    });
  }

  /** Accrued at the end of the month (or on approval when the month is not over yet). */
  private async payrolls(companyId: string): Promise<Candidate[]> {
    const rows = await this.prisma.payrollPeriod.findMany({
      where: { companyId, imported: false },
    });
    const today = accountingToday();
    return rows.map((r) => {
      const monthEnd = new Date(Date.UTC(r.year, r.month, 0));
      const approved = r.approvedAt ? localDate(r.approvedAt) : today;
      return {
        source: JournalSource.PAYROLL,
        sourceId: r.id,
        sourceNumber: r.number,
        description: `${String(r.month).padStart(2, '0')}/${r.year} bordro tahakkuku`,
        date: monthEnd > today ? approved : monthEnd,
        amount: r.employerCostTotal,
        wanted: r.status === PayrollPeriodStatus.APPROVED || r.status === PayrollPeriodStatus.PAID,
        reverseDate: localDate(r.updatedAt),
        ownerId: r.approvedById ?? r.createdById,
        mutable: true,
        lines: () =>
          Promise.resolve(
            payrollLines({
              net: r.netTotal,
              tax: r.taxTotal,
              sgk: r.sgkTotal,
              deductions: r.deductionTotal,
            }),
          ),
      };
    });
  }

  /** Production records at the costs stored when the output was received. */
  private async production(companyId: string): Promise<Candidate[]> {
    const rows = await this.prisma.productionRecord.findMany({
      where: { companyId },
      include: { workOrder: { select: { number: true } } },
    });
    return rows.map((r) => ({
      source: JournalSource.PRODUCTION,
      sourceId: r.id,
      sourceNumber: r.number,
      description: `Üretim — iş emri ${r.workOrder.number}`,
      date: r.recordDate,
      amount: r.materialCost.plus(r.laborCost).plus(r.overheadCost),
      wanted: true,
      reverseDate: r.recordDate,
      ownerId: r.createdById,
      lines: () =>
        Promise.resolve(
          productionLines({
            material: r.materialCost,
            labor: r.laborCost,
            overhead: r.overheadCost,
          }),
        ),
    }));
  }

  // ---------- Lookups ----------

  /** Stock value moved in and out by each movement, at the recorded unit cost. */
  private async movementCosts(companyId: string): Promise<MovementCosts> {
    const rows = await this.prisma.$queryRaw<
      { movementId: string; increase: Prisma.Decimal | null; decrease: Prisma.Decimal | null }[]
    >`
      SELECT "movementId",
        SUM(CASE WHEN quantity > 0 THEN quantity * "unitCost" ELSE 0 END) AS increase,
        SUM(CASE WHEN quantity < 0 THEN -quantity * "unitCost" ELSE 0 END) AS decrease
      FROM stock_transactions WHERE "companyId" = ${companyId}::uuid
      GROUP BY "movementId"`;
    const round = (value: Prisma.Decimal | null) =>
      new Prisma.Decimal(value ?? 0).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return new Map(
      rows.map((r) => [r.movementId, { increase: round(r.increase), decrease: round(r.decrease) }]),
    );
  }

  /** Selling rate of the date (as documents use), else the closest later one. */
  private async rateOn(currencyCode: string, date: Date): Promise<Dec | null> {
    const rate =
      (await this.prisma.exchangeRate.findFirst({
        where: { currencyCode, rateDate: { lte: date } },
        orderBy: { rateDate: 'desc' },
      })) ??
      (await this.prisma.exchangeRate.findFirst({
        where: { currencyCode, rateDate: { gt: date } },
        orderBy: { rateDate: 'asc' },
      }));
    return rate?.selling ?? null;
  }
}

type MovementCosts = Map<string, { increase: Dec; decrease: Dec }>;
