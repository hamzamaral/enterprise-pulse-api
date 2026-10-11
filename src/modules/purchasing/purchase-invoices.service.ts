import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  LedgerDocumentType,
  PaymentStatus,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { PartnerLedgerService } from '../partners/partner-ledger.service';
import { PartnersService, SUPPLIER_TYPES } from '../partners/partners.service';
import {
  isStocked,
  qty,
  toLineDto,
  toTotalsDto,
  tradeVariantSelect,
  TradeService,
} from '../partners/trade.service';
import type {
  CancelDocumentDto,
  CreatePurchaseInvoiceDto,
  PurchaseInvoiceDetailDto,
  PurchaseInvoiceDto,
  PurchaseInvoiceQueryDto,
} from './dto/purchasing.dto';

const SORTABLE = ['number', 'invoiceDate', 'dueDate', 'grandTotal', 'createdAt'] as const;
const INVOICEABLE_ORDER = [
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
  PurchaseOrderStatus.RECEIVED,
] as PurchaseOrderStatus[];
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const listInclude = {
  partner: { select: { code: true, title: true } },
  order: { select: { number: true } },
} satisfies Prisma.PurchaseInvoiceInclude;

const detailInclude = {
  ...listInclude,
  createdBy: { select: { firstName: true, lastName: true } },
  lines: { include: { variant: { select: tradeVariantSelect } }, orderBy: { lineNo: 'asc' } },
} satisfies Prisma.PurchaseInvoiceInclude;

type ListRow = Prisma.PurchaseInvoiceGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.PurchaseInvoiceGetPayload<{ include: typeof detailInclude }>;

const today = () => parseDateOnly(new Date().toISOString().slice(0, 10));

/**
 * Purchase invoices (alış faturaları). Order lines are matched three ways: goods up to the
 * received quantity, services up to the ordered quantity, never invoiced twice. The grand
 * total is credited to the supplier's ledger with its due date.
 */
