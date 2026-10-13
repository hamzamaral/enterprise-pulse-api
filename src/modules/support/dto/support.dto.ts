import { ApiProperty, PartialType } from '@nestjs/swagger';
import { TicketEventType, TicketPriority, TicketStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { SLA_STATES, type SlaState } from '../support-math';

// ---------- Categories ----------

export class CreateTicketCategoryDto {
  @IsString()
  @Length(2, 100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  /** New tickets of the category are assigned to this support agent. */
  @IsOptional()
  @IsUUID()
  defaultAssigneeId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class UpdateTicketCategoryDto extends PartialType(CreateTicketCategoryDto) {}

export class TicketCategoryDto {
  id: string;
  name: string;
  description: string | null;
  defaultAssigneeId: string | null;
  defaultAssigneeName: string | null;
  isActive: boolean;
  sortOrder: number;
  ticketCount: number;
  /** Open, in progress or waiting tickets. */
  activeCount: number;
}

// ---------- SLA ----------

export class TicketSlaPolicyDto {
  @IsEnum(TicketPriority)
  @ApiProperty({ enum: TicketPriority, enumName: 'TicketPriority' })
  priority: TicketPriority;

  @IsInt()
  @Min(1)
  @Max(720)
  firstResponseHours: number;

  @IsInt()
  @Min(1)
  @Max(2160)
  resolutionHours: number;
}

export class UpdateTicketSlaPoliciesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => TicketSlaPolicyDto)
  policies: TicketSlaPolicyDto[];
}

// ---------- Tickets ----------

export class CreateTicketDto {
  @IsString()
  @Length(3, 200)
  subject: string;

  @IsString()
  @Length(3, 10000)
  description: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsEnum(TicketPriority)
  @ApiProperty({ enum: TicketPriority, enumName: 'TicketPriority', required: false })
  priority?: TicketPriority;

  /** File on behalf of another user; needs `support:create`. */
  @IsOptional()
  @IsUUID()
  requesterId?: string;
}

export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  @Length(3, 200)
  subject?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  /** Recomputes the SLA due dates from the creation time. */
  @IsOptional()
  @IsEnum(TicketPriority)
  @ApiProperty({ enum: TicketPriority, enumName: 'TicketPriority', required: false })
  priority?: TicketPriority;

  /** null = unassigned. */
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}

export class ChangeTicketStatusDto {
  @IsEnum(TicketStatus)
  @ApiProperty({ enum: TicketStatus, enumName: 'TicketStatus' })
  status: TicketStatus;

  /** Posted as a public reply, e.g. the solution or the question for the requester. */
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  comment?: string;
}

export class AddTicketCommentDto {
  @IsString()
  @Length(1, 10000)
  body: string;

  /** Visible to support agents only. */
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}

export class CloseTicketDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class RateTicketDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class ReopenTicketDto {
  /** Why the solution did not work. */
  @IsString()
  @Length(3, 10000)
  comment: string;
}

export const ASSIGNEE_FILTERS = ['me', 'unassigned'] as const;

export class TicketQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  @ApiProperty({ enum: TicketStatus, enumName: 'TicketStatus', required: false })
  status?: TicketStatus;

  /** Open, in progress or waiting tickets; ignored when `status` is set. */
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';

  @IsOptional()
  @IsEnum(TicketPriority)
  @ApiProperty({ enum: TicketPriority, enumName: 'TicketPriority', required: false })
  priority?: TicketPriority;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** `me`, `unassigned` or a user id. */
  @IsOptional()
  @IsString()
  assignee?: string;

  /** Active tickets past their first response or resolution target. */
  @IsOptional()
  @IsIn(['true', 'false'])
  overdue?: 'true' | 'false';
}

export class MyTicketQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}

export class TicketDto {
  id: string;
  number: string;
  subject: string;
  @ApiProperty({ enum: TicketStatus, enumName: 'TicketStatus' })
  status: TicketStatus;
  @ApiProperty({ enum: TicketPriority, enumName: 'TicketPriority' })
  priority: TicketPriority;
  categoryId: string | null;
  categoryName: string | null;
  requesterId: string;
  requesterName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  @ApiProperty({ enum: SLA_STATES, enumName: 'SlaState' })
  responseSla: SlaState;
  @ApiProperty({ enum: SLA_STATES, enumName: 'SlaState' })
  resolutionSla: SlaState;
  /** Public replies. */
  commentCount: number;
  satisfactionRating: number | null;
  createdAt: string;
  updatedAt: string;
}

export class TicketCommentDto {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  isInternal: boolean;
  /** Written by the requester rather than the support team. */
  fromRequester: boolean;
  createdAt: string;
}

export class TicketEventDto {
  id: string;
  @ApiProperty({ enum: TicketEventType, enumName: 'TicketEventType' })
  type: TicketEventType;
  actorName: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

export class TicketAttachmentDto {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedByName: string | null;
  createdAt: string;
  canDelete: boolean;
}

export class TicketDetailDto extends TicketDto {
  description: string;
  requesterEmail: string;
  pausedAt: string | null;
  pausedMinutes: number;
  satisfactionComment: string | null;
  comments: TicketCommentDto[];
  events: TicketEventDto[];
  attachments: TicketAttachmentDto[];
  isRequester: boolean;
  /** Assign, change status, priority and category, write internal notes. */
  canManage: boolean;
  canComment: boolean;
  canAttach: boolean;
  /** The requester may close the ticket (and rate it). */
  canClose: boolean;
  canReopen: boolean;
  canRate: boolean;
  canDelete: boolean;
  /** Status changes available to the agent. */
  @ApiProperty({ enum: TicketStatus, enumName: 'TicketStatus', isArray: true })
  nextStatuses: TicketStatus[];
}

export class SupportAgentDto {
  id: string;
  name: string;
  email: string;
  activeCount: number;
}

export class TicketPriorityStatDto {
  @ApiProperty({ enum: TicketPriority, enumName: 'TicketPriority' })
  priority: TicketPriority;
  active: number;
  overdue: number;
}

export class TicketCategoryStatDto {
  categoryId: string | null;
  categoryName: string | null;
  active: number;
  /** Created in the last 30 days. */
  recent: number;
}

export class TicketAgentStatDto {
  userId: string;
  name: string;
  active: number;
  overdue: number;
  /** Resolved in the last 30 days. */
  resolved: number;
}

export class TicketTrendPointDto {
  /** YYYY-MM-DD */
  date: string;
  created: number;
  resolved: number;
}

export class SupportSummaryDto {
  activeCount: number;
  unassignedCount: number;
  myActiveCount: number;
  overdueCount: number;
  atRiskCount: number;
  waitingCount: number;
  /** Last 30 days. */
  createdCount: number;
  resolvedCount: number;
  averageFirstResponseHours: number | null;
  averageResolutionHours: number | null;
  /** Share of tickets resolved in the last 30 days within the resolution target. */
  slaComplianceRate: number | null;
  /** Average satisfaction rating of the last 90 days. */
  satisfactionAverage: string | null;
  satisfactionCount: number;
  byPriority: TicketPriorityStatDto[];
  byCategory: TicketCategoryStatDto[];
  byAgent: TicketAgentStatDto[];
  /** Last 14 days. */
  trend: TicketTrendPointDto[];
}
