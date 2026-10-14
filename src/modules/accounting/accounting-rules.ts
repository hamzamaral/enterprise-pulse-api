import {
  ChequeKind,
  PaymentMethod,
  Prisma,
  StockMovementType,
  TreasuryAccountType,
} from '@prisma/client';
import { ACC } from './accounting-chart';
import type { DraftLine } from './accounting-math';

/**
 * Posting rules (muhasebeleştirme kuralları). Every amount is already in the base currency;
 * each rule derives one side from the others so the entry always balances.
 */

type Dec = Prisma.Decimal;

/** 100 Kasa or 102 Bankalar. */
export const treasuryCode = (type: TreasuryAccountType) =>
  type === TreasuryAccountType.CASH ? ACC.CASH : ACC.BANKS;

/** Satış faturası: 120 Alıcılar / 600 Yurt İçi Satışlar + 391 Hesaplanan KDV. */
export function salesInvoiceLines(input: { partnerId: string; total: Dec; vat: Dec }): DraftLine[] {
  return [
    { code: ACC.RECEIVABLES, debit: input.total, partnerId: input.partnerId },
    { code: ACC.SALES, credit: input.total.minus(input.vat) },
    { code: ACC.OUTPUT_VAT, credit: input.vat },
  ];
}

/**
 * Satış iadesi: 610 Satıştan İadeler + 391 / 120, and the returned goods back into stock at
 * cost: 153 / 621.
 */
export function salesReturnLines(input: {
  partnerId: string;
  total: Dec;
  vat: Dec;
  cost: Dec;
}): DraftLine[] {
  return [
    { code: ACC.SALES_RETURNS, debit: input.total.minus(input.vat) },
    { code: ACC.OUTPUT_VAT, debit: input.vat },
    { code: ACC.RECEIVABLES, credit: input.total, partnerId: input.partnerId },
    { code: ACC.MERCHANDISE, debit: input.cost },
    { code: ACC.COST_OF_GOODS_SOLD, credit: input.cost },
  ];
}

/**
 * Alış faturası: goods to 153 Ticari Mallar, services and other lines to 770 Genel Yönetim
 * Giderleri, VAT to 191 İndirilecek KDV / 320 Satıcılar.
 */
export function purchaseInvoiceLines(input: {
  partnerId: string;
  total: Dec;
  vat: Dec;
  goods: Dec;
}): DraftLine[] {
  const net = input.total.minus(input.vat);
  const goods = Prisma.Decimal.min(input.goods, net);
  return [
    { code: ACC.MERCHANDISE, debit: goods },
    { code: ACC.GENERAL_ADMIN_EXPENSES, debit: net.minus(goods) },
    { code: ACC.INPUT_VAT, debit: input.vat },
    { code: ACC.PAYABLES, credit: input.total, partnerId: input.partnerId },
  ];
}

/** Sevk irsaliyesi: cost of the delivered goods, 621 / 153. */
export function deliveryCostLines(cost: Dec): DraftLine[] {
  return [
    { code: ACC.COST_OF_GOODS_SOLD, debit: cost },
    { code: ACC.MERCHANDISE, credit: cost },
  ];
}

/**
 * Stock movements outside purchasing and sales, valued at cost:
 * receipt without invoice 153 / 329, internal issue 770 / 153,
 * count surplus 153 / 679 and shortage 689 / 153.
 */
export function stockMovementLines(
  type: StockMovementType,
  value: { increase: Dec; decrease: Dec },
): DraftLine[] {
  switch (type) {
    case StockMovementType.RECEIPT:
      return [
        { code: ACC.MERCHANDISE, debit: value.increase },
        { code: ACC.OTHER_TRADE_PAYABLES, credit: value.increase },
      ];
    case StockMovementType.ISSUE:
      return [
        { code: ACC.GENERAL_ADMIN_EXPENSES, debit: value.decrease },
        { code: ACC.MERCHANDISE, credit: value.decrease },
      ];
    case StockMovementType.ADJUSTMENT:
      return [
        { code: ACC.MERCHANDISE, debit: value.increase },
        { code: ACC.OTHER_EXTRAORDINARY_INCOME, credit: value.increase },
        { code: ACC.OTHER_EXTRAORDINARY_EXPENSE, debit: value.decrease },
        { code: ACC.MERCHANDISE, credit: value.decrease },
      ];
    default:
      return [];
  }
}

/**
 * Üretim fişi: materials used 710 / 153, and the output into stock at full cost 153 /
 * 711 (materials) + 721 (labour) + 731 (overhead) yansıtma hesapları.
 */
export function productionLines(cost: { material: Dec; labor: Dec; overhead: Dec }): DraftLine[] {
  const total = cost.material.plus(cost.labor).plus(cost.overhead);
  return [
    { code: ACC.DIRECT_MATERIALS, debit: cost.material },
    { code: ACC.MERCHANDISE, credit: cost.material },
    { code: ACC.MERCHANDISE, debit: total },
    { code: ACC.DIRECT_MATERIALS_APPLIED, credit: cost.material },
    { code: ACC.DIRECT_LABOR_APPLIED, credit: cost.labor },
    { code: ACC.OVERHEAD_APPLIED, credit: cost.overhead },
  ];
}