@Injectable()
export class PurchaseInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly partners: PartnersService,
    private readonly ledger: PartnerLedgerService,
    private readonly trade: TradeService,
  ) {}

  async findAll(companyId: string, query: PurchaseInvoiceQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.PurchaseInvoiceWhereInput = {
      companyId,
      status: query.status,
      paymentStatus: query.paymentStatus,
      partnerId: query.partnerId,
      orderId: query.orderId,
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { supplierInvoiceNo: { contains: search, mode: 'insensitive' } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseInvoice.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.purchaseInvoice.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<PurchaseInvoiceDetailDto> {
    const row = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Purchase invoice not found');
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreatePurchaseInvoiceDto): Promise<PurchaseInvoiceDetailDto> {
    const { companyId } = user;
    const invoice = await this.prisma.$transaction(async (tx) => {
      const partner = await this.partners.getForDocument(
        tx,
        companyId,
        dto.partnerId,
        SUPPLIER_TYPES,
      );
      const supplierInvoiceNo = dto.supplierInvoiceNo.trim();
      const duplicate = await tx.purchaseInvoice.count({
        where: {
          companyId,
          partnerId: partner.id,
          supplierInvoiceNo,
          status: { not: InvoiceStatus.CANCELLED },
        },
      });
      if (duplicate) {
        throw new ConflictException(`Invoice ${supplierInvoiceNo} is already recorded`);
      }

      const order = dto.orderId
        ? await (async () => {
            await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${dto.orderId}::uuid FOR UPDATE`;
            return tx.purchaseOrder.findFirst({
              where: { id: dto.orderId, companyId },
              include: { lines: { include: { variant: { select: tradeVariantSelect } } } },
            });
          })()
        : null;
      if (dto.orderId) {
        if (!order) throw new BadRequestException('Purchase order not found');
        if (order.partnerId !== partner.id) {
          throw new BadRequestException('Order belongs to another supplier');
        }
        if (!INVOICEABLE_ORDER.includes(order.status)) {
          throw new ConflictException('Only approved orders can be invoiced');
        }
      }
      const orderLines = new Map(order?.lines.map((line) => [line.id, line]));
      const invoicing = new Map<string, Prisma.Decimal>();
      const inputs = dto.lines.map((input, index) => {
        if (!input.orderLineId) return input;
        const line = orderLines.get(input.orderLineId);
        if (!line) {
          throw new BadRequestException(`Line ${index + 1}: order line not found on this order`);
        }
        const total = (invoicing.get(line.id) ?? dec(0)).plus(input.quantity);
        const limit = isStocked(line.variant) ? line.receivedQty : line.quantity;
        const open = limit.minus(line.invoicedQty);
        if (total.greaterThan(open)) {
          throw new BadRequestException(
            `Line ${index + 1}: only ${qty(open.isNegative() ? 0 : open)} can be invoiced`,
          );
        }
        invoicing.set(line.id, total);
        return { ...input, variantId: line.variantId };
      });

      const invoiceDate = parseDateOnly(dto.invoiceDate);
      const dueDate = dto.dueDate
        ? parseDateOnly(dto.dueDate)
        : new Date(invoiceDate.getTime() + partner.paymentTermDays * 86_400_000);
      if (dueDate < invoiceDate) {
        throw new BadRequestException('Due date cannot be before the invoice date');
      }
      const currency = await this.trade.resolveCurrency(
        tx,
        companyId,
        dto.currencyCode ?? order?.currencyCode ?? partner.currencyCode,
        dto.exchangeRate,
        invoiceDate,
      );
      const variants = await this.trade.loadVariants(
        tx,
        companyId,
        inputs.map((l) => l.variantId),
      );
      const priced = this.trade.priceLines(inputs, variants);
      const number = await this.numbering.next(companyId, 'PURCHASE_INVOICE', tx);
      const created = await tx.purchaseInvoice.create({
        data: {
          companyId,
          number,
          supplierInvoiceNo,
          partnerId: partner.id,
          orderId: order?.id ?? null,
          invoiceDate,
          dueDate,
          currencyCode: currency.currencyCode,
          exchangeRate: currency.exchangeRate,
          status: InvoiceStatus.ISSUED,
          notes: dto.notes?.trim() || null,
          subtotal: priced.subtotal,
          discountTotal: priced.discountTotal,
          vatTotal: priced.vatTotal,
          grandTotal: priced.grandTotal,
          createdById: user.id,
          lines: {
            create: priced.lines.map((line, index) => ({
              ...line,
              orderLineId: inputs[index].orderLineId ?? null,
            })),
          },
        },
      });
      for (const [lineId, quantity] of invoicing) {
        await tx.purchaseOrderLine.update({
          where: { id: lineId },
          data: { invoicedQty: { increment: quantity } },
        });
      }
      if (priced.grandTotal.isPositive()) {
        await this.ledger.post(tx, user, {
          partnerId: partner.id,
          entryDate: invoiceDate,
          dueDate,
          documentType: LedgerDocumentType.PURCHASE_INVOICE,
          documentId: created.id,
          documentNumber: number,
          description: `Alış faturası ${supplierInvoiceNo}`,
          credit: priced.grandTotal,
          currencyCode: currency.currencyCode,
          exchangeRate: currency.exchangeRate,
        });
      }
      return created;
    });
    return this.findOne(companyId, invoice.id);
  }

  /** Cancels an unpaid invoice: the ledger entry is reversed and order lines reopen. */
  async cancel(
    user: AuthUser,
    id: string,
    dto: CancelDocumentDto,
  ): Promise<PurchaseInvoiceDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_invoices WHERE id = ${id}::uuid FOR UPDATE`;
      const invoice = await tx.purchaseInvoice.findFirst({
        where: { id, companyId },
        include: { lines: { select: { orderLineId: true, quantity: true } } },
      });
      if (!invoice) throw new NotFoundException('Purchase invoice not found');
      if (invoice.status !== InvoiceStatus.ISSUED) {
        throw new ConflictException('Invoice is already cancelled');
      }
      if (!invoice.paidAmount.isZero()) {
        throw new ConflictException('Invoice has payments; remove them first');
      }
      for (const line of invoice.lines) {
        if (!line.orderLineId) continue;
        await tx.purchaseOrderLine.update({
          where: { id: line.orderLineId },
          data: { invoicedQty: { decrement: line.quantity } },
        });
      }
      const reason = dto.reason?.trim();
      await this.ledger.reverse(
        tx,
        user,
        LedgerDocumentType.PURCHASE_INVOICE,
        invoice.id,
        today(),
        `İptal: ${invoice.number}${reason ? ` — ${reason}` : ''}`,
      );
      await tx.purchaseInvoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.CANCELLED,
          cancelledAt: new Date(),
          ...(reason && {
            notes: invoice.notes ? `${invoice.notes}\n[İptal] ${reason}` : `[İptal] ${reason}`,
          }),
        },
      });
    });
    return this.findOne(companyId, id);
  }
}

export function isOverdue(row: {
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
  dueDate: Date;
}): boolean {
  return (
    row.status === InvoiceStatus.ISSUED &&
    row.paymentStatus !== PaymentStatus.PAID &&
    row.dueDate < today()
  );
}

function toDto(row: ListRow): PurchaseInvoiceDto {
  return {
    id: row.id,
    number: row.number,
    supplierInvoiceNo: row.supplierInvoiceNo,
    partnerId: row.partnerId,
    partnerCode: row.partner.code,
    partnerTitle: row.partner.title,
    orderId: row.orderId,
    orderNumber: row.order?.number ?? null,
    invoiceDate: toDateOnly(row.invoiceDate),
    dueDate: toDateOnly(row.dueDate),
    currencyCode: row.currencyCode,
    exchangeRate: row.exchangeRate.toFixed(4),
    status: row.status,
    paymentStatus: row.paymentStatus,
    paidAmount: row.paidAmount.toFixed(2),
    overdue: isOverdue(row),
    createdAt: row.createdAt,
    ...toTotalsDto(row),
  };
}

function toDetailDto(row: DetailRow): PurchaseInvoiceDetailDto {
  return {
    ...toDto(row),
    notes: row.notes,
    lines: row.lines.map((line) => ({ ...toLineDto(line), orderLineId: line.orderLineId })),
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    cancelledAt: row.cancelledAt,
  };
}
