import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  TrainingCategory,
  TrainingEnrollmentStatus,
  TrainingFormat,
  TrainingSessionStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { COMPLIANCE_STATUSES, type ComplianceStatus } from '../training-math';

// ---------- Courses ----------

export class CreateTrainingCourseDto {
  /** Short unique code, e.g. `ISG-TEMEL`. */
  @IsString()
  @Length(2, 30)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9-]*$/, { message: 'code may contain letters, digits and -' })
  code: string;

  @IsString()
  @Length(2, 200)
  title: string;

  @IsEnum(TrainingCategory)
  @ApiProperty({ enum: TrainingCategory, enumName: 'TrainingCategory' })
  category: TrainingCategory;

  @IsOptional()
  @IsEnum(TrainingFormat)
  @ApiProperty({ enum: TrainingFormat, enumName: 'TrainingFormat', required: false })
  format?: TrainingFormat;

  @IsNumber({ maxDecimalPlaces: 1 })
  @IsPositive()
  @Max(1000)
  durationHours: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  provider?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  /** Every active employee must hold a valid certificate. */
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  /** Certificates expire this many months after the session; null = never. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  validityMonths?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTrainingCourseDto extends PartialType(CreateTrainingCourseDto) {}

export class TrainingCourseQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(TrainingCategory)
  @ApiProperty({ enum: TrainingCategory, enumName: 'TrainingCategory', required: false })
  category?: TrainingCategory;

  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}

export class TrainingCourseDto {
  id: string;
  code: string;
  title: string;
  @ApiProperty({ enum: TrainingCategory, enumName: 'TrainingCategory' })
  category: TrainingCategory;
  @ApiProperty({ enum: TrainingFormat, enumName: 'TrainingFormat' })
  format: TrainingFormat;
  durationHours: string;
  provider: string | null;
  description: string | null;
  isMandatory: boolean;
  validityMonths: number | null;
  isActive: boolean;
  sessionCount: number;
  /** Planned sessions that have not started yet. */
  upcomingCount: number;
  /** People who attended any session. */
  attendedCount: number;
}

// ---------- Sessions ----------

export class CreateTrainingSessionDto {
  @IsUUID()
  courseId: string;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  instructor?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number | null;

  /** Total cost in the company currency. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number | null;

  @IsOptional()
  @IsBoolean()
  selfEnrollment?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  /** Employees enrolled right away. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  employeeIds?: string[];
}

export class UpdateTrainingSessionDto extends PartialType(
  OmitType(CreateTrainingSessionDto, ['courseId', 'employeeIds'] as const),
) {}

export class TrainingSessionQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TrainingSessionStatus)
  @ApiProperty({ enum: TrainingSessionStatus, enumName: 'TrainingSessionStatus', required: false })
  status?: TrainingSessionStatus;

  @IsOptional()
  @IsUUID()
  courseId?: string;

  /** Planned sessions that have not ended yet. */
  @IsOptional()
  @IsIn(['true', 'false'])
  upcoming?: 'true' | 'false';
}

export class TrainingSessionDto {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  @ApiProperty({ enum: TrainingCategory, enumName: 'TrainingCategory' })
  category: TrainingCategory;
  @ApiProperty({ enum: TrainingFormat, enumName: 'TrainingFormat' })
  format: TrainingFormat;
  durationHours: string;
  isMandatory: boolean;
  startsAt: string;
  endsAt: string;
  location: string | null;
  instructor: string | null;
  capacity: number | null;
  cost: string | null;
  currencyCode: string;
  selfEnrollment: boolean;
  @ApiProperty({ enum: TrainingSessionStatus, enumName: 'TrainingSessionStatus' })
  status: TrainingSessionStatus;
  /** Enrollments that are not cancelled. */
  enrolledCount: number;
  attendedCount: number;
  seatsLeft: number | null;
  averageFeedback: string | null;
  feedbackCount: number;
}

export class TrainingEnrollmentDto {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentName: string | null;
  positionName: string | null;
  @ApiProperty({ enum: TrainingEnrollmentStatus, enumName: 'TrainingEnrollmentStatus' })
  status: TrainingEnrollmentStatus;
  score: number | null;
  certificateExpiresAt: string | null;
  feedbackRating: number | null;
  feedbackComment: string | null;
  enrolledAt: string;
}

