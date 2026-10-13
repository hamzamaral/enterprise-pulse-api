import {
  PayrollPeriodStatus,
  PayslipItemKind,
  Prisma,
  type PrismaClient,
  TreasuryAccountType,
  TreasuryDocumentType,
} from '@prisma/client';
import { formatNumber } from '../src/modules/numbering/number-format';
import {
  computePayslip,
  DEFAULT_RATES,
  employedDays,
  type PayslipResult,
  periodTotals,
} from '../src/modules/payroll/payroll-math';

const now = new Date();
const YEAR = now.getFullYear();
const CURRENT_MONTH = now.getMonth() + 1;
const date = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 0));

interface PayrollSeedContext {
  companyId: string;
  adminId: string;
}

/** Employee number → gross salary last July, this January and this July (raises). */
const SALARIES: Record<string, [number | null, number, number]> = {
  'PRS-000001': [200_000, 250_000, 300_000],
  'PRS-000002': [112_000, 140_000, 160_000],
  'PRS-000003': [84_000, 105_000, 120_000],
  'PRS-000004': [96_000, 120_000, 138_000],
  'PRS-000005': [92_000, 115_000, 130_000],
  'PRS-000006': [88_000, 110_000, 125_000],
  'PRS-000007': [76_000, 95_000, 110_000],
  'PRS-000008': [68_000, 85_000, 98_000],
  'PRS-000009': [62_500, 78_000, 90_000],
  'PRS-000010': [48_000, 60_000, 69_000],
  'PRS-000011': [46_500, 58_000, 66_000],
  'PRS-000012': [41_500, 52_000, 60_000],
  'PRS-000013': [38_500, 48_000, 55_000],
  'PRS-000014': [36_000, 45_000, 52_000],
  'PRS-000015': [null, 36_000, 41_000],
};

/** Month → employee number → extra items. */
const ITEMS: Record<number, Record<string, [PayslipItemKind, string, number][]>> = {
  3: { 'PRS-000012': [[PayslipItemKind.EARNING, 'Satış primi (1. çeyrek)', 9_000]] },
  6: {
    'PRS-000005': [[PayslipItemKind.EARNING, 'Satış primi (2. çeyrek)', 15_000]],
    'PRS-000012': [[PayslipItemKind.EARNING, 'Satış primi (2. çeyrek)', 8_000]],
    'PRS-000013': [[PayslipItemKind.EARNING, 'Satış primi (2. çeyrek)', 6_000]],
  },
  9: {
    'PRS-000012': [[PayslipItemKind.EARNING, 'Satış primi (3. çeyrek)', 7_500]],
    'PRS-000015': [[PayslipItemKind.DEDUCTION, 'Maaş avansı', 5_000]],
  },
};

/** The latest period stays approved and waits for payment; these are its timesheet figures. */
const LAST_MONTH_TIME: Record<string, { overtime?: number; missing?: number }> = {
  'PRS-000007': { overtime: 6 },
  'PRS-000008': { overtime: 4 },
  'PRS-000009': { overtime: 8 },
  'PRS-000013': { missing: 1 },
  'PRS-000014': { overtime: 5 },
};

/**
 * Payroll demo: yearly parameters, salary history with a January and July raise, and payrolls
 * from January to last month. Earlier months are imported (paid before the system), last month
 * is approved and waits to be paid from a funded payroll bank account.
 */
