import { PartnerType, type PrismaClient } from '@prisma/client';

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
