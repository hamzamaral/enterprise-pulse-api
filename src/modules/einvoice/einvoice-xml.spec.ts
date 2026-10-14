import { EInvoiceProfile } from '@prisma/client';
import { buildLines } from './einvoice-rules';
import { buildInvoiceXml, escapeXml, type UblInvoice } from './einvoice-xml';

const { lines, totals } = buildLines([
  {
    description: 'Ofis Koltuğu <Ergonomik> & Siyah',
    sellerCode: 'MOB-01',
    variantId: null,
    unit: 'ADET',
    quantity: 2,
    unitPrice: 1500,
    discountRate: 10,
    vatRate: 20,
  },
  {
    description: 'Montaj',
    sellerCode: null,
    variantId: null,
    unit: 'SAAT',
    quantity: 3,
    unitPrice: 100,
    discountRate: 0,
    vatRate: 20,
  },
]);

const invoice: UblInvoice = {
  profile: EInvoiceProfile.TICARIFATURA,
  number: 'EPF2026000000007',
  uuid: '5b3f2a8e-1d4c-4c1e-9f0a-2b7c9d8e6f10',
  issueDate: '2026-10-14',
  issueTime: '10:15:00',
  currencyCode: 'TRY',
  exchangeRate: null,
  notes: ['Fatura no: FTR-2026-000007'],
  supplier: {
    taxId: '3130557669',
    name: 'Pulse Teknoloji A.Ş.',
    taxOffice: 'Kozyatağı',
    street: 'Atatürk Cad. 1',
    city: 'İstanbul',
    country: 'TR',
    email: 'info@pulse.dev',
  },
  customer: {
    taxId: '10000000146',
    name: 'Ayşe Nur Yılmaz',
    taxOffice: null,
    street: null,
    city: 'Ankara',
    country: 'TR',
    email: null,
  },
  lines,
  totals,
  orderReference: { number: 'SIP-2026-000003', date: '2026-10-10' },
};

describe('buildInvoiceXml', () => {
  const xml = buildInvoiceXml(invoice);

  it('writes the UBL-TR header', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns=')).toBe(true);
    expect(xml).toContain('<cbc:CustomizationID>TR1.2</cbc:CustomizationID>');
    expect(xml).toContain('<cbc:ProfileID>TICARIFATURA</cbc:ProfileID>');
    expect(xml).toContain('<cbc:ID>EPF2026000000007</cbc:ID>');
    expect(xml).toContain(`<cbc:UUID>${invoice.uuid}</cbc:UUID>`);
    expect(xml).toContain('<cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>');
    expect(xml).toContain('<cbc:LineCountNumeric>2</cbc:LineCountNumeric>');
    expect(xml).toContain('<cbc:ID>SIP-2026-000003</cbc:ID>');
    expect(xml).not.toContain('EREPSENDT');
  });

  it('identifies companies by VKN and people by TCKN', () => {
    expect(xml).toContain('<cbc:ID schemeID="VKN">3130557669</cbc:ID>');
    expect(xml).toContain('<cbc:ID schemeID="TCKN">10000000146</cbc:ID>');
    expect(xml).toContain('<cbc:FirstName>Ayşe Nur</cbc:FirstName>');
    expect(xml).toContain('<cbc:FamilyName>Yılmaz</cbc:FamilyName>');
  });

  it('writes totals, VAT and lines with allowances', () => {
    expect(xml).toContain('<cbc:TaxAmount currencyID="TRY">600.00</cbc:TaxAmount>');
    expect(xml).toContain('<cbc:TaxTypeCode>0015</cbc:TaxTypeCode>');
    expect(xml).toContain(
      '<cbc:LineExtensionAmount currencyID="TRY">3000.00</cbc:LineExtensionAmount>',
    );
    expect(xml).toContain(
      '<cbc:AllowanceTotalAmount currencyID="TRY">300.00</cbc:AllowanceTotalAmount>',
    );
    expect(xml).toContain('<cbc:PayableAmount currencyID="TRY">3600.00</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity>');
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="HUR">3</cbc:InvoicedQuantity>');
    expect(xml).toContain('<cbc:MultiplierFactorNumeric>0.1</cbc:MultiplierFactorNumeric>');
    expect(xml.match(/<cac:AllowanceCharge>/g)).toHaveLength(1);
    expect(xml).toContain('<cbc:Name>Ofis Koltuğu &lt;Ergonomik&gt; &amp; Siyah</cbc:Name>');
  });

  it('marks e-Arşiv invoices and uses the anonymous TCKN for consumers', () => {
    const archive = buildInvoiceXml({
      ...invoice,
      profile: EInvoiceProfile.EARSIVFATURA,
      customer: { ...invoice.customer, taxId: null },
    });
    expect(archive).toContain('<cbc:DocumentTypeCode>EREPSENDT</cbc:DocumentTypeCode>');
    expect(archive).toContain('<cbc:ID schemeID="TCKN">11111111111</cbc:ID>');
  });

  it('adds the exchange rate to foreign-currency invoices', () => {
    const usd = buildInvoiceXml({ ...invoice, currencyCode: 'USD', exchangeRate: '41.2500' });
    expect(usd).toContain('<cbc:CalculationRate>41.2500</cbc:CalculationRate>');
    expect(usd).toContain('currencyID="USD"');
  });

  it('escapes XML special characters', () => {
    expect(escapeXml(`a<b>&"c'`)).toBe('a&lt;b&gt;&amp;&quot;c&apos;');
  });
});
