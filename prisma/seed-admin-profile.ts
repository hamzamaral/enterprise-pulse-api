import {
  AssetCondition,
  AssetStatus,
  AssigneeType,
  InterviewRecommendation,
  InterviewStatus,
  InterviewType,
  LeaveRequestStatus,
  Prisma,
  type PrismaClient,
  ProjectMemberRole,
  ProjectTaskPriority,
  ProjectTaskStatus,
  TicketPriority,
  TicketStatus,
  TreasuryDocumentType,
  WorkflowActionType,
  WorkflowStatus,
} from '@prisma/client';
import { parseDateOnly, toDateOnly } from '../src/common/dates/date-only';
import { lineAmounts } from '../src/modules/expenses/expense-math';
import { countWorkingDays } from '../src/modules/hr/working-days';
import { formatNumber } from '../src/modules/numbering/number-format';
import { entryCost } from '../src/modules/projects/project-math';
import { createTickets, type TicketSeed } from './seed-support';

const YEAR = new Date().getFullYear();
const DAY_MS = 86_400_000;
const DAY = 24;

const today = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};
const daysFromToday = (days: number) => new Date(today().getTime() + days * DAY_MS);
const atDaysAgo = (days: number, hour: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour);
};
/** The first Monday on or after `days` from today. */
const mondayFrom = (days: number) => {
  const date = daysFromToday(days);
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7));
  return date;
};
/** The first weekday on or after `days` from today. */
const weekdayFrom = (days: number) => {
  const date = daysFromToday(days);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date;
};
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

interface ProfileContext {
  companyId: string;
  adminId: string;
  managerId: string;
}

interface Profile extends ProfileContext {
  employee: { id: string; firstName: string; lastName: string };
}

/** Employee record of the general manager; the admin account uses it for self-service pages. */
const PROFILE_EMPLOYEE_NO = 'PRS-000001';

/**
 * Gives the admin account an employee profile (the general manager) with assets, leave, expenses,
 * project tasks, interviews and support tickets so its self-service pages are not empty. Every
 * part is skipped when its data already exists, so the step can run against seeded databases.
 */
export async function seedAdminProfile(prisma: PrismaClient, ctx: ProfileContext) {
  const linked = await prisma.employee.findFirst({
    where: { companyId: ctx.companyId, userId: ctx.adminId },
  });
  let employee = linked;
  if (!employee) {
    const candidate = await prisma.employee.findFirst({
      where: { companyId: ctx.companyId, employeeNo: PROFILE_EMPLOYEE_NO, userId: null },
    });
    if (!candidate) return;
    employee = await prisma.employee.update({
      where: { id: candidate.id },
      data: { userId: ctx.adminId },
    });
  }
  const profile: Profile = { ...ctx, employee };

  await seedProfileAssets(prisma, profile);
  await seedProfileLeave(prisma, profile);
  await seedProfileExpenses(prisma, profile);
  await seedProfileProjects(prisma, profile);
  await seedProfileInterviews(prisma, profile);
  await seedProfileTickets(prisma, profile);
}

const nextNumber = async (prisma: PrismaClient, companyId: string, code: string) => {
  const seq = await prisma.numberSequence.update({
    where: { companyId_code: { companyId, code } },
    data: { nextValue: { increment: 1 }, currentYear: YEAR },
  });
  return formatNumber(seq, YEAR, seq.nextValue - 1);
};

