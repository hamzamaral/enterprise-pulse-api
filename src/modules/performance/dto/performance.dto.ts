import { ApiProperty, PartialType } from '@nestjs/swagger';
import { PerformanceReviewStatus, ReviewCycleStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// ---------- Competencies ----------

export class CreateCompetencyDto {
  @IsString()
  @Length(2, 100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class UpdateCompetencyDto extends PartialType(CreateCompetencyDto) {}

export class CompetencyDto {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  /** Cycles that rate this competency. */
  cycleCount: number;
}

// ---------- Review cycles ----------

export class CreateReviewCycleDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @IsDateString({ strict: true })
  periodStart: string;

  @IsDateString({ strict: true })
  periodEnd: string;

  @IsDateString({ strict: true })
  selfReviewDue: string;

  @IsDateString({ strict: true })
  managerReviewDue: string;

  /** Share of goals in the overall score; competencies make up the rest. */
  @IsInt()
  @Min(0)
  @Max(100)
  goalWeight: number;

  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  competencyIds: string[];
}

/** After launch only the name and the due dates can change. */
export class UpdateReviewCycleDto extends PartialType(CreateReviewCycleDto) {}

export class ReviewCycleQueryDto {
  @IsOptional()
  @IsEnum(ReviewCycleStatus)
  @ApiProperty({ enum: ReviewCycleStatus, enumName: 'ReviewCycleStatus', required: false })
  status?: ReviewCycleStatus;
}

export class ReviewCycleDto {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  selfReviewDue: string;
  managerReviewDue: string;
  goalWeight: number;
  @ApiProperty({ enum: ReviewCycleStatus, enumName: 'ReviewCycleStatus' })
  status: ReviewCycleStatus;
  launchedAt: string | null;
  closedAt: string | null;
  reviewCount: number;
  completedCount: number;
  /** Mean overall score of the completed reviews. */
  averageScore: string | null;
  createdAt: string;
}

export class ReviewStatusCountsDto {
  SELF_REVIEW: number;
  MANAGER_REVIEW: number;
  COMPLETED: number;
}

export class CycleCompetencyDto {
  id: string;
  name: string;
  description: string | null;
}

export class CycleDepartmentDto {
  departmentId: string | null;
  departmentName: string | null;
  reviewCount: number;
  completedCount: number;
  averageScore: string | null;
}

export class ReviewCycleDetailDto extends ReviewCycleDto {
  competencies: CycleCompetencyDto[];
  statusCounts: ReviewStatusCountsDto;
  /** Completed reviews per score band 1-5 (index 0 is band 1). */
  distribution: number[];
  departments: CycleDepartmentDto[];
  /** Completed reviews the employee has acknowledged. */
  acknowledgedCount: number;
  createdByName: string;
  canEdit: boolean;
  canLaunch: boolean;
  canClose: boolean;
  canDelete: boolean;
}

export class CycleReviewQueryDto {
  @IsOptional()
  @IsEnum(PerformanceReviewStatus)
  @ApiProperty({
    enum: PerformanceReviewStatus,
    enumName: 'PerformanceReviewStatus',
    required: false,
  })
  status?: PerformanceReviewStatus;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Employee name or number. */
  @IsOptional()
  @IsString()
  search?: string;
}

// ---------- Reviews ----------

export class PerformanceReviewDto {
  id: string;
  cycleId: string;
  cycleName: string;
  @ApiProperty({ enum: ReviewCycleStatus, enumName: 'ReviewCycleStatus' })
  cycleStatus: ReviewCycleStatus;
  periodStart: string;
  periodEnd: string;
  selfReviewDue: string;
  managerReviewDue: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentName: string | null;
  positionName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  @ApiProperty({ enum: PerformanceReviewStatus, enumName: 'PerformanceReviewStatus' })
  status: PerformanceReviewStatus;
  goalCount: number;
  /** Set once the review is completed. */
  overallScore: string | null;
  selfSubmittedAt: string | null;
  managerSubmittedAt: string | null;
  acknowledgedAt: string | null;
}

export class ReviewGoalDto {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  progress: number;
  /** Hidden from the reviewer until the self review is submitted. */
  selfRating: number | null;
  /** Hidden from the employee until the review is completed. */
  managerRating: number | null;
}

export class ReviewCompetencyDto {
  id: string;
  competencyId: string;
  name: string;
  description: string | null;
  selfRating: number | null;
  managerRating: number | null;
  comment: string | null;
}

export const REVIEW_VIEWERS = ['EMPLOYEE', 'REVIEWER', 'HR'] as const;
export type ReviewViewer = (typeof REVIEW_VIEWERS)[number];

export class PerformanceReviewDetailDto extends PerformanceReviewDto {
  goalWeight: number;
  selfComment: string | null;
  managerComment: string | null;
  strengths: string | null;
  improvements: string | null;
  goalScore: string | null;
  competencyScore: string | null;
  goals: ReviewGoalDto[];
  competencies: ReviewCompetencyDto[];
  /** How the caller relates to the review. */
  @ApiProperty({ enum: REVIEW_VIEWERS, enumName: 'ReviewViewer' })
  viewer: ReviewViewer;
  canEditGoals: boolean;
  canSelfReview: boolean;
  canManagerReview: boolean;
  /** Send a submitted self review back to the employee. */
  canReturn: boolean;
  canAcknowledge: boolean;
  canReopen: boolean;
}

export class CreateReviewGoalDto {
  @IsString()
  @Length(2, 200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsInt()
  @Min(1)
  @Max(100)
  weight: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;
}

export class UpdateReviewGoalDto extends PartialType(CreateReviewGoalDto) {}

export class SelfGoalInputDto {
  @IsUUID()
  id: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;
}

export class RatingInputDto {
  @IsUUID()
  id: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;
}

export class ManagerCompetencyInputDto extends RatingInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string | null;
}

/** Saves the employee's draft; `submit` hands the review to the reviewer. */
export class SelfReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  selfComment?: string | null;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SelfGoalInputDto)
  goals: SelfGoalInputDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RatingInputDto)
  competencies: RatingInputDto[];

  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

/** Saves the reviewer's draft; `submit` completes the review and computes the scores. */
export class ManagerReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  managerComment?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  strengths?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  improvements?: string | null;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RatingInputDto)
  goals: RatingInputDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ManagerCompetencyInputDto)
  competencies: ManagerCompetencyInputDto[];

  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}
