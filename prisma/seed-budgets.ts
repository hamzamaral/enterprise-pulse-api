import {
  BudgetEventType,
  BudgetItemKind,
  BudgetSource,
  BudgetStatus,
  PayrollPeriodStatus,
  type PrismaClient,
} from '@prisma/client';

interface BudgetSeedContext {
  companyId: string;
  adminId: string;
  managerId: string;
}

const ITEMS: {
  code: string;
  name: string;
  kind: BudgetItemKind;
  source: BudgetSource;
  /** Expense category codes or product category names. */
  categories?: string[];
  description: string;
}[] = [
  {
    code: '600',
    name: 'Yurt İçi Satışlar',
    kind: BudgetItemKind.INCOME,
    source: BudgetSource.SALES,
    description: 'Kesilen satış faturaları (KDV hariç), iadeler düşülmüş',
  },
  {
    code: '602',
    name: 'Hizmet ve Bakım Gelirleri',
    kind: BudgetItemKind.INCOME,
    source: BudgetSource.MANUAL,
    description: 'Bakım, destek ve danışmanlık faturaları',
  },
  {
    code: '720',
    name: 'Personel Giderleri',
    kind: BudgetItemKind.EXPENSE,
    source: BudgetSource.PAYROLL,
    description: 'Bordro işveren maliyeti (brüt ücret, SGK ve işsizlik işveren payı)',
  },
  {
    code: '730',
    name: 'Seyahat ve Konaklama',
    kind: BudgetItemKind.EXPENSE,
    source: BudgetSource.EXPENSES,
    categories: ['HARCIRAH', 'KM', 'KONAKLAMA', 'TAKSI', 'ULASIM'],
    description: 'Masraf formlarındaki harcırah, yol ve konaklama kalemleri',
  },
  {
    code: '731',
    name: 'Yemek ve Temsil',
    kind: BudgetItemKind.EXPENSE,
    source: BudgetSource.EXPENSES,
    categories: ['YEMEK', 'TEMSIL'],
    description: 'İş yemekleri ve müşteri ağırlama',
  },
  {
    code: '739',
    name: 'Diğer Masraflar',
    kind: BudgetItemKind.EXPENSE,
    source: BudgetSource.EXPENSES,
    categories: [],
    description: 'Başka kaleme bağlanmayan masraf kategorileri',
  },
  {
    code: '740',
    name: 'Donanım ve Ekipman',
    kind: BudgetItemKind.EXPENSE,
    source: BudgetSource.PURCHASES,
    categories: ['Elektronik', 'Bilgisayar ve Aksesuar', 'Telefon ve Tablet'],
    description: 'Bilgisayar, telefon ve elektronik alımları',
  },
  {
    code: '741',
    name: 'Ofis ve Sarf Malzemeleri',
    kind: BudgetItemKind.EXPENSE,
    source: BudgetSource.PURCHASES,
    categories: [],
    description: 'Diğer tüm alış faturaları',
  },
  {
    code: '750',
    name: 'Kira Giderleri',
    kind: BudgetItemKind.EXPENSE,
    source: BudgetSource.MANUAL,
    description: 'Ofis ve depo kiraları',
  },
  {
    code: '760',
    name: 'Yazılım ve Lisans',
    kind: BudgetItemKind.EXPENSE,
    source: BudgetSource.MANUAL,
    description: 'Bulut abonelikleri ve yıllık lisanslar',
  },
  {
    code: '770',
    name: 'Pazarlama ve Reklam',
    kind: BudgetItemKind.EXPENSE,
    source: BudgetSource.MANUAL,
    description: 'Dijital reklam, fuar ve etkinlikler',
  },
];

type Plan = Record<string, number | number[]>;

/** Rounded up to the next thousand. */
const roundUp = (value: number) => Math.ceil(value / 1000) * 1000;

