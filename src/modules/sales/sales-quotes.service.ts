import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalesOrderStatus, SalesQuoteStatus } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OpportunitiesService } from '../crm/opportunities.service';
import { NumberingService } from '../numbering/numbering.service';
import { CUSTOMER_TYPES, PartnersService } from '../partners/partners.service';
import {
  toLineDto,
  toTotalsDto,
  tradeVariantSelect,
  TradeService,
} from '../partners/trade.service';
import type {
  ConvertQuoteDto,
  CreateSalesQuoteDto,
  SalesQuoteDetailDto,
  SalesQuoteDto,
  SalesQuoteQueryDto,
} from './dto/sales.dto';

const SORTABLE = ['number', 'quoteDate', 'validUntil', 'grandTotal', 'createdAt'] as const;

const listInclude = {
  partner: { select: { code: true, title: true } },
  opportunity: { select: { number: true, title: true } },
  order: { select: { id: true, number: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.SalesQuoteInclude;

const detailInclude = {
  ...listInclude,
  lines: { include: { variant: { select: tradeVariantSelect } }, orderBy: { lineNo: 'asc' } },
} satisfies Prisma.SalesQuoteInclude;

type ListRow = Prisma.SalesQuoteGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.SalesQuoteGetPayload<{ include: typeof detailInclude }>;

const today = () => parseDateOnly(new Date().toISOString().slice(0, 10));

/** Sales quotes (STK): priced offers to customers, converted into orders when accepted. */
@Injectable()
export class SalesQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly partners: PartnersService,
    private readonly trade: TradeService,
    private readonly opportunities: OpportunitiesService,
  ) {}

  async findAll(companyId: string, query: SalesQuoteQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.SalesQuoteWhereInput = {
      companyId,
      status: query.status,
      partnerId: query.partnerId,
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.salesQuote.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.salesQuote.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<SalesQuoteDetailDto> {
    const row = await this.prisma.salesQuote.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Sales quote not found');
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreateSalesQuoteDto): Promise<SalesQuoteDetailDto> {
    const { companyId } = user;
    const quote = await this.prisma.$transaction(async (tx) => {
      const partner = await this.partners.getForDocument(
        tx,
        companyId,
        dto.partnerId,
        CUSTOMER_TYPES,
      );
      const quoteDate = parseDateOnly(dto.quoteDate);
      const validUntil = dto.validUntil ? parseDateOnly(dto.validUntil) : null;
      if (validUntil && validUntil < quoteDate) {
        throw new BadRequestException('Validity date cannot be before the quote date');
      }
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
      if (dto.opportunityId) {
        await this.opportunities.attachQuote(tx, companyId, dto.opportunityId, partner.id);
      }
      const number = await this.numbering.next(companyId, 'SALES_QUOTE', tx);
      return tx.salesQuote.create({
        data: {
          companyId,
          number,
          partnerId: partner.id,
          opportunityId: dto.opportunityId ?? null,
          quoteDate,
          validUntil,
          currencyCode: currency.currencyCode,
          exchangeRate: currency.exchangeRate,
          notes: dto.notes?.trim() || null,
          subtotal: priced.subtotal,
          discountTotal: priced.discountTotal,
          vatTotal: priced.vatTotal,
          grandTotal: priced.grandTotal,
          createdById: user.id,
          lines: { create: priced.lines },
        },
      });
    });
    return this.findOne(companyId, quote.id);
  }

  async reject(user: AuthUser, id: string): Promise<SalesQuoteDetailDto> {
    const { count } = await this.prisma.salesQuote.updateMany({
      where: { id, companyId: user.companyId, status: SalesQuoteStatus.OPEN },
      data: { status: SalesQuoteStatus.REJECTED },
    });
    if (!count) {
      await this.findOne(user.companyId, id);
      throw new ConflictException('Only open quotes can be rejected');
    }
    return this.findOne(user.companyId, id);
  }

  /** The customer accepted: creates a DRAFT sales order with the quoted lines and prices. */
  async convert(user: AuthUser, id: string, dto: ConvertQuoteDto): Promise<{ orderId: string }> {
    const { companyId } = user;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sales_quotes WHERE id = ${id}::uuid FOR UPDATE`;
      const quote = await tx.salesQuote.findFirst({
        where: { id, companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!quote) throw new NotFoundException('Sales quote not found');
      if (quote.status !== SalesQuoteStatus.OPEN) {
        throw new ConflictException('Only open quotes can be converted');
      }
      if (quote.validUntil && quote.validUntil < today()) {
        throw new ConflictException('Quote has expired');
      }
      if (quote.lines.some((line) => !line.variantId)) {
        throw new BadRequestException('Every quote line needs a product before ordering');
      }
      await this.partners.getForDocument(tx, companyId, quote.partnerId, CUSTOMER_TYPES);
      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, companyId, isActive: true },
      });
      if (!warehouse) throw new BadRequestException('Warehouse not found');

      const number = await this.numbering.next(companyId, 'SALES_ORDER', tx);
      const order = await tx.salesOrder.create({
        data: {
          companyId,
          number,
          partnerId: quote.partnerId,
          quoteId: quote.id,
          orderDate: today(),
          deliveryDate: dto.deliveryDate ? parseDateOnly(dto.deliveryDate) : null,
          warehouseId: warehouse.id,
          customerRef: dto.customerRef?.trim() || null,
          currencyCode: quote.currencyCode,
          exchangeRate: quote.exchangeRate,
          status: SalesOrderStatus.DRAFT,
          notes: quote.notes,
          subtotal: quote.subtotal,
          discountTotal: quote.discountTotal,
          vatTotal: quote.vatTotal,
          grandTotal: quote.grandTotal,
          createdById: user.id,
          lines: {
            create: quote.lines.map((line) => ({
              lineNo: line.lineNo,
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
      await tx.salesQuote.update({
        where: { id: quote.id },
        data: { status: SalesQuoteStatus.ACCEPTED },
      });
      if (quote.opportunityId) await this.opportunities.markWonByQuote(tx, quote.opportunityId);
      return { orderId: order.id };
    });
  }
}

function toDto(row: ListRow): SalesQuoteDto {
  return {
    id: row.id,
    number: row.number,
    partnerId: row.partnerId,
    partnerCode: row.partner.code,
    partnerTitle: row.partner.title,
    opportunityId: row.opportunityId,
    opportunityNumber: row.opportunity?.number ?? null,
    opportunityTitle: row.opportunity?.title ?? null,
    quoteDate: toDateOnly(row.quoteDate),
    validUntil: row.validUntil ? toDateOnly(row.validUntil) : null,
    expired: row.status === SalesQuoteStatus.OPEN && !!row.validUntil && row.validUntil < today(),
    currencyCode: row.currencyCode,
    exchangeRate: row.exchangeRate.toFixed(4),
    status: row.status,
    lineCount: row._count.lines,
    orderId: row.order?.id ?? null,
    orderNumber: row.order?.number ?? null,
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    createdAt: row.createdAt,
    ...toTotalsDto(row),
  };
}

function toDetailDto(row: DetailRow): SalesQuoteDetailDto {
  return { ...toDto(row), notes: row.notes, lines: row.lines.map(toLineDto) };
}
