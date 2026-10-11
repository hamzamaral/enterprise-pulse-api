import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  SupplierQuoteStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { lineAmounts } from '../../common/money/document-totals';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { PartnersService, SUPPLIER_TYPES } from '../partners/partners.service';
import {
  netUnitCostBase,
  qty,
  toLineDto,
  toTotalsDto,
  tradeVariantSelect,
  TradeService,
} from '../partners/trade.service';
import type {
  AcceptQuoteDto,
  CreateSupplierQuoteDto,
  QuoteComparisonDto,
  SupplierQuoteDetailDto,
  SupplierQuoteDto,
  SupplierQuoteQueryDto,
} from './dto/purchasing.dto';

const SORTABLE = ['number', 'quoteDate', 'grandTotal', 'createdAt'] as const;

const listInclude = {
  partner: { select: { code: true, title: true } },
  request: { select: { number: true } },
  order: { select: { id: true, number: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.SupplierQuoteInclude;

const detailInclude = {
  ...listInclude,
  lines: { include: { variant: { select: tradeVariantSelect } }, orderBy: { lineNo: 'asc' } },
} satisfies Prisma.SupplierQuoteInclude;

type ListRow = Prisma.SupplierQuoteGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.SupplierQuoteGetPayload<{ include: typeof detailInclude }>;

/** Supplier quotes (teklifler): entered per supplier, compared per request, accepted into an order. */
@Injectable()
export class SupplierQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly partners: PartnersService,
    private readonly trade: TradeService,
  ) {}

  async findAll(companyId: string, query: SupplierQuoteQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.SupplierQuoteWhereInput = {
      companyId,
      requestId: query.requestId,
      partnerId: query.partnerId,
      status: query.status,
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supplierQuote.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.supplierQuote.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<SupplierQuoteDetailDto> {
    const row = await this.prisma.supplierQuote.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Supplier quote not found');
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreateSupplierQuoteDto): Promise<SupplierQuoteDetailDto> {
    const { companyId } = user;
    const quote = await this.prisma.$transaction(async (tx) => {
      const partner = await this.partners.getForDocument(
        tx,
        companyId,
        dto.partnerId,
        SUPPLIER_TYPES,
      );
      if (dto.requestId) {
        const request = await tx.purchaseRequest.findFirst({
          where: { id: dto.requestId, companyId },
          include: { lines: { select: { id: true } } },
        });
        if (!request) throw new BadRequestException('Purchase request not found');
        if (request.status !== PurchaseRequestStatus.APPROVED) {
          throw new ConflictException('Quotes can only be added to approved requests');
        }
        const requestLines = new Set(request.lines.map((l) => l.id));
        if (dto.lines.some((l) => l.requestLineId && !requestLines.has(l.requestLineId))) {
          throw new BadRequestException('Quote line refers to another request');
        }
      } else if (dto.lines.some((l) => l.requestLineId)) {
        throw new BadRequestException('requestLineId needs requestId');
      }
      const quoteDate = parseDateOnly(dto.quoteDate);
      const currency = await this.trade.resolveCurrency(
        tx,
        companyId,
        dto.currencyCode ?? partner.currencyCode,
        dto.exchangeRate,
        quoteDate,
      );
      const variants = await this.trade.loadVariants(
        tx,
        companyId,
        dto.lines.map((l) => l.variantId),
      );
      const priced = this.trade.priceLines(dto.lines, variants);
      const number = await this.numbering.next(companyId, 'SUPPLIER_QUOTE', tx);
      return tx.supplierQuote.create({
        data: {
          companyId,
          number,
          requestId: dto.requestId ?? null,
          partnerId: partner.id,
          quoteDate,
          validUntil: dto.validUntil ? parseDateOnly(dto.validUntil) : null,
          deliveryDays: dto.deliveryDays ?? null,
          currencyCode: currency.currencyCode,
          exchangeRate: currency.exchangeRate,
          notes: dto.notes?.trim() || null,
          subtotal: priced.subtotal,
          discountTotal: priced.discountTotal,
          vatTotal: priced.vatTotal,
          grandTotal: priced.grandTotal,
          createdById: user.id,
          lines: {
            create: priced.lines.map((line, index) => ({
              ...line,
              requestLineId: dto.lines[index].requestLineId ?? null,
            })),
          },
        },
      });
    });
    return this.findOne(companyId, quote.id);
  }

  async reject(companyId: string, id: string): Promise<SupplierQuoteDetailDto> {
    const { count } = await this.prisma.supplierQuote.updateMany({
      where: { id, companyId, status: SupplierQuoteStatus.OPEN },
      data: { status: SupplierQuoteStatus.REJECTED },
    });
    if (!count) {
      await this.findOne(companyId, id);
      throw new ConflictException('Only open quotes can be rejected');
    }
    return this.findOne(companyId, id);
  }

  /**
   * Turns an open quote into a DRAFT purchase order. The other open quotes of the same request
   * are rejected and the request becomes ORDERED.
   */
  async accept(user: AuthUser, id: string, dto: AcceptQuoteDto): Promise<{ orderId: string }> {
    const { companyId } = user;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM supplier_quotes WHERE id = ${id}::uuid FOR UPDATE`;
      const quote = await tx.supplierQuote.findFirst({
        where: { id, companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!quote) throw new NotFoundException('Supplier quote not found');
      if (quote.status !== SupplierQuoteStatus.OPEN) {
        throw new ConflictException('Only open quotes can be accepted');
      }
      const missing = quote.lines.find((line) => !line.variantId);
      if (missing) {
        throw new BadRequestException(
          `Line ${missing.lineNo} has no product; orders need a product on every line`,
        );
      }
      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, companyId, isActive: true },
      });
      if (!warehouse) throw new BadRequestException('Warehouse not found');

      const number = await this.numbering.next(companyId, 'PURCHASE_ORDER', tx);
      const order = await tx.purchaseOrder.create({
        data: {
          companyId,
          number,
          partnerId: quote.partnerId,
          requestId: quote.requestId,
          quoteId: quote.id,
          orderDate: parseDateOnly(new Date().toISOString().slice(0, 10)),
          expectedDate: dto.expectedDate ? parseDateOnly(dto.expectedDate) : null,
          warehouseId: warehouse.id,
          currencyCode: quote.currencyCode,
          exchangeRate: quote.exchangeRate,
          status: PurchaseOrderStatus.DRAFT,
          notes: quote.notes,
          subtotal: quote.subtotal,
          discountTotal: quote.discountTotal,
          vatTotal: quote.vatTotal,
          grandTotal: quote.grandTotal,
          createdById: user.id,
          lines: {
            create: quote.lines.map((line) => ({
              lineNo: line.lineNo,
              requestLineId: line.requestLineId,
              variantId: line.variantId!,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountRate: line.discountRate,
              vatRate: line.vatRate,
              lineTotal: line.lineTotal,
            })),
          },
        },
      });
      await tx.supplierQuote.update({
        where: { id: quote.id },
        data: { status: SupplierQuoteStatus.ACCEPTED },
      });
      if (quote.requestId) {
        await tx.supplierQuote.updateMany({
          where: { requestId: quote.requestId, status: SupplierQuoteStatus.OPEN },
          data: { status: SupplierQuoteStatus.REJECTED },
        });
        await tx.purchaseRequest.update({
          where: { id: quote.requestId },
          data: { status: PurchaseRequestStatus.ORDERED },
        });
      }
      return { orderId: order.id };
    });
  }

  /** Side-by-side prices of every quote for a request, comparable in base currency. */
  async compare(companyId: string, requestId: string): Promise<QuoteComparisonDto> {
    const request = await this.prisma.purchaseRequest.findFirst({
      where: { id: requestId, companyId },
      include: {
        company: { select: { baseCurrency: true } },
        lines: { include: { variant: { select: tradeVariantSelect } }, orderBy: { lineNo: 'asc' } },
        quotes: { include: detailInclude, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!request) throw new NotFoundException('Purchase request not found');

    const quotes = request.quotes.map((quote) => ({
      ...toDto(quote),
      prices: quote.lines
        .filter((line) => line.requestLineId)
        .map((line) => ({
          requestLineId: line.requestLineId!,
          quantity: qty(line.quantity),
          unitPrice: line.unitPrice.toFixed(4),
          netUnitPriceBase: netUnitCostBase(line, quote.exchangeRate).toFixed(4),
          lineTotal: lineAmounts(line).total.toFixed(2),
        })),
    }));
    const complete = quotes.filter(
      (q) =>
        q.status === SupplierQuoteStatus.OPEN &&
        request.lines.every((line) => q.prices.some((p) => p.requestLineId === line.id)),
    );
    const best = complete.reduce<(typeof complete)[number] | null>(
      (min, q) => (!min || Number(q.grandTotalBase) < Number(min.grandTotalBase) ? q : min),
      null,
    );
    return {
      requestId: request.id,
      requestNumber: request.number,
      title: request.title,
      baseCurrency: request.company.baseCurrency,
      lines: request.lines.map((line) => ({
        id: line.id,
        lineNo: line.lineNo,
        variantId: line.variantId,
        productId: line.variant?.productId ?? null,
        sku: line.variant?.sku ?? null,
        unitCode: line.variant?.product.unit.code ?? null,
        description: line.description,
        quantity: qty(line.quantity),
        estimatedPrice: line.estimatedPrice?.toFixed(2) ?? null,
      })),
      quotes,
      bestQuoteId: best?.id ?? null,
    };
  }
}

function toDto(row: ListRow): SupplierQuoteDto {
  return {
    id: row.id,
    number: row.number,
    requestId: row.requestId,
    requestNumber: row.request?.number ?? null,
    partnerId: row.partnerId,
    partnerCode: row.partner.code,
    partnerTitle: row.partner.title,
    quoteDate: toDateOnly(row.quoteDate),
    validUntil: row.validUntil ? toDateOnly(row.validUntil) : null,
    deliveryDays: row.deliveryDays,
    currencyCode: row.currencyCode,
    exchangeRate: row.exchangeRate.toFixed(4),
    status: row.status,
    lineCount: row._count.lines,
    orderId: row.order?.id ?? null,
    orderNumber: row.order?.number ?? null,
    createdAt: row.createdAt,
    ...toTotalsDto(row),
  };
}

function toDetailDto(row: DetailRow): SupplierQuoteDetailDto {
  return {
    ...toDto(row),
    notes: row.notes,
    lines: row.lines.map((line) => ({ ...toLineDto(line), requestLineId: line.requestLineId })),
  };
}