export async function seedPayroll(prisma: PrismaClient, ctx: PayrollSeedContext) {
  const { companyId, adminId } = ctx;
  if (await prisma.payrollPeriod.count({ where: { companyId } })) return;

  const rates = DEFAULT_RATES;
  await prisma.payrollParameter.upsert({
    where: { companyId_year: { companyId, year: YEAR } },
    create: {
      companyId,
      year: YEAR,
      ...rates,
      taxBrackets: rates.taxBrackets as unknown as Prisma.InputJsonValue,
    },
    update: {},
  });

  const employees = await prisma.employee.findMany({
    where: { companyId, deletedAt: null },
    include: { department: { select: { name: true } }, position: { select: { name: true } } },
    orderBy: { employeeNo: 'asc' },
  });
  const records: Prisma.SalaryRecordCreateManyInput[] = [];
  for (const employee of employees) {
    const salary = SALARIES[employee.employeeNo];
    if (!salary) continue;
    const [lastYear, january, july] = salary;
    const add = (effectiveFrom: Date, grossSalary: number, note: string) =>
      records.push({
        companyId,
        employeeId: employee.id,
        effectiveFrom: effectiveFrom < employee.hireDate ? employee.hireDate : effectiveFrom,
        grossSalary,
        note,
        createdById: adminId,
      });
    if (lastYear !== null) add(date(YEAR - 1, 7, 1), lastYear, 'Temmuz zammı');
    else add(employee.hireDate, Math.round(january / 1.2 / 500) * 500, 'İşe giriş ücreti');
    add(date(YEAR, 1, 1), january, 'Yıllık ücret artışı');
    add(date(YEAR, 7, 1), july, 'Temmuz zammı');
  }
  await prisma.salaryRecord.createMany({ data: records, skipDuplicates: true });

  const salaryAt = (employeeId: string, at: Date) =>
    records
      .filter((r) => r.employeeId === employeeId && (r.effectiveFrom as Date) <= at)
      .sort((a, b) => (a.effectiveFrom as Date).getTime() - (b.effectiveFrom as Date).getTime())
      .at(-1)?.grossSalary as number | undefined;

  const cumulative = new Map<string, Prisma.Decimal>();
  const lastMonth = CURRENT_MONTH - 1;
  for (let month = 1; month <= lastMonth; month++) {
    const imported = month < lastMonth;
    const seq = await prisma.numberSequence.update({
      where: { companyId_code: { companyId, code: 'PAYROLL' } },
      data: { nextValue: { increment: 1 } },
    });
    const period = await prisma.payrollPeriod.create({
      data: {
        companyId,
        number: formatNumber(seq, YEAR, seq.nextValue - 1),
        year: YEAR,
        month,
        status: imported ? PayrollPeriodStatus.PAID : PayrollPeriodStatus.APPROVED,
        imported,
        approvedAt: imported ? monthEnd(YEAR, month) : new Date(Date.now() - 2 * 86_400_000),
        approvedById: adminId,
        paymentDate: imported ? monthEnd(YEAR, month) : null,
        paidAt: imported ? monthEnd(YEAR, month) : null,
        createdById: adminId,
      },
    });

    const results: PayslipResult[] = [];
    for (const employee of employees) {
      const salary = salaryAt(employee.id, monthEnd(YEAR, month));
      const days = employedDays(employee.hireDate, employee.terminationDate, YEAR, month);
      if (!salary || days === 0) continue;
      const items = ITEMS[month]?.[employee.employeeNo] ?? [];
      const time = imported ? {} : (LAST_MONTH_TIME[employee.employeeNo] ?? {});
      const sum = (kind: PayslipItemKind) =>
        items.filter(([k]) => k === kind).reduce((total, [, , amount]) => total + amount, 0);
      const result = computePayslip(rates, {
        month,
        monthlySalary: salary,
        employedDays: days,
        missingDays: time.missing ?? 0,
        overtimeHours: time.overtime ?? 0,
        extraEarnings: sum(PayslipItemKind.EARNING),
        otherDeductions: sum(PayslipItemKind.DEDUCTION),
        cumulativeTaxBase: cumulative.get(employee.id) ?? 0,
      });
      cumulative.set(employee.id, result.cumulativeTaxBase);
      results.push(result);
      await prisma.payslip.create({
        data: {
          companyId,
          periodId: period.id,
          employeeId: employee.id,
          employeeNo: employee.employeeNo,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          departmentName: employee.department?.name ?? null,
          positionName: employee.position?.name ?? null,
          monthlySalary: salary,
          employedDays: days,
          missingDays: time.missing ?? 0,
          overtimeHours: time.overtime ?? 0,
          ...result,
          items: {
            create: items.map(([kind, description, amount]) => ({ kind, description, amount })),
          },
        },
      });
    }
    await prisma.payrollPeriod.update({ where: { id: period.id }, data: periodTotals(results) });
  }

  if (
    lastMonth >= 1 &&
    !(await prisma.treasuryAccount.count({ where: { companyId, code: 'BNK-MAAS' } }))
  ) {
    const account = await prisma.treasuryAccount.create({
      data: {
        companyId,
        code: 'BNK-MAAS',
        name: 'İş Bankası — Maaş',
        type: TreasuryAccountType.BANK,
        currencyCode: 'TRY',
        bankName: 'Türkiye İş Bankası',
        branchName: 'Maslak Kurumsal',
        iban: 'TR640006400000011234567890',
      },
    });
    await prisma.treasuryTransaction.create({
      data: {
        companyId,
        accountId: account.id,
        txDate: date(YEAR, lastMonth, 1),
        documentType: TreasuryDocumentType.OPENING,
        documentId: account.id,
        documentNumber: account.code,
        description: 'Açılış bakiyesi',
        amountIn: 1_500_000,
        createdById: adminId,
      },
    });
  }
}
