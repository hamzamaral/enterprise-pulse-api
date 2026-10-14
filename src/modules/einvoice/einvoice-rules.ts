import { EInvoiceProfile, EInvoiceStatus, Prisma } from '@prisma/client';
import { documentAmounts, lineAmounts } from '../../common/money/document-totals';

/** e-Fatura posta kutusu etiketi, e.g. "urn:mail:defaultpk@firma.com.tr". */
export const ALIAS_PATTERN = /^urn:mail:[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** GİB invoice number: 3-character prefix, 4-digit year and a 9-digit sequence. */
export const GIB_NUMBER = /^[A-Z0-9]{3}\d{4}\d{9}$/;
/** Ticari fatura: the receiver may accept or reject within 8 days of delivery. */
export const RESPONSE_DAYS = 8;
/** GİB accepts this TCKN on e-Arşiv invoices for consumers without a tax id. */
export const ANONYMOUS_TCKN = '11111111111';

/** GİB / receiver status codes used by the simulation. */
export const GIB_CODES = {
  QUEUED: '1000',
  SCHEMA_ERROR: '1150',
  PROCESSED: '1200',
  COMPLETED: '1300',
  ACCEPTED: 'KABUL',
  REJECTED: 'RED',
  CANCELLED: 'IPTAL',
} as const;

/** Vergi kimlik numarası (10 digits) check digit. */
export function isValidVkn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (Number(value[i]) + 9 - i) % 10;
    let v = (t * 2 ** (9 - i)) % 9;
    if (t !== 0 && v === 0) v = 9;
    sum += v;
  }
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}

/** The VKN with its check digit fixed; used to repair sample data. */
export function withVknCheckDigit(value: string): string {
  const head = value.slice(0, 9);
  for (let digit = 0; digit <= 9; digit++) {
    if (isValidVkn(`${head}${digit}`)) return `${head}${digit}`;
  }
  return value;
}

/** T.C. kimlik numarası (11 digits). */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = value.split('').map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d[9] === tenth && d[10] === eleventh;
}

export const isValidTaxId = (value: string | null | undefined): boolean =>
  !!value && (value.length === 11 ? isValidTckn(value) : isValidVkn(value));

export const taxIdScheme = (value: string) => (value.length === 11 ? 'TCKN' : 'VKN');

/** "EPF-2026-000000001" → "EPF2026000000001". */
export const toGibNumber = (formatted: string) => formatted.replace(/-/g, '');

/**
 * The scenario of an outgoing invoice: registered receivers (with an alias) get e-Fatura, the
 * rest e-Arşiv. Returns null when the requested profile does not fit the receiver.
 */
export function resolveProfile(
  receiverAlias: string | null,
  requested: EInvoiceProfile | undefined,
  fallback: EInvoiceProfile,
): EInvoiceProfile | null {
  if (!receiverAlias) {
    return !requested || requested === EInvoiceProfile.EARSIVFATURA
      ? EInvoiceProfile.EARSIVFATURA
      : null;
  }
  const profile = requested ?? fallback;
  return profile === EInvoiceProfile.EARSIVFATURA ? null : profile;
}

export interface EInvoiceLineInput {
  description: string;
  sellerCode: string | null;
  variantId: string | null;
  /** Internal unit code such as ADET; mapped to UN/ECE. */
  unit: string | null;
  quantity: Prisma.Decimal.Value;
  unitPrice: Prisma.Decimal.Value;
  discountRate: Prisma.Decimal.Value;
  vatRate: Prisma.Decimal.Value;
}

/** Line snapshot stored on the e-invoice and written to the XML. */
export interface EInvoiceLine {
  lineNo: number;
  description: string;
  sellerCode: string | null;
  variantId: string | null;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  discountRate: string;
  gross: string;
  discount: string;
  net: string;
  vatRate: string;
  vat: string;
}

export interface EInvoiceTotals {
  lineExtension: string;
  allowance: string;
  taxExclusive: string;
  taxInclusive: string;
  payable: string;
  taxes: { rate: string; base: string; vat: string }[];
}

