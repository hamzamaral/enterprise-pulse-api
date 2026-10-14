import { EInvoiceProfile, EInvoiceStatus } from '@prisma/client';
import {
  buildLines,
  canRespond,
  isValidTaxId,
  isValidTckn,
  isValidVkn,
  nextOutgoingStep,
  resolveProfile,
  salesCancelCheck,
  toGibNumber,
  unitCode,
  validateForGib,
  withVknCheckDigit,
  type ValidationInput,
} from './einvoice-rules';

const { TEMELFATURA, TICARIFATURA, EARSIVFATURA } = EInvoiceProfile;
const DAY = 86_400_000;
const NOW = new Date('2026-10-14T09:00:00Z');

describe('tax ids', () => {
  it('checks the VKN check digit', () => {
    expect(isValidVkn('3130557669')).toBe(true);
    expect(isValidVkn('1234567890')).toBe(true);
    expect(isValidVkn('3130557668')).toBe(false);
    expect(isValidVkn('313055766')).toBe(false);
    expect(isValidVkn('31305576AB')).toBe(false);
  });

  it('repairs the VKN check digit', () => {
    expect(withVknCheckDigit('9876543210')).toBe('9876543217');
    expect(isValidVkn(withVknCheckDigit('5556667778'))).toBe(true);
    expect(withVknCheckDigit('3130557669')).toBe('3130557669');
  });

  it('checks the TCKN rules', () => {
    expect(isValidTckn('10000000146')).toBe(true);
    expect(isValidTckn('10000000147')).toBe(false);
    expect(isValidTckn('00000000146')).toBe(false);
    expect(isValidTaxId('10000000146')).toBe(true);
    expect(isValidTaxId('3130557669')).toBe(true);
    expect(isValidTaxId(null)).toBe(false);
  });
});

describe('profiles and numbers', () => {
  it('sends e-Fatura to registered users and e-Arşiv to the rest', () => {
    const alias = 'urn:mail:defaultpk@firma.com.tr';
    expect(resolveProfile(alias, undefined, TICARIFATURA)).toBe(TICARIFATURA);
    expect(resolveProfile(alias, TEMELFATURA, TICARIFATURA)).toBe(TEMELFATURA);
    expect(resolveProfile(alias, EARSIVFATURA, TICARIFATURA)).toBeNull();
    expect(resolveProfile(null, undefined, TICARIFATURA)).toBe(EARSIVFATURA);
    expect(resolveProfile(null, TICARIFATURA, TICARIFATURA)).toBeNull();
  });

  it('strips the dashes of the formatted number', () => {
    expect(toGibNumber('EPF-2026-000000042')).toBe('EPF2026000000042');
  });

  it('maps units to UN/ECE codes', () => {
    expect(unitCode('ADET')).toBe('C62');
    expect(unitCode('KG')).toBe('KGM');
    expect(unitCode('SAAT')).toBe('HUR');
    expect(unitCode(null)).toBe('C62');
  });
});

describe('buildLines', () => {
  it('computes line and document amounts with a VAT breakdown', () => {
    const { lines, totals } = buildLines([
      {
        description: 'Laptop',
        sellerCode: 'LAP-01',
        variantId: null,
        unit: 'ADET',
        quantity: 2,
        unitPrice: 1000,
        discountRate: 10,
        vatRate: 20,
      },
      {
        description: 'Kurulum',
        sellerCode: null,
        variantId: null,
        unit: 'SAAT',
        quantity: 1.5,
        unitPrice: 200,
        discountRate: 0,
        vatRate: 10,
      },
    ]);
    expect(lines[0]).toMatchObject({
      lineNo: 1,
      quantity: '2',
      unitCode: 'C62',
      gross: '2000.00',
      discount: '200.00',
      net: '1800.00',
      vat: '360.00',
    });
    expect(lines[1]).toMatchObject({
      quantity: '1.5',
      unitCode: 'HUR',
      net: '300.00',
      vat: '30.00',
    });
    expect(totals).toEqual({
      lineExtension: '2100.00',
      allowance: '200.00',
      taxExclusive: '2100.00',
      taxInclusive: '2490.00',
      payable: '2490.00',
      taxes: [
        { rate: '10.00', base: '300.00', vat: '30.00' },
        { rate: '20.00', base: '1800.00', vat: '360.00' },
      ],
    });
  });
});

