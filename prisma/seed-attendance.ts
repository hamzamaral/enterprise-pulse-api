import { AttendanceSource, LeaveRequestStatus, type PrismaClient } from '@prisma/client';
import { parseDateOnly, toDateOnly } from '../src/common/dates/date-only';
import {
  DEFAULT_SHIFT,
  instantOf,
  shiftWindow,
  type ShiftTimes,
} from '../src/modules/hr/timesheet';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Europe/Istanbul has no daylight saving time. */
const OFFSET_MINUTES = 180;

const SHIFTS: [
  code: string,
  name: string,
  start: string,
  end: string,
  breakMin: number,
  color: string,
][] = [
  ['GND', 'Gündüz', '09:00', '18:00', 60, '#6366f1'],
  ['SBH', 'Sabah', '07:00', '15:00', 30, '#0ea5e9'],
  ['AKS', 'Akşam', '15:00', '23:00', 30, '#f59e0b'],
  ['GCE', 'Gece', '23:00', '07:00', 30, '#64748b'],
];

/** Deterministic pseudo-random number in [0, 100) so re-seeding yields the same data. */
function noise(a: number, b: number): number {
  return Math.abs(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 100;
}

/**
 * Shift definitions, a morning/evening rotation for the operations team and attendance records
 * from the start of the previous month until yesterday (some late arrivals, absences and overtime).
 */
export async function seedAttendance(prisma: PrismaClient, companyId: string) {
  const shifts = new Map<string, ShiftTimes & { id: string }>();
  for (const [code, name, startTime, endTime, breakMinutes, color] of SHIFTS) {
    const row = await prisma.shift.upsert({
      where: { companyId_code: { companyId, code } },
      create: { companyId, code, name, startTime, endTime, breakMinutes, color },
      update: {},
    });
    shifts.set(code, row);
  }
  if (await prisma.attendanceRecord.count({ where: { companyId } })) return;

  const now = new Date();
  const today = parseDateOnly(new Date(now.getTime() + OFFSET_MINUTES * 60_000).toISOString());
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const planEnd = new Date(today.getTime() + 13 * DAY_MS);

  const employees = await prisma.employee.findMany({
    where: { companyId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, hireDate: true, department: { select: { code: true } } },
    orderBy: { employeeNo: 'asc' },
  });
  const [holidays, leaves] = await Promise.all([
    prisma.holiday.findMany({ where: { companyId, date: { gte: from, lte: today } } }),
    prisma.leaveRequest.findMany({
      where: { companyId, status: LeaveRequestStatus.APPROVED, endDate: { gte: from } },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
  ]);
  const holidaySet = new Set(holidays.map((holiday) => toDateOnly(holiday.date)));

  const plan: { companyId: string; employeeId: string; date: Date; shiftId: string }[] = [];
  const records: {
    companyId: string;
    employeeId: string;
    date: Date;
    checkIn: Date;
    checkOut: Date;
    source: AttendanceSource;
  }[] = [];

  employees.forEach((employee, employeeIndex) => {
    const rotates = employee.department?.code === 'OPS';
    for (let time = from.getTime(); time <= planEnd.getTime(); time += DAY_MS) {
      const date = new Date(time);
      const weekday = date.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;

      let shift: ShiftTimes = DEFAULT_SHIFT;
      if (rotates) {
        const week = Math.floor((time / DAY_MS + 3) / 7);
        const code = (week + employeeIndex) % 2 === 0 ? 'SBH' : 'AKS';
        const planned = shifts.get(code)!;
        plan.push({ companyId, employeeId: employee.id, date, shiftId: planned.id });
        shift = planned;
      }

      if (date >= today || date < employee.hireDate || holidaySet.has(toDateOnly(date))) continue;
      const onLeave = leaves.some(
        (leave) =>
          leave.employeeId === employee.id && leave.startDate <= date && date <= leave.endDate,
      );
      if (onLeave) continue;

      const roll = noise(employeeIndex + 1, time / DAY_MS);
      if (roll < 3) continue;
      const { start, end } = shiftWindow(shift);
      const checkIn = roll < 13 ? start + 8 + Math.round(roll * 2) : start - Math.round(roll % 15);
      const checkOut = roll > 85 ? end + 45 + Math.round(roll % 60) : end + Math.round(roll % 12);
      records.push({
        companyId,
        employeeId: employee.id,
        date,
        checkIn: instantOf(date, checkIn, OFFSET_MINUTES),
        checkOut: instantOf(date, checkOut, OFFSET_MINUTES),
        source: AttendanceSource.SELF,
      });
    }
  });

  await prisma.shiftAssignment.createMany({ data: plan, skipDuplicates: true });
  await prisma.attendanceRecord.createMany({ data: records, skipDuplicates: true });
}
