import { LedgerAccountType } from '@prisma/client';

/** System accounts used by automatic postings. */
export const ACC = {
  CASH: '100',
  CHEQUES_RECEIVED: '101',
  BANKS: '102',
  CHEQUES_ISSUED: '103',
  RECEIVABLES: '120',
  NOTES_RECEIVABLE: '121',
  MERCHANDISE: '153',
  INPUT_VAT: '191',
  PAYABLES: '320',
  NOTES_PAYABLE: '321',
  OTHER_TRADE_PAYABLES: '329',
  DUE_TO_EMPLOYEES: '335',
  OTHER_PAYABLES: '336',
  TAXES_PAYABLE: '360',
  SOCIAL_SECURITY_PAYABLE: '361',
  OUTPUT_VAT: '391',
  CAPITAL: '500',
  SALES: '600',
  SALES_RETURNS: '610',
  COST_OF_GOODS_SOLD: '621',
  OTHER_EXTRAORDINARY_INCOME: '679',
  OTHER_EXTRAORDINARY_EXPENSE: '689',
  DIRECT_MATERIALS: '710',
  DIRECT_MATERIALS_APPLIED: '711',
  DIRECT_LABOR_APPLIED: '721',
  OVERHEAD_APPLIED: '731',
  GENERAL_ADMIN_EXPENSES: '770',
} as const;

export type SystemAccountCode = (typeof ACC)[keyof typeof ACC];

const SYSTEM_CODES = new Set<string>(Object.values(ACC));

/** Main accounts of the Tekdüzen Hesap Planı installed for every company. */
const DEFAULT_ACCOUNTS: [string, string][] = [
  ['100', 'Kasa'],
  ['101', 'Alınan Çekler'],
  ['102', 'Bankalar'],
  ['103', 'Verilen Çekler ve Ödeme Emirleri (-)'],
  ['108', 'Diğer Hazır Değerler'],
  ['120', 'Alıcılar'],
  ['121', 'Alacak Senetleri'],
  ['126', 'Verilen Depozito ve Teminatlar'],
  ['127', 'Diğer Ticari Alacaklar'],
  ['128', 'Şüpheli Ticari Alacaklar'],
  ['135', 'Personelden Alacaklar'],
  ['136', 'Diğer Çeşitli Alacaklar'],
  ['150', 'İlk Madde ve Malzeme'],
  ['153', 'Ticari Mallar'],
  ['159', 'Verilen Sipariş Avansları'],
  ['180', 'Gelecek Aylara Ait Giderler'],
  ['190', 'Devreden KDV'],
  ['191', 'İndirilecek KDV'],
  ['193', 'Peşin Ödenen Vergiler ve Fonlar'],
  ['195', 'İş Avansları'],
  ['196', 'Personel Avansları'],
  ['253', 'Tesis, Makine ve Cihazlar'],
  ['254', 'Taşıtlar'],
  ['255', 'Demirbaşlar'],
  ['257', 'Birikmiş Amortismanlar (-)'],
  ['260', 'Haklar'],
  ['300', 'Banka Kredileri'],
  ['320', 'Satıcılar'],
  ['321', 'Borç Senetleri'],
  ['326', 'Alınan Depozito ve Teminatlar'],
  ['329', 'Diğer Ticari Borçlar'],
  ['335', 'Personele Borçlar'],
  ['336', 'Diğer Çeşitli Borçlar'],
  ['340', 'Alınan Sipariş Avansları'],
  ['360', 'Ödenecek Vergi ve Fonlar'],
  ['361', 'Ödenecek Sosyal Güvenlik Kesintileri'],
  ['370', 'Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları'],
  ['380', 'Gelecek Aylara Ait Gelirler'],
  ['391', 'Hesaplanan KDV'],
  ['400', 'Banka Kredileri (Uzun Vadeli)'],
  ['500', 'Sermaye'],
  ['540', 'Yasal Yedekler'],
  ['570', 'Geçmiş Yıllar Kârları'],
  ['580', 'Geçmiş Yıllar Zararları (-)'],
  ['590', 'Dönem Net Kârı'],
  ['591', 'Dönem Net Zararı (-)'],
  ['600', 'Yurt İçi Satışlar'],
  ['601', 'Yurt Dışı Satışlar'],
  ['602', 'Diğer Gelirler'],
  ['610', 'Satıştan İadeler (-)'],
  ['611', 'Satış İskontoları (-)'],
  ['620', 'Satılan Mamuller Maliyeti (-)'],
  ['621', 'Satılan Ticari Mallar Maliyeti (-)'],
  ['622', 'Satılan Hizmet Maliyeti (-)'],
  ['630', 'Araştırma ve Geliştirme Giderleri (-)'],
  ['631', 'Pazarlama, Satış ve Dağıtım Giderleri (-)'],
  ['632', 'Genel Yönetim Giderleri (-)'],
  ['642', 'Faiz Gelirleri'],
  ['646', 'Kambiyo Kârları'],
  ['649', 'Diğer Olağan Gelir ve Kârlar'],
  ['653', 'Komisyon Giderleri (-)'],
  ['656', 'Kambiyo Zararları (-)'],
  ['659', 'Diğer Olağan Gider ve Zararlar (-)'],
  ['660', 'Kısa Vadeli Borçlanma Giderleri (-)'],
  ['679', 'Diğer Olağandışı Gelir ve Kârlar'],
  ['689', 'Diğer Olağandışı Gider ve Zararlar (-)'],
  ['691', 'Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları (-)'],
  ['710', 'Direkt İlk Madde ve Malzeme Giderleri'],
  ['711', 'Direkt İlk Madde ve Malzeme Yansıtma Hesabı'],
  ['720', 'Direkt İşçilik Giderleri'],
  ['721', 'Direkt İşçilik Giderleri Yansıtma Hesabı'],
  ['730', 'Genel Üretim Giderleri'],
  ['731', 'Genel Üretim Giderleri Yansıtma Hesabı'],
  ['760', 'Pazarlama, Satış ve Dağıtım Giderleri'],
  ['770', 'Genel Yönetim Giderleri'],
  ['780', 'Finansman Giderleri'],
];

