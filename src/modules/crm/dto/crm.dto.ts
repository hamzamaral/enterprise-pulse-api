import { ApiProperty, PartialType, PickType } from '@nestjs/swagger';
import {
  CrmActivityType,
  LeadSource,
  LeadStatus,
  OpportunityStage,
  SalesQuoteStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const OPEN_LEAD_STATUSES = [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED];
const OPEN_STAGES = [
  OpportunityStage.PROSPECTING,
  OpportunityStage.QUALIFICATION,
  OpportunityStage.PROPOSAL,
  OpportunityStage.NEGOTIATION,
];

// ---------- Shared ----------

export class CrmMemberDto {
  id: string;
  name: string;
  email: string;
}

export class ReasonDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

// ---------- Leads ----------

export class CreateLeadDto {
  @IsString()
  @Length(2, 200)
  companyName: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactName?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsEnum(LeadSource)
  @ApiProperty({ enum: LeadSource, enumName: 'LeadSource', required: false })
  source?: LeadSource;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  estimatedValue?: number | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  /** Defaults to the current user. */
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}

export class UpdateLeadDto extends PartialType(CreateLeadDto) {
  /** Working statuses only; use disqualify / convert for the others. */
  @IsOptional()
  @IsIn(OPEN_LEAD_STATUSES)
  @ApiProperty({ enum: OPEN_LEAD_STATUSES, enumName: 'LeadStatus', required: false })
  status?: LeadStatus;
}

export class LeadQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(LeadStatus)
  @ApiProperty({ enum: LeadStatus, enumName: 'LeadStatus', required: false })
  status?: LeadStatus;

  @IsOptional()
  @IsEnum(LeadSource)
  @ApiProperty({ enum: LeadSource, enumName: 'LeadSource', required: false })
  source?: LeadSource;

  /** NEW, CONTACTED and QUALIFIED leads. */
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  /** Only leads owned by the current user. */
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false';
}

export class ConvertLeadDto {
  /** Link an existing customer instead of creating one from the lead. */
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsBoolean()
  createOpportunity: boolean;

  /** Defaults to the lead's company name. */
  @IsOptional()
  @IsString()
  @Length(2, 200)
  opportunityTitle?: string;

  /** Defaults to the lead's estimated value. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsDateString({ strict: true })
  expectedCloseDate?: string;
}

export class ConvertLeadResultDto {
  partnerId: string;
  opportunityId: string | null;
}

export class LeadDto {
  id: string;
  number: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  @ApiProperty({ enum: LeadSource, enumName: 'LeadSource' })
  source: LeadSource;
  @ApiProperty({ enum: LeadStatus, enumName: 'LeadStatus' })
  status: LeadStatus;
  estimatedValue: string | null;
  currencyCode: string;
  ownerId: string | null;
  ownerName: string | null;
  partnerId: string | null;
  partnerTitle: string | null;
  convertedAt: Date | null;
  createdAt: Date;
}

export class LeadOpportunityDto {
  id: string;
  number: string;
  title: string;
  @ApiProperty({ enum: OpportunityStage, enumName: 'OpportunityStage' })
  stage: OpportunityStage;
  amount: string;
  currencyCode: string;
}

export class LeadDetailDto extends LeadDto {
  notes: string | null;
  disqualifyReason: string | null;
  createdByName: string;
  updatedAt: Date;
  opportunities: LeadOpportunityDto[];
}

// ---------- Opportunities ----------

export class CreateOpportunityDto {
  @IsString()
  @Length(2, 200)
  title: string;

  @IsUUID()
  partnerId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  /** Defaults to the customer's currency. */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;

  @IsOptional()
  @IsIn(OPEN_STAGES)
  @ApiProperty({ enum: OPEN_STAGES, enumName: 'OpportunityStage', required: false })
  stage?: OpportunityStage;

  /** Defaults to the stage's typical probability. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsDateString({ strict: true })
  expectedCloseDate?: string | null;

  /** Defaults to the current user. */
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class UpdateOpportunityDto extends PartialType(
  PickType(CreateOpportunityDto, [
    'title',
    'amount',
    'currencyCode',
    'probability',
    'expectedCloseDate',
    'ownerId',
    'description',
  ] as const),
) {}

export class ChangeStageDto {
  @IsIn(OPEN_STAGES)
  @ApiProperty({ enum: OPEN_STAGES, enumName: 'OpportunityStage' })
  stage: OpportunityStage;
}

export class OpportunityQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(OpportunityStage)
  @ApiProperty({ enum: OpportunityStage, enumName: 'OpportunityStage', required: false })
  stage?: OpportunityStage;

