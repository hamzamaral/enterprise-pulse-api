import { Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, LeaveRequestStatus, type LeaveType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { parseDateOnly, toDateOnly } from './date-only';
import type {
  AccrueResultDto,
  CreateHolidayDto,
  CreateLeaveTypeDto,
  HolidayDto,
  LeaveBalanceDto,
  LeaveTypeDto,
  UpdateLeaveBalanceDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';

@Injectable()
export class LeaveSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  findTypes(companyId: string, activeOnly = false): Promise<LeaveTypeDto[]> {
    return this.prisma.leaveType.findMany({
      where: { companyId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: { name: 'asc' },
      select: typeSelect,
    });
  }

  createType(companyId: string, dto: CreateLeaveTypeDto): Promise<LeaveTypeDto> {
    return this.prisma.leaveType.create({ data: { ...dto, companyId }, select: typeSelect });
  }

  async updateType(companyId: string, id: string, dto: UpdateLeaveTypeDto): Promise<LeaveTypeDto> {
    await this.getType(companyId, id);
    return this.prisma.leaveType.update({ where: { id }, data: dto, select: typeSelect });
  }

  async getType(companyId: string, id: string): Promise<LeaveType> {
    const type = await this.prisma.leaveType.findFirst({ where: { id, companyId } });
    if (!type) throw new NotFoundException('Leave type not found');
    return type;
  }

  async findHolidays(companyId: string, year?: number): Promise<HolidayDto[]> {
    const rows = await this.prisma.holiday.findMany({
      where: {
        companyId,
        ...(year
          ? { date: { gte: parseDateOnly(`${year}-01-01`), lte: parseDateOnly(`${year}-12-31`) } }
          : {}),
      },
      orderBy: { date: 'asc' },
    });
    return rows.map((h) => ({ id: h.id, date: toDateOnly(h.date), name: h.name }));
  }

  /** Holiday dates ("YYYY-MM-DD") within the inclusive range, for working-day calculations. */
  async holidaySet(companyId: string, start: Date, end: Date): Promise<Set<string>> {
    const rows = await this.prisma.holiday.findMany({
      where: { companyId, date: { gte: start, lte: end } },
      select: { date: true },
    });
    return new Set(rows.map((h) => toDateOnly(h.date)));
  }

  async createHoliday(companyId: string, dto: CreateHolidayDto): Promise<HolidayDto> {
    const row = await this.prisma.holiday.create({
      data: { companyId, date: parseDateOnly(dto.date), name: dto.name },
    });
    return { id: row.id, date: toDateOnly(row.date), name: row.name };
  }

  async removeHoliday(companyId: string, id: string): Promise<void> {
    const { count } = await this.prisma.holiday.deleteMany({ where: { id, companyId } });
    if (!count) throw new NotFoundException('Holiday not found');
  }

  async findBalances(
    companyId: string,
    filter: { employeeId?: string; year: number },
  ): Promise<LeaveBalanceDto[]> {
    const rows = await this.prisma.leaveBalance.findMany({
      where: { companyId, year: filter.year, employeeId: filter.employeeId },
      include: {
        employee: { select: { firstName: true, lastName: true } },
        leaveType: { select: { name: true, color: true } },
      },
      orderBy: [{ employee: { firstName: 'asc' } }, { leaveType: { name: 'asc' } }],
    });

    const pending = await this.prisma.leaveRequest.groupBy({
      by: ['employeeId', 'leaveTypeId'],
      where: {
        companyId,
        status: LeaveRequestStatus.PENDING,
        employeeId: filter.employeeId,
        startDate: {
          gte: parseDateOnly(`${filter.year}-01-01`),
          lte: parseDateOnly(`${filter.year}-12-31`),
        },
      },
      _sum: { days: true },
    });
    const pendingByKey = new Map(
      pending.map((p) => [`${p.employeeId}:${p.leaveTypeId}`, p._sum.days ?? 0]),
    );

    return rows.map((b) => {
      const pendingDays = pendingByKey.get(`${b.employeeId}:${b.leaveTypeId}`) ?? 0;
      return {
        id: b.id,
        employeeId: b.employeeId,
        employeeName: `${b.employee.firstName} ${b.employee.lastName}`,
        leaveTypeId: b.leaveTypeId,
        leaveTypeName: b.leaveType.name,
        leaveTypeColor: b.leaveType.color,
        year: b.year,
        entitledDays: b.entitledDays,
        usedDays: b.usedDays,
        pendingDays,
        remainingDays: b.entitledDays - b.usedDays - pendingDays,
      };
    });
  }

  /** Creates missing balances for every active employee and balance-tracked leave type. */
  async accrue(companyId: string, year: number): Promise<AccrueResultDto> {
    const [employees, types] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId, deletedAt: null, status: EmployeeStatus.ACTIVE },
        select: { id: true },
      }),
      this.prisma.leaveType.findMany({
        where: { companyId, isActive: true, requiresBalance: true },
        select: { id: true, defaultDays: true },
      }),
    ]);
    const { count } = await this.prisma.leaveBalance.createMany({
      data: employees.flatMap((e) =>
        types.map((t) => ({
          companyId,
          employeeId: e.id,
          leaveTypeId: t.id,
          year,
          entitledDays: t.defaultDays,
        })),
      ),
      skipDuplicates: true,
    });
    return { created: count };
  }

  async updateBalance(
    companyId: string,
    id: string,
    dto: UpdateLeaveBalanceDto,
  ): Promise<LeaveBalanceDto> {
    const balance = await this.prisma.leaveBalance.findFirst({ where: { id, companyId } });
    if (!balance) throw new NotFoundException('Leave balance not found');
    await this.prisma.leaveBalance.update({
      where: { id },
      data: { entitledDays: dto.entitledDays },
    });
    const balances = await this.findBalances(companyId, {
      employeeId: balance.employeeId,
      year: balance.year,
    });
    return balances.find((b) => b.id === id)!;
  }
}

const typeSelect = {
  id: true,
  code: true,
  name: true,
  defaultDays: true,
  isPaid: true,
  requiresBalance: true,
  color: true,
  isActive: true,
} as const;
