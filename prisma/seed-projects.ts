import {
  ExpenseReportStatus,
  Prisma,
  type PrismaClient,
  ProjectMemberRole,
  ProjectStatus,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from '@prisma/client';
import { formatNumber } from '../src/modules/numbering/number-format';
import { entryCost } from '../src/modules/projects/project-math';

const YEAR = new Date().getFullYear();
const daysFromToday = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + days));
};
const atDaysAgo = (days: number, hour: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour);
};

interface ProjectSeedContext {
  companyId: string;
  adminId: string;
}

interface SeedTask {
  title: string;
  status: ProjectTaskStatus;
  priority?: ProjectTaskPriority;
  assignee?: string;
  /** Relative to today; negative is in the past. */
  due?: number;
  estimate?: number;
}

interface SeedProject {
  name: string;
  description: string;
  partner?: string;
  manager: string;
  status: ProjectStatus;
  start: number;
  due: number;
  completedDaysAgo?: number;
  budget?: number;
  /** Employee number → [hourly cost, role]. */
  members: Record<string, [number | null, ProjectMemberRole?]>;
  tasks: SeedTask[];
  /** Days ago the time logging runs (inclusive), and the usual hours per day per member. */
  time?: { from: number; to: number; hours: Record<string, number> };
  /** Sequence part of expense report numbers of this year. */
  expenses?: string[];
}

