import { Prisma, WorkOrderStatus } from '@prisma/client';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import type { PrismaService, PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { qty } from '../inventory/stock-math';
import type { WorkOrderDto } from './dto/production.dto';
import { isLate, progress, ZERO, type BomShape } from './production-math';

export const PRODUCTION_READ = 'production:read';
export const PRODUCTION_UPDATE = 'production:update';
export const PRODUCTION_RECORD = 'production:record';

type Dec = Prisma.Decimal;
type Client = PrismaService | PrismaTx;

/** Today in Istanbul as a `@db.Date` value. */
export const productionToday = () =>
  parseDateOnly(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }));

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;

export const variantSelect = {
  id: true,
  sku: true,
  name: true,
  productId: true,
  averageCost: true,
  isActive: true,
  product: {
    select: {
      name: true,
      type: true,
      trackingType: true,
      purchasePrice: true,
      isActive: true,
      deletedAt: true,
      unit: { select: { code: true } },
    },
  },
} satisfies Prisma.ProductVariantSelect;

export type VariantRow = Prisma.ProductVariantGetPayload<{ select: typeof variantSelect }>;

/** Shared variant fields of the DTOs. */
export const variantFields = (v: VariantRow) => ({
  variantId: v.id,
  productId: v.productId,
  sku: v.sku,
  productName: v.product.name,
  variantName: v.name,
  unitCode: v.product.unit.code,
});

export const variantLabel = (v: { name: string | null; product: { name: string } }) =>
  v.name ? `${v.product.name} (${v.name})` : v.product.name;

export const workOrderInclude = {
  bom: { select: { code: true } },
  variant: { select: variantSelect },
  sourceWarehouse: { select: { name: true } },
  targetWarehouse: { select: { name: true } },
} satisfies Prisma.WorkOrderInclude;

export type WorkOrderRow = Prisma.WorkOrderGetPayload<{ include: typeof workOrderInclude }>;

export function toWorkOrderDto(row: WorkOrderRow, today = productionToday()): WorkOrderDto {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    bomId: row.bomId,
    bomCode: row.bom.code,
    ...variantFields(row.variant),
    quantity: qty(row.quantity),
    producedQty: qty(row.producedQty),
    progress: progress(row.producedQty, row.quantity),
    plannedStart: toDateOnly(row.plannedStart),
    plannedEnd: toDateOnly(row.plannedEnd),
    late: isLate(row.status, row.plannedEnd, today),
    sourceWarehouseId: row.sourceWarehouseId,
    sourceWarehouseName: row.sourceWarehouse.name,
    targetWarehouseId: row.targetWarehouseId,
    targetWarehouseName: row.targetWarehouse.name,
    reference: row.reference,
    createdAt: row.createdAt,
  };
}

/** On-hand quantity per variant, in one warehouse or in all of them. */
export async function onHandByVariant(
  client: Client,
  companyId: string,
  variantIds: string[],
  warehouseId?: string,
): Promise<Map<string, Dec>> {
  const rows = await client.stockBalance.groupBy({
    by: ['variantId'],
    where: { companyId, variantId: { in: variantIds }, ...(warehouseId && { warehouseId }) },
    _sum: { quantity: true },
  });
  const result = new Map(variantIds.map((id) => [id, ZERO]));
  for (const row of rows) result.set(row.variantId, row._sum.quantity ?? ZERO);
  return result;
}

export interface DefaultBom extends BomShape {
  id: string;
  variantId: string;
}

/** The active default BOM of every variant that has one. */
export async function defaultBoms(client: Client, companyId: string) {
  const rows = await client.billOfMaterials.findMany({
    where: { companyId, isDefault: true, isActive: true },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  });
  return new Map<string, DefaultBom>(
    rows.map((r) => [
      r.variantId,
      {
        id: r.id,
        variantId: r.variantId,
        quantity: r.quantity,
        laborCost: r.laborCost,
        overheadCost: r.overheadCost,
        lines: r.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          scrapRate: l.scrapRate,
        })),
      },
    ]),
  );
}

/** Statuses after which a work order no longer changes. */
export const CLOSED_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.COMPLETED,
  WorkOrderStatus.CANCELLED,
];

export const trimOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;
