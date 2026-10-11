import {
  InvoiceStatus,
  LedgerDocumentType,
  PartnerType,
  Prisma,
  type PrismaClient,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  SupplierQuoteStatus,
} from '@prisma/client';
import { documentAmounts, lineAmounts, toBase } from '../src/common/money/document-totals';
import { formatNumber } from '../src/modules/numbering/number-format';

const YEAR = new Date().getFullYear();
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const docNo = (prefix: string, value: number) =>
  formatNumber({ prefix, padding: 6, includeYear: true }, YEAR, value);
const daysAgo = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - days));
};
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

/** [code, title, type, city, tax number, payment term, currency, credit limit] */
const PARTNERS: [string, string, PartnerType, string, string, number, string, number | null][] = [
  ['TED-001', 'Anadolu Bilişim Ltd. Şti.', 'SUPPLIER', 'İstanbul', '1112223334', 30, 'TRY', null],
  ['TED-002', 'Ege Kırtasiye San. Tic. A.Ş.', 'SUPPLIER', 'İzmir', '2223334445', 45, 'TRY', null],
  ['TED-003', 'TechSource Europe GmbH', 'SUPPLIER', 'München', '3334445556', 60, 'EUR', null],
  ['TED-004', 'Marmara Ambalaj A.Ş.', 'SUPPLIER', 'Kocaeli', '4445556667', 30, 'TRY', null],
  ['MUS-001', 'Boğaziçi Perakende A.Ş.', 'CUSTOMER', 'İstanbul', '5556667778', 30, 'TRY', 500000],
  ['MUS-002', 'Başkent Ofis Çözümleri Ltd.', 'CUSTOMER', 'Ankara', '6667778889', 15, 'TRY', 150000],
  ['MUS-003', 'Akdeniz Otelcilik A.Ş.', 'CUSTOMER', 'Antalya', '7778889990', 45, 'TRY', 250000],
  ['MUS-004', 'Nordic Retail AB', 'CUSTOMER', 'Stockholm', '8889990001', 30, 'USD', 40000],
  ['CAR-001', 'Karadeniz Ticaret ve Dağıtım', 'BOTH', 'Trabzon', '9990001112', 30, 'TRY', 100000],
];

export async function seedPartners(prisma: PrismaClient, companyId: string) {
  const ids: Record<string, string> = {};
  for (const [
    code,
    title,
    type,
    city,
    taxNumber,
    paymentTermDays,
    currencyCode,
    creditLimit,
  ] of PARTNERS) {
    const partner = await prisma.businessPartner.upsert({
      where: { companyId_code: { companyId, code } },
      create: {
        companyId,
        code,
        title,
        type,
        city,
        taxNumber,
        taxOffice: city,
        paymentTermDays,
        currencyCode,
        creditLimit,
        email: `info@${code.toLowerCase()}.example.com`,
        phone: '+90 212 555 00 00',
        contactName: type === 'SUPPLIER' ? 'Satış Temsilcisi' : 'Satın Alma Sorumlusu',
      },
      update: {},
    });
    ids[code] = partner.id;
  }
  return ids;
}

interface PurchasingSeedContext {
  companyId: string;
  adminId: string;
  managerId: string;
  employeeId: string;
  partners: Record<string, string>;
}

interface SeedLine {
  sku: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number;
  discountRate?: number;
}

/**
 * Purchasing demo: a pending request (the seeded workflow instance), an approved request with
 * two competing quotes, and orders whose receipts are the RECEIPT movements of the stock seed,
 * so stock, receipts and invoices tell one consistent story.
 */