/** Account type from the first digits of the code (class 6 mixes income and expense). */
export function accountType(code: string): LedgerAccountType {
  const cls = code[0];
  if (cls === '1' || cls === '2') return LedgerAccountType.ASSET;
  if (cls === '3' || cls === '4') return LedgerAccountType.LIABILITY;
  if (cls === '5') return LedgerAccountType.EQUITY;
  if (cls === '6' && ['60', '64', '67'].includes(code.slice(0, 2))) return LedgerAccountType.INCOME;
  return LedgerAccountType.EXPENSE;
}

export interface DefaultAccount {
  code: string;
  name: string;
  type: LedgerAccountType;
  isSystem: boolean;
}

export function defaultChart(): DefaultAccount[] {
  return DEFAULT_ACCOUNTS.map(([code, name]) => ({
    code,
    name,
    type: accountType(code),
    isSystem: SYSTEM_CODES.has(code),
  }));
}

/** "100" or "100.01.002": three digits optionally followed by dot-separated digit groups. */
export const ACCOUNT_CODE = /^[1-7]\d{2}(\.\d{1,4})*$/;

/** Three-digit main account of any code. */
export const mainCode = (code: string) => code.slice(0, 3);

/** Hesap sınıfları of the balance sheet. */
export const BALANCE_CLASSES: Record<string, string> = {
  '1': 'Dönen Varlıklar',
  '2': 'Duran Varlıklar',
  '3': 'Kısa Vadeli Yabancı Kaynaklar',
  '4': 'Uzun Vadeli Yabancı Kaynaklar',
  '5': 'Özkaynaklar',
};

