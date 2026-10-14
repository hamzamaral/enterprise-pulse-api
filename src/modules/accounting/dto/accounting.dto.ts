import { ApiProperty } from '@nestjs/swagger';
import { JournalEntryStatus, JournalSource, LedgerAccountType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
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
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { ACCOUNT_CODE, type IncomeSectionKey } from '../accounting-chart';

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

const MAX_AMOUNT = 999_999_999_999;

// ---------- Chart of accounts ----------

export class LedgerAccountDto {
  id: string;
  code: string;
  name: string;
  @ApiProperty({ enum: LedgerAccountType, enumName: 'LedgerAccountType' })
  type: LedgerAccountType;
  parentId: string | null;
  /** 0 for main accounts, 1+ for sub-accounts. */
  level: number;
  isSystem: boolean;
  isActive: boolean;
  /** Totals including sub-accounts, up to today. */
  debit: string;
  credit: string;
  /** Debit − credit. */
  balance: string;
  /** The account or one of its sub-accounts has journal lines. */
  hasEntries: boolean;
  childCount: number;
}

export class CreateLedgerAccountDto {
  /** Sub-account such as "102.01"; its parent must exist. Main accounts are three digits. */
  @IsString()
  @Matches(ACCOUNT_CODE, { message: 'code must look like 102 or 102.01' })
  code: string;

  @IsString()
  @Length(2, 120)
  name: string;
}

export class UpdateLedgerAccountDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class InstallChartResultDto {
  created: number;
}

export class AccountLedgerQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class AccountLedgerRowDto {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  @ApiProperty({ enum: JournalSource, enumName: 'JournalSource' })
  source: JournalSource;
  sourceNumber: string | null;
  description: string;
  lineDescription: string | null;
  accountCode: string;
  partnerName: string | null;
  employeeName: string | null;
  debit: string;
  credit: string;
  /** Running debit − credit balance. */
  balance: string;
}

export class AccountLedgerDto {
  account: LedgerAccountDto;
  from: string;
  to: string;
  /** Balance before `from`. */
  opening: string;
  rows: AccountLedgerRowDto[];
  totalDebit: string;
  totalCredit: string;
  closing: string;
}

// ---------- Journal entries ----------

export class JournalQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @IsOptional()
  @IsEnum(JournalSource)
  @ApiProperty({ enum: JournalSource, enumName: 'JournalSource', required: false })
  source?: JournalSource;

  @IsOptional()
  @IsEnum(JournalEntryStatus)
  @ApiProperty({ enum: JournalEntryStatus, enumName: 'JournalEntryStatus', required: false })
  status?: JournalEntryStatus;
}

export class JournalEntryDto {
  id: string;
  number: string;
  entryDate: string;
  @ApiProperty({ enum: JournalEntryStatus, enumName: 'JournalEntryStatus' })
  status: JournalEntryStatus;
  @ApiProperty({ enum: JournalSource, enumName: 'JournalSource' })
  source: JournalSource;
  sourceId: string | null;
  sourceNumber: string | null;
  description: string;
  total: string;
  /** This entry reverses another one. */
  isReversal: boolean;
  /** Another entry reverses this one. */
  isReversed: boolean;
  createdByName: string;
  postedAt: string | null;
}

export class JournalLineDto {
  id: string;
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  partnerId: string | null;
  partnerName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  description: string | null;
  debit: string;
  credit: string;
}

export class JournalRefDto {
  id: string;
  number: string;
}

export class JournalEntryDetailDto extends JournalEntryDto {
  /**
   * Record to open for the source: the document itself, the cheque / expense report / payroll
   * behind a treasury movement, the treasury account of an opening or the partner of an opening.
   */
  documentId: string | null;
  lines: JournalLineDto[];
  reverses: JournalRefDto | null;
  reversal: JournalRefDto | null;
  /** The entry date is in a locked period. */
  locked: boolean;
  canEdit: boolean;
  canPost: boolean;
  canReverse: boolean;
  canDelete: boolean;
}

export class JournalLineInputDto {
  @IsUUID()
  accountId: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string | null;

  @IsOptional()
  @IsUUID()
  employeeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  debit: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  credit: number;
}

export class SaveJournalEntryDto {
  @IsDateString({ strict: true })
  entryDate: string;

