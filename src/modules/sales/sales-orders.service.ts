import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, SalesOrderStatus } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { toBase } from '../../common/money/document-totals';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { PartnerLedgerService } from '../partners/partner-ledger.service';
import { CUSTOMER_TYPES, PartnersService } from '../partners/partners.service';
import {
  isStocked,
  qty,
  toLineDto,
  toTotalsDto,
  tradeVariantSelect,
  TradeService,
} from '../partners/trade.service';
import type { CancelDocumentDto } from '../partners/dto/trade.dto';
import type {
  CreateSalesOrderDto,
  CreditCheckDto,
  SalesOrderDetailDto,
  SalesOrderDto,
  SalesOrderQueryDto,
  UpdateSalesOrderDto,
} from './dto/sales.dto';

const SORTABLE = ['number', 'orderDate', 'deliveryDate', 'grandTotal', 'createdAt'] as const;
export const OPEN_ORDER_STATUSES = [
  SalesOrderStatus.APPROVED,
  SalesOrderStatus.PARTIALLY_DELIVERED,
  SalesOrderStatus.DELIVERED,
] as SalesOrderStatus[];
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const listInclude = {
  partner: { select: { code: true, title: true } },
  warehouse: { select: { name: true } },
  quote: { select: { number: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  approvedBy: { select: { firstName: true, lastName: true } },
  lines: { select: { quantity: true, deliveredQty: true } },
} satisfies Prisma.SalesOrderInclude;

const detailInclude = {
  ...listInclude,
  partner: { select: { code: true, title: true, creditLimit: true } },
  lines: {
    include: {
      variant: { select: tradeVariantSelect },
      reservation: { select: { quantity: true } },
    },
    orderBy: { lineNo: 'asc' },
  },
  deliveries: {
    select: { id: true, number: true, deliveryDate: true },
    orderBy: { createdAt: 'asc' },
  },
  invoices: {
    select: { id: true, number: true, invoiceDate: true, status: true, grandTotal: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.SalesOrderInclude;

type ListRow = Prisma.SalesOrderGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.SalesOrderGetPayload<{ include: typeof detailInclude }>;

interface ValuedOrder {
  exchangeRate: Prisma.Decimal;
  lines: { quantity: Prisma.Decimal; invoicedQty: Prisma.Decimal; lineTotal: Prisma.Decimal }[];
}

/** Value of the not yet invoiced quantities of an order, in base currency. */
export function uninvoicedBase(order: ValuedOrder): Prisma.Decimal {
  const total = order.lines.reduce((sum, line) => {
    if (line.quantity.isZero()) return sum;
    const open = Prisma.Decimal.max(line.quantity.minus(line.invoicedQty), 0);
    return sum.plus(line.lineTotal.times(open).dividedBy(line.quantity));
  }, dec(0));
  return toBase(total, order.exchangeRate);
}

/**
 * Sales orders (SPS). Approval checks the customer's credit limit and reserves stock in the
 * shipping warehouse; deliveries consume the reservations and invoices follow deliveries.
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly partners: PartnersService,
    private readonly ledger: PartnerLedgerService,
    private readonly trade: TradeService,
  ) {}

  async findAll(companyId: string, query: SalesOrderQueryDto) {
    const search = query.search?.trim();
    const openIds = query.open ? await this.openOrderIds(companyId) : undefined;
    const where: Prisma.SalesOrderWhereInput = {
      companyId,
      status: query.status,
      partnerId: query.partnerId,
      ...(openIds && { id: { in: openIds } }),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { customerRef: { contains: search, mode: 'insensitive' } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.salesOrder.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<SalesOrderDetailDto> {
    const row = await this.prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Sales order not found');
    const credit = await this.creditCheck(this.prisma, companyId, row);
    return toDetailDto(row, credit);
  }

  async create(user: AuthUser, dto: CreateSalesOrderDto): Promise<SalesOrderDetailDto> {
    const { companyId } = user;
    const order = await this.prisma.$transaction(async (tx) => {
      const partner = await this.partners.getForDocument(
        tx,
        companyId,
        dto.partnerId,
        CUSTOMER_TYPES,
      );
      const data = await this.buildContent(tx, companyId, dto, partner.currencyCode);
      const number = await this.numbering.next(companyId, 'SALES_ORDER', tx);
      return tx.salesOrder.create({
        data: {
          ...data.header,
          companyId,
          number,
          partnerId: partner.id,
          status: SalesOrderStatus.DRAFT,
          createdById: user.id,
          lines: { create: data.lines },
        },
      });
    });
    return this.findOne(companyId, order.id);
  }

  /** Replaces header and lines; only DRAFT orders are editable. */
  async update(user: AuthUser, id: string, dto: UpdateSalesOrderDto): Promise<SalesOrderDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, companyId, id);
      if (order.status !== SalesOrderStatus.DRAFT) {
        throw new ConflictException('Only draft orders can be edited');
      }
      const partner = await tx.businessPartner.findUniqueOrThrow({
        where: { id: order.partnerId },
      });
      const data = await this.buildContent(tx, companyId, dto, partner.currencyCode);
      await tx.salesOrderLine.deleteMany({ where: { orderId: id } });
      await tx.salesOrder.update({
        where: { id },
        data: { ...data.header, lines: { create: data.lines } },
      });
    });
    return this.findOne(companyId, id);
  }

  /** Confirms a draft: the credit limit must allow it, then stock is reserved. */
  async approve(user: AuthUser, id: string): Promise<SalesOrderDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(
      async (tx) => {
        const order = await this.lockOrder(tx, companyId, id);
        if (order.status !== SalesOrderStatus.DRAFT) {
          throw new ConflictException('Only draft orders can be approved');
        }
        // Serializes credit checks of the same customer.
        await tx.$queryRaw`SELECT id FROM business_partners WHERE id = ${order.partnerId}::uuid FOR UPDATE`;
        const row = await tx.salesOrder.findUniqueOrThrow({
          where: { id },
          include: { lines: true, partner: { select: { creditLimit: true } } },
        });
        const credit = await this.creditCheck(tx, companyId, row);
        if (credit.exceeded) {
          throw new ConflictException(
            `Credit limit exceeded: exposure ${credit.exposure} / limit ${credit.creditLimit}`,
          );
        }
        await tx.salesOrder.update({
          where: { id },
          data: {
            status: SalesOrderStatus.APPROVED,
            approvedById: user.id,
            approvedAt: new Date(),
          },
        });
        await this.reserveStock(tx, companyId, id);
      },
      { timeout: 30_000 },
    );
    return this.findOne(companyId, id);
  }

  /** Tops up reservations of an approved order from stock that became available since. */
  async reserve(user: AuthUser, id: string): Promise<SalesOrderDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(
      async (tx) => {
        const order = await this.lockOrder(tx, companyId, id);
        if (
          order.status !== SalesOrderStatus.APPROVED &&
          order.status !== SalesOrderStatus.PARTIALLY_DELIVERED
        ) {
          throw new ConflictException('Only approved orders reserve stock');
        }
        await this.reserveStock(tx, companyId, id);
      },
      { timeout: 30_000 },
    );
    return this.findOne(companyId, id);
  }

  /** Cancels an order without deliveries or active invoices and releases its reservations. */
  async cancel(user: AuthUser, id: string, dto: CancelDocumentDto): Promise<SalesOrderDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, companyId, id);
      if (order.status !== SalesOrderStatus.DRAFT && order.status !== SalesOrderStatus.APPROVED) {
        throw new ConflictException('Delivered or cancelled orders cannot be cancelled');
      }
      const [deliveries, invoices] = await Promise.all([
        tx.deliveryNote.count({ where: { orderId: id } }),
        tx.salesInvoice.count({ where: { orderId: id, status: { not: InvoiceStatus.CANCELLED } } }),
      ]);
      if (deliveries || invoices) {
        throw new ConflictException('Order has deliveries or invoices');
      }
      await tx.stockReservation.deleteMany({ where: { orderLine: { orderId: id } } });
      const reason = dto.reason?.trim();
      await tx.salesOrder.update({
        where: { id },
        data: {
          status: SalesOrderStatus.CANCELLED,
          ...(reason && {
            notes: order.notes ? `${order.notes}\n[İptal] ${reason}` : `[İptal] ${reason}`,
          }),
        },
      });
    });
    return this.findOne(companyId, id);
  }

  /**
   * Reserves what is still to deliver on each stocked line, as far as available stock
   * (on hand − all reservations) in the order's warehouse allows.
   */
  private async reserveStock(tx: PrismaTx, companyId: string, orderId: string): Promise<void> {
    const order = await tx.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        lines: {
          include: { variant: { select: tradeVariantSelect }, reservation: true },
          orderBy: { lineNo: 'asc' },
        },
      },
    });
    const lines = order.lines.filter((line) => isStocked(line.variant));
    const variantIds = [...new Set(lines.map((line) => line.variantId))].sort();
    if (!variantIds.length) return;
    // Same lock as stock postings, so availability cannot change underneath us.
    await tx.$queryRaw`
      SELECT id FROM product_variants WHERE id = ANY(${variantIds}::uuid[]) ORDER BY id FOR UPDATE`;
    const [balances, reserved] = await Promise.all([
      tx.stockBalance.findMany({
        where: { warehouseId: order.warehouseId, variantId: { in: variantIds } },
      }),
      tx.stockReservation.groupBy({
        by: ['variantId'],
        where: { warehouseId: order.warehouseId, variantId: { in: variantIds } },
        _sum: { quantity: true },
      }),
    ]);
    const available = new Map(variantIds.map((vid) => [vid, dec(0)]));
    for (const balance of balances) available.set(balance.variantId, balance.quantity);
    for (const row of reserved) {
      available.set(row.variantId, available.get(row.variantId)!.minus(row._sum.quantity ?? 0));
    }

    for (const line of lines) {
      const current = line.reservation?.quantity ?? dec(0);
      const need = line.quantity.minus(line.deliveredQty).minus(current);
      const free = available.get(line.variantId)!;
      const take = Prisma.Decimal.min(need, free);
      if (take.lte(0)) continue;
      available.set(line.variantId, free.minus(take));
      await tx.stockReservation.upsert({
        where: { orderLineId: line.id },
        create: {
          companyId,
          warehouseId: order.warehouseId,
          variantId: line.variantId,
          orderLineId: line.id,
          quantity: take,
        },
        update: { quantity: { increment: take } },
      });
    }
  }

  private async creditCheck(
    client: PrismaTx | PrismaService,
    companyId: string,
    order: ValuedOrder & {
      id: string;
      partnerId: string;
      status: SalesOrderStatus;
      partner: { creditLimit: Prisma.Decimal | null };
    },
  ): Promise<CreditCheckDto> {
    const [balance, others] = await Promise.all([
      this.ledger.balance(companyId, order.partnerId, client),
      client.salesOrder.findMany({
        where: {
          companyId,
          partnerId: order.partnerId,
          id: { not: order.id },
          status: { in: OPEN_ORDER_STATUSES },
        },
        select: {
          exchangeRate: true,
          lines: { select: { quantity: true, invoicedQty: true, lineTotal: true } },
        },
      }),
    ]);
    const openOrders = others.reduce((sum, other) => sum.plus(uninvoicedBase(other)), dec(0));
    const own = order.status === SalesOrderStatus.CANCELLED ? dec(0) : uninvoicedBase(order);
    const exposure = balance.plus(openOrders).plus(own);
    const limit = order.partner.creditLimit;
    return {
      creditLimit: limit?.toFixed(2) ?? null,
      balance: balance.toFixed(2),
      openOrders: openOrders.toFixed(2),
      exposure: exposure.toFixed(2),
      exceeded: !!limit && exposure.greaterThan(limit),
    };
  }

  private async lockOrder(tx: PrismaTx, companyId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${id}::uuid FOR UPDATE`;
    const order = await tx.salesOrder.findFirst({ where: { id, companyId } });
    if (!order) throw new NotFoundException('Sales order not found');
    return order;
  }

  private async buildContent(
    tx: PrismaTx,
    companyId: string,
    dto: UpdateSalesOrderDto,
    defaultCurrency: string,
  ) {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: dto.warehouseId, companyId, isActive: true },
    });
    if (!warehouse) throw new BadRequestException('Warehouse not found');
    const orderDate = parseDateOnly(dto.orderDate);
    const currency = await this.trade.resolveCurrency(
      tx,
      companyId,
      dto.currencyCode ?? defaultCurrency,
      dto.exchangeRate,
      orderDate,
    );
    const variants = await this.trade.loadVariants(
      tx,
      companyId,
      dto.lines.map((l) => l.variantId),
    );
    const priced = this.trade.priceLines(dto.lines, variants, { requireItem: true });
    return {
      header: {
        orderDate,
        deliveryDate: dto.deliveryDate ? parseDateOnly(dto.deliveryDate) : null,
        warehouseId: warehouse.id,
        customerRef: dto.customerRef?.trim() || null,
        currencyCode: currency.currencyCode,
        exchangeRate: currency.exchangeRate,
        notes: dto.notes?.trim() || null,
        subtotal: priced.subtotal,
        discountTotal: priced.discountTotal,
        vatTotal: priced.vatTotal,
        grandTotal: priced.grandTotal,
      },
      lines: priced.lines.map((line) => ({ ...line, variantId: line.variantId! })),
    };
  }

  /** Approved orders with quantities still to deliver or invoice. */
  private async openOrderIds(companyId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT o.id FROM sales_orders o
      JOIN sales_order_lines l ON l."orderId" = o.id
      WHERE o."companyId" = ${companyId}::uuid
        AND o.status::text = ANY(${OPEN_ORDER_STATUSES}::text[])
        AND (l."deliveredQty" < l.quantity OR l."invoicedQty" < l.quantity)`;
    return rows.map((row) => row.id);
  }
}

