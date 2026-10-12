import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  ExpenseReportStatus,
  ProjectMemberRole,
  ProjectStatus,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PaginatedResponseDto,
  PaginationQueryDto,
} from '../../../common/pagination/pagination.dto';

// ---------- Projects ----------

export class CreateProjectDto {
  @IsString()
  @Length(2, 200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  /** Customer (business partner) the project is delivered for. */
  @IsOptional()
  @IsUUID()
  partnerId?: string | null;

  /** Employee running the project; becomes a LEAD member. */
  @IsUUID()
  managerId: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  @ApiProperty({ enum: ProjectStatus, enumName: 'ProjectStatus', required: false })
  status?: ProjectStatus;

  @IsOptional()
  @IsDateString({ strict: true })
  startDate?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  dueDate?: string | null;

  /** Cost budget (labour + expenses) in the company currency. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  budgetAmount?: number | null;
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}

export class ProjectQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ProjectStatus)
  @ApiProperty({ enum: ProjectStatus, enumName: 'ProjectStatus', required: false })
  status?: ProjectStatus;

  /** Only open projects (planned, active, on hold). */
  @IsOptional()
  @IsIn(['true', 'false'])
  open?: 'true' | 'false';

  /** Only projects the current user manages or is a member of, even with `projects:read`. */
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false';

  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class ProjectDto {
  id: string;
  number: string;
  name: string;
  @ApiProperty({ enum: ProjectStatus, enumName: 'ProjectStatus' })
  status: ProjectStatus;
  partnerId: string | null;
  partnerCode: string | null;
  partnerTitle: string | null;
  managerId: string;
  managerName: string;
  startDate: string | null;
  dueDate: string | null;
  /** Company currency; budgets and costs are null for members who don't run the project. */
  budgetAmount: string | null;
  currencyCode: string;
  memberCount: number;
  taskCount: number;
  doneTaskCount: number;
  /** Done tasks, 0–100. */
  progress: number;
  loggedHours: string;
  laborCost: string | null;
  expenseCost: string | null;
  totalCost: string | null;
  /** Total cost as a percentage of the budget; null without a budget. */
  budgetUsage: number | null;
  overdue: boolean;
}

export class ProjectMemberDto {
  id: string;
  employeeId: string;
  employeeName: string;
  positionName: string | null;
  userId: string | null;
  @ApiProperty({ enum: ProjectMemberRole, enumName: 'ProjectMemberRole' })
  role: ProjectMemberRole;
  hourlyCost: string | null;
  loggedHours: string;
}

export class ProjectTaskCountsDto {
  TODO: number;
  IN_PROGRESS: number;
  REVIEW: number;
  DONE: number;
}

export class ProjectDetailDto extends ProjectDto {
  description: string | null;
  completedAt: string | null;
  createdByName: string;
  createdAt: string;
  members: ProjectMemberDto[];
  taskCounts: ProjectTaskCountsDto;
  overdueTaskCount: number;
  estimatedHours: string;
  /** Edit the project, its members and delete tasks. */
  canManage: boolean;
  /** Budget, costs, hourly rates, everybody's time and charged expenses. */
  canSeeCosts: boolean;
  /** Remove the project (no time logged yet). */
  canDelete: boolean;
  /** The current user is a member: works on tasks. */
  isMember: boolean;
  /** The current user is a member and the project accepts time. */
  canLogTime: boolean;
}

/** Expense report charged to the project (drafts excluded). */
export class ProjectExpenseDto {
  id: string;
  number: string;
  title: string;
  employeeName: string;
  @ApiProperty({ enum: ExpenseReportStatus, enumName: 'ExpenseReportStatus' })
  status: ExpenseReportStatus;
  totalAmount: string;
  submittedAt: string | null;
  /** Counts towards the project cost (approved or paid). */
  counted: boolean;
}

export class AddProjectMemberDto {
  @IsUUID()
  employeeId: string;

  @IsOptional()
  @IsEnum(ProjectMemberRole)
  @ApiProperty({ enum: ProjectMemberRole, enumName: 'ProjectMemberRole', required: false })
  role?: ProjectMemberRole;

  /** Cost of one hour in the company currency. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  hourlyCost?: number | null;
}

export class UpdateProjectMemberDto extends PartialType(
  OmitType(AddProjectMemberDto, ['employeeId'] as const),
) {}

export class ProjectSummaryDto {
  currencyCode: string;
  activeCount: number;
  overdueCount: number;
  overBudgetCount: number;
  myProjectCount: number;
  myOpenTaskCount: number;
  myOverdueTaskCount: number;
  /** Hours the current user logged this week (Monday–Sunday). */
  myHoursThisWeek: string;
}

// ---------- Tasks ----------

export class CreateProjectTaskDto {
  @IsString()
  @Length(2, 200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @IsEnum(ProjectTaskStatus)
  @ApiProperty({ enum: ProjectTaskStatus, enumName: 'ProjectTaskStatus', required: false })
  status?: ProjectTaskStatus;

  @IsOptional()
  @IsEnum(ProjectTaskPriority)
  @ApiProperty({ enum: ProjectTaskPriority, enumName: 'ProjectTaskPriority', required: false })
  priority?: ProjectTaskPriority;

  /** A project member. */
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  dueDate?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(10000)
  estimatedHours?: number | null;
}

export class UpdateProjectTaskDto extends PartialType(CreateProjectTaskDto) {}

export class MoveProjectTaskDto {
  @IsEnum(ProjectTaskStatus)
  @ApiProperty({ enum: ProjectTaskStatus, enumName: 'ProjectTaskStatus' })
  status: ProjectTaskStatus;

  /** 0-based position in the target column; past the end appends. */
  @IsInt()
  @Min(0)
  position: number;
}

export class ProjectTaskQueryDto {
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsEnum(ProjectTaskStatus)
  @ApiProperty({ enum: ProjectTaskStatus, enumName: 'ProjectTaskStatus', required: false })
  status?: ProjectTaskStatus;
}

export class ProjectTaskDto {
  id: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  taskNo: number;
  title: string;
  description: string | null;
  @ApiProperty({ enum: ProjectTaskStatus, enumName: 'ProjectTaskStatus' })
  status: ProjectTaskStatus;
  @ApiProperty({ enum: ProjectTaskPriority, enumName: 'ProjectTaskPriority' })
  priority: ProjectTaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  estimatedHours: string | null;
  loggedHours: string;
  sortOrder: number;
  completedAt: string | null;
  overdue: boolean;
  createdAt: string;
}

// ---------- Time ----------

export class TimeEntryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  /** Only the current user's entries. */
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false';
}

export class TimeEntryDto {
  id: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  taskId: string | null;
  taskNo: number | null;
  taskTitle: string | null;
  employeeId: string;
  employeeName: string;
  workDate: string;
  hours: string;
  description: string | null;
  /** Company currency; only shown to people who run the project. */
  costAmount: string | null;
}

export class TimeEntryPageDto extends PaginatedResponseDto(TimeEntryDto) {
  /** Hours of every entry matching the filters, not just this page. */
  totalHours: string;
}

export class TimeWeekQueryDto {
  /** Any day of the week; defaults to today. */
  @IsOptional()
  @IsDateString({ strict: true })
  date?: string;
}

export class TimeWeekRowDto {
  projectId: string;
  projectNumber: string;
  projectName: string;
  taskId: string | null;
  taskNo: number | null;
  taskTitle: string | null;
  description: string | null;
  /** Hours per day, Monday first. */
  hours: string[];
  /** The project no longer accepts time; the row is read-only. */
  locked: boolean;
}

export class TimeWeekDto {
  weekStart: string;
  days: string[];
  rows: TimeWeekRowDto[];
  dayTotals: string[];
  total: string;
}

export class TimeWeekRowInputDto {
  @IsUUID()
  projectId: string;

  @IsOptional()
  @IsUUID()
  taskId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  /** Seven values, Monday first; 0 clears the day. */
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  @Min(0, { each: true })
  @Max(24, { each: true })
  hours: number[];
}

export class SaveTimeWeekDto {
  @IsDateString({ strict: true })
  weekStart: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TimeWeekRowInputDto)
  rows: TimeWeekRowInputDto[];
}
