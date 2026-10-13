import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  LeaveRequestStatus,
  PayrollPeriodStatus,
  PayslipItemKind,
  Prisma,
  TreasuryDocumentType,
  type PayrollPeriod,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { TreasuryService } from '../finance/treasury.service';
import { AttendanceService } from '../hr/attendance.service';
import { countWorkingDays } from '../hr/working-days';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import type {
  CreatePayrollPeriodDto,
  MyPayslipDto,
  PayPayrollPeriodDto,
  PayrollPeriodDetailDto,
  PayrollPeriodDto,
  PayrollPeriodQueryDto,
  PayrollSummaryDto,
  PayslipDetailDto,
  PayslipRowDto,
  UpdatePayslipDto,
} from './dto/payroll.dto';
import { computePayslip, employedDays, periodTotals } from './payroll-math';
import { PayrollSettingsService } from './payroll-settings.service';
import { SalariesService } from './salaries.service';

const MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];
const DONE = [PayrollPeriodStatus.APPROVED, PayrollPeriodStatus.PAID];
const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toFixed(2);
const periodKey = (p: { year: number; month: number }) => p.year * 12 + p.month;
const periodName = (p: { year: number; month: number }) => `${MONTHS[p.month - 1]} ${p.year}`;
const fullName = (u: { firstName: string; lastName: string } | null) =>
  u ? `${u.firstName} ${u.lastName}` : null;

const detailInclude = {
  paymentAccount: { select: { name: true } },
  approvedBy: { select: { firstName: true, lastName: true } },
  paidBy: { select: { firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  payslips: { orderBy: { employeeNo: 'asc' } },
} satisfies Prisma.PayrollPeriodInclude;

type SlipRow = Prisma.PayslipGetPayload<object>;
type ItemInput = { kind: PayslipItemKind; description: string; amount: Prisma.Decimal.Value };

function monthBounds(year: number, month: number) {
  return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 0)) };
}

function sumItems(items: ItemInput[], kind: PayslipItemKind) {
  return items
    .filter((item) => item.kind === kind)
    .reduce((total, item) => total.plus(item.amount), ZERO);
}

