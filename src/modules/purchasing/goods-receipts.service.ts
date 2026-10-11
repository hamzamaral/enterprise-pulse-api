import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseOrderStatus, StockMovementType } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { MovementLineInputDto } from '../inventory/dto/stock.dto';
import { StockMovementsService } from '../inventory/stock-movements.service';
import { NumberingService } from '../numbering/numbering.service';
import {
  isStocked,
  netUnitCostBase,
  qty,
  tradeVariantSelect,
  variantLabel,
} from '../partners/trade.service';
import type {
  CreateGoodsReceiptDto,
  GoodsReceiptDetailDto,
  GoodsReceiptDto,
  GoodsReceiptQueryDto,
} from './dto/purchasing.dto';

const SORTABLE = ['number', 'receiptDate', 'createdAt'] as const;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const listInclude = {
  order: { select: { number: true } },
  partner: { select: { title: true } },
  warehouse: { select: { name: true } },
  stockMovement: { select: { number: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.GoodsReceiptInclude;

const detailInclude = {
  ...listInclude,
  lines: {
    include: {
      variant: { select: tradeVariantSelect },
      orderLine: { select: { lineNo: true, description: true } },
    },
    orderBy: { orderLine: { lineNo: 'asc' } },
  },
} satisfies Prisma.GoodsReceiptInclude;

type ListRow = Prisma.GoodsReceiptGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.GoodsReceiptGetPayload<{ include: typeof detailInclude }>;

/**
 * Goods receipts (mal kabul). Received goods enter stock through a RECEIPT movement valued at
 * the order's net unit price in base currency; service lines only advance the order.
 */
@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly stock: StockMovementsService,
  ) {}

  async findAll(companyId: string, query: GoodsReceiptQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.GoodsReceiptWhereInput = {
      companyId,
      orderId: query.orderId,
      partnerId: query.partnerId,
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { deliveryNoteNo: { contains: search, mode: 'insensitive' } },
          { order: { number: { contains: search, mode: 'insensitive' } } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.goodsReceipt.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.goodsReceipt.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<GoodsReceiptDetailDto> {
    const row = await this.prisma.goodsReceipt.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Goods receipt not found');
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreateGoodsReceiptDto): Promise<GoodsReceiptDetailDto> {
    const { companyId } = user;
    const receipt = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${dto.orderId}::uuid FOR UPDATE`;
        const order = await tx.purchaseOrder.findFirst({
          where: { id: dto.orderId, companyId },
          include: { lines: { include: { variant: { select: tradeVariantSelect } } } },
        });
        if (!order) throw new BadRequestException('Purchase order not found');
        if (
          order.status !== PurchaseOrderStatus.APPROVED &&
          order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
        ) {
          throw new ConflictException('Only approved orders can be received');
        }
        const warehouseId = dto.warehouseId ?? order.warehouseId;
        const warehouse = await tx.warehouse.findFirst({
          where: { id: warehouseId, companyId, isActive: true },
        });
        if (!warehouse) throw new BadRequestException('Warehouse not found');

        const orderLines = new Map(order.lines.map((line) => [line.id, line]));
        const receiving = new Map<string, Prisma.Decimal>();
        for (const input of dto.lines) {
          const line = orderLines.get(input.orderLineId);
          if (!line) throw new BadRequestException('Receipt line refers to another order');
          const total = (receiving.get(line.id) ?? dec(0)).plus(input.quantity);
          const remaining = line.quantity.minus(line.receivedQty);
          if (total.greaterThan(remaining)) {
            throw new BadRequestException(
              `Line ${line.lineNo}: only ${qty(remaining)} left to receive`,
            );
          }
          receiving.set(line.id, total);
        }

        const stockLines: MovementLineInputDto[] = dto.lines
          .filter((input) => isStocked(orderLines.get(input.orderLineId)!.variant))
          .map((input) => {
            const line = orderLines.get(input.orderLineId)!;
            return {
              variantId: line.variantId,
              quantity: input.quantity,
              unitCost: netUnitCostBase(line, order.exchangeRate).toNumber(),
              lotNo: input.lotNo?.trim() || undefined,
              expiryDate: input.expiryDate,
              serialNos: input.serialNos,
            };
          });
        const deliveryNoteNo = dto.deliveryNoteNo?.trim() || null;
        const movement = stockLines.length
          ? await this.stock.post(tx, user, {
              type: StockMovementType.RECEIPT,
              movementDate: dto.receiptDate,
              targetWarehouseId: warehouse.id,
              reference: deliveryNoteNo ? `${order.number} / ${deliveryNoteNo}` : order.number,
              notes: dto.notes,
              lines: stockLines,
            })
          : null;

        const number = await this.numbering.next(companyId, 'GOODS_RECEIPT', tx);
        const created = await tx.goodsReceipt.create({
          data: {
            companyId,
            number,
            orderId: order.id,
            partnerId: order.partnerId,
            warehouseId: warehouse.id,
            receiptDate: parseDateOnly(dto.receiptDate),
            deliveryNoteNo,
            notes: dto.notes?.trim() || null,
            stockMovementId: movement?.movementId ?? null,
            createdById: user.id,
            lines: {
              create: dto.lines.map((input) => ({
                orderLineId: input.orderLineId,
                variantId: orderLines.get(input.orderLineId)!.variantId,
                quantity: dec(input.quantity),
                lotNo: input.lotNo?.trim() || null,
                expiryDate: input.expiryDate ? parseDateOnly(input.expiryDate) : null,
                serialNos: input.serialNos ?? [],
              })),
            },
          },
        });

        for (const [lineId, quantity] of receiving) {
          await tx.purchaseOrderLine.update({
            where: { id: lineId },
            data: { receivedQty: { increment: quantity } },
          });
        }
        const complete = order.lines.every((line) =>
          line.receivedQty.plus(receiving.get(line.id) ?? 0).greaterThanOrEqualTo(line.quantity),
        );
        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: {
            status: complete
              ? PurchaseOrderStatus.RECEIVED
              : PurchaseOrderStatus.PARTIALLY_RECEIVED,
          },
        });
        return created;
      },
      { timeout: 30_000 },
    );
    return this.findOne(companyId, receipt.id);
  }
}

function toDto(row: ListRow): GoodsReceiptDto {
  return {
    id: row.id,
    number: row.number,
    orderId: row.orderId,
    orderNumber: row.order.number,
    partnerId: row.partnerId,
    partnerTitle: row.partner.title,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    receiptDate: toDateOnly(row.receiptDate),
    deliveryNoteNo: row.deliveryNoteNo,
    lineCount: row._count.lines,
    stockMovementId: row.stockMovementId,
    stockMovementNumber: row.stockMovement?.number ?? null,
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    createdAt: row.createdAt,
  };
}

function toDetailDto(row: DetailRow): GoodsReceiptDetailDto {
  return {
    ...toDto(row),
    notes: row.notes,
    lines: row.lines.map((line) => ({
      id: line.id,
      orderLineId: line.orderLineId,
      variantId: line.variantId,
      productId: line.variant.productId,
      sku: line.variant.sku,
      description: line.orderLine.description || variantLabel(line.variant),
      unitCode: line.variant.product.unit.code,
      quantity: qty(line.quantity),
      lotNo: line.lotNo,
      expiryDate: line.expiryDate ? toDateOnly(line.expiryDate) : null,
      serialNos: line.serialNos,
    })),
  };
}