export async function seedBudgets(prisma: PrismaClient, ctx: BudgetSeedContext) {
  const { companyId } = ctx;
  const [expenseCategories, productCategories] = await Promise.all([
    prisma.expenseCategory.findMany({ where: { companyId }, select: { id: true, code: true } }),
    prisma.productCategory.findMany({ where: { companyId }, select: { id: true, name: true } }),
  ]);
  const items = new Map<string, string>();
  for (const [index, seed] of ITEMS.entries()) {
    const categoryIds = (seed.categories ?? []).flatMap((key) => {
      const found =
        seed.source === BudgetSource.EXPENSES
          ? expenseCategories.find((c) => c.code === key)
          : productCategories.find((c) => c.name === key);
      return found ? [found.id] : [];
    });
    const row = await prisma.budgetItem.upsert({
      where: { companyId_code: { companyId, code: seed.code } },
      create: {
        companyId,
        code: seed.code,
        name: seed.name,
        kind: seed.kind,
        source: seed.source,
        categoryIds,
        description: seed.description,
        sortOrder: (index + 1) * 10,
      },
      update: {},
    });
    items.set(seed.code, row.id);
  }

  if (await prisma.budget.count({ where: { companyId } })) return;

  const today = new Date();
  const year = today.getFullYear();
  const current = today.getMonth() + 1;
  const date = (month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
  const departments = new Map(
    (
      await prisma.department.findMany({
        where: { companyId },
        select: { id: true, code: true, manager: { select: { userId: true } } },
      })
    ).map((d) => [d.code, d]),
  );
  const dept = (code: string) => departments.get(code)!;

  // ---------- manual actuals ----------
  const entries: {
    item: string;
    dept: string | null;
    month: number;
    amount: number;
    text: string;
  }[] = [];
  for (let month = 1; month <= current; month++) {
    entries.push({ item: '750', dept: 'OPS', month, amount: 85_000, text: 'Merkez depo kirası' });
    if (month === current) continue;
    entries.push({
      item: '602',
      dept: null,
      month,
      amount: 95_000,
      text: 'Bakım ve destek faturaları',
    });
    entries.push({
      item: '760',
      dept: 'BT',
      month,
      amount: 18_000,
      text: 'Bulut ve SaaS abonelikleri',
    });
  }
  const oneOff: [string, string, number, number, string][] = [
    ['760', 'BT', 3, 115_000, 'Yıllık ERP ve ofis lisansı yenileme'],
    ['770', 'SAT', 1, 22_000, 'Dijital reklam kampanyası'],
    ['770', 'SAT', 3, 48_000, 'Sektör dergisi ilanı'],
    ['770', 'SAT', 4, 18_500, 'Dijital reklam kampanyası'],
    ['770', 'SAT', 6, 96_000, 'Fuar katılımı ve stand'],
    ['770', 'SAT', 7, 35_000, 'Sosyal medya kampanyası'],
    ['770', 'SAT', 9, 62_000, 'Bayi toplantısı'],
  ];
  for (const [item, deptCode, month, amount, text] of oneOff) {
    if (month < current) entries.push({ item, dept: deptCode, month, amount, text });
  }
  await prisma.budgetEntry.createMany({
    data: entries.map((e) => ({
      companyId,
      itemId: items.get(e.item)!,
      departmentId: e.dept ? dept(e.dept).id : null,
      entryDate: date(e.month, e.item === '750' ? 1 : 15),
      amount: e.amount,
      description: e.text,
      createdById: ctx.adminId,
    })),
  });

  // ---------- payroll plan: this year's employer cost + 3% ----------
  const payslips = await prisma.payslip.findMany({
    where: {
      companyId,
      period: {
        year,
        status: { in: [PayrollPeriodStatus.APPROVED, PayrollPeriodStatus.PAID] },
      },
    },
    select: {
      employerCost: true,
      period: { select: { month: true } },
      employee: { select: { department: { select: { code: true } } } },
    },
  });
  const payroll = (code: string | null): number[] => {
    const months = Array.from({ length: 12 }, () => 0);
    for (const slip of payslips) {
      if (code && slip.employee.department?.code !== code) continue;
      months[slip.period.month - 1] += slip.employerCost.toNumber();
    }
    let last = 0;
    return months.map((value) => {
      if (value) last = value;
      return roundUp((value || last) * 1.03);
    });
  };

  const budgets: {
    dept: string | null;
    name: string;
    ownerId: string | null;
    approved: boolean;
    note: string;
    plan: Plan;
  }[] = [
    {
      dept: null,
      name: `${year} Şirket Bütçesi`,
      ownerId: ctx.adminId,
      approved: true,
      note: 'Yönetim kurulunca onaylanan yıllık faaliyet bütçesi.',
      plan: {
        '600': 25_000,
        '602': 90_000,
        '720': payroll(null),
        '730': 6_000,
        '731': 3_000,
        '739': 1_500,
        '740': 8_000,
        '741': 3_000,
        '750': 85_000,
        '760': 25_000,
        '770': 27_000,
      },
    },
    {
      dept: 'BT',
      name: `${year} Bilgi Teknolojileri Bütçesi`,
      ownerId: dept('BT').manager?.userId ?? ctx.managerId,
      approved: true,
      note: 'Altyapı yenileme ve lisans giderleri dahil.',
      plan: { '720': payroll('BT'), '730': 1_500, '739': 500, '740': 8_000, '760': 25_000 },
    },
    {
      dept: 'SAT',
      name: `${year} Satış Bütçesi`,
      ownerId: dept('SAT').manager?.userId ?? null,
      approved: true,
      note: 'Fuar ve bayi etkinlikleri pazarlama kaleminde.',
      plan: { '720': payroll('SAT'), '730': 3_500, '731': 2_000, '770': 27_000 },
    },
    {
      dept: 'OPS',
      name: `${year} Operasyon Bütçesi`,
      ownerId: dept('OPS').manager?.userId ?? null,
      approved: false,
      note: 'Depo kirası sözleşmesi Kasım ayında yenilenecek.',
      plan: { '720': payroll('OPS'), '730': 1_000, '741': 3_000, '750': 85_000 },
    },
  ];

  const created = new Date(Date.UTC(year - 1, 11, 15, 9));
  const approved = new Date(Date.UTC(year, 0, 5, 10));
  for (const seed of budgets) {
    const budget = await prisma.budget.create({
      data: {
        companyId,
        year,
        departmentId: seed.dept ? dept(seed.dept).id : null,
        name: seed.name,
        ownerId: seed.ownerId,
        note: seed.note,
        status: seed.approved ? BudgetStatus.APPROVED : BudgetStatus.DRAFT,
        approvedAt: seed.approved ? approved : null,
        approvedById: seed.approved ? ctx.adminId : null,
        createdById: ctx.adminId,
        createdAt: created,
      },
    });
    await prisma.budgetLine.createMany({
      data: Object.entries(seed.plan).flatMap(([code, amounts]) =>
        Array.from({ length: 12 }, (_, index) => ({
          budgetId: budget.id,
          itemId: items.get(code)!,
          month: index + 1,
          amount: Array.isArray(amounts) ? amounts[index] : amounts,
        })),
      ),
    });
    await prisma.budgetEvent.createMany({
      data: [
        {
          budgetId: budget.id,
          actorId: ctx.adminId,
          type: BudgetEventType.CREATED,
          createdAt: created,
        },
        {
          budgetId: budget.id,
          actorId: ctx.adminId,
          type: BudgetEventType.PLAN_UPDATED,
          createdAt: new Date(created.getTime() + 3_600_000),
        },
        ...(seed.approved
          ? [
              {
                budgetId: budget.id,
                actorId: ctx.adminId,
                type: BudgetEventType.APPROVED,
                createdAt: approved,
              },
            ]
          : []),
      ],
    });
  }
}
