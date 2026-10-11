import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, LedgerDocumentType, Prisma, StockMovementType } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { MovementLineInputDto } from '../inventory/dto/stock.dto';
import { StockMovementsService } from '../inventory/stock-movements.service';
import { NumberingService } from '../numbering/numbering.service';
import { PartnerLedgerService } from '../partners/partner-ledger.service';
import {
  isStocked,
  paymentStatusOf,
  qty,
  toLineDto,
  toTotalsDto,
  tradeVariantSelect,
  TradeService,
  type TradeVariant,
} from '../partners/trade.service';
import type {
  CreateSalesReturnDto,
  SalesReturnDetailDto,
  SalesReturnDto,
  SalesReturnQueryDto,
} from './dto/sales.dto';

const SORTABLE = ['number', 'returnDate', 'grandTotal', 'createdAt'] as const;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const listInclude = {
  invoice: { select: { number: true } },
  partner: { select: { code: true, title: true } },
  warehouse: { select: { name: true } },
  stockMovement: { select: { number: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.SalesReturnInclude;

const detailInclude = {
  ...listInclude,
  lines: { include: { variant: { select: tradeVariantSelect } }, orderBy: { lineNo: 'asc' } },
} satisfies Prisma.SalesReturnInclude;

type ListRow = Prisma.SalesReturnGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.SalesReturnGetPayload<{ include: typeof detailInclude }>;

/**
 * Sales returns (iade). Returned goods re-enter stock at average cost through a RECEIPT; the
 * customer is credited at the invoiced price, and the credit settles the invoice first.
 */
@Injectable()
export class SalesReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly stock: StockMovementsService,
    private readonly ledger: PartnerLedgerService,
    private readonly trade: TradeService,
  ) {}

  async findAll(companyId: string, query: SalesReturnQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.SalesReturnWhereInput = {
      companyId,
      invoiceId: query.invoiceId,
      partnerId: query.partnerId,
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { reason: { contains: search, mode: 'insensitive' } },
          { invoice: { number: { contains: search, mode: 'insensitive' } } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.salesReturn.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.salesReturn.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<SalesReturnDetailDto> {
    const row = await this.prisma.salesReturn.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Sales return not found');
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreateSalesReturnDto): Promise<SalesReturnDetailDto> {
    const { companyId } = user;
    const created = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id = ${dto.invoiceId}::uuid FOR UPDATE`;
        const invoice = await tx.salesInvoice.findFirst({
          where: { id: dto.invoiceId, companyId },
          include: {
            order: { select: { warehouseId: true } },
            lines: { include: { variant: { select: tradeVariantSelect } } },
          },
        });
        if (!invoice) throw new BadRequestException('Sales invoice not found');
        if (invoice.status !== InvoiceStatus.ISSUED) {
          throw new ConflictException('Only issued invoices can be returned');
        }
        const returnDate = parseDateOnly(dto.returnDate);
        if (returnDate < invoice.invoiceDate) {
          throw new BadRequestException('Return date cannot be before the invoice date');
        }

        const invoiceLines = new Map(invoice.lines.map((line) => [line.id, line]));
        const returning = new Map<string, Prisma.Decimal>();
        for (const input of dto.lines) {
          const line = invoiceLines.get(input.invoiceLineId);
          if (!line) throw new BadRequestException('Return line refers to another invoice');
          const total = (returning.get(line.id) ?? dec(0)).plus(input.quantity);
          const open = line.quantity.minus(line.returnedQty);
          if (total.greaterThan(open)) {
            throw new BadRequestException(`Line ${line.lineNo}: only ${qty(open)} can be returned`);
          }
          returning.set(line.id, total);
        }

        const stockInputs = dto.lines.filter((input) =>
          isStocked(invoiceLines.get(input.invoiceLineId)!.variant),
        );
        const warehouseId = dto.warehouseId ?? invoice.order?.warehouseId;
        if (stockInputs.length && !warehouseId) {
          throw new BadRequestException('warehouseId is required for returned goods');
        }
        // Service-only returns of invoices without an order still record a warehouse.
        const warehouse = await tx.warehouse.findFirst({
          where: { companyId, isActive: true, ...(warehouseId && { id: warehouseId }) },
          orderBy: { code: 'asc' },
        });
        if (!warehouse) throw new BadRequestException('Warehouse not found');

        const number = await this.numbering.next(companyId, 'SALES_RETURN', tx);
        const stockLines: MovementLineInputDto[] = stockInputs.map((input) => ({
          variantId: invoiceLines.get(input.invoiceLineId)!.variantId!,
          quantity: input.quantity,
          lotNo: input.lotNo?.trim() || undefined,
          serialNos: input.serialNos,
        }));
        const movement = stockLines.length
          ? await this.stock.post(tx, user, {
              type: StockMovementType.RECEIPT,
              movementDate: dto.returnDate,
              targetWarehouseId: warehouse.id,
              reference: `${invoice.number} / ${number}`,
              notes: dto.reason,
              lines: stockLines,
            })
          : null;

        // Invoiced items may have been deactivated since; returns still accept them.
        const variants = new Map<string, TradeVariant>();
        for (const line of invoice.lines) {
          if (line.variant) variants.set(line.variant.id, line.variant);
        }
        const priced = this.trade.priceLines(
          dto.lines.map((input) => {
            const line = invoiceLines.get(input.invoiceLineId)!;
            return {
              variantId: line.variantId ?? undefined,
              description: line.description,
              quantity: input.quantity,
              unitPrice: line.unitPrice.toNumber(),
              discountRate: line.discountRate.toNumber(),
              vatRate: line.vatRate.toNumber(),
            };
          }),
          variants,
        );

        const salesReturn = await tx.salesReturn.create({
          data: {
            companyId,
            number,
            invoiceId: invoice.id,
            partnerId: invoice.partnerId,
            warehouseId: warehouse.id,
            returnDate,
            reason: dto.reason.trim(),
            currencyCode: invoice.currencyCode,
            exchangeRate: invoice.exchangeRate,
            subtotal: priced.subtotal,
            discountTotal: priced.discountTotal,
            vatTotal: priced.vatTotal,
            grandTotal: priced.grandTotal,
            stockMovementId: movement?.movementId ?? null,
            createdById: user.id,
            lines: {
              create: priced.lines.map((line, index) => ({
                ...line,
                invoiceLineId: dto.lines[index].invoiceLineId,
                lotNo: dto.lines[index].lotNo?.trim() || null,
                serialNos: dto.lines[index].serialNos?.map((s) => s.trim()) ?? [],
              })),
            },
          },
        });

        for (const [lineId, quantity] of returning) {
          await tx.salesInvoiceLine.update({
            where: { id: lineId },
            data: { returnedQty: { increment: quantity } },
          });
        }
        if (priced.grandTotal.greaterThan(0)) {
          await this.ledger.post(tx, user, {
            partnerId: invoice.partnerId,
            entryDate: returnDate,
            documentType: LedgerDocumentType.SALES_RETURN,
            documentId: salesReturn.id,
            documentNumber: number,
            description: `İade (${invoice.number}): ${dto.reason.trim()}`,
            credit: priced.grandTotal,
            currencyCode: invoice.currencyCode,
            exchangeRate: invoice.exchangeRate,
          });
          // The credit note settles the returned invoice before anything else.
          const settle = Prisma.Decimal.min(
            priced.grandTotal,
            Prisma.Decimal.max(invoice.grandTotal.minus(invoice.paidAmount), 0),
          );
          if (settle.greaterThan(0)) {
            const paid = invoice.paidAmount.plus(settle);
            await tx.salesInvoice.update({
              where: { id: invoice.id },
              data: { paidAmount: paid, paymentStatus: paymentStatusOf(paid, invoice.grandTotal) },
            });
          }
        }
        return { id: salesReturn.id };
      },
      { timeout: 30_000 },
    );
    return this.findOne(companyId, created.id);
  }
}

function toDto(row: ListRow): SalesReturnDto {
  return {
    id: row.id,
    number: row.number,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoice.number,
    partnerId: row.partnerId,
    partnerTitle: row.partner.title,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    returnDate: toDateOnly(row.returnDate),
    reason: row.reason,
    currencyCode: row.currencyCode,
    exchangeRate: row.exchangeRate.toFixed(4),
    lineCount: row._count.lines,
    stockMovementId: row.stockMovementId,
    stockMovementNumber: row.stockMovement?.number ?? null,
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    createdAt: row.createdAt,
    ...toTotalsDto(row),
  };
}

function toDetailDto(row: DetailRow): SalesReturnDetailDto {
  return {
    ...toDto(row),
    partnerCode: row.partner.code,
    lines: row.lines.map((line) => ({
      ...toLineDto(line),
      invoiceLineId: line.invoiceLineId,
      lotNo: line.lotNo,
      serialNos: line.serialNos,
    })),
  };
}
