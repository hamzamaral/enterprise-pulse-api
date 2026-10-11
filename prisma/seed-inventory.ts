import {
  Prisma,
  type PrismaClient,
  ProductType,
  SerialStatus,
  StockCountStatus,
  StockMovementType,
  TrackingType,
} from '@prisma/client';
import { weightedAverageCost } from '../src/modules/inventory/stock-math';
import { formatNumber } from '../src/modules/numbering/number-format';

const YEAR = new Date().getFullYear();
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const daysAgo = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - days));
};

const CATEGORIES: [code: string, name: string, parent?: string][] = [
  ['ELK', 'Elektronik'],
  ['BLG', 'Bilgisayar ve Aksesuar', 'ELK'],
  ['TEL', 'Telefon ve Tablet', 'ELK'],
  ['OFS', 'Ofis Malzemeleri'],
  ['KRT', 'Kırtasiye', 'OFS'],
  ['TKS', 'Tekstil'],
  ['GDA', 'Gıda ve İçecek'],
  ['TMZ', 'Temizlik'],
];

const WAREHOUSES: [code: string, name: string, branch: string, address: string][] = [
  ['MRK', 'Merkez Depo', 'MERKEZ', 'Tuzla Organize Sanayi Bölgesi, İstanbul'],
  ['ANK', 'Ankara Depo', 'ANK', 'Ostim OSB, Ankara'],
  ['IZM', 'İzmir Depo', 'IZM', 'Atatürk OSB, Çiğli, İzmir'],
];

interface SampleProduct {
  code: string;
  name: string;
  category: string;
  unit: string;
  type?: ProductType;
  tracking?: TrackingType;
  purchasePrice?: number;
  salePrice?: number;
  minStock?: number;
  barcode?: string;
  /** [sku suffix, name, attributes, minStock] */
  variants?: [string, string, Record<string, string>, number][];
}

const PRODUCTS: SampleProduct[] = [
  {
    code: 'PRD-LAPTOP',
    name: 'Dizüstü Bilgisayar 14" i7 / 16 GB',
    category: 'BLG',
    unit: 'ADET',
    tracking: TrackingType.SERIAL,
    purchasePrice: 32000,
    salePrice: 39999,
    minStock: 3,
    barcode: '8690000000017',
  },
  {
    code: 'PRD-MONITOR',
    name: '27" IPS Monitör',
    category: 'BLG',
    unit: 'ADET',
    purchasePrice: 6500,
    salePrice: 8499,
    minStock: 5,
    barcode: '8690000000024',
  },
  {
    code: 'PRD-MOUSE',
    name: 'Kablosuz Mouse',
    category: 'BLG',
    unit: 'ADET',
    purchasePrice: 350,
    salePrice: 549,
    variants: [
      ['SYH', 'Siyah', { Renk: 'Siyah' }, 20],
      ['BYZ', 'Beyaz', { Renk: 'Beyaz' }, 10],
    ],
  },
  {
    code: 'PRD-KLAVYE',
    name: 'Mekanik Klavye',
    category: 'BLG',
    unit: 'ADET',
    purchasePrice: 1200,
    salePrice: 1799,
    variants: [
      ['Q', 'Türkçe Q', { Düzen: 'Q' }, 10],
      ['F', 'Türkçe F', { Düzen: 'F' }, 3],
    ],
  },
  {
    code: 'PRD-PHONE',
    name: 'Akıllı Telefon 128 GB',
    category: 'TEL',
    unit: 'ADET',
    tracking: TrackingType.SERIAL,
    purchasePrice: 18000,
    salePrice: 22999,
    minStock: 2,
  },
  {
    code: 'PRD-POLO',
    name: 'Kurumsal Polo Tişört',
    category: 'TKS',
    unit: 'ADET',
    purchasePrice: 220,
    variants: [
      ['LCV-S', 'Lacivert / S', { Renk: 'Lacivert', Beden: 'S' }, 5],
      ['LCV-M', 'Lacivert / M', { Renk: 'Lacivert', Beden: 'M' }, 10],
      ['LCV-L', 'Lacivert / L', { Renk: 'Lacivert', Beden: 'L' }, 10],
      ['LCV-XL', 'Lacivert / XL', { Renk: 'Lacivert', Beden: 'XL' }, 5],
    ],
  },
  {
    code: 'PRD-A4',
    name: 'A4 Fotokopi Kağıdı (5 top)',
    category: 'KRT',
    unit: 'KOLI',
    purchasePrice: 450,
    salePrice: 590,
    minStock: 30,
    barcode: '8690000000031',
  },
  {
    code: 'PRD-TONER',
    name: 'Lazer Yazıcı Toneri',
    category: 'OFS',
    unit: 'ADET',
    purchasePrice: 1400,
    salePrice: 1900,
    minStock: 8,
  },
  {
    code: 'PRD-KAHVE',
    name: 'Filtre Kahve 1 kg',
    category: 'GDA',
    unit: 'KG',
    tracking: TrackingType.LOT,
    purchasePrice: 520,
    salePrice: 690,
    minStock: 10,
  },
  {
    code: 'PRD-SU',
    name: 'Damacana Su 19 L',
    category: 'GDA',
    unit: 'ADET',
    purchasePrice: 70,
    salePrice: 95,
    minStock: 20,
  },
  {
    code: 'PRD-DEZ',
    name: 'Yüzey Dezenfektanı 5 L',
    category: 'TMZ',
    unit: 'LT',
    tracking: TrackingType.LOT,
    purchasePrice: 180,
    salePrice: 260,
    minStock: 15,
  },
  {
    code: 'SRV-KURULUM',
    name: 'Kurulum ve Yapılandırma Hizmeti',
    category: 'BLG',
    unit: 'SAAT',
    type: ProductType.SERVICE,
    salePrice: 1500,
  },
];

