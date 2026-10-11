import {
  ChequeDirection,
  ChequeKind,
  ChequeStatus,
  InvoiceStatus,
  LedgerDocumentType,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  type PrismaClient,
  TreasuryAccountType,
  TreasuryDocumentType,
} from '@prisma/client';
import { allocateFifo } from '../src/modules/finance/finance-math';
import { paymentStatusOf } from '../src/modules/partners/trade.service';
import { formatNumber } from '../src/modules/numbering/number-format';

const YEAR = new Date().getFullYear();
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const daysAgo = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - days));
};
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

interface FinanceSeedContext {
  companyId: string;
  adminId: string;
  partners: Record<string, string>;
}

interface SeedPayment {
  direction: PaymentDirection;
  method: PaymentMethod;
  partner: string;
  date: Date;
  amount: Prisma.Decimal.Value;
  account?: string;
  description?: string;
  cheque?: { serialNo: string; bankName?: string; dueInDays: number };
}

/**
 * Finance demo: a cash box and TRY / USD bank accounts with opening balances; bank and cash
 * collections and payments settling the seeded invoices oldest first; a customer cheque
 * deposited and collected, one still in the portfolio, a promissory note and an own cheque.
 */
export async function seedFinance(prisma: PrismaClient, ctx: FinanceSeedContext) {
  const { companyId, adminId, partners } = ctx;
  if (await prisma.treasuryAccount.count({ where: { companyId } })) return;

  const next = async (code: string) => {
    const seq = await prisma.numberSequence.update({
      where: { companyId_code: { companyId, code } },
      data: { nextValue: { increment: 1 } },
    });
    return formatNumber(seq, YEAR, seq.nextValue - 1);
  };

  const accounts: Record<string, string> = {};
  const accountSeeds: [string, string, TreasuryAccountType, string, number, string?][] = [
    ['KASA-TL', 'Merkez Kasa', TreasuryAccountType.CASH, 'TRY', 25_000],
    [
      'BNK-TL',
      'Garanti BBVA — TL',
      TreasuryAccountType.BANK,
      'TRY',
      350_000,
      'TR120006200000000006295001',
    ],
    [
      'BNK-USD',
      'Garanti BBVA — USD',
      TreasuryAccountType.BANK,
      'USD',
      12_000,
      'TR340006200000000009187002',
    ],
  ];
  for (const [code, name, type, currencyCode, opening, iban] of accountSeeds) {
    const account = await prisma.treasuryAccount.create({
      data: {
        companyId,
        code,
        name,
        type,
        currencyCode,
        ...(type === TreasuryAccountType.BANK && {
          bankName: 'Garanti BBVA',
          branchName: 'Levent Ticari',
          iban,
        }),
      },
    });
    accounts[code] = account.id;
    await prisma.treasuryTransaction.create({
      data: {
        companyId,
        accountId: account.id,
        txDate: daysAgo(90),
        documentType: TreasuryDocumentType.OPENING,
        documentId: account.id,
        documentNumber: code,
        description: 'Açılış bakiyesi',
        amountIn: opening,
        createdById: adminId,
      },
    });
  }

  const pay = async (args: SeedPayment) => {
    const incoming = args.direction === PaymentDirection.IN;
    const amount = dec(args.amount);
    const partnerId = partners[args.partner];
    const documentType = incoming ? LedgerDocumentType.COLLECTION : LedgerDocumentType.PAYMENT;
    const number = await next(documentType);
    const accountId = args.account ? accounts[args.account] : null;
    const payment = await prisma.partnerPayment.create({
      data: {
        companyId,
        number,
        direction: args.direction,
        method: args.method,
        partnerId,
        paymentDate: args.date,
        accountId,
        amount,
        currencyCode: 'TRY',
        exchangeRate: 1,
        amountBase: amount,
        description: args.description ?? null,
        createdById: adminId,
      },
    });
    const label = `${incoming ? 'Tahsilat' : 'Ödeme'} — ${
      { CASH: 'Nakit', BANK: 'Banka', CHEQUE: 'Çek', NOTE: 'Senet' }[args.method]
    }`;
    await prisma.partnerLedgerEntry.create({
      data: {
        companyId,
        partnerId,
        entryDate: args.date,
        documentType,
        documentId: payment.id,
        documentNumber: number,
        description: args.description ? `${label}: ${args.description}` : label,
        debit: incoming ? 0 : amount,
        credit: incoming ? amount : 0,
        currencyCode: 'TRY',
        exchangeRate: 1,
        debitBase: incoming ? 0 : amount,
        creditBase: incoming ? amount : 0,
        createdById: adminId,
      },
    });
    if (args.method === PaymentMethod.CASH || args.method === PaymentMethod.BANK) {
      await prisma.treasuryTransaction.create({
        data: {
          companyId,
          accountId: accountId!,
          txDate: args.date,
          documentType: incoming ? TreasuryDocumentType.COLLECTION : TreasuryDocumentType.PAYMENT,
          documentId: payment.id,
          documentNumber: number,
          description: args.partner,
          amountIn: incoming ? amount : 0,
          amountOut: incoming ? 0 : amount,
          createdById: adminId,
        },
      });
    }

    const where = {
      companyId,
      partnerId,
      currencyCode: 'TRY',
      status: InvoiceStatus.ISSUED,
      paymentStatus: { not: PaymentStatus.PAID },
    };
    const open = incoming
      ? await prisma.salesInvoice.findMany({ where })
      : await prisma.purchaseInvoice.findMany({ where });
    const byId = new Map(open.map((invoice) => [invoice.id, invoice]));
    const allocations = allocateFifo(
      amount,
      open.map((invoice) => ({
        id: invoice.id,
        dueDate: invoice.dueDate,
        remaining: invoice.grandTotal.minus(invoice.paidAmount),
      })),
    );
    for (const allocation of allocations) {
      const invoice = byId.get(allocation.invoiceId)!;
      const paid = invoice.paidAmount.plus(allocation.amount);
      const data = { paidAmount: paid, paymentStatus: paymentStatusOf(paid, invoice.grandTotal) };
      await prisma.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          amount: allocation.amount,
          ...(incoming ? { salesInvoiceId: invoice.id } : { purchaseInvoiceId: invoice.id }),
        },
      });
      if (incoming) await prisma.salesInvoice.update({ where: { id: invoice.id }, data });
      else await prisma.purchaseInvoice.update({ where: { id: invoice.id }, data });
    }

    if (!args.cheque) return { payment, cheque: null };
    const kind = args.method === PaymentMethod.NOTE ? ChequeKind.NOTE : ChequeKind.CHEQUE;
    const status = incoming ? ChequeStatus.PORTFOLIO : ChequeStatus.ISSUED;
    const partner = await prisma.businessPartner.findUniqueOrThrow({ where: { id: partnerId } });
    const cheque = await prisma.cheque.create({
      data: {
        companyId,
        number: await next(kind === ChequeKind.NOTE ? 'PROMISSORY_NOTE' : 'CHEQUE'),
        kind,
        direction: incoming ? ChequeDirection.RECEIVED : ChequeDirection.ISSUED,
        status,
        serialNo: args.cheque.serialNo,
        bankName: args.cheque.bankName ?? (incoming ? null : 'Garanti BBVA'),
        branchName: incoming ? null : 'Levent Ticari',
        drawer: incoming ? partner.title : null,
        issueDate: args.date,
        dueDate: addDays(args.date, args.cheque.dueInDays),
        amount,
        currencyCode: 'TRY',
        exchangeRate: 1,
        partnerId,
        accountId,
        originPaymentId: payment.id,
        events: {
          create: {
            eventDate: args.date,
            toStatus: status,
            accountId,
            partnerId,
            note: number,
            createdById: adminId,
          },
        },
      },
    });
    return { payment, cheque };
  };

  // Collections: bank transfer on the overdue office invoice, cash on account.
  await pay({
    direction: PaymentDirection.IN,
    method: PaymentMethod.BANK,
    partner: 'MUS-002',
    date: daysAgo(6),
    amount: 5_000,
    account: 'BNK-TL',
    description: 'EFT',
  });
  await pay({
    direction: PaymentDirection.IN,
    method: PaymentMethod.CASH,
    partner: 'CAR-001',
    date: daysAgo(3),
    amount: 2_500,
    account: 'KASA-TL',
    description: 'Elden tahsilat',
  });

  // A customer cheque that went through the bank and was collected.
  const collected = await pay({
    direction: PaymentDirection.IN,
    method: PaymentMethod.CHEQUE,
    partner: 'MUS-001',
    date: daysAgo(40),
    amount: 8_000,
    cheque: { serialNo: 'AKB-4471203', bankName: 'Akbank', dueInDays: 30 },
  });
  const deposited = daysAgo(15);
  const paidIn = daysAgo(10);
  await prisma.cheque.update({
    where: { id: collected.cheque!.id },
    data: { status: ChequeStatus.COLLECTED, accountId: accounts['BNK-TL'] },
  });
  await prisma.chequeEvent.createMany({
    data: [
      {
        chequeId: collected.cheque!.id,
        eventDate: deposited,
        fromStatus: ChequeStatus.PORTFOLIO,
        toStatus: ChequeStatus.DEPOSITED,
        accountId: accounts['BNK-TL'],
        createdById: adminId,
      },
      {
        chequeId: collected.cheque!.id,
        eventDate: paidIn,
        fromStatus: ChequeStatus.DEPOSITED,
        toStatus: ChequeStatus.COLLECTED,
        accountId: accounts['BNK-TL'],
        createdById: adminId,
      },
    ],
  });
  await prisma.treasuryTransaction.create({
    data: {
      companyId,
      accountId: accounts['BNK-TL'],
      txDate: paidIn,
      documentType: TreasuryDocumentType.CHEQUE_COLLECTION,
      documentId: collected.cheque!.id,
      documentNumber: collected.cheque!.number,
      description: 'AKB-4471203',
      amountIn: 8_000,
      createdById: adminId,
    },
  });

  // Still in the portfolio: a cheque and a promissory note.
  await pay({
    direction: PaymentDirection.IN,
    method: PaymentMethod.CHEQUE,
    partner: 'MUS-001',
    date: daysAgo(2),
    amount: 12_500,
    cheque: { serialNo: 'YKB-0938815', bankName: 'Yapı Kredi', dueInDays: 45 },
  });
  await pay({
    direction: PaymentDirection.IN,
    method: PaymentMethod.NOTE,
    partner: 'MUS-003',
    date: daysAgo(5),
    amount: 6_000,
    cheque: { serialNo: 'SNT-2026-014', dueInDays: 60 },
  });

  // Payments: a bank transfer and an own cheque to suppliers.
  await pay({
    direction: PaymentDirection.OUT,
    method: PaymentMethod.BANK,
    partner: 'TED-001',
    date: daysAgo(4),
    amount: 20_000,
    account: 'BNK-TL',
    description: 'Havale',
  });
  await pay({
    direction: PaymentDirection.OUT,
    method: PaymentMethod.CHEQUE,
    partner: 'TED-002',
    date: daysAgo(1),
    amount: 7_500,
    account: 'BNK-TL',
    cheque: { serialNo: 'GRT-7700142', dueInDays: 30 },
  });
}