const ASSETS: {
  name: string;
  category: string;
  brand: string;
  model: string;
  serial: string;
  purchaseDate: string;
  cost: number;
  since: string;
  acknowledged: boolean;
}[] = [
  {
    name: 'Dizüstü Bilgisayar',
    category: 'BLG',
    brand: 'Apple',
    model: 'MacBook Pro 16',
    serial: 'C02HK7MBP16',
    purchaseDate: `${YEAR - 1}-11-04`,
    cost: 124_000,
    since: `${YEAR - 1}-11-10`,
    acknowledged: true,
  },
  {
    name: 'Cep Telefonu',
    category: 'TEL',
    brand: 'Apple',
    model: 'iPhone 16 Pro',
    serial: 'G7QXM2P4R9',
    purchaseDate: `${YEAR - 1}-09-25`,
    cost: 78_000,
    since: `${YEAR - 1}-10-01`,
    acknowledged: true,
  },
  {
    name: 'Monitör 27"',
    category: 'MON',
    brand: 'LG',
    model: 'UltraFine 27UQ850',
    serial: '304NTAB1K882',
    purchaseDate: `${YEAR - 1}-11-04`,
    cost: 21_500,
    since: `${YEAR - 1}-11-10`,
    acknowledged: false,
  },
];

async function seedProfileAssets(prisma: PrismaClient, profile: Profile) {
  const { companyId, adminId, employee } = profile;
  if (await prisma.assetAssignment.count({ where: { employeeId: employee.id } })) return;
  const categories = new Map(
    (await prisma.assetCategory.findMany({ where: { companyId } })).map((c) => [c.code, c.id]),
  );

  for (const sample of ASSETS) {
    const categoryId = categories.get(sample.category);
    if (!categoryId) continue;
    const warrantyYear = Number(sample.purchaseDate.slice(0, 4)) + 2;
    const asset = await prisma.asset.create({
      data: {
        companyId,
        assetTag: await nextNumber(prisma, companyId, 'ASSET'),
        name: sample.name,
        categoryId,
        brand: sample.brand,
        model: sample.model,
        serialNumber: sample.serial,
        status: AssetStatus.ASSIGNED,
        condition: AssetCondition.GOOD,
        purchaseDate: parseDateOnly(sample.purchaseDate),
        purchaseCost: sample.cost,
        salvageValue: Math.round(sample.cost * 0.05),
        supplier: `${sample.brand} Türkiye Distribütörü`,
        invoiceNo: `FTR-${sample.purchaseDate.slice(0, 4)}-${sample.serial.slice(-5)}`,
        warrantyEndDate: parseDateOnly(`${warrantyYear}${sample.purchaseDate.slice(4)}`),
      },
    });
    await prisma.assetAssignment.create({
      data: {
        companyId,
        number: await nextNumber(prisma, companyId, 'ASSET_ASSIGNMENT'),
        assetId: asset.id,
        assigneeType: AssigneeType.EMPLOYEE,
        employeeId: employee.id,
        assignedAt: parseDateOnly(sample.since),
        conditionOut: AssetCondition.NEW,
        assignedById: adminId,
        acknowledgedAt: sample.acknowledged ? parseDateOnly(sample.since) : null,
      },
    });
  }
}

