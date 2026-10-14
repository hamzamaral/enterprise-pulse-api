import { Prisma, type PrismaClient, StockMovementType, WorkOrderStatus } from '@prisma/client';
import { weightedAverageCost } from '../src/modules/inventory/stock-math';
import { formatNumber } from '../src/modules/numbering/number-format';
import { costPerUnit, perUnit, required } from '../src/modules/production/production-math';

const YEAR = new Date().getFullYear();
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const ZERO = dec(0);

const daysAgo = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - days));
};

interface MadeProduct {
  code: string;
  name: string;
  unit: string;
  salePrice: number;
  minStock: number;
}

const PRODUCTS: MadeProduct[] = [
  {
    code: 'PRD-ISTASYON',
    name: 'Çalışma İstasyonu Seti',
    unit: 'ADET',
    salePrice: 10900,
    minStock: 2,
  },
  {
    code: 'PRD-KIT',
    name: 'Yeni Personel Başlangıç Kiti',
    unit: 'ADET',
    salePrice: 12900,
    minStock: 0,
  },
  { code: 'PRD-IKRAM', name: 'Toplantı İkram Paketi', unit: 'ADET', salePrice: 790, minStock: 0 },
];

interface SampleBom {
  sku: string;
  name: string;
  quantity: number;
  laborCost: number;
  overheadCost: number;
  notes?: string;
  lines: [sku: string, quantity: number, scrapRate?: number][];
}

const BOMS: SampleBom[] = [
  {
    sku: 'PRD-ISTASYON',
    name: 'Çalışma istasyonu montajı',
    quantity: 1,
    laborCost: 250,
    overheadCost: 75,
    notes: 'Monitör, klavye ve mouse kutudan çıkarılıp test edilir, set halinde paketlenir.',
    lines: [
      ['PRD-MONITOR', 1],
      ['PRD-KLAVYE-Q', 1],
      ['PRD-MOUSE-SYH', 1],
    ],
  },
  {
    sku: 'PRD-KIT',
    name: 'Personel başlangıç kiti',
    quantity: 1,
    laborCost: 120,
    overheadCost: 40,
    lines: [
      ['PRD-ISTASYON', 1],
      ['PRD-POLO-LCV-M', 1],
      ['PRD-A4', 1],
    ],
  },
  {
    sku: 'PRD-IKRAM',
    name: 'İkram paketi (10 kişilik)',
    quantity: 10,
    laborCost: 300,
    overheadCost: 100,
    lines: [
      ['PRD-KAHVE', 5, 4],
      ['PRD-SU', 20],
    ],
  },
];

interface SampleOrder {
  sku: string;
  quantity: number;
  status: WorkOrderStatus;
  start: number;
  end: number;
  reference?: string;
  /** Production records: [days ago, quantity]. */
  records?: [number, number][];
}

const ORDERS: SampleOrder[] = [
  {
    sku: 'PRD-ISTASYON',
    quantity: 3,
    status: WorkOrderStatus.COMPLETED,
    start: 14,
    end: 12,
    reference: 'Bilgi İşlem talebi #131',
    records: [[12, 3]],
  },
  {
    sku: 'PRD-KIT',
    quantity: 12,
    status: WorkOrderStatus.RELEASED,
    start: -3,
    end: -7,
    reference: 'Eylül işe alım dönemi',
  },
  { sku: 'PRD-IKRAM', quantity: 20, status: WorkOrderStatus.DRAFT, start: -10, end: -11 },
  {
    sku: 'PRD-ISTASYON',
    quantity: 6,
    status: WorkOrderStatus.IN_PROGRESS,
    start: 6,
    end: 1,
    records: [[2, 2]],
  },
];

/**
 * Production demo data: made products and their BOMs (the starter kit uses the workstation set,
 * so MRP shows a two-level structure) and work orders in every open state. Production records
 * post their stock movements the same way the API does.
 */
