import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductType,
  SerialStatus,
  StockMovementType,
  TrackingType,
  type Warehouse,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import type {
  CreateStockMovementDto,
  MovementLineInputDto,
  MovementQueryDto,
  StockMovementDetailDto,
  StockMovementDto,
} from './dto/stock.dto';
import { crossedBelowMinimum, money, qty, unitCost, weightedAverageCost } from './stock-math';

const SORTABLE = ['number', 'movementDate', 'createdAt'] as const;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/** Which warehouses each movement type uses: [source, target]. */
const WAREHOUSES: Record<StockMovementType, [boolean, boolean]> = {
  RECEIPT: [false, true],
  ISSUE: [true, false],
  TRANSFER: [true, true],
  ADJUSTMENT: [false, true],
};

const listInclude = {
  sourceWarehouse: { select: { name: true } },
  targetWarehouse: { select: { name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  lines: { select: { quantity: true, unitCost: true } },
} satisfies Prisma.StockMovementInclude;

const detailInclude = {
  ...listInclude,
  stockCount: { select: { id: true, number: true } },
  lines: {
    include: {
      variant: {
        select: {
          sku: true,
          name: true,
          productId: true,
          product: { select: { name: true, unit: { select: { code: true } } } },
        },
      },
      lot: { select: { lotNo: true, expiryDate: true } },
      serials: { select: { serial: { select: { serialNo: true } } } },
    },
  },
} satisfies Prisma.StockMovementInclude;

type ListRow = Prisma.StockMovementGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.StockMovementGetPayload<{ include: typeof detailInclude }>;

type VariantRow = Prisma.ProductVariantGetPayload<{
  include: {
    product: {
      select: { name: true; type: true; trackingType: true; isActive: true; deletedAt: true };
    };
  };
}>;

export interface LowStockItem {
  variantId: string;
  productId: string;
  sku: string;
  name: string;
  onHand: Prisma.Decimal;
  minStock: Prisma.Decimal;
}

export interface PostResult {
  movementId: string;
  number: string;
  lowStock: LowStockItem[];
}

interface LedgerEntry {
  companyId: string;
  movementId: string;
  lineId: string;
  movementDate: Date;
  warehouse: Warehouse;
  variant: VariantRow;
  lotId: string | null;
  delta: Prisma.Decimal;
  cost: Prisma.Decimal;
}

/**
 * Posts stock documents. Every movement is applied immediately and never edited:
 * balances, lot balances and serials change inside one transaction, and each change is
 * written to the ledger (`StockTransaction`) with the resulting warehouse balance.
 */
@Injectable()
export class StockMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(user: AuthUser, dto: CreateStockMovementDto): Promise<StockMovementDetailDto> {
    const result = await this.prisma.$transaction((tx) => this.post(tx, user, dto), {
      timeout: 30_000,
    });
    await this.notifyLowStock(user.companyId, result.lowStock);
    return this.findOne(user.companyId, result.movementId);
  }

  /** Posts a movement inside the caller's transaction (also used by stock count completion). */
  async post(tx: PrismaTx, user: AuthUser, dto: CreateStockMovementDto): Promise<PostResult> {
    const { companyId } = user;
    const movementDate = parseDateOnly(dto.movementDate);
    // One day of slack: "today" in the user's time zone may already be tomorrow in UTC.
    if (movementDate.getTime() > Date.now() + 86_400_000) {
      throw new BadRequestException('Movement date cannot be in the future');
    }
    const { source, target } = await this.resolveWarehouses(tx, companyId, dto);

    // Lock the variants (in a stable order to avoid deadlocks) so concurrent movements
    // of the same item are serialized: balances, average cost and serials stay consistent.
    const variantIds = [...new Set(dto.lines.map((line) => line.variantId))].sort();
    await tx.$queryRaw`
      SELECT id FROM product_variants WHERE id = ANY(${variantIds}::uuid[]) ORDER BY id FOR UPDATE`;
    const variants = await tx.productVariant.findMany({
      where: { id: { in: variantIds }, companyId },
      include: {
        product: {
          select: { name: true, type: true, trackingType: true, isActive: true, deletedAt: true },
        },
      },
    });
    if (variants.length !== variantIds.length) {
      throw new BadRequestException('One or more items were not found');
    }
    const byId = new Map(variants.map((v) => [v.id, v]));
    this.validateLines(dto, byId);

    const onHand = await this.totalsByVariant(tx, variantIds);
    const before = new Map(onHand);
    const average = new Map(variants.map((v) => [v.id, v.averageCost]));

    const number = await this.numbering.next(companyId, 'STOCK_MOVEMENT', tx);
    const movement = await tx.stockMovement.create({
      data: {
        companyId,
        number,
        type: dto.type,
        movementDate,
        sourceWarehouseId: source?.id ?? null,
        targetWarehouseId: target?.id ?? null,
        reference: dto.reference?.trim() || null,
        notes: dto.notes?.trim() || null,
        createdById: user.id,
      },
    });

    for (const input of dto.lines) {
      const variant = byId.get(input.variantId)!;
      const quantity = dec(input.quantity);
      const incoming = isIncoming(dto.type, quantity);
      const lotId = await this.resolveLot(tx, companyId, variant, input, incoming);

      let cost = average.get(variant.id)!;
      if (dto.type === StockMovementType.RECEIPT) {
        const receiptCost = input.unitCost !== undefined ? dec(input.unitCost) : cost;
        average.set(
          variant.id,
          weightedAverageCost(onHand.get(variant.id)!, cost, quantity, receiptCost),
        );
        cost = receiptCost;
      }

      const line = await tx.stockMovementLine.create({
        data: { movementId: movement.id, variantId: variant.id, lotId, quantity, unitCost: cost },
      });
      await this.moveSerials(tx, companyId, dto.type, variant, input, line.id, source, target);

      const entries: [Warehouse, Prisma.Decimal][] =
        dto.type === StockMovementType.ISSUE
          ? [[source!, quantity.neg()]]
          : dto.type === StockMovementType.TRANSFER
            ? [
                [source!, quantity.neg()],
                [target!, quantity],
              ]
            : [[target!, quantity]];
      for (const [warehouse, delta] of entries) {
        await this.applyLedgerEntry(tx, {
          companyId,
          movementId: movement.id,
          lineId: line.id,
          movementDate,
          warehouse,
          variant,
          lotId,
          delta,
          cost,
        });
        onHand.set(variant.id, onHand.get(variant.id)!.plus(delta));
      }
    }

    for (const variant of variants) {
      const next = average.get(variant.id)!;
      if (!next.equals(variant.averageCost)) {
        await tx.productVariant.update({ where: { id: variant.id }, data: { averageCost: next } });
      }
    }

    const lowStock = variants
      .filter((v) => crossedBelowMinimum(before.get(v.id)!, onHand.get(v.id)!, v.minStock))
      .map((v) => ({
        variantId: v.id,
        productId: v.productId,
        sku: v.sku,
        name: v.name ? `${v.product.name} (${v.name})` : v.product.name,
        onHand: onHand.get(v.id)!,
        minStock: v.minStock,
      }));
    return { movementId: movement.id, number, lowStock };
  }

  /** Tells stock managers (`inventory:update`) that items fell below their reorder point. */
  async notifyLowStock(companyId: string, items: LowStockItem[]): Promise<void> {
    if (!items.length) return;
    const userIds = await this.notifications.findUserIdsWithPermission(
      companyId,
      'inventory:update',
    );
    for (const item of items) {
      await this.notifications.notify({
        userIds,
        companyId,
        type: 'inventory.low_stock',
        title: `Kritik stok: ${item.sku}`,
        body: `${item.name} stoğu ${qty(item.onHand)} — minimum ${qty(item.minStock)}.`,
        link: `/inventory/products/${item.productId}`,
      });
    }
  }

  async findAll(companyId: string, query: MovementQueryDto) {
    const filters: Prisma.StockMovementWhereInput[] = [];
    if (query.warehouseId) {
      filters.push({
        OR: [{ sourceWarehouseId: query.warehouseId }, { targetWarehouseId: query.warehouseId }],
      });
    }
    if (query.search) {
      filters.push({
        OR: [
          { number: { contains: query.search, mode: 'insensitive' } },
          { reference: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.StockMovementWhereInput = {
      companyId,
      type: query.type,
      AND: filters,
      ...((query.dateFrom || query.dateTo) && {
        movementDate: {
          gte: query.dateFrom ? parseDateOnly(query.dateFrom) : undefined,
          lte: query.dateTo ? parseDateOnly(query.dateTo) : undefined,
        },
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return paginated(
      rows.map((row) => this.toDto(row)),
      total,
      query,
    );
  }

  async findOne(companyId: string, id: string): Promise<StockMovementDetailDto> {
    const row = await this.prisma.stockMovement.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Stock movement not found');
    return this.toDetailDto(row);
  }

  // ---------- posting helpers ----------

  private async resolveWarehouses(tx: PrismaTx, companyId: string, dto: CreateStockMovementDto) {
    const [needsSource, needsTarget] = WAREHOUSES[dto.type];
    if (needsSource !== Boolean(dto.sourceWarehouseId)) {
      throw new BadRequestException(
        needsSource
          ? 'sourceWarehouseId is required'
          : `sourceWarehouseId is not allowed for ${dto.type}`,
      );
    }
    if (needsTarget !== Boolean(dto.targetWarehouseId)) {
      throw new BadRequestException(
        needsTarget
          ? 'targetWarehouseId is required'
          : `targetWarehouseId is not allowed for ${dto.type}`,
      );
    }
    if (dto.sourceWarehouseId && dto.sourceWarehouseId === dto.targetWarehouseId) {
      throw new BadRequestException('Source and target warehouses must differ');
    }
    const load = async (id: string | undefined) => {
      if (!id) return null;
      const warehouse = await tx.warehouse.findFirst({ where: { id, companyId } });
      if (!warehouse) throw new BadRequestException('Warehouse not found');
      if (!warehouse.isActive) {
        throw new BadRequestException(`Warehouse ${warehouse.name} is inactive`);
      }
      return warehouse;
    };
    return { source: await load(dto.sourceWarehouseId), target: await load(dto.targetWarehouseId) };
  }

  private validateLines(dto: CreateStockMovementDto, variants: Map<string, VariantRow>) {
    const seenSerials = new Set<string>();
    dto.lines.forEach((line, index) => {
      const variant = variants.get(line.variantId)!;
      const label = `Line ${index + 1} (${variant.sku})`;
      const quantity = dec(line.quantity);
      const incoming = isIncoming(dto.type, quantity);

      if (variant.product.type !== ProductType.GOODS) {
        throw new BadRequestException(`${label}: services are not stocked`);
      }
      if (dto.type === StockMovementType.ADJUSTMENT ? quantity.isZero() : quantity.lte(0)) {
        throw new BadRequestException(`${label}: invalid quantity`);
      }
      if (
        incoming &&
        (!variant.isActive || !variant.product.isActive || variant.product.deletedAt)
      ) {
        throw new BadRequestException(`${label}: item is inactive`);
      }
      if (line.unitCost !== undefined && dto.type !== StockMovementType.RECEIPT) {
        throw new BadRequestException(`${label}: unit cost can only be set on receipts`);
      }

      const tracking = variant.product.trackingType;
      const hasLot = Boolean(line.lotId || line.lotNo);
      const hasSerials = Boolean(line.serialNos?.length || line.serialIds?.length);
      if (tracking !== TrackingType.LOT && (hasLot || line.expiryDate)) {
        throw new BadRequestException(`${label}: item is not lot tracked`);
      }
      if (tracking !== TrackingType.SERIAL && hasSerials) {
        throw new BadRequestException(`${label}: item is not serial tracked`);
      }
      if (tracking === TrackingType.LOT && !hasLot) {
        throw new BadRequestException(`${label}: lot is required`);
      }
      if (tracking === TrackingType.SERIAL) {
        if (!quantity.isInteger()) {
          throw new BadRequestException(`${label}: serial tracked quantities must be whole`);
        }
        const serials = incoming
          ? (line.serialNos ?? []).map((s) => s.trim())
          : (line.serialIds ?? []);
        if (incoming && line.serialIds?.length) {
          throw new BadRequestException(`${label}: incoming serials are given as serialNos`);
        }
        if (!incoming && line.serialNos?.length) {
          throw new BadRequestException(`${label}: outgoing serials are given as serialIds`);
        }
        if (serials.length !== quantity.abs().toNumber()) {
          throw new BadRequestException(
            `${label}: ${quantity.abs().toString()} serial number(s) required`,
          );
        }
        for (const serial of serials) {
          const key = `${variant.id}:${serial}`;
          if (!serial || seenSerials.has(key)) {
            throw new BadRequestException(`${label}: duplicate serial number ${serial}`);
          }
          seenSerials.add(key);
        }
      }
    });
  }

  private async resolveLot(
    tx: PrismaTx,
    companyId: string,
    variant: VariantRow,
    line: MovementLineInputDto,
    incoming: boolean,
  ): Promise<string | null> {
    if (variant.product.trackingType !== TrackingType.LOT) return null;
    const expiryDate = line.expiryDate ? parseDateOnly(line.expiryDate) : undefined;
    if (line.lotId) {
      const lot = await tx.stockLot.findFirst({ where: { id: line.lotId, variantId: variant.id } });
      if (!lot) throw new BadRequestException(`Lot not found for ${variant.sku}`);
      return lot.id;
    }
    const lotNo = line.lotNo!.trim();
    if (!incoming) {
      const lot = await tx.stockLot.findUnique({
        where: { variantId_lotNo: { variantId: variant.id, lotNo } },
      });
      if (!lot) throw new BadRequestException(`Lot ${lotNo} not found for ${variant.sku}`);
      return lot.id;
    }
    const lot = await tx.stockLot.upsert({
      where: { variantId_lotNo: { variantId: variant.id, lotNo } },
      create: { companyId, variantId: variant.id, lotNo, expiryDate },
      update: expiryDate ? { expiryDate } : {},
    });
    return lot.id;
  }

  private async moveSerials(
    tx: PrismaTx,
    companyId: string,
    type: StockMovementType,
    variant: VariantRow,
    line: MovementLineInputDto,
    lineId: string,
    source: Warehouse | null,
    target: Warehouse | null,
  ): Promise<void> {
    if (variant.product.trackingType !== TrackingType.SERIAL) return;
    const incoming = isIncoming(type, dec(line.quantity));
    let serialIds: string[];

    if (incoming) {
      const serialNos = line.serialNos!.map((s) => s.trim());
      const existing = await tx.serialNumber.findMany({
        where: { variantId: variant.id, serialNo: { in: serialNos } },
      });
      const inStock = existing.find((s) => s.status === SerialStatus.IN_STOCK);
      if (inStock) {
        throw new ConflictException(`Serial number ${inStock.serialNo} is already in stock`);
      }
      if (existing.length) {
        await tx.serialNumber.updateMany({
          where: { id: { in: existing.map((s) => s.id) } },
          data: { status: SerialStatus.IN_STOCK, warehouseId: target!.id },
        });
      }
      const known = new Set(existing.map((s) => s.serialNo));
      const created = await tx.serialNumber.createManyAndReturn({
        data: serialNos
          .filter((serialNo) => !known.has(serialNo))
          .map((serialNo) => ({
            companyId,
            variantId: variant.id,
            serialNo,
            warehouseId: target!.id,
          })),
        select: { id: true },
      });
      serialIds = [...existing.map((s) => s.id), ...created.map((s) => s.id)];
    } else {
      const from = type === StockMovementType.ADJUSTMENT ? target! : source!;
      serialIds = line.serialIds!;
      const serials = await tx.serialNumber.findMany({
        where: { id: { in: serialIds }, variantId: variant.id, companyId },
      });
      if (serials.length !== serialIds.length) {
        throw new BadRequestException(`Unknown serial number for ${variant.sku}`);
      }
      const unavailable = serials.find(
        (s) => s.status !== SerialStatus.IN_STOCK || s.warehouseId !== from.id,
      );
      if (unavailable) {
        throw new BadRequestException(
          `Serial number ${unavailable.serialNo} is not in stock in ${from.name}`,
        );
      }
      await tx.serialNumber.updateMany({
        where: { id: { in: serialIds } },
        data:
          type === StockMovementType.TRANSFER
            ? { warehouseId: target!.id }
            : { status: SerialStatus.ISSUED, warehouseId: null },
      });
    }

    await tx.stockMovementSerial.createMany({
      data: serialIds.map((serialId) => ({ lineId, serialId })),
    });
  }

  /** Changes a warehouse balance (and lot balance) and records the ledger entry. */
  private async applyLedgerEntry(tx: PrismaTx, entry: LedgerEntry): Promise<void> {
    const { companyId, warehouse, variant, lotId, delta } = entry;
    const balanceKey = { warehouseId: warehouse.id, variantId: variant.id };

    if (delta.isNegative()) {
      const amount = delta.neg();
      // Conditional decrement: never lets a balance go below zero.
      const { count } = await tx.stockBalance.updateMany({
        where: { ...balanceKey, quantity: { gte: amount } },
        data: { quantity: { decrement: amount } },
      });
      if (!count) {
        throw new BadRequestException(`Insufficient stock of ${variant.sku} in ${warehouse.name}`);
      }
      if (lotId) {
        const lot = await tx.lotBalance.updateMany({
          where: { warehouseId: warehouse.id, lotId, quantity: { gte: amount } },
          data: { quantity: { decrement: amount } },
        });
        if (!lot.count) {
          throw new BadRequestException(
            `Insufficient stock of ${variant.sku} in the selected lot (${warehouse.name})`,
          );
        }
      }
    } else {
      await tx.stockBalance.upsert({
        where: { warehouseId_variantId: balanceKey },
        create: { companyId, ...balanceKey, quantity: delta },
        update: { quantity: { increment: delta } },
      });
      if (lotId) {
        await tx.lotBalance.upsert({
          where: { warehouseId_lotId: { warehouseId: warehouse.id, lotId } },
          create: { companyId, warehouseId: warehouse.id, lotId, quantity: delta },
          update: { quantity: { increment: delta } },
        });
      }
    }

    const balance = await tx.stockBalance.findUniqueOrThrow({
      where: { warehouseId_variantId: balanceKey },
      select: { quantity: true },
    });
    await tx.stockTransaction.create({
      data: {
        companyId,
        movementId: entry.movementId,
        lineId: entry.lineId,
        warehouseId: warehouse.id,
        variantId: variant.id,
        lotId,
        quantity: delta,
        unitCost: entry.cost,
        balanceAfter: balance.quantity,
        movementDate: entry.movementDate,
      },
    });
  }

  private async totalsByVariant(tx: PrismaTx, variantIds: string[]) {
    const rows = await tx.stockBalance.groupBy({
      by: ['variantId'],
      where: { variantId: { in: variantIds } },
      _sum: { quantity: true },
    });
    const totals = new Map(variantIds.map((id) => [id, dec(0)]));
    for (const row of rows) totals.set(row.variantId, dec(row._sum.quantity ?? 0));
    return totals;
  }

  // ---------- mapping ----------

  private toDto(row: ListRow): StockMovementDto {
    const total = row.lines.reduce(
      (sum, line) => sum.plus(line.quantity.times(line.unitCost ?? 0)),
      dec(0),
    );
    return {
      id: row.id,
      number: row.number,
      type: row.type,
      movementDate: toDateOnly(row.movementDate),
      sourceWarehouseId: row.sourceWarehouseId,
      sourceWarehouseName: row.sourceWarehouse?.name ?? null,
      targetWarehouseId: row.targetWarehouseId,
      targetWarehouseName: row.targetWarehouse?.name ?? null,
      reference: row.reference,
      lineCount: row.lines.length,
      totalValue: money(total),
      createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
      createdAt: row.createdAt,
    };
  }

  private toDetailDto(row: DetailRow): StockMovementDetailDto {
    return {
      ...this.toDto(row),
      notes: row.notes,
      stockCountId: row.stockCount?.id ?? null,
      stockCountNumber: row.stockCount?.number ?? null,
      lines: row.lines.map((line) => ({
        id: line.id,
        variantId: line.variantId,
        productId: line.variant.productId,
        sku: line.variant.sku,
        productName: line.variant.product.name,
        variantName: line.variant.name,
        unitCode: line.variant.product.unit.code,
        quantity: qty(line.quantity),
        unitCost: unitCost(line.unitCost),
        lineValue: money(line.quantity.times(line.unitCost ?? 0)),
        lotNo: line.lot?.lotNo ?? null,
        expiryDate: line.lot ? toDateOnly(line.lot.expiryDate) : null,
        serialNos: line.serials.map((s) => s.serial.serialNo).sort(),
      })),
    };
  }
}

/** Receipts and positive adjustments bring stock in; the rest take it out. */
function isIncoming(type: StockMovementType, quantity: Prisma.Decimal): boolean {
  return (
    type === StockMovementType.RECEIPT ||
    (type === StockMovementType.ADJUSTMENT && quantity.isPositive())
  );
}
