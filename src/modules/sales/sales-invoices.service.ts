import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, LedgerDocumentType, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import type { CancelDocumentDto } from '../partners/dto/trade.dto';
import { PartnerLedgerService } from '../partners/partner-ledger.service';
import { CUSTOMER_TYPES, PartnersService } from '../partners/partners.service';
import {
  isOverdue,
  isStocked,
  qty,
  toLineDto,
  toTotalsDto,
  tradeVariantSelect,
  TradeService,
} from '../partners/trade.service';
import type {
  CreateSalesInvoiceDto,
  SalesInvoiceDetailDto,
  SalesInvoiceDto,
  SalesInvoiceQueryDto,
} from './dto/sales.dto';
import { OPEN_ORDER_STATUSES } from './sales-orders.service';

const SORTABLE = ['number', 'invoiceDate', 'dueDate', 'grandTotal', 'createdAt'] as const;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const listInclude = {
  partner: { select: { code: true, title: true } },
  order: { select: { number: true } },
} satisfies Prisma.SalesInvoiceInclude;

const detailInclude = {
  partner: {
    select: {
      code: true,
      title: true,
      address: true,
      city: true,
      taxNumber: true,
      taxOffice: true,
    },
  },
  order: { select: { number: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  lines: { include: { variant: { select: tradeVariantSelect } }, orderBy: { lineNo: 'asc' } },
  returns: {
    select: { id: true, number: true, returnDate: true, grandTotal: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.SalesInvoiceInclude;

type ListRow = Prisma.SalesInvoiceGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.SalesInvoiceGetPayload<{ include: typeof detailInclude }>;

const today = () => parseDateOnly(new Date().toISOString().slice(0, 10));

/**
 * Sales invoices (satış faturaları). Goods are invoiced up to the delivered quantity, services
 * up to the ordered quantity; goods cannot be invoiced without an order (they would never
 * leave stock). The grand total is debited to the customer's ledger with its due date.
 */
@Injectable()
export class SalesInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly partners: PartnersService,
    private readonly ledger: PartnerLedgerService,
    private readonly trade: TradeService,
  ) {}

  async findAll(companyId: string, query: SalesInvoiceQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.SalesInvoiceWhereInput = {
      companyId,
      status: query.status,
      paymentStatus: query.paymentStatus,
      partnerId: query.partnerId,
      orderId: query.orderId,
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
          { order: { number: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.salesInvoice.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.salesInvoice.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<SalesInvoiceDetailDto> {
    const row = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Sales invoice not found');
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreateSalesInvoiceDto): Promise<SalesInvoiceDetailDto> {
    const { companyId } = user;
    const invoice = await this.prisma.$transaction(async (tx) => {
      const partner = await this.partners.getForDocument(
        tx,
        companyId,
        dto.partnerId,
        CUSTOMER_TYPES,
      );
      const order = dto.orderId
        ? await (async () => {
            await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${dto.orderId}::uuid FOR UPDATE`;
            return tx.salesOrder.findFirst({
              where: { id: dto.orderId, companyId },
              include: { lines: { include: { variant: { select: tradeVariantSelect } } } },
            });
          })()
        : null;
      if (dto.orderId) {
        if (!order) throw new BadRequestException('Sales order not found');
        if (order.partnerId !== partner.id) {
          throw new BadRequestException('Order belongs to another customer');
        }
        if (!OPEN_ORDER_STATUSES.includes(order.status)) {
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
        const limit = isStocked(line.variant) ? line.deliveredQty : line.quantity;
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
      inputs.forEach((input, index) => {
        const orderLineId = 'orderLineId' in input ? input.orderLineId : undefined;
        if (!orderLineId && isStocked(variants.get(input.variantId ?? ''))) {
          throw new BadRequestException(
            `Line ${index + 1}: goods are invoiced from an order after delivery`,
          );
        }
      });
      const priced = this.trade.priceLines(inputs, variants);
      const number = await this.numbering.next(companyId, 'SALES_INVOICE', tx);
      const created = await tx.salesInvoice.create({
        data: {
          companyId,
          number,
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
              orderLineId: dto.lines[index].orderLineId ?? null,
            })),
          },
        },
      });
      for (const [lineId, quantity] of invoicing) {
        await tx.salesOrderLine.update({
          where: { id: lineId },
          data: { invoicedQty: { increment: quantity } },
        });
      }
      if (priced.grandTotal.greaterThan(0)) {
        await this.ledger.post(tx, user, {
          partnerId: partner.id,
          entryDate: invoiceDate,
          dueDate,
          documentType: LedgerDocumentType.SALES_INVOICE,
          documentId: created.id,
          documentNumber: number,
          description: order ? `Satış faturası (${order.number})` : 'Satış faturası',
          debit: priced.grandTotal,
          currencyCode: currency.currencyCode,
          exchangeRate: currency.exchangeRate,
        });
      }
      return created;
    });
    return this.findOne(companyId, invoice.id);
  }

  /** Cancels an invoice without collections or returns: reversed in the ledger, lines reopen. */
  async cancel(user: AuthUser, id: string, dto: CancelDocumentDto): Promise<SalesInvoiceDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id = ${id}::uuid FOR UPDATE`;
      const invoice = await tx.salesInvoice.findFirst({
        where: { id, companyId },
        include: {
          lines: { select: { orderLineId: true, quantity: true } },
          _count: { select: { returns: true } },
        },
      });
      if (!invoice) throw new NotFoundException('Sales invoice not found');
      if (invoice.status !== InvoiceStatus.ISSUED) {
        throw new ConflictException('Invoice is already cancelled');
      }
      if (invoice._count.returns) {
        throw new ConflictException('Invoice has returns');
      }
      if (!invoice.paidAmount.isZero()) {
        throw new ConflictException('Invoice has collections; remove them first');
      }
      for (const line of invoice.lines) {
        if (!line.orderLineId) continue;
        await tx.salesOrderLine.update({
          where: { id: line.orderLineId },
          data: { invoicedQty: { decrement: line.quantity } },
        });
      }
      const reason = dto.reason?.trim();
      await this.ledger.reverse(
        tx,
        user,
        LedgerDocumentType.SALES_INVOICE,
        invoice.id,
        today(),
        `İptal: ${invoice.number}${reason ? ` — ${reason}` : ''}`,
      );
      await tx.salesInvoice.update({
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

function toDto(row: ListRow): SalesInvoiceDto {
  return {
    id: row.id,
    number: row.number,
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

function toDetailDto(row: DetailRow): SalesInvoiceDetailDto {
  return {
    ...toDto(row),
    notes: row.notes,
    partnerAddress: [row.partner.address, row.partner.city].filter(Boolean).join(', ') || null,
    partnerTaxNumber: row.partner.taxNumber,
    partnerTaxOffice: row.partner.taxOffice,
    lines: row.lines.map((line) => ({
      ...toLineDto(line),
      orderLineId: line.orderLineId,
      trackingType: line.variant?.product.trackingType ?? null,
      returnedQty: qty(line.returnedQty),
    })),
    returns: row.returns.map((r) => ({
      id: r.id,
      number: r.number,
      date: toDateOnly(r.returnDate),
      status: 'POSTED',
      total: r.grandTotal.toFixed(2),
    })),
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    cancelledAt: row.cancelledAt,
  };
}