function deliveredPercent(lines: { quantity: Prisma.Decimal; deliveredQty: Prisma.Decimal }[]) {
  const ordered = lines.reduce((sum, l) => sum.plus(l.quantity), dec(0));
  if (ordered.isZero()) return 0;
  const delivered = lines.reduce(
    (sum, l) => sum.plus(Prisma.Decimal.min(l.deliveredQty, l.quantity)),
    dec(0),
  );
  return Math.floor(delivered.dividedBy(ordered).times(100).toNumber());
}

function toDto(row: ListRow): SalesOrderDto {
  return {
    id: row.id,
    number: row.number,
    partnerId: row.partnerId,
    partnerCode: row.partner.code,
    partnerTitle: row.partner.title,
    orderDate: toDateOnly(row.orderDate),
    deliveryDate: row.deliveryDate ? toDateOnly(row.deliveryDate) : null,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    customerRef: row.customerRef,
    currencyCode: row.currencyCode,
    exchangeRate: row.exchangeRate.toFixed(4),
    status: row.status,
    lineCount: row.lines.length,
    deliveredPercent: deliveredPercent(row.lines),
    quoteId: row.quoteId,
    quoteNumber: row.quote?.number ?? null,
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    approvedByName: row.approvedBy
      ? `${row.approvedBy.firstName} ${row.approvedBy.lastName}`
      : null,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
    ...toTotalsDto(row),
  };
}

function toDetailDto(row: DetailRow, credit: CreditCheckDto): SalesOrderDetailDto {
  return {
    ...toDto(row),
    notes: row.notes,
    lines: row.lines.map((line) => ({
      ...toLineDto(line),
      trackingType: line.variant.product.trackingType,
      deliveredQty: qty(line.deliveredQty),
      invoicedQty: qty(line.invoicedQty),
      reservedQty: qty(line.reservation?.quantity ?? 0),
    })),
    deliveries: row.deliveries.map((delivery) => ({
      id: delivery.id,
      number: delivery.number,
      date: toDateOnly(delivery.deliveryDate),
      status: 'POSTED',
      total: null,
    })),
    invoices: row.invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      date: toDateOnly(invoice.invoiceDate),
      status: invoice.status,
      total: invoice.grandTotal.toFixed(2),
    })),
    credit,
  };
}
