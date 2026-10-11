import { Injectable } from '@nestjs/common';
import { Prisma, type TrackingType } from '@prisma/client';
import { toDateOnly } from '../../common/dates/date-only';
import { paginated, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  LedgerEntryDto,
  LedgerQueryDto,
  LotQueryDto,
  LotStockDto,
  SerialDto,
  SerialQueryDto,
  StockLevelDto,
  StockLevelQueryDto,
  StockSummaryDto,
} from './dto/stock.dto';
import { money, qty, unitCost } from './stock-math';

/** Allow-listed sort columns of the stock level query (never interpolate `sortBy` directly). */
const LEVEL_SORT: Record<string, Prisma.Sql> = {
  sku: Prisma.sql`v.sku`,
  productName: Prisma.sql`p.name`,
  quantity: Prisma.sql`quantity`,
  stockValue: Prisma.sql`"stockValue"`,
};

interface LevelRow {
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  categoryName: string | null;
  unitCode: string;
  trackingType: TrackingType;
  quantity: Prisma.Decimal;
  total: Prisma.Decimal;
  minStock: Prisma.Decimal;
  averageCost: Prisma.Decimal;
  stockValue: Prisma.Decimal;
  totalCount: bigint;
}

/** Read models over balances and the ledger: stock levels, lots, serials and the stock card. */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One row per stockable variant. With `warehouseId` the quantity is that warehouse's
   * balance (only items present there); otherwise the company-wide total.
   * `lowStock` always compares the company-wide total with the reorder point.
   */
  async findLevels(companyId: string, query: StockLevelQueryDto) {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`v."companyId" = ${companyId}::uuid`,
      Prisma.sql`p."deletedAt" IS NULL`,
      Prisma.sql`p.type = 'GOODS'`,
    ];
    if (query.warehouseId) {
      conditions.push(Prisma.sql`COALESCE(h.quantity, 0) <> 0`);
    } else {
      conditions.push(Prisma.sql`((v."isActive" AND p."isActive") OR COALESCE(t.total, 0) <> 0)`);
    }
    if (query.categoryId) conditions.push(Prisma.sql`p."categoryId" = ${query.categoryId}::uuid`);
    if (query.lowStock) {
      conditions.push(Prisma.sql`v."minStock" > 0 AND COALESCE(t.total, 0) < v."minStock"`);
    }
    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        Prisma.sql`(v.sku ILIKE ${term} OR p.code ILIKE ${term} OR p.name ILIKE ${term}
          OR v.name ILIKE ${term} OR v.barcode = ${query.search})`,
      );
    }
    const quantity = query.warehouseId
      ? Prisma.sql`COALESCE(h.quantity, 0)`
      : Prisma.sql`COALESCE(t.total, 0)`;
    const sortColumn = LEVEL_SORT[query.sortBy ?? ''] ?? Prisma.sql`v.sku`;
    const direction =
      query.sortOrder === 'desc' && query.sortBy ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const { skip, take } = toPageArgs(query);

    const rows = await this.prisma.$queryRaw<LevelRow[]>`
      WITH totals AS (
        SELECT "variantId", SUM(quantity) AS total
        FROM stock_balances WHERE "companyId" = ${companyId}::uuid
        GROUP BY "variantId"
      )
      SELECT v.id AS "variantId", p.id AS "productId", v.sku, p.name AS "productName",
             v.name AS "variantName", c.name AS "categoryName", u.code AS "unitCode",
             p."trackingType", ${quantity} AS quantity, COALESCE(t.total, 0) AS total,
             v."minStock", v."averageCost", ${quantity} * v."averageCost" AS "stockValue",
             COUNT(*) OVER () AS "totalCount"
      FROM product_variants v
      JOIN products p ON p.id = v."productId"
      JOIN units u ON u.id = p."unitId"
      LEFT JOIN product_categories c ON c.id = p."categoryId"
      LEFT JOIN totals t ON t."variantId" = v.id
      LEFT JOIN stock_balances h
        ON h."variantId" = v.id AND h."warehouseId" = ${query.warehouseId ?? null}::uuid
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${sortColumn} ${direction}, v.sku ASC
      OFFSET ${skip} LIMIT ${take}`;

    const total = rows.length ? Number(rows[0].totalCount) : 0;
    return paginated(
      rows.map((row): StockLevelDto => ({
        variantId: row.variantId,
        productId: row.productId,
        sku: row.sku,
        productName: row.productName,
        variantName: row.variantName,
        categoryName: row.categoryName,
        unitCode: row.unitCode,
        trackingType: row.trackingType,
        quantity: qty(row.quantity),
        minStock: qty(row.minStock),
        averageCost: unitCost(row.averageCost),
        stockValue: money(row.stockValue),
        lowStock: row.minStock.gt(0) && row.total.lt(row.minStock),
      })),
      total,
      query,
    );
  }

  async summary(companyId: string): Promise<StockSummaryDto> {
    const [rows, warehouseCount] = await Promise.all([
      this.prisma.$queryRaw<{ items: bigint; low: bigint; value: Prisma.Decimal | null }[]>`
        WITH totals AS (
          SELECT "variantId", SUM(quantity) AS total
          FROM stock_balances WHERE "companyId" = ${companyId}::uuid
          GROUP BY "variantId"
        )
        SELECT COUNT(*) FILTER (WHERE COALESCE(t.total, 0) > 0) AS items,
               COUNT(*) FILTER (
                 WHERE v."minStock" > 0 AND COALESCE(t.total, 0) < v."minStock"
               ) AS low,
               SUM(COALESCE(t.total, 0) * v."averageCost") AS value
        FROM product_variants v
        JOIN products p ON p.id = v."productId"
        LEFT JOIN totals t ON t."variantId" = v.id
        WHERE v."companyId" = ${companyId}::uuid AND p."deletedAt" IS NULL AND p.type = 'GOODS'
          AND v."isActive" AND p."isActive"`,
      this.prisma.warehouse.count({ where: { companyId, isActive: true } }),
    ]);
    const row = rows[0];
    return {
      itemCount: Number(row?.items ?? 0),
      lowStockCount: Number(row?.low ?? 0),
      stockValue: money(row?.value),
      warehouseCount,
    };
  }

  /** Lots of a variant that still have stock (per warehouse), oldest expiry first (FEFO). */
  async findLots(companyId: string, query: LotQueryDto): Promise<LotStockDto[]> {
    const rows = await this.prisma.lotBalance.findMany({
      where: {
        companyId,
        warehouseId: query.warehouseId,
        quantity: { gt: 0 },
        lot: { variantId: query.variantId },
      },
      include: {
        lot: { select: { lotNo: true, expiryDate: true } },
        warehouse: { select: { name: true } },
      },
    });
    return rows
      .map((row) => ({
        lotId: row.lotId,
        lotNo: row.lot.lotNo,
        expiryDate: toDateOnly(row.lot.expiryDate),
        warehouseId: row.warehouseId,
        warehouseName: row.warehouse.name,
        quantity: qty(row.quantity),
      }))
      .sort(
        (a, b) =>
          (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999') ||
          a.lotNo.localeCompare(b.lotNo),
      );
  }

  async findSerials(companyId: string, query: SerialQueryDto): Promise<SerialDto[]> {
    const rows = await this.prisma.serialNumber.findMany({
      where: {
        companyId,
        variantId: query.variantId,
        warehouseId: query.warehouseId,
        status: query.status,
      },
      include: { warehouse: { select: { name: true } } },
      orderBy: { serialNo: 'asc' },
      take: 1000,
    });
    return rows.map((row) => ({
      id: row.id,
      serialNo: row.serialNo,
      status: row.status,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse?.name ?? null,
    }));
  }

  /** Stock card: ledger entries of a variant, newest first. */
  async findLedger(companyId: string, query: LedgerQueryDto) {
    const where: Prisma.StockTransactionWhereInput = {
      companyId,
      variantId: query.variantId,
      warehouseId: query.warehouseId,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockTransaction.findMany({
        where,
        include: {
          movement: { select: { number: true, type: true } },
          warehouse: { select: { name: true } },
          lot: { select: { lotNo: true } },
        },
        orderBy: { seq: 'desc' },
        ...toPageArgs(query),
      }),
      this.prisma.stockTransaction.count({ where }),
    ]);
    return paginated(
      rows.map((row): LedgerEntryDto => ({
        id: row.id,
        movementId: row.movementId,
        movementNumber: row.movement.number,
        movementType: row.movement.type,
        movementDate: toDateOnly(row.movementDate),
        warehouseId: row.warehouseId,
        warehouseName: row.warehouse.name,
        lotNo: row.lot?.lotNo ?? null,
        quantity: qty(row.quantity),
        unitCost: unitCost(row.unitCost),
        balanceAfter: qty(row.balanceAfter),
        createdAt: row.createdAt,
      })),
      total,
      query,
    );
  }
}