export async function seedProduction(
  prisma: PrismaClient,
  ctx: { companyId: string; adminId: string },
): Promise<void> {
  const { companyId, adminId } = ctx;
  for (const [code, name, prefix] of [
    ['WORK_ORDER', 'İş Emri', 'ISE'],
    ['PRODUCTION', 'Üretim Fişi', 'URT'],
  ]) {
    await prisma.numberSequence.upsert({
      where: { companyId_code: { companyId, code } },
      create: { companyId, code, name, prefix, currentYear: YEAR },
      update: {},
    });
  }

  const category = await prisma.productCategory.findUnique({
    where: { companyId_code: { companyId, code: 'BLG' } },
  });
  const vat = await prisma.taxRate.findUnique({
    where: { companyId_code: { companyId, code: 'KDV20' } },
  });
  const units = new Map(
    (await prisma.unit.findMany({ where: { companyId } })).map((u) => [u.code, u.id]),
  );
  for (const sample of PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { companyId_code: { companyId, code: sample.code } },
      create: {
        companyId,
        code: sample.code,
        name: sample.name,
        categoryId: category?.id,
        unitId: units.get(sample.unit)!,
        salePrice: sample.salePrice,
        vatRateId: vat?.id,
      },
      update: {},
    });
    await prisma.productVariant.upsert({
      where: { companyId_sku: { companyId, sku: sample.code } },
      create: {
        companyId,
        productId: product.id,
        sku: sample.code,
        minStock: sample.minStock,
        isDefault: true,
      },
      update: {},
    });
  }

  const skus = [...new Set(BOMS.flatMap((b) => [b.sku, ...b.lines.map(([sku]) => sku)]))];
  const variants = new Map(
    (await prisma.productVariant.findMany({ where: { companyId, sku: { in: skus } } })).map((v) => [
      v.sku,
      v,
    ]),
  );
  if (variants.size !== skus.length) return;

  const upsertBom = async (sample: SampleBom) => {
    const code = `${sample.sku}-R1`;
    const existing = await prisma.billOfMaterials.findUnique({
      where: { companyId_code: { companyId, code } },
      include: { lines: true },
    });
    if (existing) return existing;
    return prisma.billOfMaterials.create({
      data: {
        companyId,
        code,
        name: sample.name,
        variantId: variants.get(sample.sku)!.id,
        quantity: sample.quantity,
        laborCost: sample.laborCost,
        overheadCost: sample.overheadCost,
        isDefault: true,
        notes: sample.notes,
        createdById: adminId,
        lines: {
          create: sample.lines.map(([sku, quantity, scrapRate], index) => ({
            lineNo: index + 1,
            variantId: variants.get(sku)!.id,
            quantity,
            scrapRate: scrapRate ?? 0,
          })),
        },
      },
      include: { lines: true },
    });
  };
  const boms = new Map<string, Awaited<ReturnType<typeof upsertBom>>>();
  for (const sample of BOMS) boms.set(sample.sku, await upsertBom(sample));

  if (await prisma.workOrder.count({ where: { companyId } })) return;

  const warehouse = await prisma.warehouse.findUnique({
    where: { companyId_code: { companyId, code: 'MRK' } },
  });
  if (!warehouse) return;

  const next = async (tx: Prisma.TransactionClient, code: string) => {
    const sequence = await tx.numberSequence.findUniqueOrThrow({
      where: { companyId_code: { companyId, code } },
    });
    const value = sequence.resetYearly && sequence.currentYear !== YEAR ? 1 : sequence.nextValue;
    await tx.numberSequence.update({
      where: { id: sequence.id },
      data: { currentYear: YEAR, nextValue: value + 1 },
    });
    return formatNumber(sequence, YEAR, value);
  };

  /** Posts one movement line set into `warehouse` like the stock service (no lots here). */
  const move = async (
    tx: Prisma.TransactionClient,
    type: StockMovementType,
    date: Date,
    reference: string,
    notes: string,
    lines: { variantId: string; quantity: Prisma.Decimal; unitCost?: Prisma.Decimal }[],
  ) => {
    const movement = await tx.stockMovement.create({
      data: {
        companyId,
        number: await next(tx, 'STOCK_MOVEMENT'),
        type,
        movementDate: date,
        ...(type === StockMovementType.ISSUE
          ? { sourceWarehouseId: warehouse.id }
          : { targetWarehouseId: warehouse.id }),
        reference,
        notes,
        createdById: adminId,
      },
    });
    let value = ZERO;
    for (const input of lines) {
      const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: input.variantId } });
      const total = await tx.stockBalance.aggregate({
        where: { variantId: variant.id },
        _sum: { quantity: true },
      });
      let cost = variant.averageCost;
      if (type === StockMovementType.RECEIPT) {
        cost = input.unitCost ?? cost;
        await tx.productVariant.update({
          where: { id: variant.id },
          data: {
            averageCost: weightedAverageCost(
              total._sum.quantity ?? 0,
              variant.averageCost,
              input.quantity,
              cost,
            ),
          },
        });
      }
      const delta = type === StockMovementType.ISSUE ? input.quantity.neg() : input.quantity;
      const line = await tx.stockMovementLine.create({
        data: {
          movementId: movement.id,
          variantId: variant.id,
          quantity: input.quantity,
          unitCost: cost,
        },
      });
      const balance = await tx.stockBalance.upsert({
        where: { warehouseId_variantId: { warehouseId: warehouse.id, variantId: variant.id } },
        create: { companyId, warehouseId: warehouse.id, variantId: variant.id, quantity: delta },
        update: { quantity: { increment: delta } },
      });
      await tx.stockTransaction.create({
        data: {
          companyId,
          movementId: movement.id,
          lineId: line.id,
          warehouseId: warehouse.id,
          variantId: variant.id,
          quantity: delta,
          unitCost: cost,
          balanceAfter: balance.quantity,
          movementDate: date,
        },
      });
      value = value.plus(input.quantity.times(cost));
    }
    return { id: movement.id, value: value.toDecimalPlaces(2) };
  };

  for (const sample of ORDERS) {
    const bom = boms.get(sample.sku)!;
    await prisma.$transaction(async (tx) => {
      const quantity = dec(sample.quantity);
      const number = await next(tx, 'WORK_ORDER');
      const created = daysAgo(Math.max(sample.start, 0) + 2);
      const order = await tx.workOrder.create({
        data: {
          companyId,
          number,
          bomId: bom.id,
          variantId: bom.variantId,
          quantity,
          status: sample.status,
          plannedStart: daysAgo(sample.start),
          plannedEnd: daysAgo(sample.end),
          sourceWarehouseId: warehouse.id,
          targetWarehouseId: warehouse.id,
          laborPerUnit: costPerUnit(bom.laborCost, bom.quantity),
          overheadPerUnit: costPerUnit(bom.overheadCost, bom.quantity),
          reference: sample.reference,
          createdById: adminId,
          createdAt: created,
          releasedAt: sample.status === WorkOrderStatus.DRAFT ? null : created,
          components: {
            create: bom.lines.map((line) => {
              const quantityPer = perUnit(line, bom.quantity);
              return {
                lineNo: line.lineNo,
                variantId: line.variantId,
                quantityPer,
                requiredQty: required(quantityPer, quantity),
              };
            }),
          },
        },
        include: { components: true },
      });

      let produced = ZERO;
      for (const [days, output] of sample.records ?? []) {
        const date = daysAgo(days);
        const recordNo = await next(tx, 'PRODUCTION');
        const notes = `İş emri ${number} — üretim fişi ${recordNo}`;
        const out = dec(output);
        const uses = order.components.map((c) => ({
          component: c,
          quantity: required(c.quantityPer, out),
        }));
        const issue = await move(
          tx,
          StockMovementType.ISSUE,
          date,
          number,
          notes,
          uses.map((u) => ({ variantId: u.component.variantId, quantity: u.quantity })),
        );
        const labor = order.laborPerUnit.times(out).toDecimalPlaces(2);
        const overhead = order.overheadPerUnit.times(out).toDecimalPlaces(2);
        const unitCost = issue.value.plus(labor).plus(overhead).dividedBy(out).toDecimalPlaces(4);
        const receipt = await move(tx, StockMovementType.RECEIPT, date, number, notes, [
          { variantId: order.variantId, quantity: out, unitCost },
        ]);
        await tx.productionRecord.create({
          data: {
            companyId,
            workOrderId: order.id,
            number: recordNo,
            recordDate: date,
            quantity: out,
            materialCost: issue.value,
            laborCost: labor,
            overheadCost: overhead,
            unitCost,
            issueMovementId: issue.id,
            receiptMovementId: receipt.id,
            createdById: adminId,
            createdAt: date,
          },
        });
        for (const use of uses) {
          await tx.workOrderComponent.update({
            where: { id: use.component.id },
            data: { consumedQty: { increment: use.quantity } },
          });
        }
        produced = produced.plus(out);
      }
      if (produced.gt(0)) {
        const first = sample.records![0][0];
        await tx.workOrder.update({
          where: { id: order.id },
          data: {
            producedQty: produced,
            startedAt: daysAgo(first),
            completedAt: sample.status === WorkOrderStatus.COMPLETED ? daysAgo(first) : null,
          },
        });
      }
    });
  }
}