const PROJECTS: SeedProject[] = [
  {
    name: 'Başkent Ofis ERP kurulumu',
    description:
      'Başkent Ofis Çözümleri için satın alma, stok ve finans modüllerinin kurulumu, veri aktarımı ' +
      've kullanıcı eğitimleri.',
    partner: 'MUS-002',
    manager: 'PRS-000002',
    status: 'ACTIVE',
    start: -45,
    due: 35,
    budget: 380_000,
    members: {
      'PRS-000002': [950, 'LEAD'],
      'PRS-000007': [650],
      'PRS-000008': [650],
      'PRS-000009': [600],
    },
    tasks: [
      {
        title: 'Kapsam ve analiz toplantıları',
        status: 'DONE',
        assignee: 'PRS-000002',
        due: -38,
        estimate: 80,
      },
      {
        title: 'Veri aktarım şablonlarının hazırlanması',
        status: 'DONE',
        assignee: 'PRS-000008',
        due: -30,
        estimate: 100,
      },
      {
        title: 'Sunucu ve yedekleme kurulumu',
        status: 'DONE',
        assignee: 'PRS-000009',
        due: -28,
        estimate: 60,
      },
      {
        title: 'Cari ve stok kartlarının aktarımı',
        status: 'REVIEW',
        priority: 'HIGH',
        assignee: 'PRS-000007',
        due: 2,
        estimate: 80,
      },
      {
        title: 'Onay akışlarının tanımlanması',
        status: 'IN_PROGRESS',
        assignee: 'PRS-000008',
        due: 6,
        estimate: 120,
      },
      {
        title: 'Banka entegrasyonu',
        status: 'IN_PROGRESS',
        priority: 'URGENT',
        assignee: 'PRS-000007',
        due: -1,
        estimate: 90,
      },
      {
        title: 'Kullanıcı yetki matrisi',
        status: 'TODO',
        assignee: 'PRS-000002',
        due: 10,
        estimate: 16,
      },
      {
        title: 'Ankara ofisinde kullanıcı eğitimi',
        status: 'TODO',
        priority: 'HIGH',
        assignee: 'PRS-000007',
        due: 21,
        estimate: 24,
      },
      {
        title: 'Canlıya geçiş kontrol listesi',
        status: 'TODO',
        priority: 'LOW',
        due: 30,
        estimate: 8,
      },
    ],
    time: {
      from: 42,
      to: 0,
      hours: { 'PRS-000002': 2, 'PRS-000007': 5, 'PRS-000008': 6, 'PRS-000009': 2 },
    },
    expenses: ['000001'],
  },
  {
    name: 'Akdeniz Otelcilik tablet kurulumu',
    description: 'Resepsiyon ve kat hizmetleri için tablet, mobil cihaz yönetimi ve ağ kurulumu.',
    partner: 'MUS-003',
    manager: 'PRS-000002',
    status: 'ACTIVE',
    start: -20,
    due: -2,
    budget: 60_000,
    members: { 'PRS-000002': [950, 'LEAD'], 'PRS-000007': [650], 'PRS-000009': [600] },
    tasks: [
      { title: 'Saha keşfi', status: 'DONE', assignee: 'PRS-000009', due: -15, estimate: 20 },
      {
        title: 'Tabletlerin hazırlanması',
        status: 'DONE',
        assignee: 'PRS-000007',
        due: -9,
        estimate: 24,
      },
      {
        title: 'Otelde kurulum',
        status: 'REVIEW',
        priority: 'HIGH',
        assignee: 'PRS-000007',
        due: -3,
        estimate: 24,
      },
      {
        title: 'Kablosuz ağ iyileştirmesi',
        status: 'IN_PROGRESS',
        priority: 'URGENT',
        assignee: 'PRS-000009',
        due: -2,
        estimate: 30,
      },
      { title: 'Teslim tutanağı', status: 'TODO', assignee: 'PRS-000002', due: 1, estimate: 2 },
    ],
    time: { from: 18, to: 1, hours: { 'PRS-000007': 3, 'PRS-000009': 4 } },
    expenses: ['000002'],
  },
  {
    name: 'Boğaziçi Perakende sadakat programı',
    description:
      'Mağaza sadakat kartı kampanyasının kurgusu, satış ekibi sunumları ve pilot mağaza.',
    partner: 'MUS-001',
    manager: 'PRS-000005',
    status: 'ACTIVE',
    start: -25,
    due: 20,
    budget: 30_000,
    members: { 'PRS-000005': [800, 'LEAD'], 'PRS-000012': [450], 'PRS-000013': [450] },
    tasks: [
      {
        title: 'Rakip kampanya analizi',
        status: 'DONE',
        assignee: 'PRS-000012',
        due: -18,
        estimate: 40,
      },
      { title: 'Teklif sunumu', status: 'DONE', assignee: 'PRS-000005', due: -10, estimate: 16 },
      {
        title: 'Pilot mağaza seçimi',
        status: 'IN_PROGRESS',
        assignee: 'PRS-000013',
        due: 4,
        estimate: 24,
      },
      {
        title: 'Kampanya materyalleri',
        status: 'TODO',
        priority: 'LOW',
        assignee: 'PRS-000012',
        due: 12,
      },
    ],
    time: { from: 24, to: 2, hours: { 'PRS-000005': 1, 'PRS-000012': 2, 'PRS-000013': 1 } },
    expenses: ['000004'],
  },
  {
    name: 'Satış süreçleri yenileme',
    description: 'Teklif onayları ve CRM fırsat aşamalarının yeniden tanımlanması.',
    manager: 'PRS-000005',
    status: 'PLANNED',
    start: 7,
    due: 60,
    budget: 40_000,
    members: { 'PRS-000005': [800, 'LEAD'], 'PRS-000012': [450], 'PRS-000007': [650] },
    tasks: [
      {
        title: 'Mevcut süreç haritası',
        status: 'TODO',
        assignee: 'PRS-000012',
        due: 14,
        estimate: 10,
      },
      {
        title: 'CRM alan ihtiyaçları',
        status: 'TODO',
        assignee: 'PRS-000007',
        due: 21,
        estimate: 12,
      },
    ],
  },
  {
    name: 'Depo yerleşim düzeni',
    description: 'Ana depoda raf adreslemesi ve sayım bölgelerinin yeniden düzenlenmesi.',
    manager: 'PRS-000006',
    status: 'COMPLETED',
    start: -75,
    due: -35,
    completedDaysAgo: 36,
    budget: 90_000,
    members: { 'PRS-000006': [800, 'LEAD'], 'PRS-000014': [400], 'PRS-000015': [400] },
    tasks: [
      {
        title: 'Raf adres etiketleri',
        status: 'DONE',
        assignee: 'PRS-000014',
        due: -60,
        estimate: 90,
      },
      {
        title: 'Ürünlerin yeni adreslere taşınması',
        status: 'DONE',
        assignee: 'PRS-000015',
        due: -45,
        estimate: 70,
      },
      {
        title: 'Sayım bölgelerinin tanımı',
        status: 'DONE',
        assignee: 'PRS-000006',
        due: -38,
        estimate: 20,
      },
    ],
    time: { from: 70, to: 37, hours: { 'PRS-000006': 1, 'PRS-000014': 3, 'PRS-000015': 3 } },
  },
];

/** Varies the daily hours a little so the timesheets don't look machine-made. */
const JITTER = [0, 1, -1, 0, 2, -1, 0, 1, 0, -2, 1, 0];

/**
 * Project demo: customer and internal projects in every status, members with hourly costs, kanban
 * tasks, several weeks of time entries and expense reports charged to them.
 */
