import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { ExpenseCategoryKind, ExpenseReportStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

// ---------- Categories ----------

export class ExpenseCategoryDto {
  id: string;
  code: string;
  name: string;
  @ApiProperty({ enum: ExpenseCategoryKind, enumName: 'ExpenseCategoryKind' })
  kind: ExpenseCategoryKind;
  rate: string | null;
  limitAmount: string | null;
  requiresReceipt: boolean;
  isActive: boolean;
}

export class CreateExpenseCategoryDto {
  @Matches(/^[A-Z0-9_-]{2,20}$/)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @IsOptional()
  @IsEnum(ExpenseCategoryKind)
  @ApiProperty({ enum: ExpenseCategoryKind, enumName: 'ExpenseCategoryKind', required: false })
  kind?: ExpenseCategoryKind;

  /** Required for PER_DIEM and MILEAGE. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  rate?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  limitAmount?: number | null;

  @IsOptional()
  @IsBoolean()
  requiresReceipt?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Code and kind are fixed once lines may refer to the category. */
export class UpdateExpenseCategoryDto extends PartialType(
  OmitType(CreateExpenseCategoryDto, ['code', 'kind'] as const),
) {}

// ---------- Reports ----------

export class ExpenseLineInputDto {
  @IsUUID()
  categoryId: string;

  @IsDateString({ strict: true })
  expenseDate: string;

  @IsString()
  @Length(2, 300)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  merchant?: string | null;

  /** Days (per diem) or kilometres (mileage); ignored for receipts. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity?: number;

  /** Receipt total including VAT, in `currencyCode`; computed for per diem and mileage. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  vatAmount?: number;

  /** Defaults to the company currency. */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;

  /** Defaults to the latest rate of `currencyCode`. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  exchangeRate?: number;

  /** File uploaded with `POST /expense-reports/receipts`. */
  @IsOptional()
  @IsUUID()
  receiptFileId?: string | null;
}

export class UpdateExpenseReportDto {
  @IsString()
  @Length(2, 200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  /** Working project the employee is a member of; approved totals count towards its cost. */
  @IsOptional()
  @IsUUID()
  projectId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ExpenseLineInputDto)
  lines: ExpenseLineInputDto[];
}

export class CreateExpenseReportDto extends UpdateExpenseReportDto {
  /** On behalf of another employee (`expenses:create`); defaults to the current user's record. */
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

export class ExpenseReportQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ExpenseReportStatus)
  @ApiProperty({ enum: ExpenseReportStatus, enumName: 'ExpenseReportStatus', required: false })
  status?: ExpenseReportStatus;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  /** Only the current user's reports, even with `expenses:read`. */
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false';
}

export class PayExpenseReportDto {
  /** Cash or bank account in the company currency. */
  @IsUUID()
  accountId: string;

  /** Defaults to today. */
  @IsOptional()
  @IsDateString({ strict: true })
  paymentDate?: string;
}

export class ExpenseLineDto {
  id: string;
  lineNo: number;
  categoryId: string;
  categoryName: string;
  @ApiProperty({ enum: ExpenseCategoryKind, enumName: 'ExpenseCategoryKind' })
  categoryKind: ExpenseCategoryKind;
  expenseDate: string;
  description: string;
  merchant: string | null;
  quantity: string;
  amount: string;
  vatAmount: string;
  currencyCode: string;
  exchangeRate: string;
  amountBase: string;
  receiptFileId: string | null;
  receiptName: string | null;
  /** Above the category's soft limit. */
  overLimit: boolean;
  missingReceipt: boolean;
}

export class ExpenseReportDto {
  id: string;
  number: string;
  title: string;
  employeeId: string;
  employeeName: string;
  departmentName: string | null;
  projectId: string | null;
  projectNumber: string | null;
  projectName: string | null;
  @ApiProperty({ enum: ExpenseReportStatus, enumName: 'ExpenseReportStatus' })
  status: ExpenseReportStatus;
  /** Company currency. */
  totalAmount: string;
  currencyCode: string;
  lineCount: number;
  submittedAt: Date | null;
  decidedAt: Date | null;
  paymentDate: string | null;
  createdAt: Date;
}

export class ExpenseReportDetailDto extends ExpenseReportDto {
  description: string | null;
  lines: ExpenseLineDto[];
  workflowInstanceId: string | null;
  paymentAccountId: string | null;
  paymentAccountName: string | null;
  paidAt: Date | null;
  paidByName: string | null;
  createdByName: string;
  vatTotal: string;
  overLimitCount: number;
  missingReceiptCount: number;
  canEdit: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canCancel: boolean;
  canPay: boolean;
  canReversePayment: boolean;
}

export class ExpenseCategoryTotalDto {
  categoryId: string;
  name: string;
  @ApiProperty({ enum: ExpenseCategoryKind, enumName: 'ExpenseCategoryKind' })
  kind: ExpenseCategoryKind;
  amount: string;
}

export class ExpenseMonthTotalDto {
  /** YYYY-MM */
  month: string;
  amount: string;
}

/** Amounts in the company currency; company-wide with `expenses:read`, otherwise own reports. */
export class ExpenseSummaryDto {
  currencyCode: string;
  pendingCount: number;
  pendingAmount: string;
  toPayCount: number;
  toPayAmount: string;
  paidThisMonthAmount: string;
  /** Approved and paid this year. */
  byCategory: ExpenseCategoryTotalDto[];
  /** Approved and paid, last 6 months. */
  byMonth: ExpenseMonthTotalDto[];
  myDraftCount: number;
  myPendingCount: number;
  myToPayAmount: string;
}