/** Account a payment method moves money through. */
function methodCode(method: PaymentMethod, direction: 'IN' | 'OUT', endorsed: boolean): string {
  switch (method) {
    case PaymentMethod.CASH:
      return ACC.CASH;
    case PaymentMethod.BANK:
      return ACC.BANKS;
    case PaymentMethod.CHEQUE:
      return direction === 'IN' || endorsed ? ACC.CHEQUES_RECEIVED : ACC.CHEQUES_ISSUED;
    case PaymentMethod.NOTE:
      return direction === 'IN' || endorsed ? ACC.NOTES_RECEIVABLE : ACC.NOTES_PAYABLE;
  }
}

/** Tahsilat: 100 / 102 / 101 / 121 against 120 Alıcılar. */
export function collectionLines(input: {
  partnerId: string;
  method: PaymentMethod;
  amount: Dec;
}): DraftLine[] {
  return [
    { code: methodCode(input.method, 'IN', false), debit: input.amount },
    { code: ACC.RECEIVABLES, credit: input.amount, partnerId: input.partnerId },
  ];
}

/** Ödeme: 320 Satıcılar against 100 / 102, an own cheque or note, or an endorsed one. */
export function paymentLines(input: {
  partnerId: string;
  method: PaymentMethod;
  amount: Dec;
  endorsed: boolean;
}): DraftLine[] {
  return [
    { code: ACC.PAYABLES, debit: input.amount, partnerId: input.partnerId },
    { code: methodCode(input.method, 'OUT', input.endorsed), credit: input.amount },
  ];
}

/** Received cheque / note collected: 100 / 102 against 101 Alınan Çekler or 121 Alacak Senetleri. */
export function chequeCollectionLines(input: {
  kind: ChequeKind;
  treasuryType: TreasuryAccountType;
  amount: Dec;
  partnerId: string;
}): DraftLine[] {
  return [
    { code: treasuryCode(input.treasuryType), debit: input.amount },
    {
      code: input.kind === ChequeKind.CHEQUE ? ACC.CHEQUES_RECEIVED : ACC.NOTES_RECEIVABLE,
      credit: input.amount,
      partnerId: input.partnerId,
    },
  ];
}

/** Own cheque / note paid at maturity: 103 Verilen Çekler or 321 Borç Senetleri against 100 / 102. */
export function chequePaymentLines(input: {
  kind: ChequeKind;
  treasuryType: TreasuryAccountType;
  amount: Dec;
  partnerId: string;
}): DraftLine[] {
  return [
    {
      code: input.kind === ChequeKind.CHEQUE ? ACC.CHEQUES_ISSUED : ACC.NOTES_PAYABLE,
      debit: input.amount,
      partnerId: input.partnerId,
    },
    { code: treasuryCode(input.treasuryType), credit: input.amount },
  ];
}

/** Opening balance of a cash box or bank account against 500 Sermaye; signed. */
export function treasuryOpeningLines(treasuryType: TreasuryAccountType, amount: Dec): DraftLine[] {
  return [
    { code: treasuryCode(treasuryType), debit: amount },
    { code: ACC.CAPITAL, credit: amount },
  ];
}

/** Partner opening balance: receivable 120 / 500, payable 500 / 320. */
export function partnerOpeningLines(input: {
  partnerId: string;
  debit: Dec;
  credit: Dec;
}): DraftLine[] {
  return [
    { code: ACC.RECEIVABLES, debit: input.debit, partnerId: input.partnerId },
    { code: ACC.CAPITAL, credit: input.debit },
    { code: ACC.CAPITAL, debit: input.credit },
    { code: ACC.PAYABLES, credit: input.credit, partnerId: input.partnerId },
  ];
}

/** Approved expense report: 770 + 191 İndirilecek KDV / 335 Personele Borçlar. */
export function expenseReportLines(input: {
  employeeId: string;
  total: Dec;
  vat: Dec;
}): DraftLine[] {
  return [
    { code: ACC.GENERAL_ADMIN_EXPENSES, debit: input.total.minus(input.vat) },
    { code: ACC.INPUT_VAT, debit: input.vat },
    { code: ACC.DUE_TO_EMPLOYEES, credit: input.total, employeeId: input.employeeId },
  ];
}

/** Reimbursement or net salary payment: 335 / 100 or 102; signed. */
export function employeePaymentLines(input: {
  treasuryType: TreasuryAccountType;
  amount: Dec;
  employeeId?: string | null;
}): DraftLine[] {
  return [
    { code: ACC.DUE_TO_EMPLOYEES, debit: input.amount, employeeId: input.employeeId ?? null },
    { code: treasuryCode(input.treasuryType), credit: input.amount },
  ];
}

/**
 * Approved payroll: employer cost to 770 against net salaries (335), income and stamp tax (360),
 * employee and employer SGK and unemployment contributions (361) and other deductions (336).
 */
export function payrollLines(input: {
  net: Dec;
  tax: Dec;
  sgk: Dec;
  deductions: Dec;
}): DraftLine[] {
  const credits = input.net.plus(input.tax).plus(input.sgk).plus(input.deductions);
  return [
    { code: ACC.GENERAL_ADMIN_EXPENSES, debit: credits },
    { code: ACC.DUE_TO_EMPLOYEES, credit: input.net },
    { code: ACC.TAXES_PAYABLE, credit: input.tax },
    { code: ACC.SOCIAL_SECURITY_PAYABLE, credit: input.sgk },
    { code: ACC.OTHER_PAYABLES, credit: input.deductions },
  ];
}