const UNIT_CODES: Record<string, string> = {
  ADET: 'C62',
  KG: 'KGM',
  LT: 'LTR',
  M: 'MTR',
  M2: 'MTK',
  KOLI: 'CT',
  SAAT: 'HUR',
};

/** UN/ECE Rec. 20 unit code used by UBL-TR; unknown units are sent as pieces. */
export const unitCode = (unit: string | null) => (unit && UNIT_CODES[unit]) || 'C62';

const trimQty = (value: Prisma.Decimal) => value.toFixed(3).replace(/\.?0+$/, '');

export function buildLines(inputs: EInvoiceLineInput[]): {
  lines: EInvoiceLine[];
  totals: EInvoiceTotals;
} {
  const lines = inputs.map((input, index) => {
    const amounts = lineAmounts(input);
    return {
      lineNo: index + 1,
      description: input.description,
      sellerCode: input.sellerCode,
      variantId: input.variantId,
      quantity: trimQty(new Prisma.Decimal(input.quantity)),
      unitCode: unitCode(input.unit),
      unitPrice: new Prisma.Decimal(input.unitPrice).toFixed(4),
      discountRate: new Prisma.Decimal(input.discountRate).toFixed(2),
      gross: amounts.gross.toFixed(2),
      discount: amounts.discount.toFixed(2),
      net: amounts.net.toFixed(2),
      vatRate: new Prisma.Decimal(input.vatRate).toFixed(2),
      vat: amounts.vat.toFixed(2),
    };
  });
  const doc = documentAmounts(inputs);
  return {
    lines,
    totals: {
      lineExtension: doc.netTotal.toFixed(2),
      allowance: doc.discountTotal.toFixed(2),
      taxExclusive: doc.netTotal.toFixed(2),
      taxInclusive: doc.grandTotal.toFixed(2),
      payable: doc.grandTotal.toFixed(2),
      taxes: doc.vatBreakdown.map((b) => ({
        rate: b.rate.toFixed(2),
        base: b.base.toFixed(2),
        vat: b.vat.toFixed(2),
      })),
    },
  };
}

export interface ValidationInput {
  profile: EInvoiceProfile;
  number: string;
  supplierTaxId: string | null;
  customerTaxId: string | null;
  receiverAlias: string | null;
  currencyCode: string;
  exchangeRate: Prisma.Decimal.Value;
  lines: EInvoiceLine[];
  payable: Prisma.Decimal.Value;
}

/** Simulated GİB schematron checks; returns the error messages (empty when valid). */
export function validateForGib(input: ValidationInput): string[] {
  const errors: string[] = [];
  if (!GIB_NUMBER.test(input.number)) {
    errors.push(`Fatura numarası GİB formatına uymuyor: ${input.number}`);
  }
  if (!isValidTaxId(input.supplierTaxId)) {
    errors.push('Gönderici VKN/TCKN geçersiz');
  }
  const eArchive = input.profile === EInvoiceProfile.EARSIVFATURA;
  if (!input.customerTaxId) {
    if (!eArchive) errors.push('Alıcı VKN/TCKN zorunludur');
  } else if (!isValidTaxId(input.customerTaxId)) {
    errors.push(`Alıcı VKN/TCKN geçersiz: ${input.customerTaxId}`);
  }
  if (!eArchive && !(input.receiverAlias && ALIAS_PATTERN.test(input.receiverAlias))) {
    errors.push('Alıcı posta kutusu etiketi (urn:mail) geçersiz');
  }
  if (input.currencyCode !== 'TRY' && !new Prisma.Decimal(input.exchangeRate).greaterThan(0)) {
    errors.push('Döviz kuru zorunludur');
  }
  if (!input.lines.length) errors.push('Fatura en az bir satır içermelidir');
  input.lines.forEach((line) => {
    if (!new Prisma.Decimal(line.quantity).greaterThan(0)) {
      errors.push(`Satır ${line.lineNo}: miktar sıfırdan büyük olmalıdır`);
    }
  });
  const total = input.lines.reduce(
    (sum, line) => sum.plus(line.net).plus(line.vat),
    new Prisma.Decimal(0),
  );
  if (!total.equals(new Prisma.Decimal(input.payable))) {
    errors.push('Ödenecek tutar satır toplamlarıyla uyuşmuyor');
  }
  return errors;
}

