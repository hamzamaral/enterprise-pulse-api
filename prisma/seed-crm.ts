import {
  CrmActivityType,
  LeadSource,
  LeadStatus,
  OpportunityStage,
  type PrismaClient,
  SalesQuoteStatus,
} from '@prisma/client';
import { defaultProbability } from '../src/modules/crm/crm-math';
import { formatNumber } from '../src/modules/numbering/number-format';

const YEAR = new Date().getFullYear();
const daysAgo = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - days));
};
/** Local time `days` from today at `hour`:00. */
const at = (days: number, hour: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour);
};

interface CrmSeedContext {
  companyId: string;
  adminId: string;
  managerId: string;
  partners: Record<string, string>;
}

interface SeedLead {
  companyName: string;
  contactName: string;
  city: string;
  source: LeadSource;
  status: LeadStatus;
  estimatedValue: number;
  owner: 'admin' | 'manager';
  createdDaysAgo: number;
  disqualifyReason?: string;
  partner?: string;
}

interface SeedOpportunity {
  title: string;
  partner: string;
  stage: OpportunityStage;
  amount: number;
  currencyCode?: string;
  owner: 'admin' | 'manager';
  closeInDays: number;
  createdDaysAgo: number;
  closedDaysAgo?: number;
  lostReason?: string;
  /** Status of the seeded sales quote of the same customer to link. */
  quote?: SalesQuoteStatus;
  lead?: number;
}

const LEADS: SeedLead[] = [
  {
    companyName: 'Başkent Ofis Çözümleri Ltd.',
    contactName: 'Hakan Er',
    city: 'Ankara',
    source: 'REFERRAL',
    status: 'CONVERTED',
    estimatedValue: 50000,
    owner: 'manager',
    createdDaysAgo: 45,
    partner: 'MUS-002',
  },
  {
    companyName: 'Yıldız Mimarlık Ofisi',
    contactName: 'Derya Yıldız',
    city: 'İstanbul',
    source: 'WEBSITE',
    status: 'NEW',
    estimatedValue: 45000,
    owner: 'manager',
    createdDaysAgo: 1,
  },
  {
    companyName: 'Ege Lojistik Hizmetleri A.Ş.',
    contactName: 'Okan Tekin',
    city: 'İzmir',
    source: 'COLD_CALL',
    status: 'CONTACTED',
    estimatedValue: 180000,
    owner: 'admin',
    createdDaysAgo: 9,
  },
  {
    companyName: 'Kapadokya Turizm A.Ş.',
    contactName: 'Sevgi Bulut',
    city: 'Nevşehir',
    source: 'EVENT',
    status: 'QUALIFIED',
    estimatedValue: 95000,
    owner: 'manager',
    createdDaysAgo: 16,
  },
  {
    companyName: 'Marmara Eğitim Kurumları',
    contactName: 'Tolga Işık',
    city: 'Bursa',
    source: 'SOCIAL_MEDIA',
    status: 'DISQUALIFIED',
    estimatedValue: 70000,
    owner: 'admin',
    createdDaysAgo: 30,
    disqualifyReason: 'Bütçe bir sonraki yıla ertelendi',
  },
  {
    companyName: 'Trakya Gıda San. ve Tic.',
    contactName: 'Gül Aksu',
    city: 'Tekirdağ',
    source: 'PARTNER',
    status: 'NEW',
    estimatedValue: 60000,
    owner: 'admin',
    createdDaysAgo: 3,
  },
];