/**
 * Monthly payroll (bordro). A draft period pulls salaries, unpaid leave and the attendance
 * timesheet (absences, overtime) and computes every payslip with `payroll-math`; approval locks it
 * and shows payslips to employees, payment posts the net total as `PAYROLL_PAYMENT`. Periods
 * follow each other: only the latest can be reopened and a new one needs the previous approved,
 * because each month continues the yearly cumulative tax base of the one before.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly treasury: TreasuryService,
    private readonly notifications: NotificationsService,
    private readonly attendance: AttendanceService,
    private readonly settings: PayrollSettingsService,
    private readonly salaries: SalariesService,
  ) {}

  // ---------- Periods ----------

  async findAll(companyId: string, query: PayrollPeriodQueryDto) {
    const where: Prisma.PayrollPeriodWhereInput = {
      companyId,
      year: query.year,
      status: query.status,
    };
    const [rows, total, currency] = await Promise.all([
      this.prisma.payrollPeriod.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.payrollPeriod.count({ where }),
      this.baseCurrency(companyId),
    ]);
    return paginated(
      rows.map((row) => this.toDto(row, currency)),
      total,
      query,
    );
  }

  async summary(companyId: string): Promise<PayrollSummaryDto> {
    const year = new Date().getUTCFullYear();
    const [currency, done, draft, toPay, yearTotals, employees] = await Promise.all([
      this.baseCurrency(companyId),
      this.prisma.payrollPeriod.findMany({
        where: { companyId, status: { in: DONE } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 12,
      }),
      this.prisma.payrollPeriod.findFirst({
        where: { companyId, status: PayrollPeriodStatus.DRAFT },
      }),
      this.prisma.payrollPeriod.aggregate({
        where: { companyId, status: PayrollPeriodStatus.APPROVED, imported: false },
        _sum: { netTotal: true },
      }),
      this.prisma.payrollPeriod.aggregate({
        where: { companyId, year, status: { in: DONE } },
        _sum: { grossTotal: true, employerCostTotal: true },
      }),
      this.prisma.employee.findMany({
        where: { companyId, deletedAt: null, status: EmployeeStatus.ACTIVE },
        select: {
          id: true,
          _count: {
            select: {
              salaryRecords: {
                where: { effectiveFrom: { lte: parseDateOnly(toDateOnly(new Date())) } },
              },
            },
          },
        },
      }),
    ]);
    return {
      currencyCode: currency,
      lastPeriod: done[0] ? this.toDto(done[0], currency) : null,
      draftPeriod: draft ? this.toDto(draft, currency) : null,
      toPayAmount: money(toPay._sum.netTotal ?? ZERO),
      yearGrossTotal: money(yearTotals._sum.grossTotal ?? ZERO),
      yearEmployerCostTotal: money(yearTotals._sum.employerCostTotal ?? ZERO),
      activeEmployeeCount: employees.length,
      missingSalaryCount: employees.filter((e) => e._count.salaryRecords === 0).length,
      byMonth: done
        .slice()
        .reverse()
        .map((row) => ({
          year: row.year,
          month: row.month,
          grossTotal: money(row.grossTotal),
          netTotal: money(row.netTotal),
          employerCostTotal: money(row.employerCostTotal),
        })),
    };
  }

  async findOne(user: AuthUser, id: string): Promise<PayrollPeriodDetailDto> {
    const row = await this.prisma.payrollPeriod.findFirst({
      where: { id, companyId: user.companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Payroll period not found');
    const [currency, later, missing] = await Promise.all([
      this.baseCurrency(user.companyId),
      this.laterPeriodExists(this.prisma, row),
      row.status === PayrollPeriodStatus.DRAFT
        ? this.employeesWithoutSalary(user.companyId, row.year, row.month)
        : Promise.resolve([]),
    ]);
    const draft = row.status === PayrollPeriodStatus.DRAFT;
    const approved = row.status === PayrollPeriodStatus.APPROVED;
    return {
      ...this.toDto(row, currency),
      payslips: row.payslips.map((slip) => this.toRow(slip)),
      missingSalaryNames: missing,
      paymentAccountId: row.paymentAccountId,
      paymentAccountName: row.paymentAccount?.name ?? null,
      approvedByName: fullName(row.approvedBy),
      paidAt: row.paidAt,
      paidByName: fullName(row.paidBy),
      createdByName: fullName(row.createdBy)!,
      canEdit: draft && hasPermission(user, 'payroll:create'),
      canApprove: draft && row.employeeCount > 0 && hasPermission(user, 'payroll:approve'),
      canReopen: approved && !row.imported && !later && hasPermission(user, 'payroll:approve'),
      canPay: approved && !row.imported && hasPermission(user, 'payroll:pay'),
      canReversePayment:
        row.status === PayrollPeriodStatus.PAID &&
        !row.imported &&
        hasPermission(user, 'payroll:pay'),
      canDelete: draft && hasPermission(user, 'payroll:create'),
    };
  }

  async create(user: AuthUser, dto: CreatePayrollPeriodDto): Promise<PayrollPeriodDetailDto> {
    const now = new Date();
    if (periodKey(dto) > periodKey({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 })) {
      throw new BadRequestException('Payroll cannot be prepared for a future month');
    }
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM companies WHERE id = ${user.companyId}::uuid FOR UPDATE`;
      const draft = await tx.payrollPeriod.findFirst({
        where: { companyId: user.companyId, status: PayrollPeriodStatus.DRAFT },
      });
      if (draft) {
        throw new ConflictException(
          `Approve or delete the draft payroll ${periodName(draft)} first`,
        );
      }
      const latest = await tx.payrollPeriod.findFirst({
        where: { companyId: user.companyId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
      if (latest && periodKey(latest) >= periodKey(dto)) {
        throw new ConflictException(`Payroll periods must come after ${periodName(latest)}`);
      }
      const period = await tx.payrollPeriod.create({
        data: {
          companyId: user.companyId,
          number: await this.numbering.next(user.companyId, 'PAYROLL', tx),
          year: dto.year,
          month: dto.month,
          createdById: user.id,
        },
      });
      await this.build(tx, period, new Map());
      return period.id;
    });
    return this.findOne(user, id);
  }

  /** Reads salaries, leave and attendance again; extra earnings and deductions are kept. */
  async recalculate(user: AuthUser, id: string): Promise<PayrollPeriodDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const period = await this.lock(tx, user.companyId, id);
      this.assertDraft(period);
      const slips = await tx.payslip.findMany({
        where: { periodId: id },
        include: { items: true },
      });
      await this.build(tx, period, new Map(slips.map((slip) => [slip.employeeId, slip.items])));
    });
    return this.findOne(user, id);
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const period = await this.lock(tx, user.companyId, id);
      this.assertDraft(period);
      await tx.payrollPeriod.delete({ where: { id } });
    });
  }

  async approve(user: AuthUser, id: string): Promise<PayrollPeriodDetailDto> {
    const period = await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, user.companyId, id);
      this.assertDraft(row);
      if (row.employeeCount === 0) throw new ConflictException('The payroll has no payslips');
      return tx.payrollPeriod.update({
        where: { id },
        data: {
          status: PayrollPeriodStatus.APPROVED,
          approvedAt: new Date(),
          approvedById: user.id,
        },
      });
    });
    await this.notifyEmployees(
      period,
      user,
      'payroll.approved',
      'Bordronuz hazır',
      (name) => `${name} bordro pusulanızı görüntüleyebilirsiniz.`,
    );
    return this.findOne(user, id);
  }

  /** Back to draft; only the latest period, and only before it is paid. */
  async reopen(user: AuthUser, id: string): Promise<PayrollPeriodDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const period = await this.lock(tx, user.companyId, id);
      if (period.status !== PayrollPeriodStatus.APPROVED || period.imported) {
        throw new ConflictException('Only approved, unpaid payrolls can be reopened');
      }
      if (await this.laterPeriodExists(tx, period)) {
        throw new ConflictException('A later payroll exists; reopen that one first');
      }
      await tx.payrollPeriod.update({
        where: { id },
        data: { status: PayrollPeriodStatus.DRAFT, approvedAt: null, approvedById: null },
      });
    });
    return this.findOne(user, id);
  }

  /** Pays the net salaries from one account in the company currency. */
  async pay(user: AuthUser, id: string, dto: PayPayrollPeriodDto): Promise<PayrollPeriodDetailDto> {
    const base = await this.baseCurrency(user.companyId);
    const period = await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, user.companyId, id);
      if (row.status !== PayrollPeriodStatus.APPROVED || row.imported) {
        throw new ConflictException('Only approved payrolls can be paid');
      }
      const account = await tx.treasuryAccount.findFirst({
        where: { id: dto.accountId, companyId: user.companyId },
      });
      if (!account) throw new BadRequestException('Account not found');
      if (account.currencyCode !== base) {
        throw new BadRequestException(`Salaries are paid from ${base} accounts`);
      }
      const paymentDate = parseDateOnly(dto.paymentDate ?? new Date().toISOString());
      await this.treasury.post(tx, user, {
        accountId: account.id,
        txDate: paymentDate,
        documentType: TreasuryDocumentType.PAYROLL_PAYMENT,
        documentId: row.id,
        documentNumber: row.number,
        description: `Maaş ödemesi: ${periodName(row)} (${row.employeeCount} personel)`,
        amountOut: row.netTotal,
      });
      return tx.payrollPeriod.update({
        where: { id },
        data: {
          status: PayrollPeriodStatus.PAID,
          paymentAccountId: account.id,
          paymentDate,
          paidAt: new Date(),
          paidById: user.id,
        },
      });
    });
    await this.notifyEmployees(
      period,
      user,
      'payroll.paid',
      'Maaşınız ödendi',
      (name) => `${name} maaşınız hesabınıza aktarıldı.`,
    );
    return this.findOne(user, id);
  }

  async reversePayment(user: AuthUser, id: string): Promise<PayrollPeriodDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const period = await this.lock(tx, user.companyId, id);
      if (period.status !== PayrollPeriodStatus.PAID || period.imported) {
        throw new ConflictException('Payroll is not paid');
      }
      await this.treasury.reverse(
        tx,
        user,
        TreasuryDocumentType.PAYROLL_PAYMENT,
        period.id,
        parseDateOnly(new Date().toISOString()),
        `Maaş ödemesi iptali: ${periodName(period)}`,
      );
      await tx.payrollPeriod.update({
        where: { id },
        data: {
          status: PayrollPeriodStatus.APPROVED,
          paymentAccountId: null,
          paymentDate: null,
          paidAt: null,
          paidById: null,
        },
      });
    });
    return this.findOne(user, id);
  }

  // ---------- Payslips ----------

  async mine(user: AuthUser): Promise<MyPayslipDto[]> {
    const [rows, currency] = await Promise.all([
      this.prisma.payslip.findMany({
        where: {
          companyId: user.companyId,
          employee: { userId: user.id },
          period: { status: { in: DONE } },
        },
        include: { period: true },
        orderBy: [{ period: { year: 'desc' } }, { period: { month: 'desc' } }],
      }),
      this.baseCurrency(user.companyId),
    ]);
    return rows.map((row) => ({
      id: row.id,
      periodId: row.periodId,
      year: row.period.year,
      month: row.period.month,
      status: row.period.status,
      grossPay: money(row.grossPay),
      netPay: money(row.netPay),
      paymentDate: toDateOnly(row.period.paymentDate),
      currencyCode: currency,
    }));
  }

  /** Payroll staff see every payslip, employees their own once the period is approved. */
  async payslip(user: AuthUser, id: string): Promise<PayslipDetailDto> {
    const row = await this.prisma.payslip.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        period: true,
        items: { orderBy: [{ kind: 'asc' }, { description: 'asc' }] },
        employee: { select: { userId: true, hireDate: true, nationalId: true } },
        company: { select: { name: true, baseCurrency: true } },
      },
    });
    const staff = hasPermission(user, 'payroll:read');
    const own = row?.employee.userId === user.id && row.period.status !== PayrollPeriodStatus.DRAFT;
    if (!row || !(staff || own)) throw new NotFoundException('Payslip not found');
    return {
      ...this.toRow(row),
      periodId: row.periodId,
      periodNumber: row.period.number,
      year: row.period.year,
      month: row.period.month,
      status: row.period.status,
      currencyCode: row.company.baseCurrency,
      companyName: row.company.name,
      hireDate: toDateOnly(row.employee.hireDate),
      nationalId: row.employee.nationalId,
      employedDays: row.employedDays,
      basePay: money(row.basePay),
      overtimePay: money(row.overtimePay),
      extraEarnings: money(row.extraEarnings),
      sgkBase: money(row.sgkBase),
      incomeTaxBase: money(row.incomeTaxBase),
      cumulativeTaxBase: money(row.cumulativeTaxBase),
      incomeTax: money(row.incomeTax),
      incomeTaxExemption: money(row.incomeTaxExemption),
      stampTax: money(row.stampTax),
      stampTaxExemption: money(row.stampTaxExemption),
      sgkEmployer: money(row.sgkEmployer),
      unemploymentEmployer: money(row.unemploymentEmployer),
      paymentDate: toDateOnly(row.period.paymentDate),
      items: row.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        description: item.description,
        amount: money(item.amount),
      })),
      canEdit:
        row.period.status === PayrollPeriodStatus.DRAFT && hasPermission(user, 'payroll:create'),
    };
  }

  /** Corrects missing days, overtime and extra items of a draft payslip. */
  async updatePayslip(
    user: AuthUser,
    id: string,
    dto: UpdatePayslipDto,
  ): Promise<PayslipDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const slip = await tx.payslip.findFirst({ where: { id, companyId: user.companyId } });
      if (!slip) throw new NotFoundException('Payslip not found');
      const period = await this.lock(tx, user.companyId, slip.periodId);
      this.assertDraft(period);
      if (dto.missingDays > slip.employedDays) {
        throw new BadRequestException(`Missing days cannot exceed ${slip.employedDays}`);
      }
      const rates = await this.settings.ratesFor(tx, user.companyId, period.year);
      const items = dto.items.map((item) => ({ ...item, description: item.description.trim() }));
      const result = computePayslip(rates, {
        month: period.month,
        monthlySalary: slip.monthlySalary,
        employedDays: slip.employedDays,
        missingDays: dto.missingDays,
        overtimeHours: dto.overtimeHours,
        extraEarnings: sumItems(items, PayslipItemKind.EARNING),
        otherDeductions: sumItems(items, PayslipItemKind.DEDUCTION),
        cumulativeTaxBase: slip.cumulativeTaxBase.minus(slip.incomeTaxBase),
      });
      await tx.payslipItem.deleteMany({ where: { payslipId: id } });
      await tx.payslip.update({
        where: { id },
        data: {
          ...result,
          missingDays: dto.missingDays,
          overtimeHours: dto.overtimeHours,
          items: { create: items },
        },
      });
      await this.updateTotals(tx, period.id);
    });
    return this.payslip(user, id);
  }

  // ---------- Building ----------

  private async build(
    tx: PrismaTx,
    period: PayrollPeriod,
    keep: Map<string, ItemInput[]>,
  ): Promise<void> {
    const { companyId, year, month } = period;
    const { from, to } = monthBounds(year, month);
    const employees = await tx.employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        hireDate: { lte: to },
        OR: [{ terminationDate: null }, { terminationDate: { gte: from } }],
      },
      include: { department: { select: { name: true } }, position: { select: { name: true } } },
      orderBy: { employeeNo: 'asc' },
    });
    const ids = employees.map((e) => e.id);
    const [rates, salaries, unpaid, cumulative, attendance] = await Promise.all([
      this.settings.ratesFor(tx, companyId, year),
      this.salaries.salariesAt(tx, companyId, ids, to),
      this.unpaidLeaveDays(tx, companyId, ids, from, to),
      this.cumulativeBases(tx, companyId, ids, year, month),
      this.attendanceFigures(companyId, year, month),
    ]);

    await tx.payslip.deleteMany({ where: { periodId: period.id } });
    for (const employee of employees) {
      const salary = salaries.get(employee.id);
      if (!salary) continue;
      const items = keep.get(employee.id) ?? [];
      const days = employedDays(employee.hireDate, employee.terminationDate, year, month);
      const worked = attendance.get(employee.id);
      const missingDays = Math.min(
        days,
        (worked?.absentDays ?? 0) + (unpaid.get(employee.id) ?? 0),
      );
      const overtimeHours = worked?.overtimeHours ?? 0;
      const result = computePayslip(rates, {
        month,
        monthlySalary: salary,
        employedDays: days,
        missingDays,
        overtimeHours,
        extraEarnings: sumItems(items, PayslipItemKind.EARNING),
        otherDeductions: sumItems(items, PayslipItemKind.DEDUCTION),
        cumulativeTaxBase: cumulative.get(employee.id) ?? 0,
      });
      await tx.payslip.create({
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
          missingDays,
          overtimeHours,
          ...result,
          items: {
            create: items.map(({ kind, description, amount }) => ({ kind, description, amount })),
          },
        },
      });
    }
    await this.updateTotals(tx, period.id);
  }

  private async updateTotals(tx: PrismaTx, periodId: string) {
    const slips = await tx.payslip.findMany({ where: { periodId } });
    await tx.payrollPeriod.update({ where: { id: periodId }, data: periodTotals(slips) });
  }

  /**
   * Absent days and overtime (rounded to half hours) from the attendance timesheet. Employees
   * without any attendance record in the month are not tracked, so no absence is assumed.
   */
  private async attendanceFigures(companyId: string, year: number, month: number) {
    const sheet = await this.attendance.timesheet(
      companyId,
      `${year}-${String(month).padStart(2, '0')}`,
    );
    const result = new Map<string, { absentDays: number; overtimeHours: number }>();
    for (const row of sheet.rows) {
      if (!row.days.some((day) => day.source !== null)) continue;
      result.set(row.employeeId, {
        absentDays: row.totals.absentDays,
        overtimeHours: Math.round(row.totals.overtimeMinutes / 30) / 2,
      });
    }
    return result;
  }

  /** Working days of approved unpaid leave inside the month. */
  private async unpaidLeaveDays(
    tx: PrismaTx,
    companyId: string,
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    const [leaves, holidays] = await Promise.all([
      tx.leaveRequest.findMany({
        where: {
          companyId,
          employeeId: { in: employeeIds },
          status: LeaveRequestStatus.APPROVED,
          leaveType: { isPaid: false },
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: { employeeId: true, startDate: true, endDate: true },
      }),
      tx.holiday.findMany({ where: { companyId, date: { gte: from, lte: to } } }),
    ]);
    const holidaySet = new Set(holidays.map((h) => toDateOnly(h.date)));
    const result = new Map<string, number>();
    for (const leave of leaves) {
      const start = leave.startDate > from ? leave.startDate : from;
      const end = leave.endDate < to ? leave.endDate : to;
      const days = countWorkingDays(start, end, holidaySet);
      result.set(leave.employeeId, (result.get(leave.employeeId) ?? 0) + days);
    }
    return result;
  }

  /** Cumulative income tax base of each employee at the end of the previous payroll of the year. */
  private async cumulativeBases(
    tx: PrismaTx,
    companyId: string,
    employeeIds: string[],
    year: number,
    month: number,
  ): Promise<Map<string, Prisma.Decimal>> {
    const slips = await tx.payslip.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        period: { year, month: { lt: month } },
      },
      select: { employeeId: true, cumulativeTaxBase: true },
      orderBy: { period: { month: 'asc' } },
    });
    return new Map(slips.map((slip) => [slip.employeeId, slip.cumulativeTaxBase]));
  }

  private async employeesWithoutSalary(companyId: string, year: number, month: number) {
    const { from, to } = monthBounds(year, month);
    const rows = await this.prisma.employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        hireDate: { lte: to },
        OR: [{ terminationDate: null }, { terminationDate: { gte: from } }],
        salaryRecords: { none: { effectiveFrom: { lte: to } } },
      },
      select: { firstName: true, lastName: true },
      orderBy: { employeeNo: 'asc' },
    });
    return rows.map((row) => `${row.firstName} ${row.lastName}`);
  }

  // ---------- Helpers ----------

  private async lock(tx: PrismaTx, companyId: string, id: string): Promise<PayrollPeriod> {
    await tx.$queryRaw`SELECT id FROM payroll_periods WHERE id = ${id}::uuid FOR UPDATE`;
    const period = await tx.payrollPeriod.findFirst({ where: { id, companyId } });
    if (!period) throw new NotFoundException('Payroll period not found');
    return period;
  }

  private assertDraft(period: PayrollPeriod) {
    if (period.status !== PayrollPeriodStatus.DRAFT) {
      throw new ConflictException('Only draft payrolls can be changed');
    }
  }

  private async laterPeriodExists(client: PrismaTx | PrismaService, period: PayrollPeriod) {
    const later = await client.payrollPeriod.count({
      where: {
        companyId: period.companyId,
        OR: [{ year: { gt: period.year } }, { year: period.year, month: { gt: period.month } }],
      },
    });
    return later > 0;
  }

  private async notifyEmployees(
    period: PayrollPeriod,
    user: AuthUser,
    type: string,
    title: string,
    body: (name: string) => string,
  ) {
    const slips = await this.prisma.payslip.findMany({
      where: { periodId: period.id },
      select: { employee: { select: { userId: true } } },
    });
    await this.notifications.notify({
      userIds: slips
        .map((slip) => slip.employee.userId)
        .filter((id): id is string => !!id && id !== user.id),
      companyId: user.companyId,
      type,
      title,
      body: body(periodName(period)),
      link: '/payroll/my',
    });
  }

  private toDto(row: PayrollPeriod, currency: string): PayrollPeriodDto {
    return {
      id: row.id,
      number: row.number,
      year: row.year,
      month: row.month,
      status: row.status,
      imported: row.imported,
      employeeCount: row.employeeCount,
      grossTotal: money(row.grossTotal),
      netTotal: money(row.netTotal),
      sgkTotal: money(row.sgkTotal),
      taxTotal: money(row.taxTotal),
      deductionTotal: money(row.deductionTotal),
      employerCostTotal: money(row.employerCostTotal),
      currencyCode: currency,
      approvedAt: row.approvedAt,
      paymentDate: toDateOnly(row.paymentDate),
      createdAt: row.createdAt,
    };
  }

  private toRow(slip: SlipRow): PayslipRowDto {
    return {
      id: slip.id,
      employeeId: slip.employeeId,
      employeeNo: slip.employeeNo,
      employeeName: slip.employeeName,
      departmentName: slip.departmentName,
      positionName: slip.positionName,
      monthlySalary: money(slip.monthlySalary),
      payDays: slip.payDays,
      missingDays: slip.missingDays,
      overtimeHours: slip.overtimeHours.toString(),
      grossPay: money(slip.grossPay),
      sgkEmployee: money(slip.sgkEmployee),
      unemploymentEmployee: money(slip.unemploymentEmployee),
      incomeTaxPayable: money(slip.incomeTax.minus(slip.incomeTaxExemption)),
      stampTaxPayable: money(slip.stampTax.minus(slip.stampTaxExemption)),
      otherDeductions: money(slip.otherDeductions),
      netPay: money(slip.netPay),
      employerCost: money(slip.employerCost),
    };
  }

  private async baseCurrency(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { baseCurrency: true },
    });
    return company.baseCurrency;
  }
}