const DAY = 86_400_000;

/** Whether a ticari fatura can still be accepted or rejected. */
export function canRespond(
  invoice: { profile: EInvoiceProfile; status: EInvoiceStatus; deliveredAt: Date | null },
  now: Date,
): boolean {
  return (
    invoice.profile === EInvoiceProfile.TICARIFATURA &&
    invoice.status === EInvoiceStatus.DELIVERED &&
    !!invoice.deliveredAt &&
    now.getTime() - invoice.deliveredAt.getTime() <= RESPONSE_DAYS * DAY
  );
}

/** A delivered ticari fatura without a response after 8 days counts as accepted. */
export function responseExpired(
  invoice: { profile: EInvoiceProfile; status: EInvoiceStatus; deliveredAt: Date | null },
  now: Date,
): boolean {
  return (
    invoice.profile === EInvoiceProfile.TICARIFATURA &&
    invoice.status === EInvoiceStatus.DELIVERED &&
    !!invoice.deliveredAt &&
    now.getTime() - invoice.deliveredAt.getTime() > RESPONSE_DAYS * DAY
  );
}

export type CancelCheck =
  { allowed: true; cancelEInvoice: boolean } | { allowed: false; reason: string };

/**
 * Whether the sales invoice behind an e-invoice may be cancelled. Delivered e-Arşiv invoices are
 * cancelled with it; delivered e-Fatura can only be undone by the receiver rejecting it.
 */
export function salesCancelCheck(
  invoice: { profile: EInvoiceProfile; status: EInvoiceStatus } | null,
): CancelCheck {
  if (!invoice) return { allowed: true, cancelEInvoice: false };
  switch (invoice.status) {
    case EInvoiceStatus.QUEUED:
    case EInvoiceStatus.SENT:
      return { allowed: false, reason: 'The e-invoice is being sent; wait for the GİB response' };
    case EInvoiceStatus.DELIVERED:
    case EInvoiceStatus.ACCEPTED:
      if (invoice.profile === EInvoiceProfile.EARSIVFATURA) {
        return { allowed: true, cancelEInvoice: true };
      }
      return {
        allowed: false,
        reason: 'The e-Fatura was delivered; it can only be cancelled if the receiver rejects it',
      };
    default:
      return { allowed: true, cancelEInvoice: false };
  }
}

/** Next status of an outgoing envelope in one integrator run; null when nothing changes. */
export function nextOutgoingStep(
  invoice: { profile: EInvoiceProfile; status: EInvoiceStatus; deliveredAt: Date | null },
  errors: () => string[],
  now: Date,
): { status: EInvoiceStatus; code: string; message: string } | null {
  if (invoice.status === EInvoiceStatus.QUEUED) {
    const problems = errors();
    if (problems.length) {
      return {
        status: EInvoiceStatus.ERROR,
        code: GIB_CODES.SCHEMA_ERROR,
        message: problems.join('; '),
      };
    }
    return {
      status: EInvoiceStatus.SENT,
      code: GIB_CODES.PROCESSED,
      message: 'Zarf başarıyla işlendi',
    };
  }
  if (invoice.status === EInvoiceStatus.SENT) {
    if (invoice.profile === EInvoiceProfile.EARSIVFATURA) {
      return {
        status: EInvoiceStatus.DELIVERED,
        code: GIB_CODES.COMPLETED,
        message: 'e-Arşiv raporuna eklendi; alıcıya e-posta ile iletildi',
      };
    }
    return {
      status: EInvoiceStatus.DELIVERED,
      code: GIB_CODES.COMPLETED,
      message:
        invoice.profile === EInvoiceProfile.TICARIFATURA
          ? 'Alıcıya ulaştı; ticari fatura yanıtı bekleniyor'
          : 'Başarıyla tamamlandı',
    };
  }
  if (responseExpired(invoice, now)) {
    return {
      status: EInvoiceStatus.ACCEPTED,
      code: GIB_CODES.ACCEPTED,
      message: `${RESPONSE_DAYS} gün içinde yanıt verilmedi; kabul edilmiş sayılır`,
    };
  }
  return null;
}
