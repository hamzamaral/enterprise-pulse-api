import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChequeDirection,
  ChequeKind,
  ChequeStatus,
  InvoiceStatus,
  LedgerDocumentType,
  PaymentDirection,
  PaymentMethod,
  PaymentRecordStatus,
  PaymentStatus,
  Prisma,
  TreasuryAccountType,
  TreasuryDocumentType,
  type BusinessPartner,
  type PartnerPayment,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { toBase } from '../../common/money/document-totals';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import type { CancelDocumentDto } from '../partners/dto/trade.dto';
import { PartnerLedgerService } from '../partners/partner-ledger.service';
import { CUSTOMER_TYPES, PartnersService, SUPPLIER_TYPES } from '../partners/partners.service';
import { isOverdue, paymentStatusOf, TradeService } from '../partners/trade.service';
import type {
  AllocationInputDto,
  CreatePaymentDto,
  OpenInvoiceDto,
  OpenInvoicesQueryDto,
  PaymentDetailDto,
  PaymentDto,
  PaymentQueryDto,
} from './dto/finance.dto';
import { allocateFifo, type Allocation } from './finance-math';
import { TreasuryService } from './treasury.service';

const SORTABLE = ['number', 'paymentDate', 'amount', 'amountBase', 'createdAt'] as const;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const today = () => parseDateOnly(new Date().toISOString().slice(0, 10));

const listInclude = {
  partner: { select: { code: true, title: true } },
  account: { select: { name: true } },
  originCheque: { select: { id: true, number: true } },
  endorsedCheque: { select: { id: true, number: true } },
  allocations: { select: { amount: true } },
} satisfies Prisma.PartnerPaymentInclude;