async function seedProfileLeave(prisma: PrismaClient, profile: Profile) {
  const { companyId, adminId, managerId, employee } = profile;
  if (await prisma.leaveRequest.count({ where: { employeeId: employee.id } })) return;
  const definition = await prisma.workflowDefinition.findUnique({
    where: { companyId_code: { companyId, code: 'LEAVE_REQUEST' } },
  });
  const leaveTypes = new Map(
    (await prisma.leaveType.findMany({ where: { companyId } })).map((t) => [t.code, t]),
  );
  const holidays = new Set(
    (await prisma.holiday.findMany({ where: { companyId } })).map((h) => toDateOnly(h.date)),
  );
  const summerStart = mondayFrom(-75);
  const errandDay = weekdayFrom(-24);
  const plannedStart = mondayFrom(35);
  const samples = [
    {
      type: 'YILLIK',
      start: summerStart,
      end: addDays(summerStart, 4),
      reason: 'Aile tatili',
      status: LeaveRequestStatus.APPROVED,
    },
    {
      type: 'MAZERET',
      start: errandDay,
      end: errandDay,
      reason: 'Tapu işlemleri',
      status: LeaveRequestStatus.APPROVED,
    },
    {
      type: 'YILLIK',
      start: plannedStart,
      end: addDays(plannedStart, 2),
      reason: 'Kısa tatil',
      status: LeaveRequestStatus.PENDING,
    },
  ];
  const name = `${employee.firstName} ${employee.lastName}`;

  for (const sample of samples) {
    const leaveType = leaveTypes.get(sample.type);
    const days = countWorkingDays(sample.start, sample.end, holidays);
    if (!leaveType || !days) continue;
    const number = await nextNumber(prisma, companyId, 'LEAVE_REQUEST');
    const approved = sample.status === LeaveRequestStatus.APPROVED;

    let workflowInstanceId: string | null = null;
    if (!approved && definition) {
      const instance = await prisma.workflowInstance.create({
        data: {
          companyId,
          definitionId: definition.id,
          entityType: 'LeaveRequest',
          entityId: number,
          title: `${name} — ${leaveType.name} (${days} gün)`,
          currentStepOrder: 1,
          startedById: adminId,
          actions: {
            create: { stepOrder: 0, type: WorkflowActionType.START, userId: adminId },
          },
        },
      });
      workflowInstanceId = instance.id;
      await prisma.notification.create({
        data: {
          userId: managerId,
          companyId,
          type: 'workflow.approval_requested',
          title: 'Onayınızı bekleyen talep',
          body: `"${instance.title}" — Yönetici Onayı`,
          link: `/workflow/instances/${instance.id}`,
        },
      });
    }

    await prisma.leaveRequest.create({
      data: {
        companyId,
        number,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: sample.start,
        endDate: sample.end,
        days,
        reason: sample.reason,
        status: sample.status,
        workflowInstanceId,
        createdById: adminId,
        decidedAt: approved ? new Date() : null,
      },
    });
    if (approved) {
      await prisma.leaveBalance.updateMany({
        where: {
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          year: sample.start.getUTCFullYear(),
        },
        data: { usedDays: { increment: days } },
      });
      // Attendance was seeded before the leave existed; leave days carry no clock-ins.
      await prisma.attendanceRecord.deleteMany({
        where: { employeeId: employee.id, date: { gte: sample.start, lte: sample.end } },
      });
    }
  }
}

const EXPENSES: {
  title: string;
  description: string;
  status: 'PAID' | 'PENDING';
  createdDaysAgo: number;
  lines: {
    category: string;
    daysAgo: number;
    description: string;
    merchant?: string;
    quantity?: number;
    amount?: number;
    vat?: number;
  }[];
}[] = [
  {
    title: 'Ankara yönetim toplantısı',
    description: 'Başkent Ofis yönetim kurulu sunumu.',
    status: 'PAID',
    createdDaysAgo: 16,
    lines: [
      { category: 'HARCIRAH', daysAgo: 18, description: 'Ankara, 1 gün', quantity: 1 },
      {
        category: 'KM',
        daysAgo: 18,
        description: 'İstanbul – Ankara özel araç (gidiş-dönüş)',
        quantity: 460,
      },
      {
        category: 'TELEFON',
        daysAgo: 18,
        description: 'Yol boyunca mobil internet paketi',
        merchant: 'Turkcell',
        amount: 650,
        vat: 108,
      },
    ],
  },
  {
    title: 'İletişim giderleri',
    description: 'Mobil hat ve müşteri ziyareti.',
    status: 'PENDING',
    createdDaysAgo: 2,
    lines: [
      {
        category: 'TELEFON',
        daysAgo: 5,
        description: 'Mobil hat ve internet faturası',
        merchant: 'Turkcell',
        amount: 1250,
        vat: 208,
      },
      { category: 'KM', daysAgo: 4, description: 'Müşteri ziyareti — Maslak', quantity: 85 },
    ],
  },
];

