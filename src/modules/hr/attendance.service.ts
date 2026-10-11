import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceSource, LeaveRequestStatus, Prisma, type Shift } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CreateShiftDto,
  MyAttendanceDto,
  ShiftDto,
  ShiftPlanDto,
  ShiftPlanQueryDto,
  TimesheetDayDto,
  TimesheetDto,
  TimesheetRowDto,
  TimesheetTotalsDto,
  UpdateAttendanceRecordDto,
  UpdateShiftDto,
  UpdateShiftPlanDto,
  UpdateShiftPlanResultDto,
} from './dto/attendance.dto';
import {
  DEFAULT_SHIFT,
  evaluateDay,
  formatClock,
  instantOf,
  minutesSinceWorkDate,
  parseClock,
  plannedMinutes,
  shiftWindow,
  zoneOffsetMinutes,
  type ShiftTimes,
} from './timesheet';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIME_ZONE = 'Europe/Istanbul';
const MAX_PLAN_DAYS = 31;

const employeeSelect = {
  id: true,
  employeeNo: true,
  firstName: true,
  lastName: true,
  hireDate: true,
  terminationDate: true,
  department: { select: { name: true } },
} satisfies Prisma.EmployeeSelect;

type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;

type ResolvedShift = ShiftTimes & { color: string | null };

function toShiftDto(row: Shift): ShiftDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    startTime: row.startTime,
    endTime: row.endTime,
    breakMinutes: row.breakMinutes,
    plannedMinutes: plannedMinutes(row),
    color: row.color,
    isActive: row.isActive,
  };
}

function datesBetween(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  for (let time = from.getTime(); time <= to.getTime(); time += DAY_MS) dates.push(new Date(time));
  return dates;
}