export class TrainingSessionDetailDto extends TrainingSessionDto {
  notes: string | null;
  validityMonths: number | null;
  description: string | null;
  provider: string | null;
  completedAt: string | null;
  createdByName: string;
  enrollments: TrainingEnrollmentDto[];
  canEdit: boolean;
  /** The session has started and attendance can be recorded. */
  canComplete: boolean;
  canCancel: boolean;
  canDelete: boolean;
}

export class EnrollEmployeesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  employeeIds: string[];
}

export class AttendanceInputDto {
  @IsUUID()
  enrollmentId: string;

  @IsBoolean()
  attended: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number | null;
}

/** Enrollments missing from the list are recorded as no-shows. */
export class CompleteTrainingSessionDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => AttendanceInputDto)
  attendance: AttendanceInputDto[];
}

export class TrainingFeedbackDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}

// ---------- Self-service ----------

export class MyTrainingDto {
  /** Enrollment id. */
  id: string;
  sessionId: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  @ApiProperty({ enum: TrainingCategory, enumName: 'TrainingCategory' })
  category: TrainingCategory;
  @ApiProperty({ enum: TrainingFormat, enumName: 'TrainingFormat' })
  format: TrainingFormat;
  durationHours: string;
  isMandatory: boolean;
  startsAt: string;
  endsAt: string;
  location: string | null;
  instructor: string | null;
  @ApiProperty({ enum: TrainingSessionStatus, enumName: 'TrainingSessionStatus' })
  sessionStatus: TrainingSessionStatus;
  @ApiProperty({ enum: TrainingEnrollmentStatus, enumName: 'TrainingEnrollmentStatus' })
  status: TrainingEnrollmentStatus;
  score: number | null;
  certificateExpiresAt: string | null;
  feedbackRating: number | null;
  feedbackComment: string | null;
  canGiveFeedback: boolean;
  /** Self-enrolled seat of a session that has not started. */
  canCancel: boolean;
}

export class OpenTrainingSessionDto extends TrainingSessionDto {
  description: string | null;
  /** The caller already holds a seat. */
  enrolled: boolean;
}

export class ComplianceItemDto {
  courseId: string;
  @ApiProperty({ enum: COMPLIANCE_STATUSES, enumName: 'ComplianceStatus' })
  status: ComplianceStatus;
  completedAt: string | null;
  expiresAt: string | null;
  /** Start of an upcoming session the employee is enrolled in. */
  scheduledAt: string | null;
}

export class ComplianceCourseDto {
  courseId: string;
  code: string;
  title: string;
  validityMonths: number | null;
  valid: number;
  expiring: number;
  expired: number;
  missing: number;
}

export class MyTrainingOverviewDto {
  trainings: MyTrainingDto[];
  mandatory: ComplianceItemDto[];
  /** Mandatory courses, in the order of `mandatory`. */
  courses: ComplianceCourseDto[];
  hoursThisYear: string;
}

export class ComplianceEmployeeDto {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentName: string | null;
  /** One entry per course of `courses`, in the same order. */
  items: ComplianceItemDto[];
}

export class ComplianceReportDto {
  courses: ComplianceCourseDto[];
  employees: ComplianceEmployeeDto[];
  /** Percentage of valid or expiring certificates; null without mandatory courses. */
  rate: number | null;
}

export class TrainingCategoryStatDto {
  @ApiProperty({ enum: TrainingCategory, enumName: 'TrainingCategory' })
  category: TrainingCategory;
  hours: string;
  participants: number;
}

export class TrainingSummaryDto {
  upcomingSessions: number;
  /** Seats taken in upcoming sessions. */
  upcomingSeats: number;
  hoursThisYear: string;
  participantsThisYear: number;
  costThisYear: string;
  currencyCode: string;
  averageFeedback: string | null;
  complianceRate: number | null;
  expiringCount: number;
  /** Expired or missing mandatory certificates. */
  overdueCount: number;
  byCategory: TrainingCategoryStatDto[];
}