async function seedProfileExpenses(prisma: PrismaClient, profile: Profile) {
  const { companyId, adminId, managerId, employee } = profile;
  if (await prisma.expenseReport.count({ where: { employeeId: employee.id } })) return;
  const definition = await prisma.workflowDefinition.findUnique({
    where: { companyId_code: { companyId, code: 'EXPENSE_REPORT' } },
  });
  const categories = new Map(
    (await prisma.expenseCategory.findMany({ where: { companyId } })).map((c) => [c.code, c]),
  );
  const account = await prisma.treasuryAccount.findFirst({ where: { companyId, code: 'BNK-TL' } });
  if (!definition) return;

  for (const report of EXPENSES) {
    const lines = report.lines.flatMap((line, index) => {
      const category = categories.get(line.category);
      if (!category) return [];
      const exchangeRate = new Prisma.Decimal(1);
      const amounts = lineAmounts(category, {
        quantity: line.quantity,
        amount: line.amount,
        exchangeRate,
      });
      return [
        {
          lineNo: index + 1,
          categoryId: category.id,
          expenseDate: daysFromToday(-line.daysAgo),
          description: line.description,
          merchant: line.merchant ?? null,
          quantity: amounts.quantity,
          amount: amounts.amount,
          vatAmount: line.vat ?? 0,
          currencyCode: 'TRY',
          exchangeRate,
          amountBase: amounts.amountBase,
        },
      ];
    });
    if (!lines.length) continue;
    const total = lines.reduce((sum, l) => sum.plus(l.amountBase), new Prisma.Decimal(0));
    const number = await nextNumber(prisma, companyId, 'EXPENSE_REPORT');
    const submittedAt = atDaysAgo(report.createdDaysAgo, 10);
    const paid = report.status === 'PAID' && !!account;
    const decidedAt = paid ? atDaysAgo(report.createdDaysAgo - 2, 15) : null;
    const paidAt = paid ? atDaysAgo(report.createdDaysAgo - 4, 11) : null;
    const paymentDate = paid ? daysFromToday(-(report.createdDaysAgo - 4)) : null;

    const instance = await prisma.workflowInstance.create({
      data: {
        companyId,
        definitionId: definition.id,
        entityType: 'ExpenseReport',
        entityId: number,
        title: `${number} — ${employee.firstName} ${employee.lastName}: ${report.title}`,
        status: paid ? WorkflowStatus.APPROVED : WorkflowStatus.PENDING,
        currentStepOrder: 1,
        startedById: adminId,
        startedAt: submittedAt,
        completedAt: decidedAt,
        actions: {
          create: [
            {
              stepOrder: 0,
              type: WorkflowActionType.START,
              userId: adminId,
              createdAt: submittedAt,
            },
            ...(decidedAt
              ? [
                  {
                    stepOrder: 1,
                    type: WorkflowActionType.APPROVE,
                    userId: managerId,
                    createdAt: decidedAt,
                  },
                ]
              : []),
          ],
        },
      },
    });

    const created = await prisma.expenseReport.create({
      data: {
        companyId,
        number,
        employeeId: employee.id,
        title: report.title,
        description: report.description,
        status: paid ? 'PAID' : 'PENDING',
        totalAmount: total,
        workflowInstanceId: instance.id,
        submittedAt,
        decidedAt,
        paymentAccountId: paid ? account.id : null,
        paymentDate,
        paidAt,
        paidById: paid ? adminId : null,
        createdById: adminId,
        createdAt: atDaysAgo(report.createdDaysAgo, 9),
        lines: { createMany: { data: lines } },
      },
    });
    if (paid) {
      await prisma.treasuryTransaction.create({
        data: {
          companyId,
          accountId: account.id,
          txDate: paymentDate!,
          documentType: TreasuryDocumentType.EXPENSE_PAYMENT,
          documentId: created.id,
          documentNumber: number,
          description: `Masraf ödemesi: ${employee.firstName} ${employee.lastName} — ${report.title}`,
          amountOut: total,
          createdById: adminId,
          createdAt: paidAt!,
        },
      });
    } else {
      await prisma.notification.create({
        data: {
          userId: managerId,
          companyId,
          type: 'workflow.approval_requested',
          title: 'Onayınızı bekleyen talep',
          body: `"${number} — ${report.title}" — Yönetici Onayı`,
          link: `/workflow/instances/${instance.id}`,
        },
      });
    }
  }
}

