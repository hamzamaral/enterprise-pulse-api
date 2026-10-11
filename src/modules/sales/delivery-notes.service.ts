import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalesOrderStatus, StockMovementType, TrackingType } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { MovementLineInputDto } from '../inventory/dto/stock.dto';
import { StockMovementsService } from '../inventory/stock-movements.service';
import { NumberingService } from '../numbering/numbering.service';
import { isStocked, qty, tradeVariantSelect, variantLabel } from '../partners/trade.service';
import type {
  CreateDeliveryNoteDto,
  DeliveryNoteDetailDto,
  DeliveryNoteDto,
  DeliveryNoteQueryDto,
} from './dto/sales.dto';

const SORTABLE = ['number', 'deliveryDate', 'createdAt'] as const;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const listInclude = {
  order: { select: { number: true } },
  partner: { select: { code: true, title: true, address: true, city: true } },
  warehouse: { select: { name: true } },
  stockMovement: { select: { number: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.DeliveryNoteInclude;

const detailInclude = {
  ...listInclude,
  lines: {
    include: {
      variant: { select: tradeVariantSelect },
      orderLine: { select: { lineNo: true, description: true } },
    },
    orderBy: { orderLine: { lineNo: 'asc' } },
  },
} satisfies Prisma.DeliveryNoteInclude;

type ListRow = Prisma.DeliveryNoteGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.DeliveryNoteGetPayload<{ include: typeof detailInclude }>;

/**
 * Delivery notes (irsaliye). Goods leave the order's warehouse through an ISSUE movement that
 * may use the order's own reservations; delivered quantities release those reservations.
 */
@Injectable()
export class DeliveryNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly stock: StockMovementsService,
  ) {}

  async findAll(companyId: string, query: DeliveryNoteQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.DeliveryNoteWhereInput = {
      companyId,
      orderId: query.orderId,
      partnerId: query.partnerId,
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { order: { number: { contains: search, mode: 'insensitive' } } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.deliveryNote.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.deliveryNote.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<DeliveryNoteDetailDto> {
    const row = await this.prisma.deliveryNote.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Delivery note not found');
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreateDeliveryNoteDto): Promise<DeliveryNoteDetailDto> {
    const { companyId } = user;
    const created = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${dto.orderId}::uuid FOR UPDATE`;
        const order = await tx.salesOrder.findFirst({
          where: { id: dto.orderId, companyId },
          include: {
            partner: { select: { address: true, city: true } },
            lines: { include: { variant: { select: tradeVariantSelect }, reservation: true } },
          },
        });
        if (!order) throw new BadRequestException('Sales order not found');
        if (
          order.status !== SalesOrderStatus.APPROVED &&
          order.status !== SalesOrderStatus.PARTIALLY_DELIVERED
        ) {
          throw new ConflictException('Only approved orders can be delivered');
        }

        const orderLines = new Map(order.lines.map((line) => [line.id, line]));
        const delivering = new Map<string, Prisma.Decimal>();
        for (const input of dto.lines) {
          const line = orderLines.get(input.orderLineId);
          if (!line) throw new BadRequestException('Delivery line refers to another order');
          const total = (delivering.get(line.id) ?? dec(0)).plus(input.quantity);
          const remaining = line.quantity.minus(line.deliveredQty);
          if (total.greaterThan(remaining)) {
            throw new BadRequestException(
              `Line ${line.lineNo}: only ${qty(remaining)} left to deliver`,
            );
          }
          delivering.set(line.id, total);
        }

        const stockLines: MovementLineInputDto[] = dto.lines
          .filter((input) => isStocked(orderLines.get(input.orderLineId)!.variant))
          .map((input) => ({
            variantId: orderLines.get(input.orderLineId)!.variantId,
            quantity: input.quantity,
            lotId: input.lotId,
            serialIds: input.serialIds,
          }));
        const number = await this.numbering.next(companyId, 'DELIVERY_NOTE', tx);
        const movement = stockLines.length
          ? await this.stock.post(
              tx,
              user,
              {
                type: StockMovementType.ISSUE,
                movementDate: dto.deliveryDate,
                sourceWarehouseId: order.warehouseId,
                reference: `${order.number} / ${number}`,
                notes: dto.notes,
                lines: stockLines,
              },
              { reservationOrderId: order.id },
            )
          : null;

        // Lot numbers and serial numbers are copied onto the note for printing.
        const lotIds = dto.lines.map((l) => l.lotId).filter((id): id is string => !!id);
        const serialIds = dto.lines.flatMap((l) => l.serialIds ?? []);
        const [lots, serials] = await Promise.all([
          tx.stockLot.findMany({
            where: { id: { in: lotIds } },
            select: { id: true, lotNo: true },
          }),
          tx.serialNumber.findMany({
            where: { id: { in: serialIds } },
            select: { id: true, serialNo: true },
          }),
        ]);
        const lotNos = new Map(lots.map((lot) => [lot.id, lot.lotNo]));
        const serialNos = new Map(serials.map((serial) => [serial.id, serial.serialNo]));

        const shippingAddress =
          dto.shippingAddress?.trim() ||
          [order.partner.address, order.partner.city].filter(Boolean).join(', ') ||
          null;
        const note = await tx.deliveryNote.create({
          data: {
            companyId,
            number,
            orderId: order.id,
            partnerId: order.partnerId,
            warehouseId: order.warehouseId,
            deliveryDate: parseDateOnly(dto.deliveryDate),
            shippingAddress,
            carrier: dto.carrier?.trim() || null,
            notes: dto.notes?.trim() || null,
            stockMovementId: movement?.movementId ?? null,
            createdById: user.id,
            lines: {
              create: dto.lines.map((input) => {
                const line = orderLines.get(input.orderLineId)!;
                const tracking = line.variant.product.trackingType;
                return {
                  orderLineId: line.id,
                  variantId: line.variantId,
                  quantity: dec(input.quantity),
                  lotNo:
                    tracking === TrackingType.LOT && input.lotId
                      ? (lotNos.get(input.lotId) ?? null)
                      : null,
                  serialNos: (input.serialIds ?? []).map((id) => serialNos.get(id) ?? id),
                };
              }),
            },
          },
        });

        for (const [lineId, quantity] of delivering) {
          const line = orderLines.get(lineId)!;
          await tx.salesOrderLine.update({
            where: { id: lineId },
            data: { deliveredQty: { increment: quantity } },
          });
          if (line.reservation) {
            const left = line.reservation.quantity.minus(quantity);
            if (left.lte(0)) {
              await tx.stockReservation.delete({ where: { id: line.reservation.id } });
            } else {
              await tx.stockReservation.update({
                where: { id: line.reservation.id },
                data: { quantity: left },
              });
            }
          }
        }
        const complete = order.lines.every((line) =>
          line.deliveredQty.plus(delivering.get(line.id) ?? 0).greaterThanOrEqualTo(line.quantity),
        );
        await tx.salesOrder.update({
          where: { id: order.id },
          data: {
            status: complete ? SalesOrderStatus.DELIVERED : SalesOrderStatus.PARTIALLY_DELIVERED,
          },
        });
        return { id: note.id, lowStock: movement?.lowStock ?? [] };
      },
      { timeout: 30_000 },
    );
    await this.stock.notifyLowStock(companyId, created.lowStock);
    return this.findOne(companyId, created.id);
  }
}

function toDto(row: ListRow): DeliveryNoteDto {
  return {
    id: row.id,
    number: row.number,
    orderId: row.orderId,
    orderNumber: row.order.number,
    partnerId: row.partnerId,
    partnerTitle: row.partner.title,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    deliveryDate: toDateOnly(row.deliveryDate),
    carrier: row.carrier,
    lineCount: row._count.lines,
    stockMovementId: row.stockMovementId,
    stockMovementNumber: row.stockMovement?.number ?? null,
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    createdAt: row.createdAt,
  };
}

function toDetailDto(row: DetailRow): DeliveryNoteDetailDto {
  return {
    ...toDto(row),
    shippingAddress: row.shippingAddress,
    notes: row.notes,
    partnerCode: row.partner.code,
    partnerAddress: [row.partner.address, row.partner.city].filter(Boolean).join(', ') || null,
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
      serialNos: line.serialNos,
    })),
  };
}
