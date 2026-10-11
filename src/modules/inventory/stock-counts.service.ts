import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductType,
  StockCountStatus,
  StockMovementType,
  TrackingType,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import type {
  AddCountLineDto,
  CreateStockCountDto,
  StockCountDetailDto,
  StockCountDto,
  StockCountQueryDto,
  UpdateCountLinesDto,
} from './dto/stock.dto';
import { qty } from './stock-math';
import { StockMovementsService, type LowStockItem } from './stock-movements.service';

const SORTABLE = ['number', 'countDate', 'createdAt'] as const;

const listInclude = {
  warehouse: { select: { name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  adjustment: { select: { number: true } },
  lines: { select: { expectedQty: true, countedQty: true } },
} satisfies Prisma.StockCountInclude;

const detailInclude = {
  ...listInclude,
  lines: {
    include: {
      variant: {
        select: {
          sku: true,
          barcode: true,
          name: true,
          product: { select: { name: true, unit: { select: { code: true } } } },
        },
      },
      lot: { select: { lotNo: true } },
    },
  },
} satisfies Prisma.StockCountInclude;

type ListRow = Prisma.StockCountGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.StockCountGetPayload<{ include: typeof detailInclude }>;

/**
 * Physical stock counts. Starting a count snapshots the warehouse's system quantities
 * (untracked and lot-tracked items; serial items are verified by serial number instead).
 * Completing it posts one ADJUSTMENT movement for every counted difference.
 */
@Injectable()
export class StockCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly movements: StockMovementsService,
  ) {}

  async findAll(companyId: string, query: StockCountQueryDto) {
    const where: Prisma.StockCountWhereInput = {
      companyId,
      status: query.status,
      warehouseId: query.warehouseId,
      ...(query.search && { number: { contains: query.search, mode: 'insensitive' } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockCount.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.stockCount.count({ where }),
    ]);
    return paginated(
      rows.map((row) => this.toDto(row)),
      total,
      query,
    );
  }

  async findOne(companyId: string, id: string): Promise<StockCountDetailDto> {
    const row = await this.prisma.stockCount.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Stock count not found');
    return this.toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreateStockCountDto): Promise<StockCountDetailDto> {
    const { companyId } = user;
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, companyId },
    });
    if (!warehouse) throw new BadRequestException('Warehouse not found');
    if (!warehouse.isActive) throw new BadRequestException('Warehouse is inactive');
    if (dto.categoryId) {
      const category = await this.prisma.productCategory.findFirst({
        where: { id: dto.categoryId, companyId },
      });
      if (!category) throw new BadRequestException('Product category not found');
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const open = await tx.stockCount.findFirst({
        where: { companyId, warehouseId: warehouse.id, status: StockCountStatus.DRAFT },
        select: { number: true },
      });
      if (open) {
        throw new ConflictException(`Count ${open.number} is still open for this warehouse`);
      }

      const product: Prisma.ProductWhereInput = {
        type: ProductType.GOODS,
        deletedAt: null,
        categoryId: dto.categoryId,
      };
      const [balances, lotBalances] = await Promise.all([
        tx.stockBalance.findMany({
          where: {
            warehouseId: warehouse.id,
            quantity: { gt: 0 },
            variant: { product: { ...product, trackingType: TrackingType.NONE } },
          },
          include: { variant: { select: { sku: true } } },
        }),
        tx.lotBalance.findMany({
          where: {
            warehouseId: warehouse.id,
            quantity: { gt: 0 },
            lot: { variant: { product: { ...product, trackingType: TrackingType.LOT } } },
          },
          include: {
            lot: { select: { variantId: true, lotNo: true, variant: { select: { sku: true } } } },
          },
        }),
      ]);
      const lines = [
        ...balances.map((b) => ({
          sku: b.variant.sku,
          lotNo: '',
          variantId: b.variantId,
          lotId: null as string | null,
          expectedQty: b.quantity,
        })),
        ...lotBalances.map((b) => ({
          sku: b.lot.variant.sku,
          lotNo: b.lot.lotNo,
          variantId: b.lot.variantId,
          lotId: b.lotId,
          expectedQty: b.quantity,
        })),
      ].sort((a, b) => a.sku.localeCompare(b.sku) || a.lotNo.localeCompare(b.lotNo));

      const count = await tx.stockCount.create({
        data: {
          companyId,
          number: await this.numbering.next(companyId, 'STOCK_COUNT', tx),
          warehouseId: warehouse.id,
          countDate: parseDateOnly(dto.countDate),
          notes: dto.notes?.trim() || null,
          createdById: user.id,
        },
      });
      await tx.stockCountLine.createMany({
        data: lines.map(({ variantId, lotId, expectedQty }) => ({
          countId: count.id,
          variantId,
          lotId,
          expectedQty,
        })),
      });
      return count.id;
    });
    return this.findOne(companyId, id);
  }

  async updateLines(
    companyId: string,
    id: string,
    dto: UpdateCountLinesDto,
  ): Promise<StockCountDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.getDraft(tx, companyId, id);
      const ids = dto.lines.map((line) => line.id);
      const found = await tx.stockCountLine.count({ where: { id: { in: ids }, countId: id } });
      if (found !== new Set(ids).size) throw new BadRequestException('Unknown count line');
      for (const line of dto.lines) {
        await tx.stockCountLine.update({
          where: { id: line.id },
          data: { countedQty: line.countedQty },
        });
      }
    });
    return this.findOne(companyId, id);
  }

  /** Adds an item that was found on the shelf but is not in the snapshot. */
  async addLine(companyId: string, id: string, dto: AddCountLineDto): Promise<StockCountDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const count = await this.getDraft(tx, companyId, id);
      const variant = await tx.productVariant.findFirst({
        where: { id: dto.variantId, companyId, product: { deletedAt: null } },
        include: { product: { select: { type: true, trackingType: true } } },
      });
      if (!variant || variant.product.type !== ProductType.GOODS) {
        throw new BadRequestException('Item not found');
      }
      if (variant.product.trackingType === TrackingType.SERIAL) {
        throw new BadRequestException('Serial tracked items are not counted by quantity');
      }
      const lotNo = dto.lotNo?.trim();
      if (variant.product.trackingType === TrackingType.LOT && !lotNo) {
        throw new BadRequestException('Lot number is required');
      }
      if (variant.product.trackingType === TrackingType.NONE && lotNo) {
        throw new BadRequestException('Item is not lot tracked');
      }

      const lot = lotNo
        ? await tx.stockLot.upsert({
            where: { variantId_lotNo: { variantId: variant.id, lotNo } },
            create: { companyId, variantId: variant.id, lotNo },
            update: {},
          })
        : null;
      const duplicate = await tx.stockCountLine.findFirst({
        where: { countId: id, variantId: variant.id, lotId: lot?.id ?? null },
      });
      if (duplicate) throw new ConflictException('Item is already on the count sheet');

      const balance = lot
        ? await tx.lotBalance.findUnique({
            where: { warehouseId_lotId: { warehouseId: count.warehouseId, lotId: lot.id } },
          })
        : await tx.stockBalance.findUnique({
            where: {
              warehouseId_variantId: { warehouseId: count.warehouseId, variantId: variant.id },
            },
          });
      await tx.stockCountLine.create({
        data: {
          countId: id,
          variantId: variant.id,
          lotId: lot?.id ?? null,
          expectedQty: balance?.quantity ?? 0,
          countedQty: dto.countedQty ?? null,
        },
      });
    });
    return this.findOne(companyId, id);
  }

  /** Posts the differences of counted lines as one adjustment and closes the count. */
  async complete(user: AuthUser, id: string): Promise<StockCountDetailDto> {
    const { companyId } = user;
    let lowStock: LowStockItem[] = [];
    await this.prisma.$transaction(
      async (tx) => {
        const count = await this.getDraft(tx, companyId, id);
        const lines = await tx.stockCountLine.findMany({ where: { countId: id } });
        const counted = lines.filter((line) => line.countedQty !== null);
        if (!counted.length) throw new BadRequestException('No line has been counted yet');

        const differences = counted
          .map((line) => ({ line, diff: line.countedQty!.minus(line.expectedQty) }))
          .filter(({ diff }) => !diff.isZero());

        let adjustmentId: string | null = null;
        if (differences.length) {
          const result = await this.movements.post(tx, user, {
            type: StockMovementType.ADJUSTMENT,
            movementDate: toDateOnly(count.countDate),
            targetWarehouseId: count.warehouseId,
            reference: count.number,
            notes: count.notes ?? undefined,
            lines: differences.map(({ line, diff }) => ({
              variantId: line.variantId,
              lotId: line.lotId ?? undefined,
              quantity: diff.toNumber(),
            })),
          });
          adjustmentId = result.movementId;
          lowStock = result.lowStock;
        }
        await tx.stockCount.update({
          where: { id },
          data: { status: StockCountStatus.COMPLETED, completedAt: new Date(), adjustmentId },
        });
      },
      { timeout: 30_000 },
    );
    await this.movements.notifyLowStock(companyId, lowStock);
    return this.findOne(companyId, id);
  }

  async cancel(companyId: string, id: string): Promise<StockCountDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.getDraft(tx, companyId, id);
      await tx.stockCount.update({ where: { id }, data: { status: StockCountStatus.CANCELLED } });
    });
    return this.findOne(companyId, id);
  }

  /** Loads a count and locks it, so concurrent edits and completion cannot interleave. */
  private async getDraft(tx: PrismaTx, companyId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM stock_counts WHERE id = ${id}::uuid FOR UPDATE`;
    const count = await tx.stockCount.findFirst({ where: { id, companyId } });
    if (!count) throw new NotFoundException('Stock count not found');
    if (count.status !== StockCountStatus.DRAFT) {
      throw new ConflictException('Only open counts can be changed');
    }
    return count;
  }

  private toDto(row: ListRow): StockCountDto {
    const counted = row.lines.filter((line) => line.countedQty !== null);
    return {
      id: row.id,
      number: row.number,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      status: row.status,
      countDate: toDateOnly(row.countDate),
      lineCount: row.lines.length,
      countedCount: counted.length,
      differenceCount: counted.filter((line) => !line.countedQty!.equals(line.expectedQty)).length,
      createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
      completedAt: row.completedAt,
      adjustmentId: row.adjustmentId,
      adjustmentNumber: row.adjustment?.number ?? null,
    };
  }

  private toDetailDto(row: DetailRow): StockCountDetailDto {
    return {
      ...this.toDto(row),
      notes: row.notes,
      lines: row.lines
        .map((line) => ({
          id: line.id,
          variantId: line.variantId,
          sku: line.variant.sku,
          barcode: line.variant.barcode,
          productName: line.variant.product.name,
          variantName: line.variant.name,
          unitCode: line.variant.product.unit.code,
          lotId: line.lotId,
          lotNo: line.lot?.lotNo ?? null,
          expectedQty: qty(line.expectedQty),
          countedQty: line.countedQty === null ? null : qty(line.countedQty),
          difference:
            line.countedQty === null ? null : qty(line.countedQty.minus(line.expectedQty)),
        }))
        .sort((a, b) => a.sku.localeCompare(b.sku) || (a.lotNo ?? '').localeCompare(b.lotNo ?? '')),
    };
  }
}
