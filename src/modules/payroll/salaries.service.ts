import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, PayrollPeriodStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type {
  CreateSalaryRecordDto,
  EmployeeSalaryDto,
  SalaryQueryDto,
  SalaryRecordDto,
} from './dto/payroll.dto';

const SORTABLE = ['employeeNo', 'firstName'] as const;
const today = () => parseDateOnly(new Date().toISOString());

/** Salary history (ücret kartı); visible with `payroll:read`, changed with `payroll:update`. */
@Injectable()
export class SalariesService {
  constructor(private readonly prisma: PrismaService) {}

  async current(companyId: string, query: SalaryQueryDto) {
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      deletedAt: null,
      status: EmployeeStatus.ACTIVE,
      departmentId: query.departmentId,
      ...(query.search && {
        OR: [
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
          { employeeNo: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };
    const field = SORTABLE.find((f) => f === query.sortBy) ?? 'employeeNo';
    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: {
          department: { select: { name: true } },
          position: { select: { name: true } },
          salaryRecords: { orderBy: { effectiveFrom: 'desc' } },
        },
        orderBy: { [field]: query.sortBy ? query.sortOrder : 'asc' },
        ...toPageArgs(query),
      }),
      this.prisma.employee.count({ where }),
    ]);
    const now = today();
    const data = rows.map((row): EmployeeSalaryDto => {
      const current = row.salaryRecords.find((r) => r.effectiveFrom <= now) ?? null;
      const upcoming = row.salaryRecords.filter((r) => r.effectiveFrom > now).at(-1) ?? null;
      return {
        employeeId: row.id,
        employeeNo: row.employeeNo,
        employeeName: `${row.firstName} ${row.lastName}`,
        departmentName: row.department?.name ?? null,
        positionName: row.position?.name ?? null,
        hireDate: toDateOnly(row.hireDate),
        grossSalary: current?.grossSalary.toFixed(2) ?? null,
        effectiveFrom: current ? toDateOnly(current.effectiveFrom) : null,
        upcomingSalary: upcoming?.grossSalary.toFixed(2) ?? null,
        upcomingFrom: upcoming ? toDateOnly(upcoming.effectiveFrom) : null,
      };
    });
    return paginated(data, total, query);
  }

  async history(companyId: string, employeeId: string): Promise<SalaryRecordDto[]> {
    await this.employee(companyId, employeeId);
    const rows = await this.prisma.salaryRecord.findMany({
      where: { companyId, employeeId },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rows.map((row, index) => {
      const previous = rows[index + 1];
      return {
        id: row.id,
        employeeId: row.employeeId,
        effectiveFrom: toDateOnly(row.effectiveFrom),
        grossSalary: row.grossSalary.toFixed(2),
        changePercent: previous
          ? row.grossSalary
              .minus(previous.grossSalary)
              .div(previous.grossSalary)
              .mul(100)
              .toFixed(1)
          : null,
        note: row.note,
        createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
        createdAt: row.createdAt,
      };
    });
  }

  async create(user: AuthUser, dto: CreateSalaryRecordDto): Promise<SalaryRecordDto[]> {
    const employee = await this.employee(user.companyId, dto.employeeId);
    const effectiveFrom = parseDateOnly(dto.effectiveFrom);
    if (effectiveFrom < employee.hireDate) {
      throw new ConflictException('A salary cannot start before the hire date');
    }
    await this.assertOpen(user.companyId, effectiveFrom);
    await this.prisma.salaryRecord.upsert({
      where: { employeeId_effectiveFrom: { employeeId: employee.id, effectiveFrom } },
      create: {
        companyId: user.companyId,
        employeeId: employee.id,
        effectiveFrom,
        grossSalary: dto.grossSalary,
        note: dto.note?.trim() || null,
        createdById: user.id,
      },
      update: { grossSalary: dto.grossSalary, note: dto.note?.trim() || null },
    });
    return this.history(user.companyId, employee.id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    const row = await this.prisma.salaryRecord.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Salary record not found');
    await this.assertOpen(companyId, row.effectiveFrom);
    await this.prisma.salaryRecord.delete({ where: { id } });
  }

  /** Salary in force at `date` per employee; employees without one are missing from the map. */
  async salariesAt(
    tx: PrismaTx,
    companyId: string,
    employeeIds: string[],
    date: Date,
  ): Promise<Map<string, Prisma.Decimal>> {
    const rows = await tx.salaryRecord.findMany({
      where: { companyId, employeeId: { in: employeeIds }, effectiveFrom: { lte: date } },
      orderBy: { effectiveFrom: 'asc' },
    });
    return new Map(rows.map((row) => [row.employeeId, row.grossSalary]));
  }

  /** Months of approved payrolls are closed: their salaries can no longer change. */
  private async assertOpen(companyId: string, date: Date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const closed = await this.prisma.payrollPeriod.findFirst({
      where: {
        companyId,
        status: { not: PayrollPeriodStatus.DRAFT },
        OR: [{ year: { gt: year } }, { year, month: { gte: month } }],
      },
      select: { year: true, month: true },
    });
    if (closed) {
      throw new ConflictException(
        `Payroll ${closed.year}/${String(closed.month).padStart(2, '0')} is approved; date salary changes after it`,
      );
    }
  }

  private async employee(companyId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, hireDate: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }
}