export async function seedProjects(prisma: PrismaClient, ctx: ProjectSeedContext) {
  const { companyId, adminId } = ctx;
  if (await prisma.project.count({ where: { companyId } })) return;

  const employees = new Map(
    (await prisma.employee.findMany({ where: { companyId } })).map((e) => [e.employeeNo, e]),
  );
  const partners = new Map(
    (await prisma.businessPartner.findMany({ where: { companyId } })).map((p) => [p.code, p]),
  );
  const reports = await prisma.expenseReport.findMany({ where: { companyId } });

  for (const seed of PROJECTS) {
    const manager = employees.get(seed.manager);
    if (!manager) continue;
    const seq = await prisma.numberSequence.update({
      where: { companyId_code: { companyId, code: 'PROJECT' } },
      data: { nextValue: { increment: 1 } },
    });
    const number = formatNumber(seq, YEAR, seq.nextValue - 1);
    const createdById = manager.userId ?? adminId;

    const project = await prisma.project.create({
      data: {
        companyId,
        number,
        name: seed.name,
        description: seed.description,
        partnerId: seed.partner ? (partners.get(seed.partner)?.id ?? null) : null,
        managerId: manager.id,
        status: seed.status,
        startDate: daysFromToday(seed.start),
        dueDate: daysFromToday(seed.due),
        completedAt:
          seed.completedDaysAgo === undefined ? null : atDaysAgo(seed.completedDaysAgo, 17),
        budgetAmount: seed.budget ?? null,
        createdById,
        createdAt: atDaysAgo(Math.max(-seed.start, 0) + 3, 10),
      },
    });

    const rates = new Map<string, number | null>();
    for (const [employeeNo, [hourlyCost, role]] of Object.entries(seed.members)) {
      const employee = employees.get(employeeNo);
      if (!employee) continue;
      rates.set(employee.id, hourlyCost);
      await prisma.projectMember.create({
        data: {
          projectId: project.id,
          employeeId: employee.id,
          role: role ?? ProjectMemberRole.MEMBER,
          hourlyCost,
        },
      });
    }

    const sortOrders: Record<string, number> = {};
    const taskIds = new Map<string, string[]>();
    for (const [index, task] of seed.tasks.entries()) {
      const assignee = task.assignee ? employees.get(task.assignee) : undefined;
      const sortOrder = sortOrders[task.status] ?? 0;
      sortOrders[task.status] = sortOrder + 1;
      const created = await prisma.projectTask.create({
        data: {
          projectId: project.id,
          taskNo: index + 1,
          title: task.title,
          status: task.status,
          priority: task.priority ?? ProjectTaskPriority.MEDIUM,
          assigneeId: assignee?.id ?? null,
          dueDate: task.due === undefined ? null : daysFromToday(task.due),
          estimatedHours: task.estimate ?? null,
          sortOrder,
          completedAt: task.status === 'DONE' ? atDaysAgo(Math.max(-(task.due ?? 0), 0), 16) : null,
          createdById,
        },
      });
      if (assignee && task.status !== 'TODO') {
        taskIds.set(assignee.id, [...(taskIds.get(assignee.id) ?? []), created.id]);
      }
    }

    if (seed.time) {
      const entries: Prisma.TimeEntryCreateManyInput[] = [];
      let tick = 0;
      for (let ago = seed.time.from; ago >= seed.time.to; ago--) {
        const day = daysFromToday(-ago);
        if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
        for (const [employeeNo, usual] of Object.entries(seed.time.hours)) {
          const employee = employees.get(employeeNo);
          if (!employee) continue;
          const hours = Math.max(usual + JITTER[tick++ % JITTER.length] * 0.5, 0.5);
          const tasks = taskIds.get(employee.id) ?? [];
          entries.push({
            companyId,
            projectId: project.id,
            taskId: tasks.length ? tasks[ago % tasks.length] : null,
            employeeId: employee.id,
            workDate: day,
            hours,
            description: null,
            costAmount: entryCost(hours, rates.get(employee.id) ?? null),
          });
        }
      }
      await prisma.timeEntry.createMany({ data: entries });
    }

    let expenseCost = new Prisma.Decimal(0);
    for (const sequence of seed.expenses ?? []) {
      const report = reports.find((r) => r.number === `MSF-${YEAR}-${sequence}`);
      if (!report) continue;
      await prisma.expenseReport.update({
        where: { id: report.id },
        data: { projectId: project.id },
      });
      const counted: ExpenseReportStatus[] = ['APPROVED', 'PAID'];
      if (counted.includes(report.status)) expenseCost = expenseCost.add(report.totalAmount);
    }
    if (!expenseCost.isZero()) {
      await prisma.project.update({ where: { id: project.id }, data: { expenseCost } });
    }
  }
}
