import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  ContractBillingCycle,
  ContractEventType,
  ContractFlow,
  ContractParty,
  ContractStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
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
import { CONTRACT_STATES, type ContractState } from '../contract-math';

// ---------- Types ----------

export class CreateContractTypeDto {
  @IsString()
  @Length(2, 100)
  name: string;

  /** Cannot change once the type has contracts. */
  @IsEnum(ContractParty)
  @ApiProperty({ enum: ContractParty, enumName: 'ContractParty' })
  party: ContractParty;

  @IsOptional()
  @IsEnum(ContractFlow)
  @ApiProperty({ enum: ContractFlow, enumName: 'ContractFlow', required: false })
  flow?: ContractFlow;

  /** Suggested term for new contracts and renewals; null = open-ended. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  defaultTermMonths?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  defaultNoticeDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class UpdateContractTypeDto extends PartialType(CreateContractTypeDto) {}

export class ContractTypeDto {
  id: string;
  name: string;
  @ApiProperty({ enum: ContractParty, enumName: 'ContractParty' })
  party: ContractParty;
  @ApiProperty({ enum: ContractFlow, enumName: 'ContractFlow' })
  flow: ContractFlow;
  defaultTermMonths: number | null;
  defaultNoticeDays: number;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  contractCount: number;
  activeCount: number;
}

// ---------- Contracts ----------

export class CreateContractDto {
  @IsString()
  @Length(3, 200)
  title: string;

  @IsUUID()
  typeId: string;

  /** Required for partner contract types. */
  @IsOptional()
  @IsUUID()
  partnerId?: string | null;

  /** Required for employee contract types. */
  @IsOptional()
  @IsUUID()
  employeeId?: string | null;

  /** Responsible user, defaults to the creator; must hold `contracts:read`. */
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsDateString({ strict: true })
  startDate: string;

  /** Last day of the term; null = open-ended. */
  @IsOptional()
  @IsDateString({ strict: true })
  endDate?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  signedDate?: string | null;

  /** Amount per billing cycle. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;

  @IsOptional()
  @IsEnum(ContractBillingCycle)
  @ApiProperty({ enum: ContractBillingCycle, enumName: 'ContractBillingCycle', required: false })
  billingCycle?: ContractBillingCycle;

  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  /** Length of each automatic renewal; required with `autoRenew`. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  renewalMonths?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  noticeDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  reminderDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;
}

/** The party cannot change; dates only while the contract is a draft. */
export class UpdateContractDto extends PartialType(
  OmitType(CreateContractDto, ['partnerId', 'employeeId'] as const),
) {}

export class ContractQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ContractStatus)
  @ApiProperty({ enum: ContractStatus, enumName: 'ContractStatus', required: false })
  status?: ContractStatus;

  /** Active contracts inside their reminder window. */
  @IsOptional()
  @IsIn(['true', 'false'])
  expiring?: 'true' | 'false';

  @IsOptional()
  @IsEnum(ContractParty)
  @ApiProperty({ enum: ContractParty, enumName: 'ContractParty', required: false })
  party?: ContractParty;

  @IsOptional()
  @IsUUID()
  typeId?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  /** `me` or a user id. */
  @IsOptional()
  @Matches(/^(me|[0-9a-f-]{36})$/i)
  ownerId?: string;
}

export class ActivateContractDto {
  /** Defaults to the stored signing date, otherwise today. */
  @IsOptional()
  @IsDateString({ strict: true })
  signedDate?: string;
}

export class RenewContractDto {
  /** New last day; after the current end date. */
  @IsDateString({ strict: true })
  endDate: string;

  /** New amount per billing cycle, e.g. after a price increase. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class TerminateContractDto {
  /** Last day of the contract; today or later ends it on that day. */
  @IsDateString({ strict: true })
  terminatedOn: string;

  @IsString()
  @Length(3, 1000)
  reason: string;
}

export class ContractDto {
  id: string;
  number: string;
  title: string;
  typeId: string;
  typeName: string;
  @ApiProperty({ enum: ContractFlow, enumName: 'ContractFlow' })
  flow: ContractFlow;
  @ApiProperty({ enum: ContractParty, enumName: 'ContractParty' })
  party: ContractParty;
  partnerId: string | null;
  partnerCode: string | null;
  partnerTitle: string | null;
  employeeId: string | null;
  employeeName: string | null;
  /** Partner title or employee name. */
  partyName: string;
  ownerId: string;
  ownerName: string;
  startDate: string;
  endDate: string | null;
  signedDate: string | null;
  amount: string | null;
  currencyCode: string;
  @ApiProperty({ enum: ContractBillingCycle, enumName: 'ContractBillingCycle' })
  billingCycle: ContractBillingCycle;
  /** Yearly value; one-time amounts spread over the term. */
  annualValue: string | null;
  autoRenew: boolean;
  renewalMonths: number | null;
  noticeDays: number;
  reminderDays: number;
  /** Last day to cancel an auto-renewing contract. */
  noticeDeadline: string | null;
  @ApiProperty({ enum: ContractStatus, enumName: 'ContractStatus' })
  status: ContractStatus;
  @ApiProperty({ enum: CONTRACT_STATES, enumName: 'ContractState' })
  state: ContractState;
  /** Days until the end date; negative once passed. */
  daysLeft: number | null;
  renewalCount: number;
  terminatedOn: string | null;
  createdAt: string;
}

export class ContractEventDto {
  id: string;
  @ApiProperty({ enum: ContractEventType, enumName: 'ContractEventType' })
  type: ContractEventType;
  actorName: string | null;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  createdAt: string;
}

export class ContractAttachmentDto {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedByName: string | null;
  createdAt: string;
}

export class ContractDetailDto extends ContractDto {
  description: string | null;
  terminationReason: string | null;
  activatedAt: string | null;
  createdByName: string;
  /** End date a renewal would get by default. */
  suggestedRenewalEnd: string | null;
  events: ContractEventDto[];
  attachments: ContractAttachmentDto[];
  canEdit: boolean;
  canActivate: boolean;
  canRenew: boolean;
  canTerminate: boolean;
  canCancelTermination: boolean;
  canDelete: boolean;
}

export class ContractOwnerDto {
  id: string;
  name: string;
  email: string;
  activeCount: number;
}

// ---------- Summary ----------

export class ContractValueDto {
  currencyCode: string;
  /** Yearly value of active income contracts. */
  income: string;
  expense: string;
}

export class ContractMonthDto {
  /** YYYY-MM */
  month: string;
  /** Contracts that end in the month. */
  ending: number;
  /** Auto-renewing contracts due in the month. */
  renewing: number;
}

export class ContractTypeStatDto {
  typeId: string;
  name: string;
  activeCount: number;
}

export class ContractSummaryDto {
  activeCount: number;
  draftCount: number;
  expiringCount: number;
  terminatingCount: number;
  autoRenewCount: number;
  /** Expired or terminated in the last 90 days. */
  endedRecentlyCount: number;
  values: ContractValueDto[];
  /** The next 12 months, starting with the current one. */
  upcoming: ContractMonthDto[];
  byType: ContractTypeStatDto[];
  /** Active contracts with the closest end date or notice deadline. */
  nextActions: ContractDto[];
}

export class ContractRunResultDto {
  renewed: number;
  expired: number;
  terminated: number;
  reminded: number;
}
