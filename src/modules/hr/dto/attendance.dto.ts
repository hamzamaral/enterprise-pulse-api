import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AttendanceSource } from '@prisma/client';
import type { DayStatus } from '../timesheet';

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_STATUSES: DayStatus[] = [
  'PRESENT',
  'LATE',
  'ABSENT',
  'INCOMPLETE',
  'LEAVE',
  'HOLIDAY',
  'OFF',
  'UPCOMING',
];

export class CreateShiftDto {
  @Matches(/^[A-Z0-9-]{2,20}$/)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({ example: '09:00' })
  @Matches(CLOCK)
  startTime: string;

  /** An end before the start means the shift ends on the next day. */
  @ApiProperty({ example: '18:00' })
  @Matches(CLOCK)
  endTime: string;

  @IsInt()
  @Min(0)
  @Max(240)
  breakMinutes: number;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class UpdateShiftDto extends PartialType(CreateShiftDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ShiftDto {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  /** Working minutes excluding the break. */
  plannedMinutes: number;
  color: string;
  isActive: boolean;
}

export class ShiftPlanQueryDto {
  @IsDateString({ strict: true })
  from: string;

  /** Inclusive; at most 31 days after `from`. */
  @IsDateString({ strict: true })
  to: string;

  @IsOptional()
  @IsUUID('4')
  departmentId?: string;
}

export class PlanEmployeeDto {
  id: string;
  employeeNo: string;
  name: string;
  departmentName: string | null;
}

export class ShiftPlanEntryDto {
  employeeId: string;

  @ApiProperty({ example: '2026-10-12' })
  date: string;

  /** Null marks a planned day off. */
  shiftId: string | null;
}

export class ShiftPlanDto {
  from: string;
  to: string;
  employees: PlanEmployeeDto[];
  /** Only explicit entries; other days follow the default weekday schedule. */
  entries: ShiftPlanEntryDto[];
}

export class ShiftPlanChangeDto {
  @IsUUID('4')
  employeeId: string;

  @IsDateString({ strict: true })
  date: string;

  /** Shift to work; null plans a day off. Ignored when `useDefault` is set. */
  @ApiProperty({ type: String, nullable: true, required: false })
  @IsOptional()
  @IsUUID('4')
  shiftId?: string | null;

  /** Removes the entry so the default schedule applies again. */
  @IsOptional()
  @IsBoolean()
  useDefault?: boolean;
}

export class UpdateShiftPlanDto {
  @ValidateNested({ each: true })
  @Type(() => ShiftPlanChangeDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  entries: ShiftPlanChangeDto[];
}

export class UpdateShiftPlanResultDto {
  updated: number;
}

export class TimesheetQueryDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month: string;

  @IsOptional()
  @IsUUID('4')
  departmentId?: string;
}

export class MyAttendanceQueryDto {
  @ApiProperty({ example: '2026-10', required: false })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}

export class TimesheetDayDto {
  @ApiProperty({ example: '2026-10-12' })
  date: string;

  @ApiProperty({ enum: DAY_STATUSES, enumName: 'AttendanceDayStatus' })
  status: DayStatus;

  /** Null for the default schedule or a day off. */
  shiftCode: string | null;
  shiftColor: string | null;
  /** Planned local times ("HH:mm"), null on days off. */
  plannedStart: string | null;
  plannedEnd: string | null;
  /** Actual local times ("HH:mm"). */
  checkIn: string | null;
  checkOut: string | null;
  plannedMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;

  @ApiProperty({ enum: AttendanceSource, enumName: 'AttendanceSource', nullable: true })
  source: AttendanceSource | null;

  note: string | null;
}

export class TimesheetTotalsDto {
  plannedDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  leaveDays: number;
  plannedMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
}

export class TimesheetRowDto {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentName: string | null;
  days: TimesheetDayDto[];
  totals: TimesheetTotalsDto;
}

export class TimesheetDto {
  month: string;
  /** Dates of the month ("YYYY-MM-DD"). */
  days: string[];
  /** Today's date in the company time zone. */
  today: string;
  rows: TimesheetRowDto[];
}

export class MyAttendanceDto {
  today: TimesheetDayDto;
  canCheckIn: boolean;
  canCheckOut: boolean;
  row: TimesheetRowDto;
}

export class UpdateAttendanceRecordDto {
  @IsUUID('4')
  employeeId: string;

  @IsDateString({ strict: true })
  date: string;

  /** Local time "HH:mm"; clearing both times removes the record. */
  @ApiProperty({ type: String, nullable: true, example: '09:00' })
  @IsOptional()
  @Matches(CLOCK)
  checkIn: string | null;

  /** A time before the check-in is read as the next day (night shifts). */
  @ApiProperty({ type: String, nullable: true, example: '18:00' })
  @IsOptional()
  @Matches(CLOCK)
  checkOut: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