const detailInclude = {
  ...listInclude,
  createdBy: { select: { firstName: true, lastName: true } },
  allocations: {
    include: {
      salesInvoice: {
        select: { id: true, number: true, invoiceDate: true, dueDate: true, grandTotal: true },
      },
      purchaseInvoice: {
        select: { id: true, number: true, invoiceDate: true, dueDate: true, grandTotal: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PartnerPaymentInclude;

type ListRow = Prisma.PartnerPaymentGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.PartnerPaymentGetPayload<{ include: typeof detailInclude }>;

interface InvoiceRow {
  id: string;
  number: string;
  invoiceDate: Date;
  dueDate: Date;
  currencyCode: string;
  grandTotal: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Nakit',
  BANK: 'Banka',
  CHEQUE: 'Çek',
  NOTE: 'Senet',
};

/**
 * Collections (tahsilat, TAH) and payments (ödeme, ODM). A payment credits (IN) or debits (OUT)
 * the partner ledger, moves cash / bank money or creates / endorses a cheque, and settles open
 * invoices of the same currency — explicitly or oldest due date first.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly partners: PartnersService,
    private readonly ledger: PartnerLedgerService,
    private readonly trade: TradeService,
    private readonly treasury: TreasuryService,
  ) {}

  async findAll(companyId: string, query: PaymentQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.PartnerPaymentWhereInput = {
      companyId,
      direction: query.direction,
      method: query.method,
      status: query.status,
      partnerId: query.partnerId,
      accountId: query.accountId,
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.partnerPayment.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.partnerPayment.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<PaymentDetailDto> {
    const row = await this.prisma.partnerPayment.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Payment not found');
    return toDetailDto(row);
  }

  /** Issued, not fully settled invoices a payment can be allocated to. */
  async openInvoices(companyId: string, query: OpenInvoicesQueryDto): Promise<OpenInvoiceDto[]> {
    const rows = await this.loadOpenInvoices(
      this.prisma,
      companyId,
      query.partnerId,
      query.direction,
      query.currencyCode,
    );
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      invoiceDate: toDateOnly(row.invoiceDate),
      dueDate: toDateOnly(row.dueDate),
      currencyCode: row.currencyCode,
      grandTotal: row.grandTotal.toFixed(2),
      paidAmount: row.paidAmount.toFixed(2),
      remaining: row.grandTotal.minus(row.paidAmount).toFixed(2),
      paymentStatus: row.paymentStatus,
      overdue: isOverdue(row),
    }));
  }

  async create(user: AuthUser, dto: CreatePaymentDto): Promise<PaymentDetailDto> {
    const { companyId } = user;
    const incoming = dto.direction === PaymentDirection.IN;
    const isPaper = dto.method === PaymentMethod.CHEQUE || dto.method === PaymentMethod.NOTE;
    if (!isPaper && (dto.cheque || dto.endorseChequeId)) {
      throw new BadRequestException('Cheque details are only valid for cheque or note payments');
    }
    if (isPaper && !dto.cheque === !dto.endorseChequeId) {
      throw new BadRequestException('Enter the cheque details or pick a portfolio cheque');
    }
    if (dto.endorseChequeId && incoming) {
      throw new BadRequestException('Only payments can endorse a portfolio cheque');
    }
    if (!dto.endorseChequeId && dto.amount === undefined) {
      throw new BadRequestException('Amount is required');
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const partner = await this.partners.getForDocument(
        tx,
        companyId,
        dto.partnerId,
        incoming ? CUSTOMER_TYPES : SUPPLIER_TYPES,
      );
      const paymentDate = parseDateOnly(dto.paymentDate);

      let amount = dec(dto.amount ?? 0);
      let currencyCode = dto.currencyCode ?? partner.currencyCode;
      let accountId: string | null = null;

      const endorsed = dto.endorseChequeId
        ? await this.lockPortfolioCheque(tx, companyId, dto.endorseChequeId)
        : null;
      if (endorsed) {
        const kind = dto.method === PaymentMethod.NOTE ? ChequeKind.NOTE : ChequeKind.CHEQUE;
        if (endorsed.kind !== kind) {
          throw new BadRequestException('Payment method does not match the cheque kind');
        }
        if (endorsed.partnerId === partner.id) {
          throw new BadRequestException('A cheque cannot be endorsed back to its drawer');
        }
        amount = endorsed.amount;
        currencyCode = endorsed.currencyCode;
      }

      const needsAccount =
        !isPaper || (!incoming && dto.method === PaymentMethod.CHEQUE && !endorsed);
      if (needsAccount && !dto.accountId) {
        throw new BadRequestException(
          dto.method === PaymentMethod.CHEQUE
            ? 'Pick the bank the cheque is drawn on'
            : 'Pick an account',
        );
      }
      if (dto.accountId && (needsAccount || (!incoming && dto.method === PaymentMethod.NOTE))) {
        const account = await this.treasury.lockAccount(tx, companyId, dto.accountId);
        const expected =
          dto.method === PaymentMethod.CASH ? TreasuryAccountType.CASH : TreasuryAccountType.BANK;
        if (account.type !== expected) {
          throw new BadRequestException(
            expected === TreasuryAccountType.CASH ? 'Pick a cash account' : 'Pick a bank account',
          );
        }
        if (dto.currencyCode && dto.currencyCode !== account.currencyCode) {
          throw new BadRequestException(`${account.name} is kept in ${account.currencyCode}`);
        }
        currencyCode = account.currencyCode;
        accountId = account.id;
      }

      if (dto.cheque) {
        const dueDate = parseDateOnly(dto.cheque.dueDate);
        if (dueDate < paymentDate) {
          throw new BadRequestException('Due date cannot be before the payment date');
        }
      }

      const currency = await this.trade.resolveCurrency(
        tx,
        companyId,
        currencyCode,
        dto.exchangeRate,
        paymentDate,
      );
      const documentType = incoming ? LedgerDocumentType.COLLECTION : LedgerDocumentType.PAYMENT;
      const number = await this.numbering.next(companyId, documentType, tx);
      const description = dto.description?.trim() || null;
      const created = await tx.partnerPayment.create({
        data: {
          companyId,
          number,
          direction: dto.direction,
          method: dto.method,
          partnerId: partner.id,
          paymentDate,
          accountId,
          amount,
          currencyCode: currency.currencyCode,
          exchangeRate: currency.exchangeRate,
          amountBase: toBase(amount, currency.exchangeRate),
          description,
          createdById: user.id,
        },
      });

      const label = `${incoming ? 'Tahsilat' : 'Ödeme'} — ${METHOD_LABEL[dto.method]}`;
      await this.ledger.post(tx, user, {
        partnerId: partner.id,
        entryDate: paymentDate,
        documentType,
        documentId: created.id,
        documentNumber: number,
        description: description ? `${label}: ${description}` : label,
        ...(incoming ? { credit: amount } : { debit: amount }),
        currencyCode: currency.currencyCode,
        exchangeRate: currency.exchangeRate,
      });

      if (!isPaper) {
        await this.treasury.post(tx, user, {
          accountId: accountId!,
          txDate: paymentDate,
          documentType: incoming ? TreasuryDocumentType.COLLECTION : TreasuryDocumentType.PAYMENT,
          documentId: created.id,
          documentNumber: number,
          description: partner.title,
          ...(incoming ? { amountIn: amount } : { amountOut: amount }),
        });
      } else if (endorsed) {
        await tx.cheque.update({
          where: { id: endorsed.id },
          data: {
            status: ChequeStatus.ENDORSED,
            endorsedToId: partner.id,
            endorsementPaymentId: created.id,
          },
        });
        await tx.chequeEvent.create({
          data: {
            chequeId: endorsed.id,
            eventDate: paymentDate,
            fromStatus: endorsed.status,
            toStatus: ChequeStatus.ENDORSED,
            partnerId: partner.id,
            note: `Ciro: ${number}`,
            createdById: user.id,
          },
        });
      } else {
        await this.createCheque(tx, user, created, partner, dto);
      }

      await this.allocate(tx, created, dto.allocations);
      return created;
    });
    return this.findOne(companyId, payment.id);
  }

  /**
   * Cancels a payment: ledger and cash / bank are reversed and invoices reopen. A cheque it
   * created must still be untouched (it is cancelled too); an endorsed cheque returns to the
   * portfolio.
   */
  async cancel(user: AuthUser, id: string, dto: CancelDocumentDto): Promise<PaymentDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPayment(tx, companyId, id);
      const reason = dto.reason?.trim();
      const description = `İptal: ${payment.number}${reason ? ` — ${reason}` : ''}`;

      const origin = await tx.cheque.findUnique({ where: { originPaymentId: payment.id } });
      if (origin) {
        await tx.$queryRaw`SELECT id FROM cheques WHERE id = ${origin.id}::uuid FOR UPDATE`;
        const untouched =
          origin.direction === ChequeDirection.RECEIVED
            ? origin.status === ChequeStatus.PORTFOLIO
            : origin.status === ChequeStatus.ISSUED;
        if (!untouched) {
          throw new ConflictException(`Cheque ${origin.number} has already moved on`);
        }
        await tx.cheque.update({
          where: { id: origin.id },
          data: { status: ChequeStatus.CANCELLED },
        });
        await tx.chequeEvent.create({
          data: {
            chequeId: origin.id,
            eventDate: today(),
            fromStatus: origin.status,
            toStatus: ChequeStatus.CANCELLED,
            note: description,
            createdById: user.id,
          },
        });
      }

      const endorsed = await tx.cheque.findUnique({ where: { endorsementPaymentId: payment.id } });
      if (endorsed) {
        await tx.$queryRaw`SELECT id FROM cheques WHERE id = ${endorsed.id}::uuid FOR UPDATE`;
        await tx.cheque.update({
          where: { id: endorsed.id },
          data: {
            status: ChequeStatus.PORTFOLIO,
            endorsedToId: null,
            endorsementPaymentId: null,
          },
        });
        await tx.chequeEvent.create({
          data: {
            chequeId: endorsed.id,
            eventDate: today(),
            fromStatus: endorsed.status,
            toStatus: ChequeStatus.PORTFOLIO,
            note: description,
            createdById: user.id,
          },
        });
      }

      await this.voidPayment(tx, user, payment, description);
    });
    return this.findOne(companyId, id);
  }

  /** Reverses the ledger and cash / bank postings, releases allocations, marks it cancelled. */
  async voidPayment(
    tx: PrismaTx,
    user: AuthUser,
    payment: PartnerPayment,
    description: string,
  ): Promise<void> {
    const incoming = payment.direction === PaymentDirection.IN;
    await this.ledger.reverse(
      tx,
      user,
      incoming ? LedgerDocumentType.COLLECTION : LedgerDocumentType.PAYMENT,
      payment.id,
      today(),
      description,
    );
    await this.treasury.reverse(
      tx,
      user,
      incoming ? TreasuryDocumentType.COLLECTION : TreasuryDocumentType.PAYMENT,
      payment.id,
      today(),
      description,
    );
    await this.release(tx, payment);
    await tx.partnerPayment.update({
      where: { id: payment.id },
      data: { status: PaymentRecordStatus.CANCELLED, cancelledAt: new Date() },
    });
  }

  async lockPayment(tx: PrismaTx, companyId: string, id: string): Promise<PartnerPayment> {
    await tx.$queryRaw`SELECT id FROM partner_payments WHERE id = ${id}::uuid FOR UPDATE`;
    const payment = await tx.partnerPayment.findFirst({ where: { id, companyId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== PaymentRecordStatus.POSTED) {
      throw new ConflictException('Payment is already cancelled');
    }
    return payment;
  }

  private async lockPortfolioCheque(tx: PrismaTx, companyId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM cheques WHERE id = ${id}::uuid FOR UPDATE`;
    const cheque = await tx.cheque.findFirst({ where: { id, companyId } });
    if (!cheque) throw new BadRequestException('Cheque not found');
    if (cheque.direction !== ChequeDirection.RECEIVED || cheque.status !== ChequeStatus.PORTFOLIO) {
      throw new ConflictException(`Cheque ${cheque.number} is not in the portfolio`);
    }
    return cheque;
  }

  private async createCheque(
    tx: PrismaTx,
    user: AuthUser,
    payment: PartnerPayment,
    partner: BusinessPartner,
    dto: CreatePaymentDto,
  ): Promise<void> {
    const input = dto.cheque!;
    const kind = dto.method === PaymentMethod.NOTE ? ChequeKind.NOTE : ChequeKind.CHEQUE;
    const received = payment.direction === PaymentDirection.IN;
    const status = received ? ChequeStatus.PORTFOLIO : ChequeStatus.ISSUED;
    const account = payment.accountId
      ? await tx.treasuryAccount.findUniqueOrThrow({ where: { id: payment.accountId } })
      : null;
    const number = await this.numbering.next(
      user.companyId,
      kind === ChequeKind.NOTE ? 'PROMISSORY_NOTE' : 'CHEQUE',
      tx,
    );
    await tx.cheque.create({
      data: {
        companyId: user.companyId,
        number,
        kind,
        direction: received ? ChequeDirection.RECEIVED : ChequeDirection.ISSUED,
        status,
        serialNo: input.serialNo.trim(),
        bankName: input.bankName?.trim() || account?.bankName || null,
        branchName: input.branchName?.trim() || account?.branchName || null,
        drawer: input.drawer?.trim() || (received ? partner.title : null),
        issueDate: payment.paymentDate,
        dueDate: parseDateOnly(input.dueDate),
        amount: payment.amount,
        currencyCode: payment.currencyCode,
        exchangeRate: payment.exchangeRate,
        partnerId: partner.id,
        accountId: payment.accountId,
        originPaymentId: payment.id,
        events: {
          create: {
            eventDate: payment.paymentDate,
            toStatus: status,
            accountId: payment.accountId,
            partnerId: partner.id,
            note: payment.number,
            createdById: user.id,
          },
        },
      },
    });
  }

  /** Settles open invoices of the payment's partner and currency; the rest stays on account. */
  private async allocate(
    tx: PrismaTx,
    payment: PartnerPayment,
    inputs: AllocationInputDto[] | undefined,
  ): Promise<void> {
    const incoming = payment.direction === PaymentDirection.IN;
    const open = await this.loadOpenInvoices(
      tx,
      payment.companyId,
      payment.partnerId,
      payment.direction,
      payment.currencyCode,
      true,
    );
    const byId = new Map(open.map((row) => [row.id, row]));
    let allocations: Allocation[];
    if (inputs) {
      const seen = new Set<string>();
      let total = dec(0);
      allocations = inputs.map((input) => {
        const invoice = byId.get(input.invoiceId);
        if (!invoice) {
          throw new BadRequestException(
            `Invoice ${input.invoiceId} is not open for this partner in ${payment.currencyCode}`,
          );
        }
        if (seen.has(invoice.id))
          throw new BadRequestException(`${invoice.number} is listed twice`);
        seen.add(invoice.id);
        const amount = dec(input.amount);
        const remaining = invoice.grandTotal.minus(invoice.paidAmount);
        if (amount.greaterThan(remaining)) {
          throw new BadRequestException(`${invoice.number}: only ${remaining.toFixed(2)} is open`);
        }
        total = total.plus(amount);
        return { invoiceId: invoice.id, amount };
      });
      if (total.greaterThan(payment.amount)) {
        throw new BadRequestException('Allocations exceed the payment amount');
      }
    } else {
      allocations = allocateFifo(
        payment.amount,
        open.map((row) => ({
          id: row.id,
          dueDate: row.dueDate,
          remaining: row.grandTotal.minus(row.paidAmount),
        })),
      );
    }

    for (const allocation of allocations) {
      const invoice = byId.get(allocation.invoiceId)!;
      const paid = invoice.paidAmount.plus(allocation.amount);
      const data = { paidAmount: paid, paymentStatus: paymentStatusOf(paid, invoice.grandTotal) };
      await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          amount: allocation.amount,
          ...(incoming ? { salesInvoiceId: invoice.id } : { purchaseInvoiceId: invoice.id }),
        },
      });
      if (incoming) await tx.salesInvoice.update({ where: { id: invoice.id }, data });
      else await tx.purchaseInvoice.update({ where: { id: invoice.id }, data });
    }
  }

  /** Gives the allocated amounts back to their invoices. */
  private async release(tx: PrismaTx, payment: PartnerPayment): Promise<void> {
    const allocations = await tx.paymentAllocation.findMany({ where: { paymentId: payment.id } });
    for (const allocation of allocations) {
      if (allocation.salesInvoiceId) {
        const id = allocation.salesInvoiceId;
        await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id = ${id}::uuid FOR UPDATE`;
        const invoice = await tx.salesInvoice.findUniqueOrThrow({ where: { id } });
        const paid = Prisma.Decimal.max(invoice.paidAmount.minus(allocation.amount), 0);
        await tx.salesInvoice.update({
          where: { id },
          data: { paidAmount: paid, paymentStatus: paymentStatusOf(paid, invoice.grandTotal) },
        });
      } else if (allocation.purchaseInvoiceId) {
        const id = allocation.purchaseInvoiceId;
        await tx.$queryRaw`SELECT id FROM purchase_invoices WHERE id = ${id}::uuid FOR UPDATE`;
        const invoice = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id } });
        const paid = Prisma.Decimal.max(invoice.paidAmount.minus(allocation.amount), 0);
        await tx.purchaseInvoice.update({
          where: { id },
          data: { paidAmount: paid, paymentStatus: paymentStatusOf(paid, invoice.grandTotal) },
        });
      }
    }
  }

  /** Sales invoices for collections, purchase invoices for payments; locked when `lock`. */
  private async loadOpenInvoices(
    client: PrismaTx | PrismaService,
    companyId: string,
    partnerId: string,
    direction: PaymentDirection,
    currencyCode?: string,
    lock = false,
  ): Promise<InvoiceRow[]> {
    const where = {
      companyId,
      partnerId,
      currencyCode,
      status: InvoiceStatus.ISSUED,
      paymentStatus: { not: PaymentStatus.PAID },
    };
    const select = {
      id: true,
      number: true,
      invoiceDate: true,
      dueDate: true,
      currencyCode: true,
      grandTotal: true,
      paidAmount: true,
      status: true,
      paymentStatus: true,
    } as const;
    const orderBy = [{ dueDate: 'asc' as const }, { number: 'asc' as const }];
    if (direction === PaymentDirection.IN) {
      if (lock) {
        await client.$queryRaw`SELECT id FROM sales_invoices
          WHERE "companyId" = ${companyId}::uuid AND "partnerId" = ${partnerId}::uuid
            AND status = 'ISSUED' AND "paymentStatus" <> 'PAID' FOR UPDATE`;
      }
      return client.salesInvoice.findMany({ where, select, orderBy });
    }
    if (lock) {
      await client.$queryRaw`SELECT id FROM purchase_invoices
        WHERE "companyId" = ${companyId}::uuid AND "partnerId" = ${partnerId}::uuid
          AND status = 'ISSUED' AND "paymentStatus" <> 'PAID' FOR UPDATE`;
    }
    return client.purchaseInvoice.findMany({ where, select, orderBy });
  }
}