const HOURLY_COST = 1500;
/** Daily hours booked on the first project, cycled over the last weeks. */
const DAILY_HOURS = [1.5, 2, 1, 2.5, 1.5, 2, 1];

const PROJECTS: {
  name: string;
  role: ProjectMemberRole;
  timeEntries: boolean;
  tasks: {
    title: string;
    status: ProjectTaskStatus;
    priority: ProjectTaskPriority;
    due: number;
    estimate: number;
  }[];
}[] = [
  {
    name: 'Başkent Ofis ERP kurulumu',
    role: ProjectMemberRole.MEMBER,
    timeEntries: true,
    tasks: [
      {
        title: 'Proje başlangıç toplantısı',
        status: ProjectTaskStatus.DONE,
        priority: ProjectTaskPriority.MEDIUM,
        due: -12,
        estimate: 3,
      },
      {
        title: 'Yönetim raporlarının onayı',
        status: ProjectTaskStatus.IN_PROGRESS,
        priority: ProjectTaskPriority.HIGH,
        due: 5,
        estimate: 8,
      },
      {
        title: 'Kullanıcı kabul testine katılım',
        status: ProjectTaskStatus.TODO,
        priority: ProjectTaskPriority.MEDIUM,
        due: 12,
        estimate: 4,
      },
    ],
  },
  {
    name: 'Satış süreçleri yenileme',
    role: ProjectMemberRole.LEAD,
    timeEntries: false,
    tasks: [
      {
        title: 'Satış hedeflerinin belirlenmesi',
        status: ProjectTaskStatus.TODO,
        priority: ProjectTaskPriority.HIGH,
        due: 20,
        estimate: 6,
      },
    ],
  },
];

async function seedProfileProjects(prisma: PrismaClient, profile: Profile) {
  const { companyId, adminId, employee } = profile;
  if (await prisma.projectMember.count({ where: { employeeId: employee.id } })) return;
  const holidays = new Set(
    (await prisma.holiday.findMany({ where: { companyId } })).map((h) => toDateOnly(h.date)),
  );

  for (const seed of PROJECTS) {
    const project = await prisma.project.findFirst({ where: { companyId, name: seed.name } });
    if (!project) continue;
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        employeeId: employee.id,
        role: seed.role,
        hourlyCost: HOURLY_COST,
      },
    });
    const existing = await prisma.projectTask.findMany({
      where: { projectId: project.id },
      select: { taskNo: true, status: true },
    });
    let taskNo = Math.max(0, ...existing.map((t) => t.taskNo));
    const bookable: { id: string; doneDaysAgo: number | null }[] = [];
    for (const task of seed.tasks) {
      const created = await prisma.projectTask.create({
        data: {
          projectId: project.id,
          taskNo: ++taskNo,
          title: task.title,
          status: task.status,
          priority: task.priority,
          assigneeId: employee.id,
          dueDate: daysFromToday(task.due),
          estimatedHours: task.estimate,
          sortOrder: existing.filter((t) => t.status === task.status).length,
          completedAt:
            task.status === ProjectTaskStatus.DONE ? atDaysAgo(Math.max(-task.due, 0), 16) : null,
          createdById: adminId,
        },
      });
      existing.push({ taskNo, status: task.status });
      if (task.status !== ProjectTaskStatus.TODO) {
        const done = task.status === ProjectTaskStatus.DONE;
        bookable.push({ id: created.id, doneDaysAgo: done ? Math.max(-task.due, 0) : null });
      }
    }

    if (!seed.timeEntries || !bookable.length) continue;
    const entries: Prisma.TimeEntryCreateManyInput[] = [];
    for (let ago = 20; ago >= 1; ago--) {
      const day = daysFromToday(-ago);
      if (day.getUTCDay() === 0 || day.getUTCDay() === 6 || holidays.has(toDateOnly(day))) {
        continue;
      }
      const open = bookable.filter((t) => t.doneDaysAgo === null || ago >= t.doneDaysAgo);
      if (!open.length) continue;
      const hours = DAILY_HOURS[entries.length % DAILY_HOURS.length];
      entries.push({
        companyId,
        projectId: project.id,
        taskId: open[ago % open.length].id,
        employeeId: employee.id,
        workDate: day,
        hours,
        costAmount: entryCost(hours, HOURLY_COST),
      });
    }
    await prisma.timeEntry.createMany({ data: entries });
  }
}

