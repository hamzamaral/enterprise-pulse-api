import { ApiProperty, PartialType } from '@nestjs/swagger';
import { BudgetEventType, BudgetItemKind, BudgetSource, BudgetStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { BUDGET_DOCUMENT_TYPES, type BudgetDocumentType } from '../budget-actuals.service';
import { BUDGET_ITEM_STATES, type BudgetItemState } from '../budget-math';

// ---------- Items ----------

export class CreateBudgetItemDto {
  /** Short code shown before the name, e.g. "770" or "PAZ". */
  @Matches(/^[A-Za-z0-9._-]{1,20}$/)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  /** SALES items are income; EXPENSES, PAYROLL and PURCHASES items are expenses. */
  @IsEnum(BudgetItemKind)
  @ApiProperty({ enum: BudgetItemKind, enumName: 'BudgetItemKind' })
  kind: BudgetItemKind;

  @IsOptional()
  @IsEnum(BudgetSource)
  @ApiProperty({ enum: BudgetSource, enumName: 'BudgetSource', required: false })
  source?: BudgetSource;

  /**
   * EXPENSES: expense category ids, PURCHASES: product category ids. Empty = everything no
   * other item of the source claims (one such item per source).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  categoryIds?: string[];

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

export class UpdateBudgetItemDto extends PartialType(CreateBudgetItemDto) {}

export class BudgetCategoryDto {
  id: string;
  name: string;
}

export class BudgetItemDto {
  id: string;
  code: string;
  name: string;
  @ApiProperty({ enum: BudgetItemKind, enumName: 'BudgetItemKind' })
  kind: BudgetItemKind;
  @ApiProperty({ enum: BudgetSource, enumName: 'BudgetSource' })
  source: BudgetSource;
  categories: BudgetCategoryDto[];
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  /** Budgets that plan this item. */
  budgetCount: number;
  entryCount: number;
}

/** Categories an item of each source can claim. */
export class BudgetItemOptionsDto {
  expenseCategories: BudgetCategoryDto[];
  productCategories: BudgetCategoryDto[];
}

// ---------- Budgets ----------

export const BUDGET_BASES = ['EMPTY', 'BUDGET', 'ACTUALS'] as const;
export type BudgetBasis = (typeof BUDGET_BASES)[number];

export class CreateBudgetDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  /** Null = company-wide budget. One budget per year and department. */
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  /** Defaults to "2027 Satış Bütçesi" / "2027 Şirket Bütçesi". */
  @IsOptional()
  @IsString()
  @Length(3, 150)
  name?: string;

  /** Defaults to the department manager, otherwise the creator. */
  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  /**
   * EMPTY = no plan; BUDGET = copy the plan of `sourceBudgetId`; ACTUALS = previous year's
   * actuals of the same scope, month by month.
   */
  @IsOptional()
  @IsIn(BUDGET_BASES)
  @ApiProperty({ enum: BUDGET_BASES, enumName: 'BudgetBasis', required: false })
  basis?: BudgetBasis;

  @IsOptional()
  @IsUUID()
  sourceBudgetId?: string;

  /** Applied to the copied amounts, e.g. 25 for +25%. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-100)
  @Max(500)
  adjustPercent?: number;
}

export class UpdateBudgetDto {
  @IsOptional()
  @IsString()
  @Length(3, 150)
  name?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class BudgetPlanLineDto {
  @IsUUID()
  itemId: string;

  /** January to December, company currency. */
  @IsArray()
  @ArrayMinSize(12)
  @ArrayMaxSize(12)
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  @Min(0, { each: true })
  @Max(999_999_999_999, { each: true })
  amounts: number[];
}

export class SaveBudgetPlanDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BudgetPlanLineDto)
  lines: BudgetPlanLineDto[];
}

export class ReopenBudgetDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class BudgetListQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}

export class BudgetActualsQueryDto {
  @IsUUID()
  itemId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;
}

export class BudgetTotalsDto {
  /** January to December. */
  planned: string[];
  actual: string[];
  plannedTotal: string;
  actualTotal: string;
  /** Through the last elapsed month. */
  plannedYtd: string;
  actualYtd: string;
  /** actualYtd / plannedYtd in percent; null without a plan. */
  utilization: number | null;
}