interface SampleLine {
  sku: string;
  qty: number;
  cost?: number;
  lotNo?: string;
  expiry?: Date;
  serials?: string[];
}

interface SampleMovement {
  type: StockMovementType;
  date: Date;
  source?: string;
  target?: string;
  reference?: string;
  notes?: string;
  lines: SampleLine[];
}

const serials = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(4, '0')}`);

const MOVEMENTS: SampleMovement[] = [
  {
    type: StockMovementType.RECEIPT,
    date: daysAgo(60),
    target: 'MRK',
    reference: 'İRS-A-104288',
    notes: 'Yıllık tedarik anlaşması kapsamında ilk teslimat',
    lines: [
      { sku: 'PRD-LAPTOP', qty: 6, cost: 32000, serials: serials('LTP7-', 1, 6) },
      { sku: 'PRD-PHONE', qty: 4, cost: 18000, serials: serials('PHN-', 1, 4) },
      { sku: 'PRD-MONITOR', qty: 20, cost: 6500 },
      { sku: 'PRD-MOUSE-SYH', qty: 60, cost: 350 },
      { sku: 'PRD-MOUSE-BYZ', qty: 40, cost: 360 },
      { sku: 'PRD-KLAVYE-Q', qty: 25, cost: 1200 },
      { sku: 'PRD-KLAVYE-F', qty: 10, cost: 1250 },
      { sku: 'PRD-POLO-LCV-S', qty: 20, cost: 220 },
      { sku: 'PRD-POLO-LCV-M', qty: 40, cost: 220 },
      { sku: 'PRD-POLO-LCV-L', qty: 40, cost: 220 },
      { sku: 'PRD-POLO-LCV-XL', qty: 20, cost: 220 },
      { sku: 'PRD-A4', qty: 80, cost: 450 },
      { sku: 'PRD-TONER', qty: 12, cost: 1400 },
      { sku: 'PRD-KAHVE', qty: 30, cost: 520, lotNo: 'KHV-2401', expiry: daysAgo(-200) },
      { sku: 'PRD-SU', qty: 50, cost: 70 },
      { sku: 'PRD-DEZ', qty: 40, cost: 180, lotNo: 'DZN-0915', expiry: daysAgo(-300) },
    ],
  },
  {
    type: StockMovementType.RECEIPT,
    date: daysAgo(45),
    target: 'ANK',
    reference: 'İRS-B-55120',
    lines: [
      { sku: 'PRD-MONITOR', qty: 8, cost: 6700 },
      { sku: 'PRD-MOUSE-SYH', qty: 20, cost: 355 },
      { sku: 'PRD-A4', qty: 30, cost: 460 },
      { sku: 'PRD-KAHVE', qty: 15, cost: 540, lotNo: 'KHV-2402', expiry: daysAgo(-240) },
      { sku: 'PRD-SU', qty: 30, cost: 72 },
    ],
  },
  {
    type: StockMovementType.TRANSFER,
    date: daysAgo(30),
    source: 'MRK',
    target: 'IZM',
    notes: 'İzmir şubesi açılış sevkiyatı',
    lines: [
      { sku: 'PRD-LAPTOP', qty: 2, serials: ['LTP7-0005', 'LTP7-0006'] },
      { sku: 'PRD-MONITOR', qty: 4 },
      { sku: 'PRD-MOUSE-SYH', qty: 15 },
      { sku: 'PRD-A4', qty: 20 },
      { sku: 'PRD-DEZ', qty: 10, lotNo: 'DZN-0915' },
    ],
  },
  {
    type: StockMovementType.ISSUE,
    date: daysAgo(20),
    source: 'MRK',
    reference: 'Bilgi İşlem talebi #118',
    notes: 'Yeni başlayan personel için ekipman çıkışı',
    lines: [
      { sku: 'PRD-LAPTOP', qty: 2, serials: ['LTP7-0001', 'LTP7-0002'] },
      { sku: 'PRD-MONITOR', qty: 3 },
      { sku: 'PRD-MOUSE-SYH', qty: 10 },
      { sku: 'PRD-KLAVYE-Q', qty: 5 },
      { sku: 'PRD-TONER', qty: 6 },
      { sku: 'PRD-KAHVE', qty: 8, lotNo: 'KHV-2401' },
      { sku: 'PRD-POLO-LCV-M', qty: 34 },
    ],
  },
  {
    type: StockMovementType.RECEIPT,
    date: daysAgo(10),
    target: 'MRK',
    reference: 'İRS-A-104731',
    lines: [
      { sku: 'PRD-MONITOR', qty: 5, cost: 6600 },
      { sku: 'PRD-KAHVE', qty: 20, cost: 560, lotNo: 'KHV-2403', expiry: daysAgo(-260) },
    ],
  },
  {
    type: StockMovementType.ISSUE,
    date: daysAgo(5),
    source: 'ANK',
    reference: 'Ofis tüketimi',
    lines: [
      { sku: 'PRD-SU', qty: 12 },
      { sku: 'PRD-KAHVE', qty: 5, lotNo: 'KHV-2402' },
    ],
  },
];

/**
 * Stock demo data. Movements are applied the same way the API posts them
 * (balances, lots, serials, ledger, moving average cost), just without validation.
 */
export async function seedInventory(
  prisma: PrismaClient,
  companyId: string,
  adminId: string,
): Promise<void> {
  const categories = new Map<string, string>();
  for (const [code, name, parent] of CATEGORIES) {
    const row = await prisma.productCategory.upsert({
      where: { companyId_code: { companyId, code } },
      create: { companyId, code, name, parentId: parent ? categories.get(parent) : null },
      update: {},
    });
    categories.set(code, row.id);
  }

  const warehouses = new Map<string, string>();
  for (const [code, name, branchCode, address] of WAREHOUSES) {
    const branch = await prisma.branch.findUnique({
      where: { companyId_code: { companyId, code: branchCode } },
    });
    const row = await prisma.warehouse.upsert({
      where: { companyId_code: { companyId, code } },
      create: { companyId, code, name, address, branchId: branch?.id },
      update: {},
    });
    warehouses.set(code, row.id);
  }

  const units = new Map(
    (await prisma.unit.findMany({ where: { companyId } })).map((u) => [u.code, u.id]),
  );
  const vat = await prisma.taxRate.findUnique({
    where: { companyId_code: { companyId, code: 'KDV20' } },
  });
  const variants = new Map<string, { id: string; tracking: TrackingType }>();
  for (const sample of PRODUCTS) {
    const tracking = sample.tracking ?? TrackingType.NONE;
    const product = await prisma.product.upsert({
      where: { companyId_code: { companyId, code: sample.code } },
      create: {
        companyId,
        code: sample.code,
        name: sample.name,
        categoryId: categories.get(sample.category),
        unitId: units.get(sample.unit)!,
        type: sample.type ?? ProductType.GOODS,
        trackingType: tracking,
        purchasePrice: sample.purchasePrice,
        salePrice: sample.salePrice,
        vatRateId: vat?.id,
      },
      update: {},
    });
    const definitions: Prisma.ProductVariantUncheckedCreateInput[] = sample.variants
      ? sample.variants.map(([suffix, name, attributes, minStock], index) => ({
          companyId,
          productId: product.id,
          sku: `${sample.code}-${suffix}`,
          name,
          attributes,
          minStock,
          isDefault: index === 0,
        }))
      : [
          {
            companyId,
            productId: product.id,
            sku: sample.code,
            barcode: sample.barcode,
            minStock: sample.minStock ?? 0,
            isDefault: true,
          },
        ];
    for (const data of definitions) {
      const variant = await prisma.productVariant.upsert({
        where: { companyId_sku: { companyId, sku: data.sku } },
        create: data,
        update: {},
      });
      variants.set(variant.sku, { id: variant.id, tracking });
    }
  }

  if (await prisma.stockMovement.count({ where: { companyId } })) return;

  const onHand = new Map<string, Prisma.Decimal>();
  const average = new Map<string, Prisma.Decimal>();
  let movementNo = 0;

  const applyEntry = async (
    tx: Prisma.TransactionClient,
    entry: {
      movementId: string;
      lineId: string;
      date: Date;
      warehouseId: string;
      variantId: string;
      lotId: string | null;
      delta: Prisma.Decimal;
      cost: Prisma.Decimal;
    },
  ) => {
    const { warehouseId, variantId, lotId, delta } = entry;
    const balance = await tx.stockBalance.upsert({
      where: { warehouseId_variantId: { warehouseId, variantId } },
      create: { companyId, warehouseId, variantId, quantity: delta },
      update: { quantity: { increment: delta } },
    });
    if (lotId) {
      await tx.lotBalance.upsert({
        where: { warehouseId_lotId: { warehouseId, lotId } },
        create: { companyId, warehouseId, lotId, quantity: delta },
        update: { quantity: { increment: delta } },
      });
    }
    await tx.stockTransaction.create({
      data: {
        companyId,
        movementId: entry.movementId,
        lineId: entry.lineId,
        warehouseId,
        variantId,
        lotId,
        quantity: delta,
        unitCost: entry.cost,
        balanceAfter: balance.quantity,
        movementDate: entry.date,
      },
    });
    onHand.set(variantId, (onHand.get(variantId) ?? dec(0)).plus(delta));
  };

  const post = (movement: SampleMovement) =>
    prisma.$transaction(async (tx) => {
      movementNo += 1;
      const source = movement.source ? warehouses.get(movement.source)! : null;
      const target = movement.target ? warehouses.get(movement.target)! : null;
      const created = await tx.stockMovement.create({
        data: {
          companyId,
          number: formatNumber({ prefix: 'STH', padding: 6, includeYear: true }, YEAR, movementNo),
          type: movement.type,
          movementDate: movement.date,
          sourceWarehouseId: source,
          targetWarehouseId: target,
          reference: movement.reference,
          notes: movement.notes,
          createdById: adminId,
        },
      });

      for (const sample of movement.lines) {
        const variant = variants.get(sample.sku)!;
        const quantity = dec(sample.qty);
        const lot = sample.lotNo
          ? await tx.stockLot.upsert({
              where: { variantId_lotNo: { variantId: variant.id, lotNo: sample.lotNo } },
              create: {
                companyId,
                variantId: variant.id,
                lotNo: sample.lotNo,
                expiryDate: sample.expiry,
              },
              update: {},
            })
          : null;

        let cost = average.get(variant.id) ?? dec(0);
        if (movement.type === StockMovementType.RECEIPT) {
          const receiptCost = dec(sample.cost ?? 0);
          average.set(
            variant.id,
            weightedAverageCost(onHand.get(variant.id) ?? 0, cost, quantity, receiptCost),
          );
          cost = receiptCost;
        }

        const line = await tx.stockMovementLine.create({
          data: {
            movementId: created.id,
            variantId: variant.id,
            lotId: lot?.id,
            quantity,
            unitCost: cost,
          },
        });

        if (sample.serials) {
          let serialIds: string[];
          if (movement.type === StockMovementType.RECEIPT) {
            const rows = await tx.serialNumber.createManyAndReturn({
              data: sample.serials.map((serialNo) => ({
                companyId,
                variantId: variant.id,
                serialNo,
                warehouseId: target,
              })),
              select: { id: true },
            });
            serialIds = rows.map((r) => r.id);
          } else {
            const rows = await tx.serialNumber.findMany({
              where: { variantId: variant.id, serialNo: { in: sample.serials } },
              select: { id: true },
            });
            serialIds = rows.map((r) => r.id);
            await tx.serialNumber.updateMany({
              where: { id: { in: serialIds } },
              data:
                movement.type === StockMovementType.TRANSFER
                  ? { warehouseId: target }
                  : { status: SerialStatus.ISSUED, warehouseId: null },
            });
          }
          await tx.stockMovementSerial.createMany({
            data: serialIds.map((serialId) => ({ lineId: line.id, serialId })),
          });
        }

        const entries: [string, Prisma.Decimal][] =
          movement.type === StockMovementType.ISSUE
            ? [[source!, quantity.neg()]]
            : movement.type === StockMovementType.TRANSFER
              ? [
                  [source!, quantity.neg()],
                  [target!, quantity],
                ]
              : [[target!, quantity]];
        for (const [warehouseId, delta] of entries) {
          await applyEntry(tx, {
            movementId: created.id,
            lineId: line.id,
            date: movement.date,
            warehouseId,
            variantId: variant.id,
            lotId: lot?.id ?? null,
            delta,
            cost,
          });
        }
      }
      return created.id;
    });

  for (const movement of MOVEMENTS) await post(movement);

  for (const variant of variants.values()) {
    const cost = average.get(variant.id);
    if (cost) {
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: { averageCost: cost },
      });
    }
  }

  /** Count sheet like the API snapshots it: untracked balances plus lot balances. */
  const snapshot = async (warehouseId: string) => {
    const [balances, lots] = await Promise.all([
      prisma.stockBalance.findMany({
        where: {
          warehouseId,
          quantity: { gt: 0 },
          variant: { product: { trackingType: TrackingType.NONE } },
        },
        include: { variant: { select: { sku: true } } },
      }),
      prisma.lotBalance.findMany({
        where: { warehouseId, quantity: { gt: 0 } },
        include: { lot: { select: { variantId: true, variant: { select: { sku: true } } } } },
      }),
    ]);
    return [
      ...balances.map((b) => ({
        sku: b.variant.sku,
        variantId: b.variantId,
        lotId: null as string | null,
        quantity: b.quantity,
      })),
      ...lots.map((b) => ({
        sku: b.lot.variant.sku,
        variantId: b.lot.variantId,
        lotId: b.lotId,
        quantity: b.quantity,
      })),
    ];
  };

  // A completed count in the central warehouse: one damaged box of paper, one extra water.
  const differences: Record<string, number> = { 'PRD-A4': -2, 'PRD-SU': 1 };
  const countDate = daysAgo(3);
  const countNumber = formatNumber({ prefix: 'SAY', padding: 6, includeYear: true }, YEAR, 1);
  const adjustmentId = await post({
    type: StockMovementType.ADJUSTMENT,
    date: countDate,
    target: 'MRK',
    reference: countNumber,
    notes: 'Ay sonu sayım farkları',
    lines: Object.entries(differences).map(([sku, qty]) => ({ sku, qty })),
  });
  // Stock now equals what was counted; the snapshot held the pre-adjustment quantities.
  const counted = await snapshot(warehouses.get('MRK')!);
  await prisma.stockCount.create({
    data: {
      companyId,
      number: countNumber,
      warehouseId: warehouses.get('MRK')!,
      status: StockCountStatus.COMPLETED,
      countDate,
      notes: 'Ay sonu sayım farkları',
      createdById: adminId,
      completedAt: countDate,
      adjustmentId,
      lines: {
        create: counted.map(({ sku, variantId, lotId, quantity }) => ({
          variantId,
          lotId,
          expectedQty: quantity.minus(lotId ? 0 : (differences[sku] ?? 0)),
          countedQty: quantity,
        })),
      },
    },
  });

  // An open count in İzmir: only the monitors have been counted so far.
  const open = await snapshot(warehouses.get('IZM')!);
  await prisma.stockCount.create({
    data: {
      companyId,
      number: formatNumber({ prefix: 'SAY', padding: 6, includeYear: true }, YEAR, 2),
      warehouseId: warehouses.get('IZM')!,
      countDate: daysAgo(0),
      notes: 'Çeyrek sonu sayımı',
      createdById: adminId,
      lines: {
        create: open.map(({ sku, variantId, lotId, quantity }) => ({
          variantId,
          lotId,
          expectedQty: quantity,
          countedQty: sku === 'PRD-MONITOR' ? quantity : null,
        })),
      },
    },
  });

  await prisma.numberSequence.updateMany({
    where: { companyId, code: 'STOCK_MOVEMENT', nextValue: { lte: movementNo } },
    data: { nextValue: movementNo + 1, currentYear: YEAR },
  });
  await prisma.numberSequence.updateMany({
    where: { companyId, code: 'STOCK_COUNT', nextValue: { lte: 2 } },
    data: { nextValue: 3, currentYear: YEAR },
  });
}
