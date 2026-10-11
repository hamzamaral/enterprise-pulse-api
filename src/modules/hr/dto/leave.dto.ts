import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LeaveRequestStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class CreateLeaveTypeDto {
  @Matches(/^[A-Z0-9-]{2,20}$/)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @IsInt()
  @Min(0)
  @Max(365)
  defaultDays: number;

  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresBalance?: boolean;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class UpdateLeaveTypeDto extends PartialType(CreateLeaveTypeDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class LeaveTypeDto {
  id: string;
  code: string;
  name: string;
  defaultDays: number;
  isPaid: boolean;
  requiresBalance: boolean;
  color: string;
  isActive: boolean;
}

export class CreateHolidayDto {
  @IsDateString({ strict: true })
  date: string;

  @IsString()
  @Length(2, 200)
  name: string;
}

export class HolidayQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class HolidayDto {
  id: string;

  @ApiProperty({ example: '2026-10-29' })
  date: string;

  name: string;
}

export class LeaveBalanceQueryDto {
  @IsOptional()
  @IsUUID('4')
  employeeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class AccrueBalancesDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}

export class AccrueResultDto {
  created: number;
}

export class UpdateLeaveBalanceDto {
  @IsInt()
  @Min(0)
  @Max(365)
  entitledDays: number;
}

export class LeaveBalanceDto {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeColor: string;
  year: number;
  entitledDays: number;
  usedDays: number;
  /** Days in pending requests, reserved until they are decided. */
  pendingDays: number;
  remainingDays: number;
}

export class CreateLeaveRequestDto {
  /** Defaults to the employee record of the current user. */
  @IsOptional()
  @IsUUID('4')
  employeeId?: string;

  @IsUUID('4')
  leaveTypeId: string;

  @IsDateString({ strict: true })
  startDate: string;

  @IsDateString({ strict: true })
  endDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class CancelLeaveRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class LeaveRequestQueryDto extends PaginationQueryDto {
  @ApiProperty({ enum: LeaveRequestStatus, enumName: 'LeaveRequestStatus', required: false })
  @IsOptional()
  @IsEnum(LeaveRequestStatus)
  status?: LeaveRequestStatus;

  @IsOptional()
  @IsUUID('4')
  employeeId?: string;

  @IsOptional()
  @IsUUID('4')
  leaveTypeId?: string;

  /** Only the current user's own requests. */
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false';
}

export class WorkingDaysQueryDto {
  @IsDateString({ strict: true })
  startDate: string;

  @IsDateString({ strict: true })
  endDate: string;
}

export class WorkingDaysDto {
  days: number;
}

export class LeaveRequestDto {
  id: string;
  number: string;
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeColor: string;

  @ApiProperty({ example: '2026-11-02' })
  startDate: string;

  @ApiProperty({ example: '2026-11-06' })
  endDate: string;

  days: number;
  reason: string | null;

  @ApiProperty({ enum: LeaveRequestStatus, enumName: 'LeaveRequestStatus' })
  status: LeaveRequestStatus;

  workflowInstanceId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  /** Whether the current user may cancel the request right now. */
  canCancel: boolean;
}
