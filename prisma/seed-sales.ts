import {
  InvoiceStatus,
  LedgerDocumentType,
  Prisma,
  type PrismaClient,
  SalesOrderStatus,
  SalesQuoteStatus,
  StockMovementType,
} from '@prisma/client';
import { documentAmounts, lineAmounts, toBase } from '../src/common/money/document-totals';
import { formatNumber } from '../src/modules/numbering/number-format';

const YEAR = new Date().getFullYear();
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const daysAgo = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - days));
};
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

interface SalesSeedContext {
  companyId: string;
  adminId: string;
  managerId: string;
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
 * Sales demo: open, expired, accepted and rejected quotes; a delivered and invoiced order with
 * an overdue invoice; a partly delivered order with a return; an approved order holding stock
 * reservations; and a draft in USD. Deliveries and returns post real (untracked) stock movements.
 */
export async function seedSales(prisma: PrismaClient, ctx: SalesSeedContext) {
  const { companyId, adminId, managerId, partners } = ctx;
  if (await prisma.salesQuote.count({ where: { companyId } })) return;

  const variants = new Map(
    (
      await prisma.productVariant.findMany({
        where: { companyId },
        select: {
          id: true,
          sku: true,
          name: true,
          averageCost: true,
          product: { select: { name: true, type: true } },
        },
      })
    ).map((v) => [v.sku, v]),
  );
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { companyId, code: 'MRK' } });
  const variant = (sku: string) => variants.get(sku)!;
  const label = (sku: string) => {
    const v = variant(sku);
    return v.name ? `${v.product.name} (${v.name})` : v.product.name;
  };
  const next = async (code: string) => {
    const seq = await prisma.numberSequence.update({
      where: { companyId_code: { companyId, code } },
      data: { nextValue: { increment: 1 } },
    });
    return formatNumber(seq, YEAR, seq.nextValue - 1);
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

  /** Posts an untracked ISSUE or RECEIPT at average cost, like StockMovementsService.post. */
  const postStock = async (
    type: StockMovementType,
    date: Date,
    reference: string,
    lines: { sku: string; quantity: number }[],
  ) => {
    const movement = await prisma.stockMovement.create({
      data: {
        companyId,
        number: await next('STOCK_MOVEMENT'),
        type,
        movementDate: date,
        sourceWarehouseId: type === StockMovementType.ISSUE ? warehouse.id : null,
        targetWarehouseId: type === StockMovementType.RECEIPT ? warehouse.id : null,
        reference,
        createdById: adminId,
      },
    });
    for (const input of lines) {
      const v = variant(input.sku);
      const delta = type === StockMovementType.ISSUE ? -input.quantity : input.quantity;
      const line = await prisma.stockMovementLine.create({
        data: {
          movementId: movement.id,
          variantId: v.id,
          quantity: input.quantity,
          unitCost: v.averageCost,
        },
      });
      const balance = await prisma.stockBalance.upsert({
        where: { warehouseId_variantId: { warehouseId: warehouse.id, variantId: v.id } },
        create: { companyId, warehouseId: warehouse.id, variantId: v.id, quantity: delta },
        update: { quantity: { increment: delta } },
      });
      await prisma.stockTransaction.create({
        data: {
          companyId,
          movementId: movement.id,
          lineId: line.id,
          warehouseId: warehouse.id,
          variantId: v.id,
          quantity: delta,
          unitCost: v.averageCost,
          balanceAfter: balance.quantity,
          movementDate: date,
        },
      });
    }
    return movement;
  };

  const ledger = async (args: {
    partnerId: string;
    date: Date;
    dueDate?: Date;
    type: LedgerDocumentType;
    documentId: string;
    number: string;
    description: string;
    debit?: Prisma.Decimal;
    credit?: Prisma.Decimal;
  }) =>
    prisma.partnerLedgerEntry.create({
      data: {
        companyId,
        partnerId: args.partnerId,
        entryDate: args.date,
        dueDate: args.dueDate ?? null,
        documentType: args.type,
        documentId: args.documentId,
        documentNumber: args.number,
        description: args.description,
        debit: args.debit ?? 0,
        credit: args.credit ?? 0,
        currencyCode: 'TRY',
        exchangeRate: 1,
        debitBase: toBase(args.debit ?? 0, 1),
        creditBase: toBase(args.credit ?? 0, 1),
        createdById: adminId,
      },
    });

  // --- Quotes -----------------------------------------------------------------------------
  const createQuote = async (
    partner: string,
    date: Date,
    validDays: number,
    status: SalesQuoteStatus,
    lines: SeedLine[],
  ) => {
    const priced = priceLines(lines);
    return prisma.salesQuote.create({
      data: {
        companyId,
        number: await next('SALES_QUOTE'),
        partnerId: partners[partner],
        quoteDate: date,
        validUntil: addDays(date, validDays),
        currencyCode: 'TRY',
        exchangeRate: 1,
        status,
        ...priced.totals,
        createdById: adminId,
        lines: { create: priced.lines },
      },
    });
  };
  const officeLines: SeedLine[] = [
    { sku: 'PRD-MONITOR', quantity: 3, unitPrice: 8499 },
    { sku: 'PRD-KLAVYE-Q', quantity: 3, unitPrice: 1799 },
    { sku: 'SRV-KURULUM', quantity: 4, unitPrice: 1500 },
  ];
  const accepted = await createQuote('MUS-002', daysAgo(30), 15, 'ACCEPTED', officeLines);
  await createQuote('MUS-003', daysAgo(25), 20, 'OPEN', [
    { sku: 'PRD-KAHVE', quantity: 40, unitPrice: 690, vatRate: 10 },
    { sku: 'PRD-SU', quantity: 100, unitPrice: 95, vatRate: 10 },
  ]);
  await createQuote('CAR-001', daysAgo(12), 10, 'REJECTED', [
    { sku: 'PRD-TONER', quantity: 6, unitPrice: 1900 },
  ]);
  await createQuote('MUS-001', daysAgo(2), 30, 'OPEN', [
    { sku: 'PRD-LAPTOP', quantity: 2, unitPrice: 39999, discountRate: 5 },
    { sku: 'PRD-MOUSE-SYH', quantity: 2, unitPrice: 549 },
    { sku: 'SRV-KURULUM', quantity: 2, unitPrice: 1500 },
  ]);

  // --- Orders -------------------------------------------------------------------------------
  const createOrder = async (args: {
    partner: string;
    date: Date;
    status: SalesOrderStatus;
    lines: SeedLine[];
    quoteId?: string;
    customerRef?: string;
    currencyCode?: string;
    exchangeRate?: number;
  }) => {
    const priced = priceLines(args.lines);
    const approved = args.status !== SalesOrderStatus.DRAFT;
    return prisma.salesOrder.create({
      data: {
        companyId,
        number: await next('SALES_ORDER'),
        partnerId: partners[args.partner],
        quoteId: args.quoteId ?? null,
        orderDate: args.date,
        deliveryDate: addDays(args.date, 5),
        warehouseId: warehouse.id,
        customerRef: args.customerRef ?? null,
        currencyCode: args.currencyCode ?? 'TRY',
        exchangeRate: args.exchangeRate ?? 1,
        status: args.status,
        ...priced.totals,
        createdById: adminId,
        approvedById: approved ? managerId : null,
        approvedAt: approved ? args.date : null,
        lines: { create: priced.lines },
      },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
  };
  type SeedOrder = Awaited<ReturnType<typeof createOrder>>;

  const deliver = async (order: SeedOrder, date: Date, lines: SeedLine[]) => {
    const number = await next('DELIVERY_NOTE');
    const stocked = lines.filter((l) => variant(l.sku).product.type === 'GOODS');
    const movement = stocked.length
      ? await postStock(StockMovementType.ISSUE, date, `${order.number} / ${number}`, stocked)
      : null;
    await prisma.deliveryNote.create({
      data: {
        companyId,
        number,
        orderId: order.id,
        partnerId: order.partnerId,
        warehouseId: warehouse.id,
        deliveryDate: date,
        carrier: 'Yurtiçi Kargo',
        stockMovementId: movement?.id ?? null,
        createdById: adminId,
        lines: {
          create: lines.map((l) => ({
            orderLineId: order.lines.find((ol) => ol.variantId === variant(l.sku).id)!.id,
            variantId: variant(l.sku).id,
            quantity: l.quantity,
          })),
        },
      },
    });
    for (const l of lines) {
      await prisma.salesOrderLine.update({
        where: { id: order.lines.find((ol) => ol.variantId === variant(l.sku).id)!.id },
        data: { deliveredQty: { increment: l.quantity } },
      });
    }
  };

  const invoice = async (order: SeedOrder, date: Date, termDays: number, lines: SeedLine[]) => {
    const priced = priceLines(lines);
    const number = await next('SALES_INVOICE');
    const dueDate = addDays(date, termDays);
    const created = await prisma.salesInvoice.create({
      data: {
        companyId,
        number,
        partnerId: order.partnerId,
        orderId: order.id,
        invoiceDate: date,
        dueDate,
        currencyCode: 'TRY',
        exchangeRate: 1,
        status: InvoiceStatus.ISSUED,
        ...priced.totals,
        createdById: adminId,
        lines: {
          create: priced.lines.map((line) => ({
            ...line,
            orderLineId: order.lines.find((ol) => ol.variantId === line.variantId)!.id,
          })),
        },
      },
      include: { lines: true },
    });
    for (const line of priced.lines) {
      await prisma.salesOrderLine.update({
        where: { id: order.lines.find((ol) => ol.variantId === line.variantId)!.id },
        data: { invoicedQty: { increment: line.quantity } },
      });
    }
    await ledger({
      partnerId: order.partnerId,
      date,
      dueDate,
      type: LedgerDocumentType.SALES_INVOICE,
      documentId: created.id,
      number,
      description: `Satış faturası (${order.number})`,
      debit: priced.totals.grandTotal,
    });
    return created;
  };

  // 1) Başkent Ofis: the accepted quote, delivered and invoiced; the invoice is overdue.
  const office = await createOrder({
    partner: 'MUS-002',
    date: daysAgo(29),
    status: SalesOrderStatus.DELIVERED,
    quoteId: accepted.id,
    customerRef: 'BOÇ-PO-2231',
    lines: officeLines,
  });
  await deliver(office, daysAgo(27), officeLines);
  await invoice(office, daysAgo(27), 15, officeLines);

  // 2) Boğaziçi Perakende: mice half delivered, paper delivered; 2 reams came back damaged.
  const retailLines: SeedLine[] = [
    { sku: 'PRD-MOUSE-SYH', quantity: 20, unitPrice: 549 },
    { sku: 'PRD-A4', quantity: 20, unitPrice: 590 },
  ];
  const retail = await createOrder({
    partner: 'MUS-001',
    date: daysAgo(10),
    status: SalesOrderStatus.PARTIALLY_DELIVERED,
    customerRef: 'BGZ-4471',
    lines: retailLines,
  });
  const delivered: SeedLine[] = [
    { sku: 'PRD-MOUSE-SYH', quantity: 10, unitPrice: 549 },
    { sku: 'PRD-A4', quantity: 20, unitPrice: 590 },
  ];
  await deliver(retail, daysAgo(8), delivered);
  await prisma.stockReservation.create({
    data: {
      companyId,
      warehouseId: warehouse.id,
      variantId: variant('PRD-MOUSE-SYH').id,
      orderLineId: retail.lines[0].id,
      quantity: 10,
    },
  });
  const retailInvoice = await invoice(retail, daysAgo(8), 30, delivered);

  const returned: SeedLine[] = [{ sku: 'PRD-A4', quantity: 2, unitPrice: 590 }];
  const returnPriced = priceLines(returned);
  const returnNumber = await next('SALES_RETURN');
  const returnMovement = await postStock(
    StockMovementType.RECEIPT,
    daysAgo(6),
    `${retailInvoice.number} / ${returnNumber}`,
    returned,
  );
  const invoiceLine = retailInvoice.lines.find((l) => l.variantId === variant('PRD-A4').id)!;
  const salesReturn = await prisma.salesReturn.create({
    data: {
      companyId,
      number: returnNumber,
      invoiceId: retailInvoice.id,
      partnerId: retail.partnerId,
      warehouseId: warehouse.id,
      returnDate: daysAgo(6),
      reason: 'Nakliyede ıslanan kağıt',
      currencyCode: 'TRY',
      exchangeRate: 1,
      ...returnPriced.totals,
      stockMovementId: returnMovement.id,
      createdById: adminId,
      lines: {
        create: returnPriced.lines.map((line) => ({ ...line, invoiceLineId: invoiceLine.id })),
      },
    },
  });
  await prisma.salesInvoiceLine.update({
    where: { id: invoiceLine.id },
    data: { returnedQty: 2 },
  });
  await prisma.salesInvoice.update({
    where: { id: retailInvoice.id },
    data: { paidAmount: returnPriced.totals.grandTotal, paymentStatus: 'PARTIALLY_PAID' },
  });
  await ledger({
    partnerId: retail.partnerId,
    date: daysAgo(6),
    type: LedgerDocumentType.SALES_RETURN,
    documentId: salesReturn.id,
    number: returnNumber,
    description: `İade (${retailInvoice.number}): Nakliyede ıslanan kağıt`,
    credit: returnPriced.totals.grandTotal,
  });

  // 3) Akdeniz Otelcilik: approved, waiting for delivery; its stock is reserved.
  const hotel = await createOrder({
    partner: 'MUS-003',
    date: daysAgo(2),
    status: SalesOrderStatus.APPROVED,
    lines: [
      { sku: 'PRD-POLO-LCV-M', quantity: 5, unitPrice: 590 },
      { sku: 'PRD-SU', quantity: 20, unitPrice: 95, vatRate: 10 },
    ],
  });
  for (const line of hotel.lines) {
    await prisma.stockReservation.create({
      data: {
        companyId,
        warehouseId: warehouse.id,
        variantId: line.variantId,
        orderLineId: line.id,
        quantity: line.quantity,
      },
    });
  }

  // 4) Nordic Retail: a USD draft waiting for approval.
  const usd = await prisma.exchangeRate.findFirst({
    where: { currencyCode: 'USD' },
    orderBy: { rateDate: 'desc' },
  });
  await createOrder({
    partner: 'MUS-004',
    date: daysAgo(1),
    status: SalesOrderStatus.DRAFT,
    currencyCode: 'USD',
    exchangeRate: usd ? usd.selling.toNumber() : 41.2,
    customerRef: 'NR-PO-88120',
    lines: [
      { sku: 'PRD-POLO-LCV-L', quantity: 30, unitPrice: 14.5, vatRate: 0 },
      { sku: 'PRD-POLO-LCV-XL', quantity: 15, unitPrice: 14.5, vatRate: 0 },
    ],
  });
}
