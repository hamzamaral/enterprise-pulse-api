import { EInvoiceProfile, Prisma } from '@prisma/client';
import {
  ANONYMOUS_TCKN,
  taxIdScheme,
  type EInvoiceLine,
  type EInvoiceTotals,
} from './einvoice-rules';

export interface UblParty {
  taxId: string | null;
  name: string;
  taxOffice: string | null;
  street: string | null;
  city: string | null;
  country: string;
  email: string | null;
}

export interface UblInvoice {
  profile: EInvoiceProfile;
  number: string;
  uuid: string;
  /** yyyy-MM-dd */
  issueDate: string;
  /** HH:mm:ss */
  issueTime: string;
  currencyCode: string;
  /** Required for foreign-currency invoices. */
  exchangeRate: string | null;
  notes: string[];
  supplier: UblParty;
  customer: UblParty;
  lines: EInvoiceLine[];
  totals: EInvoiceTotals;
  orderReference: { number: string; date: string } | null;
}

const COUNTRIES: Record<string, string> = {
  TR: 'Türkiye',
  DE: 'Almanya',
  SE: 'İsveç',
  US: 'Amerika Birleşik Devletleri',
  GB: 'Birleşik Krallık',
};

export const escapeXml = (value: string) =>
  value.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;',
  );

class XmlWriter {
  private readonly out: string[] = [];
  private depth = 0;

  open(tag: string, attrs: Record<string, string> = {}): this {
    this.out.push(`${this.indent()}<${tag}${this.attrs(attrs)}>`);
    this.depth += 1;
    return this;
  }

  close(tag: string): this {
    this.depth -= 1;
    this.out.push(`${this.indent()}</${tag}>`);
    return this;
  }

  /** Writes `<tag>value</tag>`; skipped when the value is null or empty. */
  leaf(tag: string, value: string | null | undefined, attrs: Record<string, string> = {}): this {
    if (value === null || value === undefined || value === '') return this;
    this.out.push(`${this.indent()}<${tag}${this.attrs(attrs)}>${escapeXml(value)}</${tag}>`);
    return this;
  }

  toString(): string {
    return `${this.out.join('\n')}\n`;
  }

  private indent() {
    return '  '.repeat(this.depth);
  }

  private attrs(attrs: Record<string, string>) {
    return Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
      .join('');
  }
}

const NAMESPACES = {
  xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  'xmlns:ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
};

function party(w: XmlWriter, tag: string, p: UblParty, eArchive: boolean) {
  const taxId = p.taxId || (eArchive ? ANONYMOUS_TCKN : '');
  const scheme = taxIdScheme(taxId);
  w.open(tag).open('cac:Party');
  w.open('cac:PartyIdentification').leaf('cbc:ID', taxId, { schemeID: scheme });
  w.close('cac:PartyIdentification');
  if (scheme === 'VKN') {
    w.open('cac:PartyName').leaf('cbc:Name', p.name).close('cac:PartyName');
  }
  w.open('cac:PostalAddress');
  w.leaf('cbc:StreetName', p.street);
  w.leaf('cbc:CitySubdivisionName', p.city);
  w.leaf('cbc:CityName', p.city ?? '-');
  w.open('cac:Country')
    .leaf('cbc:Name', COUNTRIES[p.country] ?? p.country)
    .close('cac:Country');
  w.close('cac:PostalAddress');
  if (p.taxOffice) {
    w.open('cac:PartyTaxScheme').open('cac:TaxScheme').leaf('cbc:Name', p.taxOffice);
    w.close('cac:TaxScheme').close('cac:PartyTaxScheme');
  }
  if (p.email) w.open('cac:Contact').leaf('cbc:ElectronicMail', p.email).close('cac:Contact');
  if (scheme === 'TCKN') {
    const parts = p.name.trim().split(/\s+/);
    const family = parts.length > 1 ? parts.pop()! : parts[0];
    w.open('cac:Person').leaf('cbc:FirstName', parts.join(' ')).leaf('cbc:FamilyName', family);
    w.close('cac:Person');
  }
  w.close('cac:Party').close(tag);
}

function vatSubtotal(
  w: XmlWriter,
  currency: Record<string, string>,
  base: string,
  vat: string,
  rate: string,
) {
  w.open('cac:TaxSubtotal');
  w.leaf('cbc:TaxableAmount', base, currency);
  w.leaf('cbc:TaxAmount', vat, currency);
  w.leaf('cbc:Percent', Number(rate).toString());
  w.open('cac:TaxCategory').open('cac:TaxScheme');
  w.leaf('cbc:Name', 'KDV').leaf('cbc:TaxTypeCode', '0015');
  w.close('cac:TaxScheme').close('cac:TaxCategory');
  w.close('cac:TaxSubtotal');
}