function monthRange(month: string): { from: Date; to: Date } {
  const from = parseDateOnly(`${month}-01`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
  return { from, to };
}

function emptyTotals(): TimesheetTotalsDto {
  return {
    plannedDays: 0,
    presentDays: 0,
    lateDays: 0,
    absentDays: 0,
    leaveDays: 0,
    plannedMinutes: 0,
    workedMinutes: 0,
    lateMinutes: 0,
    overtimeMinutes: 0,
  };
}

/** Shift planning (vardiya) and attendance tracking (puantaj). */
@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Shifts ────────────────────────────────────────────────────────────────

  async findShifts(companyId: string): Promise<ShiftDto[]> {
    const rows = await this.prisma.shift.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { startTime: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toShiftDto);
  }

  async createShift(companyId: string, dto: CreateShiftDto): Promise<ShiftDto> {
    this.assertShiftTimes(dto.startTime, dto.endTime, dto.breakMinutes);
    try {
      return toShiftDto(await this.prisma.shift.create({ data: { companyId, ...dto } }));
    } catch (error) {
      throw this.mapUniqueError(error);
    }
  }

  async updateShift(companyId: string, id: string, dto: UpdateShiftDto): Promise<ShiftDto> {
    const current = await this.prisma.shift.findFirst({ where: { id, companyId } });
    if (!current) throw new NotFoundException('Shift not found');
    this.assertShiftTimes(
      dto.startTime ?? current.startTime,
      dto.endTime ?? current.endTime,
      dto.breakMinutes ?? current.breakMinutes,
    );
    try {
      return toShiftDto(await this.prisma.shift.update({ where: { id }, data: dto }));
    } catch (error) {
      throw this.mapUniqueError(error);
    }
  }

  // ── Shift plan ────────────────────────────────────────────────────────────

  async findPlan(companyId: string, query: ShiftPlanQueryDto): Promise<ShiftPlanDto> {
    const from = parseDateOnly(query.from);
    const to = parseDateOnly(query.to);
    if (to < from) throw new BadRequestException('"to" must not be before "from"');
    if ((to.getTime() - from.getTime()) / DAY_MS >= MAX_PLAN_DAYS) {
      throw new BadRequestException(`The range may span at most ${MAX_PLAN_DAYS} days`);
    }
    const employees = await this.findEmployees(companyId, from, to, query.departmentId);
    const entries = await this.prisma.shiftAssignment.findMany({
      where: {
        companyId,
        date: { gte: from, lte: to },
        employeeId: { in: employees.map((e) => e.id) },
      },
      orderBy: { date: 'asc' },
    });
    return {
      from: query.from,
      to: query.to,
      employees: employees.map((employee) => ({
        id: employee.id,
        employeeNo: employee.employeeNo,
        name: `${employee.firstName} ${employee.lastName}`,
        departmentName: employee.department?.name ?? null,
      })),
      entries: entries.map((entry) => ({
        employeeId: entry.employeeId,
        date: toDateOnly(entry.date),
        shiftId: entry.shiftId,
      })),
    };
  }

  async updatePlan(companyId: string, dto: UpdateShiftPlanDto): Promise<UpdateShiftPlanResultDto> {
    const employeeIds = [...new Set(dto.entries.map((entry) => entry.employeeId))];
    const employees = await this.prisma.employee.count({
      where: { companyId, deletedAt: null, id: { in: employeeIds } },
    });
    if (employees !== employeeIds.length) throw new NotFoundException('Employee not found');

    const shiftIds = [
      ...new Set(
        dto.entries.flatMap((entry) => (!entry.useDefault && entry.shiftId ? [entry.shiftId] : [])),
      ),
    ];
    const shifts = await this.prisma.shift.count({
      where: { companyId, isActive: true, id: { in: shiftIds } },
    });
    if (shifts !== shiftIds.length) throw new NotFoundException('Shift not found or inactive');

    await this.prisma.$transaction(
      dto.entries.map((entry) => {
        const key = { employeeId: entry.employeeId, date: parseDateOnly(entry.date) };
        if (entry.useDefault) {
          return this.prisma.shiftAssignment.deleteMany({ where: { companyId, ...key } });
        }
        const shiftId = entry.shiftId ?? null;
        return this.prisma.shiftAssignment.upsert({
          where: { employeeId_date: key },
          create: { companyId, ...key, shiftId },
          update: { shiftId },
        });
      }),
    );
    return { updated: dto.entries.length };
  }

  // ── Timesheet ─────────────────────────────────────────────────────────────

  async timesheet(companyId: string, month: string, departmentId?: string): Promise<TimesheetDto> {
    const { from, to } = monthRange(month);
    const employees = await this.findEmployees(companyId, from, to, departmentId);
    const offset = await this.zoneOffset(companyId);
    return {
      month,
      days: datesBetween(from, to).map((date) => toDateOnly(date)),
      today: toDateOnly(this.localToday(offset)),
      rows: await this.buildRows(companyId, employees, from, to, offset),
    };
  }

  async mine(user: AuthUser, month?: string): Promise<MyAttendanceDto> {
    const employee = await this.ownEmployee(user);
    const offset = await this.zoneOffset(user.companyId);
    const today = this.localToday(offset);
    const { from, to } = monthRange(month ?? toDateOnly(today).slice(0, 7));
    const [row] = await this.buildRows(user.companyId, [employee], from, to, offset);
    const [todayRow] = await this.buildRows(user.companyId, [employee], today, today, offset);
    const open = await this.findOpenRecord(employee.id, today);
    const todayRecord = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });
    return {
      today: todayRow.days[0],
      canCheckIn: !todayRecord?.checkIn,
      canCheckOut: Boolean(open),
      row,
    };
  }

  async checkIn(user: AuthUser): Promise<MyAttendanceDto> {
    const employee = await this.ownEmployee(user);
    const offset = await this.zoneOffset(user.companyId);
    const today = this.localToday(offset);
    const key = { employeeId: employee.id, date: today };
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: key },
    });
    if (existing?.checkIn) throw new ConflictException('You have already checked in today');
    await this.prisma.attendanceRecord.upsert({
      where: { employeeId_date: key },
      create: {
        companyId: user.companyId,
        ...key,
        checkIn: new Date(),
        source: AttendanceSource.SELF,
      },
      update: { checkIn: new Date(), source: AttendanceSource.SELF },
    });
    return this.mine(user);
  }

  async checkOut(user: AuthUser): Promise<MyAttendanceDto> {
    const employee = await this.ownEmployee(user);
    const offset = await this.zoneOffset(user.companyId);
    const open = await this.findOpenRecord(employee.id, this.localToday(offset));
    if (!open) throw new ConflictException('There is no open check-in to close');
    await this.prisma.attendanceRecord.update({
      where: { id: open.id },
      data: { checkOut: new Date() },
    });
    return this.mine(user);
  }

  /** HR correction of a day; clearing both times and the note removes the record. */
  async updateRecord(user: AuthUser, dto: UpdateAttendanceRecordDto): Promise<TimesheetDayDto> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, companyId: user.companyId, deletedAt: null },
      select: employeeSelect,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (dto.checkOut && !dto.checkIn) {
      throw new BadRequestException('A check-out needs a check-in');
    }
    const date = parseDateOnly(dto.date);
    const offset = await this.zoneOffset(user.companyId);
    const key = { employeeId: employee.id, date };
    const note = dto.note?.trim() || null;

    if (!dto.checkIn && !note) {
      await this.prisma.attendanceRecord.deleteMany({ where: key });
    } else {
      const checkInMinutes = dto.checkIn ? parseClock(dto.checkIn) : null;
      let checkOutMinutes = dto.checkOut ? parseClock(dto.checkOut) : null;
      if (
        checkInMinutes !== null &&
        checkOutMinutes !== null &&
        checkOutMinutes <= checkInMinutes
      ) {
        checkOutMinutes += 24 * 60;
      }
      const data = {
        checkIn: checkInMinutes === null ? null : instantOf(date, checkInMinutes, offset),
        checkOut: checkOutMinutes === null ? null : instantOf(date, checkOutMinutes, offset),
        note,
        source: AttendanceSource.MANUAL,
        updatedById: user.id,
      };
      await this.prisma.attendanceRecord.upsert({
        where: { employeeId_date: key },
        create: { companyId: user.companyId, ...key, ...data },
        update: data,
      });
    }
    const [row] = await this.buildRows(user.companyId, [employee], date, date, offset);
    return row.days[0];
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async buildRows(
    companyId: string,
    employees: EmployeeRow[],
    from: Date,
    to: Date,
    offset: number,
  ): Promise<TimesheetRowDto[]> {
    const employeeIds = employees.map((employee) => employee.id);
    const range = { gte: from, lte: to };
    const [assignments, records, holidays, leaves] = await Promise.all([
      this.prisma.shiftAssignment.findMany({
        where: { companyId, employeeId: { in: employeeIds }, date: range },
        include: { shift: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { companyId, employeeId: { in: employeeIds }, date: range },
      }),
      this.prisma.holiday.findMany({ where: { companyId, date: range }, select: { date: true } }),
      this.prisma.leaveRequest.findMany({
        where: {
          companyId,
          employeeId: { in: employeeIds },
          status: LeaveRequestStatus.APPROVED,
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: { employeeId: true, startDate: true, endDate: true },
      }),
    ]);

    const keyOf = (employeeId: string, date: Date) => `${employeeId}|${toDateOnly(date)}`;
    const planned = new Map(
      assignments.map((entry) => [keyOf(entry.employeeId, entry.date), entry]),
    );
    const recorded = new Map(
      records.map((record) => [keyOf(record.employeeId, record.date), record]),
    );
    const holidaySet = new Set(holidays.map((holiday) => toDateOnly(holiday.date)));
    const now = new Date();
    const dates = datesBetween(from, to);

    return employees.map((employee) => {
      const totals = emptyTotals();
      const days = dates.map((date): TimesheetDayDto => {
        const key = keyOf(employee.id, date);
        const employed =
          date >= employee.hireDate &&
          (!employee.terminationDate || date <= employee.terminationDate);
        const shift = employed ? this.resolveShift(date, planned.get(key)) : null;
        const record = recorded.get(key);
        const onLeave = leaves.some(
          (leave) =>
            leave.employeeId === employee.id && leave.startDate <= date && date <= leave.endDate,
        );
        const holiday = employed && holidaySet.has(toDateOnly(date));
        const checkIn = record?.checkIn ? minutesSinceWorkDate(record.checkIn, date, offset) : null;
        const checkOut = record?.checkOut
          ? minutesSinceWorkDate(record.checkOut, date, offset)
          : null;
        const result = evaluateDay({
          shift,
          holiday,
          leave: employed && onLeave,
          checkIn,
          checkOut,
          now: minutesSinceWorkDate(now, date, offset),
        });

        if (result.plannedMinutes > 0) totals.plannedDays += 1;
        if (['PRESENT', 'LATE', 'INCOMPLETE'].includes(result.status)) totals.presentDays += 1;
        if (result.lateMinutes > 0) totals.lateDays += 1;
        if (result.status === 'ABSENT') totals.absentDays += 1;
        if (result.status === 'LEAVE') totals.leaveDays += 1;
        totals.plannedMinutes += result.plannedMinutes;
        totals.workedMinutes += result.workedMinutes;
        totals.lateMinutes += result.lateMinutes;
        totals.overtimeMinutes += result.overtimeMinutes;

        const window = shift ? shiftWindow(shift) : null;
        return {
          date: toDateOnly(date),
          ...result,
          shiftCode: shift?.code ?? null,
          shiftColor: shift?.color ?? null,
          plannedStart: window ? formatClock(window.start) : null,
          plannedEnd: window ? formatClock(window.end) : null,
          checkIn: checkIn === null ? null : formatClock(checkIn),
          checkOut: checkOut === null ? null : formatClock(checkOut),
          source: record?.source ?? null,
          note: record?.note ?? null,
        };
      });
      return {
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        departmentName: employee.department?.name ?? null,
        days,
        totals,
      };
    });
  }

  /** Planned shift of a day: an explicit plan entry, else the default weekday schedule. */
  private resolveShift(
    date: Date,
    entry: { shift: Shift | null } | undefined,
  ): ResolvedShift | null {
    if (entry) return entry.shift ? { ...entry.shift, color: entry.shift.color } : null;
    const weekday = date.getUTCDay();
    return weekday === 0 || weekday === 6 ? null : { ...DEFAULT_SHIFT, color: null };
  }

  private findEmployees(
    companyId: string,
    from: Date,
    to: Date,
    departmentId?: string,
  ): Promise<EmployeeRow[]> {
    return this.prisma.employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        departmentId,
        hireDate: { lte: to },
        OR: [{ terminationDate: null }, { terminationDate: { gte: from } }],
      },
      select: employeeSelect,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  private async ownEmployee(user: AuthUser): Promise<EmployeeRow> {
    const employee = await this.prisma.employee.findFirst({
      where: { companyId: user.companyId, userId: user.id, deletedAt: null },
      select: employeeSelect,
    });
    if (!employee) throw new NotFoundException('No employee record is linked to your account');
    return employee;
  }

  /** Latest check-in without a check-out from today or yesterday (night shifts). */
  private findOpenRecord(employeeId: string, today: Date) {
    return this.prisma.attendanceRecord.findFirst({
      where: {
        employeeId,
        checkIn: { not: null },
        checkOut: null,
        date: { gte: new Date(today.getTime() - DAY_MS), lte: today },
      },
      orderBy: { date: 'desc' },
    });
  }

  private async zoneOffset(companyId: string): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { companyId_key: { companyId, key: 'general' } },
    });
    const value = setting?.value as { timezone?: unknown } | null;
    const timeZone = typeof value?.timezone === 'string' ? value.timezone : DEFAULT_TIME_ZONE;
    try {
      return zoneOffsetMinutes(timeZone, new Date());
    } catch {
      return zoneOffsetMinutes(DEFAULT_TIME_ZONE, new Date());
    }
  }

  private localToday(offset: number): Date {
    return parseDateOnly(new Date(Date.now() + offset * 60_000).toISOString());
  }

  private assertShiftTimes(startTime: string, endTime: string, breakMinutes: number) {
    if (startTime === endTime) throw new BadRequestException('Shift start and end must differ');
    const { start, end } = shiftWindow({ code: null, startTime, endTime, breakMinutes });
    if (breakMinutes >= end - start) {
      throw new BadRequestException('The break must be shorter than the shift');
    }
  }

  private mapUniqueError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('A shift with this code already exists');
    }
    return error;
  }
}