const OPPORTUNITIES: SeedOpportunity[] = [
  {
    title: 'Ofis donanımı yenileme',
    partner: 'MUS-002',
    stage: 'WON',
    amount: 37392,
    owner: 'manager',
    closeInDays: -28,
    createdDaysAgo: 40,
    closedDaysAgo: 28,
    quote: 'ACCEPTED',
    lead: 0,
  },
  {
    title: 'Otel ikram ürünleri tedariki',
    partner: 'MUS-003',
    stage: 'PROPOSAL',
    amount: 37100,
    owner: 'manager',
    closeInDays: 10,
    createdDaysAgo: 27,
    quote: 'OPEN',
  },
  {
    title: 'Toner ve sarf malzemesi anlaşması',
    partner: 'CAR-001',
    stage: 'LOST',
    amount: 11400,
    owner: 'admin',
    closeInDays: -8,
    createdDaysAgo: 14,
    closedDaysAgo: 8,
    lostReason: 'Rakip teklif yaklaşık %15 daha düşük kaldı',
    quote: 'REJECTED',
  },
  {
    title: 'Mağaza yönetici dizüstü yenilemesi',
    partner: 'MUS-001',
    stage: 'NEGOTIATION',
    amount: 79096,
    owner: 'admin',
    closeInDays: 14,
    createdDaysAgo: 6,
    quote: 'OPEN',
  },
  {
    title: 'POS donanımı — İskandinav mağazaları',
    partner: 'MUS-004',
    stage: 'QUALIFICATION',
    amount: 18000,
    currencyCode: 'USD',
    owner: 'manager',
    closeInDays: 45,
    createdDaysAgo: 12,
  },
  {
    title: 'Yıllık bakım ve destek sözleşmesi',
    partner: 'MUS-001',
    stage: 'PROSPECTING',
    amount: 120000,
    owner: 'admin',
    closeInDays: 60,
    createdDaysAgo: 4,
  },
  {
    title: 'Resepsiyon tabletleri',
    partner: 'MUS-003',
    stage: 'WON',
    amount: 54000,
    owner: 'manager',
    closeInDays: -3,
    createdDaysAgo: 20,
    closedDaysAgo: 3,
  },
];

/**
 * CRM demo: leads in every status (one converted into an existing customer), opportunities
 * across the pipeline linked to the seeded sales quotes, and open, overdue and done activities.
 */
