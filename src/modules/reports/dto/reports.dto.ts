import { ApiProperty } from '@nestjs/swagger';
import { TreasuryDocumentType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

export enum TradeReportGroupBy {
  MONTH = 'MONTH',
  PARTNER = 'PARTNER',
  PRODUCT = 'PRODUCT',
}

class DateRangeQueryDto {
  @IsDateString({ strict: true })
  from: string;

  @IsDateString({ strict: true })
  to: string;
}

export class TradeReportQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsEnum(TradeReportGroupBy)
  @ApiProperty({ enum: TradeReportGroupBy, enumName: 'TradeReportGroupBy', required: false })
  groupBy?: TradeReportGroupBy;

  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

/** Amounts are in the company currency, converted at each document's own rate. */
export class TradeReportRowDto {
  /** "YYYY-MM" for months, partner id, or variant id ("text:<description>" for free lines). */
  key: string;
  label: string;
  code: string | null;
  documentCount: number;
  /** Net quantity (sold minus returned); only for product grouping. */
  quantity: string | null;
  net: string;
  vat: string;
  gross: string;
  /** Net amount of returns (sales only). */
  returns: string;
  /** `net - returns` */
  netTotal: string;
}

export class TradeReportTotalsDto {
  documentCount: number;
  net: string;
  vat: string;
  gross: string;
  returns: string;
  netTotal: string;
}

export class TradeReportDto {
  from: string;
  to: string;
  @ApiProperty({ enum: TradeReportGroupBy, enumName: 'TradeReportGroupBy' })
  groupBy: TradeReportGroupBy;
  currencyCode: string;
  totals: TradeReportTotalsDto;
  rows: TradeReportRowDto[];
}

export class CashFlowQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class CashFlowMonthDto {
  /** "YYYY-MM" */
  period: string;
  amountIn: string;
  amountOut: string;
  net: string;
}

export class CashFlowTypeDto {
  @ApiProperty({ enum: TreasuryDocumentType, enumName: 'TreasuryDocumentType' })
  documentType: TreasuryDocumentType;
  amountIn: string;
  amountOut: string;
}

/** Account amounts converted at the latest rate (or the account currency for a single account). */
export class CashFlowDto {
  from: string;
  to: string;
  currencyCode: string;
  opening: string;
  amountIn: string;
  amountOut: string;
  net: string;
  closing: string;
  months: CashFlowMonthDto[];
  byType: CashFlowTypeDto[];
  /** Currencies without an exchange rate; their accounts are left out. */
  unconvertedCurrencies: string[];
}