  @IsString()
  @Length(3, 300)
  description: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => JournalLineInputDto)
  lines: JournalLineInputDto[];
}

export class ReverseJournalEntryDto {
  @IsDateString({ strict: true })
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

// ---------- Automatic posting ----------

export const POSTING_ACTIONS = ['POST', 'REVERSE', 'REPOST'] as const;

export class PendingPostingDto {
  @ApiProperty({ enum: JournalSource, enumName: 'JournalSource' })
  source: JournalSource;
  sourceId: string;
  sourceNumber: string;
  description: string;
  /** Date of the entry to be written. */
  date: string;
  amount: string;
  /** POST a new document, REVERSE a cancelled one, REPOST a recalculated payroll. */
  @ApiProperty({ enum: POSTING_ACTIONS, enumName: 'PostingAction' })
  action: (typeof POSTING_ACTIONS)[number];
  /** The date is in a locked period; the document stays pending. */
  locked: boolean;
}

export class PostingRunResultDto {
  posted: number;
  reversed: number;
  skipped: number;
}

// ---------- Reports ----------

export class DateRangeQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}

export class TrialBalanceQueryDto extends DateRangeQueryDto {
  /** Include sub-accounts. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  detailed?: boolean;
}

export class TrialBalanceTotalsDto {
  periodDebit: string;
  periodCredit: string;
  totalDebit: string;
  totalCredit: string;
  balanceDebit: string;
  balanceCredit: string;
}

export class TrialBalanceRowDto extends TrialBalanceTotalsDto {
  accountId: string | null;
  code: string;
  name: string;
  level: number;
}

export class TrialBalanceDto {
  from: string;
  to: string;
  rows: TrialBalanceRowDto[];
  totals: TrialBalanceTotalsDto;
}

export class BalanceSheetQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  date?: string;
}

export class StatementAccountDto {
  code: string;
  name: string;
  amount: string;
}

export class StatementGroupDto {
  code: string;
  name: string;
  total: string;
  accounts: StatementAccountDto[];
}

export class StatementClassDto {
  code: string;
  name: string;
  total: string;
  groups: StatementGroupDto[];
}

export class BalanceSheetDto {
  date: string;
  assets: StatementClassDto[];
  liabilities: StatementClassDto[];
  totalAssets: string;
  totalLiabilities: string;
}

export const INCOME_SECTION_KEYS: IncomeSectionKey[] = [
  'grossSales',
  'salesDeductions',
  'costOfSales',
  'operatingExpenses',
  'otherIncome',
  'otherExpenses',
  'financeExpenses',
  'extraordinaryIncome',
  'extraordinaryExpenses',
  'taxProvision',
];

export class IncomeSectionDto {
  @ApiProperty({ enum: INCOME_SECTION_KEYS, enumName: 'IncomeSectionKey' })
  key: IncomeSectionKey;
  name: string;
  total: string;
  accounts: StatementAccountDto[];
}

export class IncomeStatementDto {
  from: string;
  to: string;
  sections: IncomeSectionDto[];
  netSales: string;
  grossProfit: string;
  operatingProfit: string;
  ordinaryProfit: string;
  profitBeforeTax: string;
  netProfit: string;
}

export class SummaryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class AccountingMonthDto {
  month: number;
  /** Net sales and other income. */
  revenue: string;
  /** Cost of sales and expenses. */
  expense: string;
  profit: string;
}

export class AccountingSummaryDto {
  year: number;
  currencyCode: string;
  /** 10 Hazır Değerler. */
  cash: string;
  /** 12 Ticari Alacaklar. */
  receivables: string;
  /** 32 Ticari Borçlar. */
  payables: string;
  netSales: string;
  netProfit: string;
  months: AccountingMonthDto[];
  pendingCount: number;
  entryCount: number;
  lockedUntil: string | null;
  chartInstalled: boolean;
}

export class AccountingSettingsDto {
  lockedUntil: string | null;
}

export class UpdateAccountingSettingsDto {
  /** Entries on or before this day cannot be posted or reversed; null unlocks. */
  @IsOptional()
  @IsDateString({ strict: true })
  lockedUntil?: string | null;
}

export class AccountingOptionDto {
  id: string;
  code: string;
  name: string;
}

export class AccountingOptionsDto {
  accounts: AccountingOptionDto[];
  partners: AccountingOptionDto[];
  employees: AccountingOptionDto[];
}