async function seedProfileInterviews(prisma: PrismaClient, profile: Profile) {
  const { companyId, employee } = profile;
  if (await prisma.interviewParticipant.count({ where: { employeeId: employee.id } })) return;

  // Past ones wait for the panel's feedback, future ones show up as upcoming.
  const scheduled = await prisma.interview.findMany({
    where: { companyId, status: InterviewStatus.SCHEDULED },
    orderBy: { scheduledAt: 'desc' },
    take: 3,
  });
  for (const interview of scheduled) {
    await prisma.interviewParticipant.create({
      data: { interviewId: interview.id, employeeId: employee.id },
    });
  }

  const completed = await prisma.interview.findFirst({
    where: {
      companyId,
      status: InterviewStatus.COMPLETED,
      type: { not: InterviewType.PHONE },
      scheduledAt: { lt: new Date() },
    },
    orderBy: { scheduledAt: 'desc' },
  });
  if (completed) {
    await prisma.interviewParticipant.create({
      data: {
        interviewId: completed.id,
        employeeId: employee.id,
        rating: 4,
        recommendation: InterviewRecommendation.YES,
        feedback: 'Takım çalışmasına yatkın, iletişimi güçlü. Teklif aşamasına geçilebilir.',
        submittedAt: new Date(completed.scheduledAt.getTime() + 3 * 3_600_000),
      },
    });
  }
}

const TICKETS: TicketSeed[] = [
  {
    subject: 'Toplantı odası ekranı görüntü vermiyor',
    description: 'Yönetim toplantı odasındaki ekran dizüstü bilgisayardan görüntü almıyor.',
    category: 'Tesis ve Ofis',
    priority: TicketPriority.HIGH,
    requester: 'admin',
    agent: 'manager',
    ageHours: 9 * DAY,
    status: TicketStatus.CLOSED,
    respondedAfter: 1,
    resolvedAfter: 5,
    closedAfter: 8,
    rating: 5,
    ratingComment: 'Toplantıdan önce çözüldü, teşekkürler.',
    comments: [
      [1, 'agent', 'HDMI dönüştürücüsü arızalı görünüyor, yenisi getiriliyor.'],
      [5, 'agent', 'Dönüştürücü değiştirildi, ekran çalışıyor.'],
    ],
  },
  {
    subject: 'Dizüstü bilgisayar bataryası çabuk bitiyor',
    description: 'Tam şarjla iki saat dayanıyor, toplantılarda sürekli prize bağlı kalıyorum.',
    category: 'Donanım',
    priority: TicketPriority.MEDIUM,
    requester: 'admin',
    agent: 'manager',
    ageHours: 2 * DAY,
    status: TicketStatus.IN_PROGRESS,
    respondedAfter: 3,
    comments: [
      [3, 'agent', 'Garanti kapsamında batarya değişimi için servis kaydı açıldı.'],
      [5, 'requester', 'Servis sürecinde yedek cihaz alabilir miyim?'],
    ],
  },
  {
    subject: 'Ankara şubesi için VPN erişimi',
    description: 'Ankara şubesinden sisteme bağlanmak için VPN profiline ihtiyacım var.',
    category: 'Ağ ve İnternet',
    priority: TicketPriority.MEDIUM,
    requester: 'admin',
    agent: 'manager',
    ageHours: 4,
    status: TicketStatus.OPEN,
  },
];

async function seedProfileTickets(prisma: PrismaClient, profile: Profile) {
  const { companyId, adminId, managerId } = profile;
  if (await prisma.ticket.count({ where: { companyId, requesterId: adminId } })) return;
  await createTickets(prisma, { companyId, adminId, managerId }, TICKETS);
}