export async function seedCrm(prisma: PrismaClient, ctx: CrmSeedContext) {
  const { companyId, adminId, managerId, partners } = ctx;
  if (await prisma.lead.count({ where: { companyId } })) return;
  const owners = { admin: adminId, manager: managerId };

  const next = async (code: string) => {
    const seq = await prisma.numberSequence.update({
      where: { companyId_code: { companyId, code } },
      data: { nextValue: { increment: 1 } },
    });
    return formatNumber(seq, YEAR, seq.nextValue - 1);
  };

  const leadIds: string[] = [];
  for (const lead of LEADS) {
    const createdAt = daysAgo(lead.createdDaysAgo);
    const row = await prisma.lead.create({
      data: {
        companyId,
        number: await next('LEAD'),
        companyName: lead.companyName,
        contactName: lead.contactName,
        email: `${lead.contactName.split(' ')[0].toLowerCase()}@example.com`,
        city: lead.city,
        source: lead.source,
        status: lead.status,
        estimatedValue: lead.estimatedValue,
        currencyCode: 'TRY',
        ownerId: owners[lead.owner],
        disqualifyReason: lead.disqualifyReason,
        partnerId: lead.partner ? partners[lead.partner] : null,
        convertedAt: lead.partner ? daysAgo(lead.createdDaysAgo - 5) : null,
        createdById: adminId,
        createdAt,
      },
    });
    leadIds.push(row.id);
  }

  const opportunityIds: string[] = [];
  for (const opp of OPPORTUNITIES) {
    const partnerId = partners[opp.partner];
    const row = await prisma.opportunity.create({
      data: {
        companyId,
        number: await next('OPPORTUNITY'),
        title: opp.title,
        partnerId,
        leadId: opp.lead === undefined ? null : leadIds[opp.lead],
        stage: opp.stage,
        probability: defaultProbability(opp.stage),
        amount: opp.amount,
        currencyCode: opp.currencyCode ?? 'TRY',
        expectedCloseDate: daysAgo(-opp.closeInDays),
        ownerId: owners[opp.owner],
        lostReason: opp.lostReason,
        closedAt: opp.closedDaysAgo === undefined ? null : daysAgo(opp.closedDaysAgo),
        createdById: adminId,
        createdAt: daysAgo(opp.createdDaysAgo),
      },
    });
    opportunityIds.push(row.id);
    if (opp.quote) {
      const quote = await prisma.salesQuote.findFirst({
        where: { companyId, partnerId, status: opp.quote, opportunityId: null },
        orderBy: { quoteDate: 'asc' },
      });
      if (quote) {
        await prisma.salesQuote.update({
          where: { id: quote.id },
          data: { opportunityId: row.id },
        });
      }
    }
  }

  const activities: {
    type: CrmActivityType;
    subject: string;
    description?: string;
    owner: 'admin' | 'manager';
    dueAt?: Date;
    done?: Date;
    lead?: number;
    opportunity?: number;
  }[] = [
    {
      type: 'CALL',
      subject: 'Satın alma müdürüyle ön görüşme',
      description: 'Mağaza müdürleri için 2 dizüstü; kurulum dahil isteniyor.',
      owner: 'admin',
      done: at(-5, 11),
      opportunity: 3,
    },
    {
      type: 'MEETING',
      subject: 'Fiyat müzakeresi toplantısı',
      owner: 'admin',
      dueAt: at(2, 14),
      opportunity: 3,
    },
    {
      type: 'TASK',
      subject: 'Teklif için geri dönüş al',
      description: 'Teklif 20 gün geçerli; karar tarihini öğren.',
      owner: 'manager',
      dueAt: at(-2, 10),
      opportunity: 1,
    },
    {
      type: 'EMAIL',
      subject: 'Ürün kataloğu ve referanslar gönderildi',
      owner: 'manager',
      done: at(-6, 16),
      opportunity: 4,
    },
    {
      type: 'MEETING',
      subject: 'Online ürün demosu',
      owner: 'manager',
      dueAt: at(5, 11),
      opportunity: 4,
    },
    {
      type: 'TASK',
      subject: 'Bakım kapsamını ve SLA sürelerini netleştir',
      owner: 'admin',
      dueAt: at(7, 9),
      opportunity: 5,
    },
    {
      type: 'NOTE',
      subject: 'Rakip teklif daha düşük',
      description: 'Müşteri fiyatı belirleyici gördü; bir sonraki dönemde tekrar denenecek.',
      owner: 'admin',
      done: at(-8, 15),
      opportunity: 2,
    },
    {
      type: 'NOTE',
      subject: 'Web formundan geldi',
      description: '12 kişilik ofis; dizüstü ve ağ altyapısı soruyor.',
      owner: 'manager',
      done: at(-1, 9),
      lead: 1,
    },
    {
      type: 'CALL',
      subject: 'İlk arama — ihtiyaç analizi',
      owner: 'admin',
      done: at(-7, 10),
      lead: 2,
    },
    {
      type: 'TASK',
      subject: 'Referans listesini gönder',
      owner: 'admin',
      dueAt: at(0, 17),
      lead: 2,
    },
    {
      type: 'MEETING',
      subject: 'Fuar sonrası tanışma toplantısı',
      owner: 'manager',
      dueAt: at(1, 10),
      lead: 3,
    },
    {
      type: 'CALL',
      subject: 'Tanışma araması',
      owner: 'admin',
      dueAt: at(-1, 15),
      lead: 5,
    },
  ];
  for (const activity of activities) {
    const opportunity =
      activity.opportunity === undefined ? undefined : OPPORTUNITIES[activity.opportunity];
    await prisma.crmActivity.create({
      data: {
        companyId,
        type: activity.type,
        subject: activity.subject,
        description: activity.description,
        dueAt: activity.dueAt ?? null,
        completedAt: activity.done ?? null,
        ownerId: owners[activity.owner],
        leadId: activity.lead === undefined ? null : leadIds[activity.lead],
        opportunityId:
          activity.opportunity === undefined ? null : opportunityIds[activity.opportunity],
        partnerId: opportunity ? partners[opportunity.partner] : null,
        createdById: owners[activity.owner],
        createdAt: activity.done ?? at(-3, 9),
      },
    });
  }
}