/** Hesap grupları (first two digits). */
export const ACCOUNT_GROUPS: Record<string, string> = {
  '10': 'Hazır Değerler',
  '11': 'Menkul Kıymetler',
  '12': 'Ticari Alacaklar',
  '13': 'Diğer Alacaklar',
  '15': 'Stoklar',
  '17': 'Yıllara Yaygın İnşaat ve Onarım Maliyetleri',
  '18': 'Gelecek Aylara Ait Giderler ve Gelir Tahakkukları',
  '19': 'Diğer Dönen Varlıklar',
  '22': 'Ticari Alacaklar',
  '23': 'Diğer Alacaklar',
  '24': 'Mali Duran Varlıklar',
  '25': 'Maddi Duran Varlıklar',
  '26': 'Maddi Olmayan Duran Varlıklar',
  '27': 'Özel Tükenmeye Tabi Varlıklar',
  '28': 'Gelecek Yıllara Ait Giderler ve Gelir Tahakkukları',
  '29': 'Diğer Duran Varlıklar',
  '30': 'Mali Borçlar',
  '32': 'Ticari Borçlar',
  '33': 'Diğer Borçlar',
  '34': 'Alınan Avanslar',
  '35': 'Yıllara Yaygın İnşaat ve Onarım Hakedişleri',
  '36': 'Ödenecek Vergi ve Diğer Yükümlülükler',
  '37': 'Borç ve Gider Karşılıkları',
  '38': 'Gelecek Aylara Ait Gelirler ve Gider Tahakkukları',
  '39': 'Diğer Kısa Vadeli Yabancı Kaynaklar',
  '40': 'Mali Borçlar',
  '42': 'Ticari Borçlar',
  '43': 'Diğer Borçlar',
  '44': 'Alınan Avanslar',
  '47': 'Borç ve Gider Karşılıkları',
  '48': 'Gelecek Yıllara Ait Gelirler ve Gider Tahakkukları',
  '49': 'Diğer Uzun Vadeli Yabancı Kaynaklar',
  '50': 'Ödenmiş Sermaye',
  '52': 'Sermaye Yedekleri',
  '54': 'Kâr Yedekleri',
  '57': 'Geçmiş Yıllar Kârları',
  '58': 'Geçmiş Yıllar Zararları (-)',
  '59': 'Dönem Net Kârı (Zararı)',
};

export type IncomeSectionKey =
  | 'grossSales'
  | 'salesDeductions'
  | 'costOfSales'
  | 'operatingExpenses'
  | 'otherIncome'
  | 'otherExpenses'
  | 'financeExpenses'
  | 'extraordinaryIncome'
  | 'extraordinaryExpenses'
  | 'taxProvision';

/** Gelir tablosu sections in statement order. */
export const INCOME_SECTIONS: { key: IncomeSectionKey; label: string; prefixes: string[] }[] = [
  { key: 'grossSales', label: 'A. Brüt Satışlar', prefixes: ['60'] },
  { key: 'salesDeductions', label: 'B. Satış İndirimleri (-)', prefixes: ['61'] },
  { key: 'costOfSales', label: 'D. Satışların Maliyeti (-)', prefixes: ['62'] },
  {
    key: 'operatingExpenses',
    label: 'E. Faaliyet Giderleri (-)',
    prefixes: ['63', '71', '72', '73', '74', '75', '76', '77', '79'],
  },
  { key: 'otherIncome', label: 'F. Diğer Faaliyetlerden Olağan Gelir ve Kârlar', prefixes: ['64'] },
  {
    key: 'otherExpenses',
    label: 'G. Diğer Faaliyetlerden Olağan Gider ve Zararlar (-)',
    prefixes: ['65'],
  },
  { key: 'financeExpenses', label: 'H. Finansman Giderleri (-)', prefixes: ['66', '78'] },
  { key: 'extraordinaryIncome', label: 'I. Olağandışı Gelir ve Kârlar', prefixes: ['67'] },
  { key: 'extraordinaryExpenses', label: 'J. Olağandışı Gider ve Zararlar (-)', prefixes: ['68'] },
  {
    key: 'taxProvision',
    label: 'K. Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları (-)',
    prefixes: ['69'],
  },
];

export function incomeSection(code: string): IncomeSectionKey | null {
  const prefix = code.slice(0, 2);
  return INCOME_SECTIONS.find((s) => s.prefixes.includes(prefix))?.key ?? null;
}

/** Classes 6 and 7 make up the result of the period. */
export const isResultAccount = (code: string) => code[0] === '6' || code[0] === '7';