/** UBL-TR 2.1 invoice (TR1.2 customisation); the digital signature is left to the integrator. */
export function buildInvoiceXml(doc: UblInvoice): string {
  const eArchive = doc.profile === EInvoiceProfile.EARSIVFATURA;
  const currency = { currencyID: doc.currencyCode };
  const w = new XmlWriter();
  w.open('Invoice', NAMESPACES);
  w.open('ext:UBLExtensions').open('ext:UBLExtension').leaf('ext:ExtensionContent', '-');
  w.close('ext:UBLExtension').close('ext:UBLExtensions');
  w.leaf('cbc:UBLVersionID', '2.1');
  w.leaf('cbc:CustomizationID', 'TR1.2');
  w.leaf('cbc:ProfileID', doc.profile);
  w.leaf('cbc:ID', doc.number);
  w.leaf('cbc:CopyIndicator', 'false');
  w.leaf('cbc:UUID', doc.uuid);
  w.leaf('cbc:IssueDate', doc.issueDate);
  w.leaf('cbc:IssueTime', doc.issueTime);
  w.leaf('cbc:InvoiceTypeCode', 'SATIS');
  for (const note of doc.notes) w.leaf('cbc:Note', note);
  w.leaf('cbc:DocumentCurrencyCode', doc.currencyCode);
  w.leaf('cbc:LineCountNumeric', String(doc.lines.length));
  if (doc.orderReference) {
    w.open('cac:OrderReference');
    w.leaf('cbc:ID', doc.orderReference.number).leaf('cbc:IssueDate', doc.orderReference.date);
    w.close('cac:OrderReference');
  }
  if (eArchive) {
    w.open('cac:AdditionalDocumentReference');
    w.leaf('cbc:ID', 'ELEKTRONIK').leaf('cbc:IssueDate', doc.issueDate);
    w.leaf('cbc:DocumentTypeCode', 'EREPSENDT');
    w.close('cac:AdditionalDocumentReference');
  }
  party(w, 'cac:AccountingSupplierParty', doc.supplier, false);
  party(w, 'cac:AccountingCustomerParty', doc.customer, eArchive);
  if (doc.exchangeRate && doc.currencyCode !== 'TRY') {
    w.open('cac:PricingExchangeRate');
    w.leaf('cbc:SourceCurrencyCode', doc.currencyCode).leaf('cbc:TargetCurrencyCode', 'TRY');
    w.leaf('cbc:CalculationRate', doc.exchangeRate).leaf('cbc:Date', doc.issueDate);
    w.close('cac:PricingExchangeRate');
  }

  const taxTotal = doc.totals.taxes
    .reduce((sum, t) => sum.plus(t.vat), new Prisma.Decimal(0))
    .toFixed(2);
  w.open('cac:TaxTotal').leaf('cbc:TaxAmount', taxTotal, currency);
  for (const t of doc.totals.taxes) vatSubtotal(w, currency, t.base, t.vat, t.rate);
  w.close('cac:TaxTotal');

  w.open('cac:LegalMonetaryTotal');
  w.leaf('cbc:LineExtensionAmount', doc.totals.lineExtension, currency);
  w.leaf('cbc:TaxExclusiveAmount', doc.totals.taxExclusive, currency);
  w.leaf('cbc:TaxInclusiveAmount', doc.totals.taxInclusive, currency);
  w.leaf('cbc:AllowanceTotalAmount', doc.totals.allowance, currency);
  w.leaf('cbc:PayableAmount', doc.totals.payable, currency);
  w.close('cac:LegalMonetaryTotal');

  for (const line of doc.lines) {
    w.open('cac:InvoiceLine');
    w.leaf('cbc:ID', String(line.lineNo));
    w.leaf('cbc:InvoicedQuantity', line.quantity, { unitCode: line.unitCode });
    w.leaf('cbc:LineExtensionAmount', line.net, currency);
    if (Number(line.discount) > 0) {
      w.open('cac:AllowanceCharge');
      w.leaf('cbc:ChargeIndicator', 'false');
      w.leaf('cbc:MultiplierFactorNumeric', (Number(line.discountRate) / 100).toString());
      w.leaf('cbc:Amount', line.discount, currency);
      w.leaf('cbc:BaseAmount', line.gross, currency);
      w.close('cac:AllowanceCharge');
    }
    w.open('cac:TaxTotal').leaf('cbc:TaxAmount', line.vat, currency);
    vatSubtotal(w, currency, line.net, line.vat, line.vatRate);
    w.close('cac:TaxTotal');
    w.open('cac:Item').leaf('cbc:Name', line.description);
    if (line.sellerCode) {
      w.open('cac:SellersItemIdentification').leaf('cbc:ID', line.sellerCode);
      w.close('cac:SellersItemIdentification');
    }
    w.close('cac:Item');
    w.open('cac:Price').leaf('cbc:PriceAmount', line.unitPrice, currency).close('cac:Price');
    w.close('cac:InvoiceLine');
  }
  w.close('Invoice');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${w.toString()}`;
}