export class BudgetRowDto extends BudgetTotalsDto {
  itemId: string;
  code: string;
  name: string;
  @ApiProperty({ enum: BudgetItemKind, enumName: 'BudgetItemKind' })
  kind: BudgetItemKind;
  @ApiProperty({ enum: BudgetSource, enumName: 'BudgetSource' })
  source: BudgetSource;
  /** actualYtd − plannedYtd. */
  variance: string;
  /** actualTotal / plannedTotal in percent; null without a plan. */
  yearUsage: number | null;
  @ApiProperty({ enum: BUDGET_ITEM_STATES, enumName: 'BudgetItemState' })
  state: BudgetItemState;
}

export class BudgetDto {
  id: string;
  year: number;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  @ApiProperty({ enum: BudgetStatus, enumName: 'BudgetStatus' })
  status: BudgetStatus;
  ownerId: string | null;
  ownerName: string | null;
  revision: number;
  approvedAt: string | null;
  incomePlanned: string;
  expensePlanned: string;
  incomePlannedYtd: string;
  incomeActualYtd: string;
  expensePlannedYtd: string;
  expenseActualYtd: string;
  expenseUtilization: number | null;
  overCount: number;
  warningCount: number;
  behindCount: number;
}

/** An item that needs attention in one of the year's budgets. */
export class BudgetAttentionDto {
  budgetId: string;
  budgetName: string;
  itemId: string;
  itemName: string;
  @ApiProperty({ enum: BudgetItemKind, enumName: 'BudgetItemKind' })
  kind: BudgetItemKind;
  @ApiProperty({ enum: BUDGET_ITEM_STATES, enumName: 'BudgetItemState' })
  state: BudgetItemState;
  plannedYtd: string;
  actualYtd: string;
  utilization: number | null;
}

export class BudgetListDto {
  year: number;
  currencyCode: string;
  /** Months of the year that have started: 0 for a future year, 12 for a past one. */
  elapsedMonths: number;
  budgets: BudgetDto[];
  attention: BudgetAttentionDto[];
}

export class BudgetEventDto {
  id: string;
  @ApiProperty({ enum: BudgetEventType, enumName: 'BudgetEventType' })
  type: BudgetEventType;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

export class BudgetDetailDto extends BudgetDto {
  currencyCode: string;
  elapsedMonths: number;
  note: string | null;
  createdByName: string;
  approvedByName: string | null;
  rows: BudgetRowDto[];
  income: BudgetTotalsDto;
  expense: BudgetTotalsDto;
  events: BudgetEventDto[];
  /** Name, owner and note; any status. */
  canUpdate: boolean;
  /** The plan; drafts only. */
  canEdit: boolean;
  canApprove: boolean;
  canReopen: boolean;
  canDelete: boolean;
}

export class BudgetActualDto {
  @ApiProperty({ enum: BUDGET_DOCUMENT_TYPES, enumName: 'BudgetDocumentType' })
  documentType: BudgetDocumentType;
  documentId: string;
  reference: string | null;
  date: string;
  month: number;
  description: string;
  departmentName: string | null;
  amount: string;
}

export class BudgetOptionDto {
  id: string;
  name: string;
}

export class BudgetDepartmentOptionDto extends BudgetOptionDto {
  code: string;
  /** User of the department manager; the default budget owner. */
  managerUserId: string | null;
}

export class BudgetOptionsDto {
  departments: BudgetDepartmentOptionDto[];
  owners: BudgetOptionDto[];
}

export class BudgetRunResultDto {
  budgets: number;
  alerts: number;
}

// ---------- Manual entries ----------

export class CreateBudgetEntryDto {
  @IsUUID()
  itemId: string;

  /** Null = counts towards company-wide budgets only. */
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @IsDateString({ strict: true })
  entryDate: string;

  /** Company currency; negative amounts correct earlier entries. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @NotEquals(0)
  @Min(-999999999999)
  @Max(999_999_999_999)
  amount: number;

  @IsString()
  @Length(3, 300)
  description: string;
}

export class BudgetEntryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class BudgetEntryDto {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  @ApiProperty({ enum: BudgetItemKind, enumName: 'BudgetItemKind' })
  kind: BudgetItemKind;
  departmentId: string | null;
  departmentName: string | null;
  entryDate: string;
  amount: string;
  description: string;
  createdByName: string;
  createdAt: string;
}
