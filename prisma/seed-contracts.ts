import {
  ContractBillingCycle,
  ContractEventType,
  ContractFlow,
  ContractParty,
  ContractStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { parseDateOnly } from '../src/common/dates/date-only';
import { addDays, termEnd } from '../src/modules/contracts/contract-math';
import { formatNumber } from '../src/modules/numbering/number-format';

const YEAR = new Date().getFullYear();

interface ContractSeedContext {
  companyId: string;
  adminId: string;
  managerId: string;
}

const TYPES: {
  name: string;
  party: ContractParty;
  flow: ContractFlow;
  defaultTermMonths: number | null;
  defaultNoticeDays: number;
  description: string;
}[] = [
  {
    name: 'Hizmet Sözleşmesi',
    party: ContractParty.PARTNER,
    flow: ContractFlow.INCOME,
    defaultTermMonths: 12,
    defaultNoticeDays: 30,
    description: 'Müşteriye verilen danışmanlık, uygulama ve dağıtım hizmetleri',
  },
  {
    name: 'Bakım ve Destek',
    party: ContractParty.PARTNER,
    flow: ContractFlow.INCOME,
    defaultTermMonths: 12,
    defaultNoticeDays: 60,
    description: 'Müşteriye verilen yıllık bakım ve destek hizmeti',
  },
  {
    name: 'Tedarik Sözleşmesi',
    party: ContractParty.PARTNER,
    flow: ContractFlow.EXPENSE,
    defaultTermMonths: 12,
    defaultNoticeDays: 30,
    description: 'Tedarikçiyle fiyat ve teslim koşulları çerçeve sözleşmesi',
  },
  {
    name: 'Kira Sözleşmesi',
    party: ContractParty.PARTNER,
    flow: ContractFlow.EXPENSE,
    defaultTermMonths: 12,
    defaultNoticeDays: 30,
    description: 'Ofis, depo ve araç kiraları',
  },
  {
    name: 'Yazılım Lisansı',
    party: ContractParty.PARTNER,
    flow: ContractFlow.EXPENSE,
    defaultTermMonths: 12,
    defaultNoticeDays: 30,
    description: 'Abonelik ve lisans yenilemeleri',
  },
  {
    name: 'Gizlilik Sözleşmesi',
    party: ContractParty.PARTNER,
    flow: ContractFlow.NONE,
    defaultTermMonths: null,
    defaultNoticeDays: 0,
    description: 'Karşılıklı gizlilik (NDA)',
  },
  {
    name: 'Belirsiz Süreli İş Sözleşmesi',
    party: ContractParty.EMPLOYEE,
    flow: ContractFlow.NONE,
    defaultTermMonths: null,
    defaultNoticeDays: 0,
    description: 'Ücret ve yan haklar bordrodan izlenir',
  },
  {
    name: 'Belirli Süreli İş Sözleşmesi',
    party: ContractParty.EMPLOYEE,
    flow: ContractFlow.NONE,
    defaultTermMonths: 12,
    defaultNoticeDays: 0,
    description: 'Proje veya dönem bazlı istihdam',
  },
];

interface ContractSeed {
  title: string;
  type: string;
  /** Partner code or employee number. */
  party: string;
  owner: 'admin' | 'manager';
  /** Days from today; `months` sets the end from the start. */
  start: number;
  months?: number;
  endOffset?: number;
  amount?: number;
  currency?: string;
  cycle?: ContractBillingCycle;
  autoRenew?: boolean;
  noticeDays?: number;
  reminderDays?: number;
  status?: ContractStatus;
  /** Renewals already made: [old end offset, new end offset, automatic]. */
  renewals?: [number, number, boolean][];
  terminatedOn?: number;
  terminationReason?: string;
  description?: string;
}

const CONTRACTS: ContractSeed[] = [
  {
    title: 'Yıllık bakım ve destek hizmeti',
    type: 'Bakım ve Destek',
    party: 'MUS-002',
    owner: 'manager',
    start: -345,
    endOffset: 20,
    amount: 15000,
    cycle: ContractBillingCycle.MONTHLY,
    noticeDays: 60,
    description:
      'Ofis ağ altyapısı ve sunucular için 7/24 destek, aylık bir yerinde bakım ziyareti.',
  },
  {
    title: 'Merkez depo kirası',
    type: 'Kira Sözleşmesi',
    party: 'CAR-001',
    owner: 'admin',
    start: -690,
    endOffset: 40,
    amount: 85000,
    cycle: ContractBillingCycle.MONTHLY,
    autoRenew: true,
    renewals: [[-325, 40, true]],
    description: 'Gebze depo binası, 2.400 m² kapalı alan. Yıllık artış TÜFE oranında.',
  },
  {
    title: 'Tasarım yazılımı kurumsal lisansı',
    type: 'Yazılım Lisansı',
    party: 'TED-003',
    owner: 'manager',
    start: -215,
    months: 12,
    amount: 4800,
    currency: 'EUR',
    cycle: ContractBillingCycle.YEARLY,
    autoRenew: true,
  },
  {
    title: 'Donanım tedarik çerçeve sözleşmesi',
    type: 'Tedarik Sözleşmesi',
    party: 'TED-001',
    owner: 'admin',
    start: -120,
    months: 12,
    amount: 250000,
    cycle: ContractBillingCycle.ONE_TIME,
    description: 'Dizüstü, monitör ve ağ cihazları için sabit fiyat listesi; 30 gün vade.',
  },
  {
    title: 'Otel yazılımları bakım sözleşmesi',
    type: 'Bakım ve Destek',
    party: 'MUS-003',
    owner: 'manager',
    start: -300,
    endOffset: 65,
    amount: 120000,
    cycle: ContractBillingCycle.YEARLY,
    noticeDays: 60,
    reminderDays: 60,
  },
  {
    title: 'Mağaza sistemleri entegrasyon hizmeti',
    type: 'Hizmet Sözleşmesi',
    party: 'MUS-004',
    owner: 'admin',
    start: -30,
    months: 12,
    amount: 3500,
    currency: 'USD',
    cycle: ContractBillingCycle.MONTHLY,
    autoRenew: true,
  },
  {
    title: 'Kırtasiye tedarik sözleşmesi',
    type: 'Tedarik Sözleşmesi',
    party: 'TED-002',
    owner: 'admin',
    start: -405,
    endOffset: -40,
    amount: 60000,
    cycle: ContractBillingCycle.YEARLY,
    status: ContractStatus.EXPIRED,
  },
  {
    title: 'Ambalaj malzemesi tedariki',
    type: 'Tedarik Sözleşmesi',
    party: 'TED-004',
    owner: 'admin',
    start: -200,
    months: 12,
    amount: 18000,
    cycle: ContractBillingCycle.MONTHLY,
    status: ContractStatus.TERMINATED,
    terminatedOn: -20,
    terminationReason: 'Yeni dönem fiyat artışı kabul edilmedi.',
  },
  {
    title: 'Karşılıklı gizlilik sözleşmesi',
    type: 'Gizlilik Sözleşmesi',
    party: 'MUS-001',
    owner: 'admin',
    start: -500,
  },
  {
    title: 'Mağaza destek hizmeti',
    type: 'Hizmet Sözleşmesi',
    party: 'MUS-001',
    owner: 'manager',
    start: -260,
    months: 12,
    amount: 22000,
    cycle: ContractBillingCycle.MONTHLY,
    terminatedOn: 25,
    terminationReason: 'Müşteri destek hizmetini kendi ekibine alıyor.',
  },
  {
    title: 'Otel yönetim sistemi entegrasyonu',
    type: 'Hizmet Sözleşmesi',
    party: 'MUS-003',
    owner: 'manager',
    start: 15,
    months: 6,
    amount: 180000,
    cycle: ContractBillingCycle.ONE_TIME,
    status: ContractStatus.DRAFT,
    description: 'Teklif onaylandı, imza bekleniyor.',
  },
  {
    title: 'Bayilik ve dağıtım sözleşmesi',
    type: 'Hizmet Sözleşmesi',
    party: 'CAR-001',
    owner: 'admin',
    start: -575,
    endOffset: 215,
    amount: 40000,
    cycle: ContractBillingCycle.QUARTERLY,
    renewals: [[-150, 215, false]],
  },
  {
    title: 'İş sözleşmesi',
    type: 'Belirsiz Süreli İş Sözleşmesi',
    party: 'PRS-000001',
    owner: 'admin',
    start: 0,
  },
  {
    title: 'İş sözleşmesi',
    type: 'Belirsiz Süreli İş Sözleşmesi',
    party: 'PRS-000002',
    owner: 'admin',
    start: 0,
  },
  {
    title: 'İş sözleşmesi',
    type: 'Belirsiz Süreli İş Sözleşmesi',
    party: 'PRS-000003',
    owner: 'admin',
    start: 0,
  },
  {
    title: 'İş sözleşmesi',
    type: 'Belirsiz Süreli İş Sözleşmesi',
    party: 'PRS-000007',
    owner: 'admin',
    start: 0,
  },
  {
    title: 'Proje bazlı iş sözleşmesi',
    type: 'Belirli Süreli İş Sözleşmesi',
    party: 'PRS-000013',
    owner: 'admin',
    start: -340,
    endOffset: 25,
    description: 'Depo dönüşüm projesi süresince.',
  },
  {
    title: 'Belirli süreli iş sözleşmesi',
    type: 'Belirli Süreli İş Sözleşmesi',
    party: 'PRS-000015',
    owner: 'admin',
    start: -240,
    months: 12,
  },
];

/** Contract types and sample contracts in every state; dates are relative to today. */
export async function seedContracts(prisma: PrismaClient, ctx: ContractSeedContext) {
  const { companyId } = ctx;
  const types = new Map<string, { id: string; party: ContractParty; defaultNoticeDays: number }>();
  for (const [index, seed] of TYPES.entries()) {
    const row = await prisma.contractType.upsert({
      where: { companyId_name: { companyId, name: seed.name } },
      create: { companyId, ...seed, sortOrder: (index + 1) * 10 },
      update: {},
    });
    types.set(seed.name, row);
  }

  if (await prisma.contract.count({ where: { companyId } })) return;

  const [partners, employees] = await Promise.all([
    prisma.businessPartner.findMany({ where: { companyId }, select: { id: true, code: true } }),
    prisma.employee.findMany({
      where: { companyId },
      select: { id: true, employeeNo: true, hireDate: true },
    }),
  ]);
  const owners = { admin: ctx.adminId, manager: ctx.managerId };
  const today = parseDateOnly(new Date().toISOString());
  const day = (offset: number) => addDays(today, offset);

  for (const seed of CONTRACTS) {
    const type = types.get(seed.type)!;
    const partner = partners.find((p) => p.code === seed.party);
    const employee = employees.find((e) => e.employeeNo === seed.party);
    if (!partner && !employee) throw new Error(`Seed party ${seed.party} not found`);

    const startDate = employee && seed.start === 0 ? employee.hireDate : day(seed.start);
    const endDate =
      seed.endOffset !== undefined
        ? day(seed.endOffset)
        : seed.months
          ? termEnd(startDate, seed.months)
          : null;
    const signedDate = addDays(startDate, -7);
    const createdAt = addDays(startDate, -10);
    const status = seed.status ?? ContractStatus.ACTIVE;
    const owner = owners[seed.owner];

    const events: Prisma.ContractEventCreateWithoutContractInput[] = [
      { type: ContractEventType.CREATED, actor: { connect: { id: owner } }, createdAt },
    ];
    if (status !== ContractStatus.DRAFT) {
      events.push({
        type: ContractEventType.ACTIVATED,
        actor: { connect: { id: owner } },
        toValue: signedDate.toISOString().slice(0, 10),
        createdAt: new Date(signedDate.getTime() + 9 * 3_600_000),
      });
    }
    for (const [from, to, automatic] of seed.renewals ?? []) {
      events.push({
        type: automatic ? ContractEventType.AUTO_RENEWED : ContractEventType.RENEWED,
        ...(automatic ? {} : { actor: { connect: { id: owner } } }),
        fromValue: day(from).toISOString().slice(0, 10),
        toValue: day(to).toISOString().slice(0, 10),
        createdAt: new Date(day(from + 1).getTime() + 7 * 3_600_000),
      });
    }
    if (seed.terminatedOn !== undefined) {
      events.push({
        type: ContractEventType.TERMINATION_SCHEDULED,
        actor: { connect: { id: owner } },
        toValue: day(seed.terminatedOn).toISOString().slice(0, 10),
        note: seed.terminationReason,
        createdAt: new Date(day(Math.min(seed.terminatedOn, 0) - 30).getTime() + 10 * 3_600_000),
      });
    }
    if (status === ContractStatus.EXPIRED || status === ContractStatus.TERMINATED) {
      const last = status === ContractStatus.EXPIRED ? endDate! : day(seed.terminatedOn!);
      events.push({
        type:
          status === ContractStatus.EXPIRED
            ? ContractEventType.EXPIRED
            : ContractEventType.TERMINATED,
        toValue: last.toISOString().slice(0, 10),
        createdAt: new Date(addDays(last, 1).getTime() + 7 * 3_600_000),
      });
    }

    const seq = await prisma.numberSequence.update({
      where: { companyId_code: { companyId, code: 'CONTRACT' } },
      data: { nextValue: { increment: 1 }, currentYear: YEAR },
    });
    await prisma.contract.create({
      data: {
        companyId,
        number: formatNumber(seq, YEAR, seq.nextValue - 1),
        title: seed.title,
        typeId: type.id,
        party: type.party,
        partnerId: partner?.id ?? null,
        employeeId: partner ? null : employee!.id,
        ownerId: owner,
        startDate,
        endDate,
        signedDate: status === ContractStatus.DRAFT ? null : signedDate,
        amount: seed.amount ?? null,
        currencyCode: seed.currency ?? 'TRY',
        billingCycle: seed.cycle ?? ContractBillingCycle.ONE_TIME,
        autoRenew: seed.autoRenew ?? false,
        renewalMonths: seed.autoRenew ? 12 : null,
        noticeDays: seed.noticeDays ?? type.defaultNoticeDays,
        reminderDays: seed.reminderDays ?? 30,
        status,
        renewalCount: seed.renewals?.length ?? 0,
        description: seed.description ?? null,
        terminatedOn: seed.terminatedOn !== undefined ? day(seed.terminatedOn) : null,
        terminationReason: seed.terminationReason ?? null,
        activatedAt: status === ContractStatus.DRAFT ? null : signedDate,
        createdById: owner,
        createdAt,
        events: { create: events },
      },
    });
  }
}
