import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, PurchaseOrderStatus } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { PartnersService, SUPPLIER_TYPES } from '../partners/partners.service';
import {
  qty,
  toLineDto,
  toTotalsDto,
  tradeVariantSelect,
  TradeService,
} from '../partners/trade.service';
import type {
  CancelDocumentDto,
  CreatePurchaseOrderDto,
  PurchaseOrderDetailDto,
  PurchaseOrderDto,
  PurchaseOrderQueryDto,
  UpdatePurchaseOrderDto,
} from './dto/purchasing.dto';

const SORTABLE = ['number', 'orderDate', 'expectedDate', 'grandTotal', 'createdAt'] as const;
const OPEN_STATUSES = [
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
  PurchaseOrderStatus.RECEIVED,
];

const listInclude = {
  partner: { select: { code: true, title: true } },
  warehouse: { select: { name: true } },
  request: { select: { number: true } },
  quote: { select: { number: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  approvedBy: { select: { firstName: true, lastName: true } },
  lines: { select: { quantity: true, receivedQty: true } },
} satisfies Prisma.PurchaseOrderInclude;

const detailInclude = {
  ...listInclude,
  lines: { include: { variant: { select: tradeVariantSelect } }, orderBy: { lineNo: 'asc' } },
  receipts: {
    select: { id: true, number: true, receiptDate: true },
    orderBy: { createdAt: 'asc' },
  },
  invoices: {
    select: { id: true, number: true, invoiceDate: true, status: true, grandTotal: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PurchaseOrderInclude;

type ListRow = Prisma.PurchaseOrderGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.PurchaseOrderGetPayload<{ include: typeof detailInclude }>;

/** Purchase orders (SAS): drafted, approved, then received and invoiced line by line. */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly partners: PartnersService,
    private readonly trade: TradeService,
  ) {}

  async findAll(companyId: string, query: PurchaseOrderQueryDto) {
    const search = query.search?.trim();
    const openIds = query.open ? await this.openOrderIds(companyId) : undefined;
    const where: Prisma.PurchaseOrderWhereInput = {
      companyId,
      status: query.status,
      partnerId: query.partnerId,
      ...(openIds && { id: { in: openIds } }),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<PurchaseOrderDetailDto> {
    const row = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Purchase order not found');
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreatePurchaseOrderDto): Promise<PurchaseOrderDetailDto> {
    const { companyId } = user;
    const order = await this.prisma.$transaction(async (tx) => {
      const partner = await this.partners.getForDocument(
        tx,
        companyId,
        dto.partnerId,
        SUPPLIER_TYPES,
      );
      const data = await this.buildContent(tx, companyId, dto, partner.currencyCode);
      const number = await this.numbering.next(companyId, 'PURCHASE_ORDER', tx);
      return tx.purchaseOrder.create({
        data: {
          ...data.header,
          companyId,
          number,
          partnerId: partner.id,
          status: PurchaseOrderStatus.DRAFT,
          createdById: user.id,
          lines: { create: data.lines },
        },
      });
    });
    return this.findOne(companyId, order.id);
  }

  /** Replaces header and lines; only DRAFT orders are editable. */
  async update(
    user: AuthUser,
    id: string,
    dto: UpdatePurchaseOrderDto,
  ): Promise<PurchaseOrderDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, companyId, id);
      if (order.status !== PurchaseOrderStatus.DRAFT) {
        throw new ConflictException('Only draft orders can be edited');
      }
      const partner = await tx.businessPartner.findUniqueOrThrow({
        where: { id: order.partnerId },
      });
      const data = await this.buildContent(tx, companyId, dto, partner.currencyCode);
      await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
      await tx.purchaseOrder.update({
        where: { id },
        data: { ...data.header, lines: { create: data.lines } },
      });
    });
    return this.findOne(companyId, id);
  }

  async approve(user: AuthUser, id: string): Promise<PurchaseOrderDetailDto> {
    const { count } = await this.prisma.purchaseOrder.updateMany({
      where: { id, companyId: user.companyId, status: PurchaseOrderStatus.DRAFT },
      data: {
        status: PurchaseOrderStatus.APPROVED,
        approvedById: user.id,
        approvedAt: new Date(),
      },
    });
    if (!count) {
      await this.findOne(user.companyId, id);
      throw new ConflictException('Only draft orders can be approved');
    }
    return this.findOne(user.companyId, id);
  }

  /** Cancels an order that has neither receipts nor (active) invoices. */
  async cancel(
    user: AuthUser,
    id: string,
    dto: CancelDocumentDto,
  ): Promise<PurchaseOrderDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, companyId, id);
      if (
        order.status !== PurchaseOrderStatus.DRAFT &&
        order.status !== PurchaseOrderStatus.APPROVED
      ) {
        throw new ConflictException('Received or cancelled orders cannot be cancelled');
      }
      const [receipts, invoices] = await Promise.all([
        tx.goodsReceipt.count({ where: { orderId: id } }),
        tx.purchaseInvoice.count({
          where: { orderId: id, status: { not: InvoiceStatus.CANCELLED } },
        }),
      ]);
      if (receipts || invoices) {
        throw new ConflictException('Order has receipts or invoices');
      }
      const reason = dto.reason?.trim();
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.CANCELLED,
          ...(reason && {
            notes: order.notes ? `${order.notes}\n[İptal] ${reason}` : `[İptal] ${reason}`,
          }),
        },
      });
    });
    return this.findOne(companyId, id);
  }

  private async lockOrder(tx: PrismaTx, companyId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({ where: { id, companyId } });
    if (!order) throw new NotFoundException('Purchase order not found');
    return order;
  }

  private async buildContent(
    tx: PrismaTx,
    companyId: string,
    dto: UpdatePurchaseOrderDto,
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
        expectedDate: dto.expectedDate ? parseDateOnly(dto.expectedDate) : null,
        warehouseId: warehouse.id,
        currencyCode: currency.currencyCode,
        exchangeRate: currency.exchangeRate,
        notes: dto.notes?.trim() || null,
        subtotal: priced.subtotal,
        discountTotal: priced.discountTotal,
        vatTotal: priced.vatTotal,
        grandTotal: priced.grandTotal,
      },
      lines: priced.lines.map((line, index) => ({
        ...line,
        variantId: line.variantId!,
        requestLineId: dto.lines[index].requestLineId ?? null,
      })),
    };
  }

  /** Approved orders with quantities still to receive or invoice. */
  private async openOrderIds(companyId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT o.id FROM purchase_orders o
      JOIN purchase_order_lines l ON l."orderId" = o.id
      WHERE o."companyId" = ${companyId}::uuid
        AND o.status::text = ANY(${OPEN_STATUSES}::text[])
        AND (l."receivedQty" < l.quantity OR l."invoicedQty" < l.quantity)`;
    return rows.map((row) => row.id);
  }
}

function receivedPercent(lines: { quantity: Prisma.Decimal; receivedQty: Prisma.Decimal }[]) {
  const ordered = lines.reduce((sum, l) => sum.plus(l.quantity), new Prisma.Decimal(0));
  if (ordered.isZero()) return 0;
  const received = lines.reduce(
    (sum, l) => sum.plus(Prisma.Decimal.min(l.receivedQty, l.quantity)),
    new Prisma.Decimal(0),
  );
  return Math.floor(received.dividedBy(ordered).times(100).toNumber());
}

function toDto(row: ListRow): PurchaseOrderDto {
  return {
    id: row.id,
    number: row.number,
    partnerId: row.partnerId,
    partnerCode: row.partner.code,
    partnerTitle: row.partner.title,
    orderDate: toDateOnly(row.orderDate),
    expectedDate: row.expectedDate ? toDateOnly(row.expectedDate) : null,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    currencyCode: row.currencyCode,
    exchangeRate: row.exchangeRate.toFixed(4),
    status: row.status,
    lineCount: row.lines.length,
    receivedPercent: receivedPercent(row.lines),
    requestId: row.requestId,
    requestNumber: row.request?.number ?? null,
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

function toDetailDto(row: DetailRow): PurchaseOrderDetailDto {
  return {
    ...toDto(row),
    notes: row.notes,
    lines: row.lines.map((line) => ({
      ...toLineDto(line),
      requestLineId: line.requestLineId,
      trackingType: line.variant.product.trackingType,
      receivedQty: qty(line.receivedQty),
      invoicedQty: qty(line.invoicedQty),
    })),
    receipts: row.receipts.map((receipt) => ({
      id: receipt.id,
      number: receipt.number,
      date: toDateOnly(receipt.receiptDate),
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
  };
}