  /** true = not won or lost yet; false = closed. */
  @IsOptional()
  @IsIn(['true', 'false'])
  open?: 'true' | 'false';

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  /** Only opportunities owned by the current user. */
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false';
}

export class BoardQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false';
}

export class OpportunityDto {
  id: string;
  number: string;
  title: string;
  partnerId: string;
  partnerCode: string;
  partnerTitle: string;
  @ApiProperty({ enum: OpportunityStage, enumName: 'OpportunityStage' })
  stage: OpportunityStage;
  amount: string;
  currencyCode: string;
  probability: number;
  /** amount × probability */
  weightedAmount: string;
  expectedCloseDate: string | null;
  /** Open and past the expected close date. */
  overdue: boolean;
  ownerId: string | null;
  ownerName: string | null;
  closedAt: Date | null;
  quoteCount: number;
  createdAt: Date;
}

export class OpportunityQuoteDto {
  id: string;
  number: string;
  quoteDate: string;
  @ApiProperty({ enum: SalesQuoteStatus, enumName: 'SalesQuoteStatus' })
  status: SalesQuoteStatus;
  grandTotal: string;
  currencyCode: string;
  orderId: string | null;
  orderNumber: string | null;
}

export class OpportunityDetailDto extends OpportunityDto {
  description: string | null;
  lostReason: string | null;
  leadId: string | null;
  leadNumber: string | null;
  createdByName: string;
  updatedAt: Date;
  quotes: OpportunityQuoteDto[];
}

export class BoardColumnDto {
  @ApiProperty({ enum: OpportunityStage, enumName: 'OpportunityStage' })
  stage: OpportunityStage;
  count: number;
  /** Total in the company currency, at the latest rates. */
  amount: string;
  /** Shown cards; WON and LOST only cover the last 90 days. */
  items: OpportunityDto[];
}

export class BoardDto {
  currencyCode: string;
  columns: BoardColumnDto[];
}

// ---------- Activities ----------

export class CreateActivityDto {
  @IsEnum(CrmActivityType)
  @ApiProperty({ enum: CrmActivityType, enumName: 'CrmActivityType' })
  type: CrmActivityType;

  @IsString()
  @Length(2, 200)
  subject: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  /** Defaults to the current user. */
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  /** Log something that already happened. Notes are always recorded as done. */
  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class UpdateActivityDto extends PartialType(
  PickType(CreateActivityDto, ['type', 'subject', 'description', 'dueAt', 'ownerId'] as const),
) {}

export const ACTIVITY_STATES = ['open', 'overdue', 'done'] as const;
export type ActivityState = (typeof ACTIVITY_STATES)[number];

export class ActivityQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(CrmActivityType)
  @ApiProperty({ enum: CrmActivityType, enumName: 'CrmActivityType', required: false })
  type?: CrmActivityType;

  @IsOptional()
  @IsIn(ACTIVITY_STATES)
  @ApiProperty({ enum: ACTIVITY_STATES, required: false })
  state?: ActivityState;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  /** Only activities assigned to the current user. */
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false';
}

export class ActivityDto {
  id: string;
  @ApiProperty({ enum: CrmActivityType, enumName: 'CrmActivityType' })
  type: CrmActivityType;
  subject: string;
  description: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  /** Open and past its due time. */
  overdue: boolean;
  ownerId: string;
  ownerName: string;
  leadId: string | null;
  leadNumber: string | null;
  leadCompanyName: string | null;
  opportunityId: string | null;
  opportunityNumber: string | null;
  opportunityTitle: string | null;
  partnerId: string | null;
  partnerTitle: string | null;
  createdById: string;
  createdByName: string;
  createdAt: Date;
}

// ---------- Summary ----------

export class StageSummaryDto {
  @ApiProperty({ enum: OpportunityStage, enumName: 'OpportunityStage' })
  stage: OpportunityStage;
  count: number;
  amount: string;
  weighted: string;
}

export class CrmSummaryDto {
  currencyCode: string;
  openCount: number;
  pipelineAmount: string;
  weightedAmount: string;
  stages: StageSummaryDto[];
  wonThisMonth: number;
  wonAmountThisMonth: string;
  lostThisMonth: number;
  /** Won share of opportunities closed in the last 90 days; null when none were closed. */
  winRate: number | null;
  newLeads: number;
  activeLeads: number;
  myOpenActivities: number;
  myOverdueActivities: number;
  myActivitiesDueToday: number;
  /** Currencies without a stored rate; their amounts are left out of the totals. */
  unconvertedCurrencies: string[];
}