describe('validateForGib', () => {
  const { lines, totals } = buildLines([
    {
      description: 'Hizmet',
      sellerCode: null,
      variantId: null,
      unit: null,
      quantity: 1,
      unitPrice: 100,
      discountRate: 0,
      vatRate: 20,
    },
  ]);
  const valid: ValidationInput = {
    profile: TICARIFATURA,
    number: 'EPF2026000000001',
    supplierTaxId: '3130557669',
    customerTaxId: '1234567890',
    receiverAlias: 'urn:mail:defaultpk@firma.com.tr',
    currencyCode: 'TRY',
    exchangeRate: 1,
    lines,
    payable: totals.payable,
  };

  it('accepts a consistent invoice', () => {
    expect(validateForGib(valid)).toEqual([]);
  });

  it('reports invalid parties, numbers and totals', () => {
    expect(
      validateForGib({
        ...valid,
        number: 'EPF-2026-1',
        customerTaxId: '8889990001',
        receiverAlias: null,
        payable: '999.00',
      }),
    ).toEqual([
      'Fatura numarası GİB formatına uymuyor: EPF-2026-1',
      'Alıcı VKN/TCKN geçersiz: 8889990001',
      'Alıcı posta kutusu etiketi (urn:mail) geçersiz',
      'Ödenecek tutar satır toplamlarıyla uyuşmuyor',
    ]);
    expect(validateForGib({ ...valid, supplierTaxId: null })).toEqual([
      'Gönderici VKN/TCKN geçersiz',
    ]);
  });

  it('lets e-Arşiv go to consumers without a tax id or alias', () => {
    expect(
      validateForGib({ ...valid, profile: EARSIVFATURA, customerTaxId: null, receiverAlias: null }),
    ).toEqual([]);
    expect(validateForGib({ ...valid, customerTaxId: null })).toEqual([
      'Alıcı VKN/TCKN zorunludur',
    ]);
  });
});

describe('outgoing steps', () => {
  const ok = () => [];

  it('validates queued envelopes', () => {
    const queued = { profile: TICARIFATURA, status: EInvoiceStatus.QUEUED, deliveredAt: null };
    expect(nextOutgoingStep(queued, ok, NOW)).toMatchObject({ status: 'SENT', code: '1200' });
    expect(nextOutgoingStep(queued, () => ['a', 'b'], NOW)).toEqual({
      status: 'ERROR',
      code: '1150',
      message: 'a; b',
    });
  });

  it('delivers sent envelopes', () => {
    for (const profile of [TEMELFATURA, TICARIFATURA, EARSIVFATURA]) {
      const step = nextOutgoingStep(
        { profile, status: EInvoiceStatus.SENT, deliveredAt: null },
        ok,
        NOW,
      );
      expect(step).toMatchObject({ status: 'DELIVERED', code: '1300' });
    }
  });

  it('accepts unanswered ticari faturas after eight days', () => {
    const delivered = (days: number) => ({
      profile: TICARIFATURA,
      status: EInvoiceStatus.DELIVERED,
      deliveredAt: new Date(NOW.getTime() - days * DAY),
    });
    expect(nextOutgoingStep(delivered(7), ok, NOW)).toBeNull();
    expect(nextOutgoingStep(delivered(9), ok, NOW)).toMatchObject({
      status: 'ACCEPTED',
      code: 'KABUL',
    });
    expect(canRespond(delivered(7), NOW)).toBe(true);
    expect(canRespond(delivered(9), NOW)).toBe(false);
    expect(canRespond({ ...delivered(1), profile: TEMELFATURA }, NOW)).toBe(false);
  });
});

describe('salesCancelCheck', () => {
  it('allows invoices without an e-invoice or with a failed one', () => {
    expect(salesCancelCheck(null)).toEqual({ allowed: true, cancelEInvoice: false });
    for (const status of [EInvoiceStatus.ERROR, EInvoiceStatus.REJECTED]) {
      expect(salesCancelCheck({ profile: TICARIFATURA, status })).toEqual({
        allowed: true,
        cancelEInvoice: false,
      });
    }
  });

  it('blocks envelopes in flight and delivered e-Fatura', () => {
    expect(salesCancelCheck({ profile: TICARIFATURA, status: 'SENT' })).toMatchObject({
      allowed: false,
    });
    expect(salesCancelCheck({ profile: TEMELFATURA, status: 'DELIVERED' })).toMatchObject({
      allowed: false,
    });
    expect(salesCancelCheck({ profile: TICARIFATURA, status: 'ACCEPTED' })).toMatchObject({
      allowed: false,
    });
  });

  it('cancels delivered e-Arşiv invoices together with the sales invoice', () => {
    expect(salesCancelCheck({ profile: EARSIVFATURA, status: 'DELIVERED' })).toEqual({
      allowed: true,
      cancelEInvoice: true,
    });
  });
});