export async function seedPurchasing(prisma: PrismaClient, ctx: PurchasingSeedContext) {
  const { companyId, adminId, managerId, employeeId, partners } = ctx;
  if (await prisma.purchaseRequest.count({ where: { companyId } })) return;

  const variants = new Map(
    (
      await prisma.productVariant.findMany({
        where: { companyId },
        select: { id: true, sku: true, name: true, product: { select: { name: true } } },
      })
    ).map((v) => [v.sku, v]),
  );
  const warehouses = new Map(
    (await prisma.warehouse.findMany({ where: { companyId } })).map((w) => [w.code, w.id]),
  );
  const variant = (sku: string) => variants.get(sku)!;
  const label = (sku: string) => {
    const v = variant(sku);
    return v.name ? `${v.product.name} (${v.name})` : v.product.name;
  };
  const priceLines = (lines: SeedLine[]) => {
    const inputs = lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountRate: l.discountRate ?? 0,
      vatRate: l.vatRate ?? 20,
    }));
    const totals = documentAmounts(inputs);
    return {
      totals: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        vatTotal: totals.vatTotal,
        grandTotal: totals.grandTotal,
      },
      lines: lines.map((l, index) => ({
        lineNo: index + 1,
        variantId: variant(l.sku).id,
        description: label(l.sku),
        quantity: dec(l.quantity),
        unitPrice: dec(l.unitPrice),
        discountRate: dec(inputs[index].discountRate),
        vatRate: dec(inputs[index].vatRate),
        lineTotal: lineAmounts(inputs[index]).total,
      })),
    };
  };

  // --- Requests ---------------------------------------------------------------------------
  const instance = await prisma.workflowInstance.findFirst({
    where: { companyId, entityId: docNo('STA', 1) },
  });
  await prisma.purchaseRequest.create({
    data: {
      companyId,
      number: docNo('STA', 1),
      title: '5 adet dizüstü bilgisayar talebi',
      requestDate: daysAgo(2),
      neededBy: daysAgo(-14),
      notes: 'Yeni katılan yazılım ekibi için.',
      status: PurchaseRequestStatus.PENDING,
      workflowInstanceId: instance?.id ?? null,
      requestedById: employeeId,
      lines: {
        create: [
          {
            lineNo: 1,
            variantId: variant('PRD-LAPTOP').id,
            description: label('PRD-LAPTOP'),
            quantity: 5,
            estimatedPrice: 32000,
          },
        ],
      },
    },
  });

  const stationery = await prisma.purchaseRequest.create({
    data: {
      companyId,
      number: docNo('STA', 2),
      title: 'Ankara ofisi kırtasiye ihtiyacı',
      requestDate: daysAgo(6),
      neededBy: daysAgo(-10),
      status: PurchaseRequestStatus.APPROVED,
      decidedAt: daysAgo(4),
      requestedById: managerId,
      lines: {
        create: [
          {
            lineNo: 1,
            variantId: variant('PRD-A4').id,
            description: label('PRD-A4'),
            quantity: 40,
            estimatedPrice: 450,
          },
          {
            lineNo: 2,
            variantId: variant('PRD-TONER').id,
            description: label('PRD-TONER'),
            quantity: 10,
            estimatedPrice: 1400,
          },
          { lineNo: 3, description: 'Ergonomik ayak desteği', quantity: 6, estimatedPrice: 750 },
        ],
      },
    },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  });

  const restock = await prisma.purchaseRequest.create({
    data: {
      companyId,
      number: docNo('STA', 3),
      title: 'Merkez depo monitör ve kahve ikmali',
      requestDate: daysAgo(16),
      status: PurchaseRequestStatus.ORDERED,
      decidedAt: daysAgo(15),
      requestedById: adminId,
      lines: {
        create: [
          {
            lineNo: 1,
            variantId: variant('PRD-MONITOR').id,
            description: label('PRD-MONITOR'),
            quantity: 10,
            estimatedPrice: 6500,
          },
          {
            lineNo: 2,
            variantId: variant('PRD-KAHVE').id,
            description: label('PRD-KAHVE'),
            quantity: 20,
            estimatedPrice: 550,
          },
        ],
      },
    },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  });

  // --- Quotes -----------------------------------------------------------------------------
  let quoteNo = 0;
  const createQuote = async (
    requestLines: { id: string }[],
    requestId: string,
    partner: string,
    date: Date,
    deliveryDays: number,
    status: SupplierQuoteStatus,
    lines: SeedLine[],
  ) => {
    quoteNo += 1;
    const priced = priceLines(lines);
    return prisma.supplierQuote.create({
      data: {
        companyId,
        number: docNo('TKL', quoteNo),
        requestId,
        partnerId: partners[partner],
        quoteDate: date,
        validUntil: addDays(date, 30),
        deliveryDays,
        currencyCode: 'TRY',
        exchangeRate: 1,
        status,
        ...priced.totals,
        createdById: adminId,
        lines: {
          create: priced.lines.map((line, index) => ({
            ...line,
            requestLineId: requestLines[index]?.id ?? null,
          })),
        },
      },
    });
  };
  await createQuote(stationery.lines, stationery.id, 'TED-002', daysAgo(3), 3, 'OPEN', [
    { sku: 'PRD-A4', quantity: 40, unitPrice: 440 },
    { sku: 'PRD-TONER', quantity: 10, unitPrice: 1380 },
  ]);
  await createQuote(stationery.lines, stationery.id, 'CAR-001', daysAgo(2), 7, 'OPEN', [
    { sku: 'PRD-A4', quantity: 40, unitPrice: 455, discountRate: 5 },
    { sku: 'PRD-TONER', quantity: 10, unitPrice: 1350, discountRate: 5 },
  ]);
  const acceptedQuote = await createQuote(
    restock.lines,
    restock.id,
    'TED-001',
    daysAgo(15),
    5,
    'ACCEPTED',
    [
      { sku: 'PRD-MONITOR', quantity: 10, unitPrice: 6600 },
      { sku: 'PRD-KAHVE', quantity: 20, unitPrice: 560, vatRate: 10 },
    ],
  );
  await createQuote(restock.lines, restock.id, 'CAR-001', daysAgo(15), 10, 'REJECTED', [
    { sku: 'PRD-MONITOR', quantity: 10, unitPrice: 6750 },
    { sku: 'PRD-KAHVE', quantity: 20, unitPrice: 545, vatRate: 10 },
  ]);

  // --- Orders, receipts and invoices -------------------------------------------------------
  let orderNo = 0;
  let receiptNo = 0;
  let invoiceNo = 0;

  const createOrder = async (args: {
    partner: string;
    warehouse: string;
    date: Date;
    status: PurchaseOrderStatus;
    lines: SeedLine[];
    currencyCode?: string;
    exchangeRate?: number;
    requestId?: string;
    requestLineIds?: string[];
    quoteId?: string;
    notes?: string;
  }) => {
    orderNo += 1;
    const priced = priceLines(args.lines);
    const approved = args.status !== PurchaseOrderStatus.DRAFT;
    return prisma.purchaseOrder.create({
      data: {
        companyId,
        number: docNo('SAS', orderNo),
        partnerId: partners[args.partner],
        requestId: args.requestId ?? null,
        quoteId: args.quoteId ?? null,
        orderDate: args.date,
        expectedDate: addDays(args.date, 7),
        warehouseId: warehouses.get(args.warehouse)!,
        currencyCode: args.currencyCode ?? 'TRY',
        exchangeRate: args.exchangeRate ?? 1,
        status: args.status,
        notes: args.notes ?? null,
        ...priced.totals,
        createdById: adminId,
        approvedById: approved ? managerId : null,
        approvedAt: approved ? addDays(args.date, 1) : null,
        lines: {
          create: priced.lines.map((line, index) => ({
            ...line,
            requestLineId: args.requestLineIds?.[index] ?? null,
          })),
        },
      },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
  };

  /** Links an existing seeded RECEIPT movement to an order as its goods receipt. */
  const receiveFromMovement = async (
    order: {
      id: string;
      number: string;
      partnerId: string;
      lines: { id: string; variantId: string }[];
    },
    reference: string,
    deliveryNoteNo: string,
  ) => {
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { companyId, reference },
      include: { lines: { include: { lot: true } } },
    });
    receiptNo += 1;
    await prisma.goodsReceipt.create({
      data: {
        companyId,
        number: docNo('MKB', receiptNo),
        orderId: order.id,
        partnerId: order.partnerId,
        warehouseId: movement.targetWarehouseId!,
        receiptDate: movement.movementDate,
        deliveryNoteNo,
        stockMovementId: movement.id,
        createdById: adminId,
        lines: {
          create: movement.lines.map((line) => ({
            orderLineId: order.lines.find((l) => l.variantId === line.variantId)!.id,
            variantId: line.variantId,
            quantity: line.quantity,
            lotNo: line.lot?.lotNo ?? null,
            expiryDate: line.lot?.expiryDate ?? null,
          })),
        },
      },
    });
    for (const line of movement.lines) {
      const orderLine = order.lines.find((l) => l.variantId === line.variantId)!;
      await prisma.purchaseOrderLine.update({
        where: { id: orderLine.id },
        data: { receivedQty: { increment: line.quantity } },
      });
    }
    await prisma.stockMovement.update({
      where: { id: movement.id },
      data: { reference: `${order.number} / ${deliveryNoteNo}` },
    });
  };

  const createInvoice = async (args: {
    order: { id: string; partnerId: string; lines: { id: string; variantId: string }[] };
    supplierInvoiceNo: string;
    date: Date;
    termDays: number;
    lines: SeedLine[];
  }) => {
    invoiceNo += 1;
    const priced = priceLines(args.lines);
    const number = docNo('ALF', invoiceNo);
    const dueDate = addDays(args.date, args.termDays);
    const invoice = await prisma.purchaseInvoice.create({
      data: {
        companyId,
        number,
        supplierInvoiceNo: args.supplierInvoiceNo,
        partnerId: args.order.partnerId,
        orderId: args.order.id,
        invoiceDate: args.date,
        dueDate,
        currencyCode: 'TRY',
        exchangeRate: 1,
        status: InvoiceStatus.ISSUED,
        ...priced.totals,
        createdById: adminId,
        lines: {
          create: priced.lines.map((line) => ({
            ...line,
            orderLineId: args.order.lines.find((l) => l.variantId === line.variantId)!.id,
          })),
        },
      },
    });
    for (const line of priced.lines) {
      const orderLine = args.order.lines.find((l) => l.variantId === line.variantId)!;
      await prisma.purchaseOrderLine.update({
        where: { id: orderLine.id },
        data: { invoicedQty: { increment: line.quantity } },
      });
    }
    await prisma.partnerLedgerEntry.create({
      data: {
        companyId,
        partnerId: args.order.partnerId,
        entryDate: args.date,
        dueDate,
        documentType: LedgerDocumentType.PURCHASE_INVOICE,
        documentId: invoice.id,
        documentNumber: number,
        description: `Alış faturası ${args.supplierInvoiceNo}`,
        debit: 0,
        credit: priced.totals.grandTotal,
        currencyCode: 'TRY',
        exchangeRate: 1,
        debitBase: 0,
        creditBase: toBase(priced.totals.grandTotal, 1),
        createdById: adminId,
      },
    });
  };

  // 1) Ankara delivery 45 days ago: fully received and invoiced, the invoice is overdue.
  const ankaraLines: SeedLine[] = [
    { sku: 'PRD-MONITOR', quantity: 8, unitPrice: 6700 },
    { sku: 'PRD-MOUSE-SYH', quantity: 20, unitPrice: 355 },
    { sku: 'PRD-A4', quantity: 30, unitPrice: 460 },
    { sku: 'PRD-KAHVE', quantity: 15, unitPrice: 540, vatRate: 10 },
    { sku: 'PRD-SU', quantity: 30, unitPrice: 72, vatRate: 10 },
  ];
  const ankaraOrder = await createOrder({
    partner: 'CAR-001',
    warehouse: 'ANK',
    date: daysAgo(50),
    status: PurchaseOrderStatus.RECEIVED,
    lines: ankaraLines,
    notes: 'Ankara ofisi açılış ihtiyaçları',
  });
  await receiveFromMovement(ankaraOrder, 'İRS-B-55120', 'İRS-B-55120');
  await createInvoice({
    order: ankaraOrder,
    supplierInvoiceNo: `KRD${YEAR}000418`,
    date: daysAgo(44),
    termDays: 30,
    lines: ankaraLines,
  });

  // 2) The restock request's order: monitors half delivered, half invoiced.
  const restockOrder = await createOrder({
    partner: 'TED-001',
    warehouse: 'MRK',
    date: daysAgo(14),
    status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
    requestId: restock.id,
    requestLineIds: restock.lines.map((l) => l.id),
    quoteId: acceptedQuote.id,
    lines: [
      { sku: 'PRD-MONITOR', quantity: 10, unitPrice: 6600 },
      { sku: 'PRD-KAHVE', quantity: 20, unitPrice: 560, vatRate: 10 },
    ],
  });
  await receiveFromMovement(restockOrder, 'İRS-A-104731', 'İRS-A-104731');
  await createInvoice({
    order: restockOrder,
    supplierInvoiceNo: `ANB${YEAR}001204`,
    date: daysAgo(9),
    termDays: 30,
    lines: [
      { sku: 'PRD-MONITOR', quantity: 5, unitPrice: 6600 },
      { sku: 'PRD-KAHVE', quantity: 20, unitPrice: 560, vatRate: 10 },
    ],
  });

  // 3) An approved euro order waiting for delivery and a draft waiting for approval.
  const eur = await prisma.exchangeRate.findFirst({
    where: { currencyCode: 'EUR' },
    orderBy: { rateDate: 'desc' },
  });
  await createOrder({
    partner: 'TED-003',
    warehouse: 'MRK',
    date: daysAgo(3),
    status: PurchaseOrderStatus.APPROVED,
    currencyCode: 'EUR',
    exchangeRate: eur ? eur.selling.toNumber() : 48.1,
    lines: [
      { sku: 'PRD-LAPTOP', quantity: 4, unitPrice: 690, discountRate: 3 },
      { sku: 'PRD-PHONE', quantity: 2, unitPrice: 380 },
    ],
  });
  await createOrder({
    partner: 'TED-004',
    warehouse: 'MRK',
    date: daysAgo(1),
    status: PurchaseOrderStatus.DRAFT,
    lines: [
      { sku: 'PRD-DEZ', quantity: 30, unitPrice: 185 },
      { sku: 'PRD-SU', quantity: 60, unitPrice: 68, vatRate: 10 },
    ],
  });

  const bump = async (code: string, used: number) =>
    prisma.numberSequence.updateMany({
      where: { companyId, code, nextValue: { lte: used } },
      data: { nextValue: used + 1, currentYear: YEAR },
    });
  await bump('PURCHASE_REQUEST', 3);
  await bump('SUPPLIER_QUOTE', quoteNo);
  await bump('PURCHASE_ORDER', orderNo);
  await bump('GOODS_RECEIPT', receiptNo);
  await bump('PURCHASE_INVOICE', invoiceNo);
}