function toDto(row: ListRow): PaymentDto {
  const cheque = row.originCheque ?? row.endorsedCheque;
  return {
    id: row.id,
    number: row.number,
    direction: row.direction,
    method: row.method,
    status: row.status,
    partnerId: row.partnerId,
    partnerCode: row.partner.code,
    partnerTitle: row.partner.title,
    paymentDate: toDateOnly(row.paymentDate),
    accountId: row.accountId,
    accountName: row.account?.name ?? null,
    amount: row.amount.toFixed(2),
    currencyCode: row.currencyCode,
    exchangeRate: row.exchangeRate.toFixed(4),
    amountBase: row.amountBase.toFixed(2),
    allocatedAmount: row.allocations.reduce((sum, a) => sum.plus(a.amount), dec(0)).toFixed(2),
    chequeId: cheque?.id ?? null,
    chequeNumber: cheque?.number ?? null,
    description: row.description,
    createdAt: row.createdAt,
  };
}

function toDetailDto(row: DetailRow): PaymentDetailDto {
  return {
    ...toDto(row),
    allocations: row.allocations.map((a) => {
      const invoice = (a.salesInvoice ?? a.purchaseInvoice)!;
      return {
        id: a.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        invoiceDate: toDateOnly(invoice.invoiceDate),
        dueDate: toDateOnly(invoice.dueDate),
        invoiceTotal: invoice.grandTotal.toFixed(2),
        amount: a.amount.toFixed(2),
      };
    }),
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    cancelledAt: row.cancelledAt,
  };
}
