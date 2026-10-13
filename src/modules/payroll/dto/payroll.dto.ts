import { ApiProperty } from '@nestjs/swagger';
import { PayrollPeriodStatus, PayslipItemKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

// ---------- Parameters ----------

export class TaxBracketDto {
  /** Upper limit of the cumulative yearly base; null for the top bracket. */
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  upTo: number | null;

  /** Percent, e.g. 15. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate: number;
}

export class UpdatePayrollParameterDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  minimumWage: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  sgkCeiling: number;

  /** Rates are percentages, e.g. 14 or 0.759. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  sgkEmployeeRate: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  unemploymentEmployeeRate: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  sgkEmployerRate: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  unemploymentEmployerRate: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(10)
  stampTaxRate: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(5)
  overtimeRate: number;

  @IsInt()
  @Min(100)
  @Max(300)
  monthlyHours: number;

  /** Ascending limits; only the last bracket is open-ended. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TaxBracketDto)
  taxBrackets: TaxBracketDto[];
}

export class TaxBracketValueDto {
  upTo: string | null;
  /** Percent. */
  rate: string;
}

/** Rates as percentages; `saved` is false while the year still runs on the built-in defaults. */
export class PayrollParameterDto {
  year: number;
  saved: boolean;
  minimumWage: string;
  sgkCeiling: string;
  sgkEmployeeRate: string;
  unemploymentEmployeeRate: string;
  sgkEmployerRate: string;
  unemploymentEmployerRate: string;
  stampTaxRate: string;
  overtimeRate: string;
  monthlyHours: number;
  taxBrackets: TaxBracketValueDto[];
  /** The year has approved periods; changes only affect drafts. */
  usedByPeriods: boolean;
}

// ---------- Salaries ----------

export class CreateSalaryRecordDto {
  @IsUUID()
  employeeId: string;

  @IsDateString({ strict: true })
  effectiveFrom: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  grossSalary: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class SalaryRecordDto {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  grossSalary: string;
  /** Change against the previous record in percent, null for the first one. */
  changePercent: string | null;
  note: string | null;
  createdByName: string;
  createdAt: Date;
}

export class SalaryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

/** Active employees with their salary on today's date. */
export class EmployeeSalaryDto {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentName: string | null;
  positionName: string | null;
  hireDate: string;
  grossSalary: string | null;
  effectiveFrom: string | null;
  /** A raise dated in the future is already on record. */
  upcomingSalary: string | null;
  upcomingFrom: string | null;
}

// ---------- Periods ----------

export class CreatePayrollPeriodDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}

export class PayrollPeriodQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @IsOptional()
  @IsEnum(PayrollPeriodStatus)
  @ApiProperty({ enum: PayrollPeriodStatus, enumName: 'PayrollPeriodStatus', required: false })
  status?: PayrollPeriodStatus;
}

export class PayPayrollPeriodDto {
  /** Bank or cash account in the company currency. */
  @IsUUID()
  accountId: string;

  /** Defaults to today. */
  @IsOptional()
  @IsDateString({ strict: true })
  paymentDate?: string;
}

export class PayrollPeriodDto {
  id: string;
  number: string;
  year: number;
  month: number;
  @ApiProperty({ enum: PayrollPeriodStatus, enumName: 'PayrollPeriodStatus' })
  status: PayrollPeriodStatus;
  imported: boolean;
  employeeCount: number;
  grossTotal: string;
  netTotal: string;
  sgkTotal: string;
  taxTotal: string;
  deductionTotal: string;
  employerCostTotal: string;
  currencyCode: string;
  approvedAt: Date | null;
  paymentDate: string | null;
  createdAt: Date;
}

export class PayslipRowDto {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentName: string | null;
  positionName: string | null;
  monthlySalary: string;
  payDays: number;
  missingDays: number;
  overtimeHours: string;
  grossPay: string;
  sgkEmployee: string;
  unemploymentEmployee: string;
  /** Income tax after the minimum wage exemption. */
  incomeTaxPayable: string;
  /** Stamp tax after the minimum wage exemption. */
  stampTaxPayable: string;
  otherDeductions: string;
  netPay: string;
  employerCost: string;
}

export class PayrollPeriodDetailDto extends PayrollPeriodDto {
  payslips: PayslipRowDto[];
  /** Employees employed in the month without a salary on record; they are left out. */
  missingSalaryNames: string[];
  paymentAccountId: string | null;
  paymentAccountName: string | null;
  approvedByName: string | null;
  paidAt: Date | null;
  paidByName: string | null;
  createdByName: string;
  canEdit: boolean;
  canApprove: boolean;
  canReopen: boolean;
  canPay: boolean;
  canReversePayment: boolean;
  canDelete: boolean;
}

export class PayrollMonthTotalDto {
  year: number;
  month: number;
  grossTotal: string;
  netTotal: string;
  employerCostTotal: string;
}

export class PayrollSummaryDto {
  currencyCode: string;
  /** Latest approved or paid period. */
  lastPeriod: PayrollPeriodDto | null;
  draftPeriod: PayrollPeriodDto | null;
  /** Approved and not yet paid. */
  toPayAmount: string;
  yearGrossTotal: string;
  yearEmployerCostTotal: string;
  activeEmployeeCount: number;
  /** Active employees without a salary on record. */
  missingSalaryCount: number;
  /** Last 12 approved or paid periods, oldest first. */
  byMonth: PayrollMonthTotalDto[];
}

// ---------- Payslips ----------

export class PayslipItemInputDto {
  @IsEnum(PayslipItemKind)
  @ApiProperty({ enum: PayslipItemKind, enumName: 'PayslipItemKind' })
  kind: PayslipItemKind;

  @IsString()
  @Length(2, 150)
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;
}

export class UpdatePayslipDto {
  @IsInt()
  @Min(0)
  @Max(30)
  missingDays: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(300)
  overtimeHours: number;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PayslipItemInputDto)
  items: PayslipItemInputDto[];
}

export class PayslipItemDto {
  id: string;
  @ApiProperty({ enum: PayslipItemKind, enumName: 'PayslipItemKind' })
  kind: PayslipItemKind;
  description: string;
  amount: string;
}

/** Own payslips of approved and paid periods. */
export class MyPayslipDto {
  id: string;
  periodId: string;
  year: number;
  month: number;
  @ApiProperty({ enum: PayrollPeriodStatus, enumName: 'PayrollPeriodStatus' })
  status: PayrollPeriodStatus;
  grossPay: string;
  netPay: string;
  paymentDate: string | null;
  currencyCode: string;
}

export class PayslipDetailDto extends PayslipRowDto {
  periodId: string;
  periodNumber: string;
  year: number;
  month: number;
  @ApiProperty({ enum: PayrollPeriodStatus, enumName: 'PayrollPeriodStatus' })
  status: PayrollPeriodStatus;
  currencyCode: string;
  companyName: string;
  hireDate: string;
  nationalId: string | null;
  employedDays: number;
  basePay: string;
  overtimePay: string;
  extraEarnings: string;
  sgkBase: string;
  incomeTaxBase: string;
  cumulativeTaxBase: string;
  incomeTax: string;
  incomeTaxExemption: string;
  stampTax: string;
  stampTaxExemption: string;
  sgkEmployer: string;
  unemploymentEmployer: string;
  paymentDate: string | null;
  items: PayslipItemDto[];
  canEdit: boolean;
}
