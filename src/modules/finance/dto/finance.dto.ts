import { ApiProperty, PartialType, PickType } from '@nestjs/swagger';
import {
  ChequeDirection,
  ChequeKind,
  ChequeStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentRecordStatus,
  PaymentStatus,
  TreasuryAccountType,
  TreasuryDocumentType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

// ---------- Treasury accounts ----------

export class CreateTreasuryAccountDto {
  @IsString()
  @Length(1, 20)
  @Matches(/^[A-Z0-9-]+$/)
  code: string;

  @IsString()
  @Length(1, 120)
  name: string;

  @IsEnum(TreasuryAccountType)
  @ApiProperty({ enum: TreasuryAccountType, enumName: 'TreasuryAccountType' })
  type: TreasuryAccountType;

  @Matches(/^[A-Z]{3}$/)
  currencyCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  branchName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(34)
  iban?: string;

  /** Posted as an OPENING transaction dated `openingDate`. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingBalance?: number;

  @IsOptional()
  @IsDateString({ strict: true })
  openingDate?: string;
}

export class UpdateTreasuryAccountDto extends PartialType(
  PickType(CreateTreasuryAccountDto, ['name', 'bankName', 'branchName', 'iban'] as const),
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TreasuryAccountQueryDto {
  @IsOptional()
  @IsEnum(TreasuryAccountType)
  @ApiProperty({ enum: TreasuryAccountType, enumName: 'TreasuryAccountType', required: false })
  type?: TreasuryAccountType;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  activeOnly?: boolean;
}

export class TreasuryAccountDto {
  id: string;
  code: string;
  name: string;
  @ApiProperty({ enum: TreasuryAccountType, enumName: 'TreasuryAccountType' })
  type: TreasuryAccountType;
  currencyCode: string;
  bankName: string | null;
  branchName: string | null;
  iban: string | null;
  isActive: boolean;
  /** Account currency. */
  balance: string;
  /** Balance at the latest stored rate, company currency. */
  balanceBase: string;
  createdAt: Date;
}

export class TreasuryStatementQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;
}

export class TreasuryEntryDto {
  id: string;
  txDate: string;
  @ApiProperty({ enum: TreasuryDocumentType, enumName: 'TreasuryDocumentType' })
  documentType: TreasuryDocumentType;
  documentId: string | null;
  documentNumber: string;
  description: string | null;
  amountIn: string;
  amountOut: string;
  balance: string;
  isReversal: boolean;
}

export class TreasuryStatementDto {
  account: TreasuryAccountDto;
  dateFrom: string | null;
  dateTo: string | null;
  openingBalance: string;
  totalIn: string;
  totalOut: string;
  closingBalance: string;
  entries: TreasuryEntryDto[];
}

export class CashPositionCurrencyDto {
  currencyCode: string;
  cash: string;
  bank: string;
  total: string;
  totalBase: string;
}

export class CashPositionDto {
  baseCurrency: string;
  currencies: CashPositionCurrencyDto[];
  /** Customer cheques and notes in portfolio or at the bank, company currency. */
  chequesInPortfolioBase: string;
  /** Own cheques and notes not yet paid, company currency. */
  chequesIssuedBase: string;
  totalBase: string;
}

// ---------- Payments ----------

export class AllocationInputDto {
  @IsUUID()
  invoiceId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;
}

export class ChequeInputDto {
  @IsString()
  @Length(1, 40)
  serialNo: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  branchName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  drawer?: string;

  @IsDateString({ strict: true })
  dueDate: string;
}

export class CreatePaymentDto {
  @IsEnum(PaymentDirection)
  @ApiProperty({ enum: PaymentDirection, enumName: 'PaymentDirection' })
  direction: PaymentDirection;

  @IsEnum(PaymentMethod)
  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method: PaymentMethod;

  @IsUUID()
  partnerId: string;

  @IsDateString({ strict: true })
  paymentDate: string;

  /** Cash box / bank account for CASH and BANK; the bank an own cheque is drawn on. */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  /** Ignored when endorsing a portfolio cheque (its amount is used). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  /** Defaults to the account currency (cash / bank) or the partner currency. */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  exchangeRate?: number;

  /** New cheque / note received (IN) or issued (OUT). */
  @IsOptional()
  @ValidateNested()
  @Type(() => ChequeInputDto)
  cheque?: ChequeInputDto;

  /** OUT only: endorse this portfolio cheque / note to the supplier (ciro). */
  @IsOptional()
  @IsUUID()
  endorseChequeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Explicit invoice allocations; when omitted, open invoices are settled oldest first. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AllocationInputDto)
  allocations?: AllocationInputDto[];
}

export class PaymentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PaymentDirection)
  @ApiProperty({ enum: PaymentDirection, enumName: 'PaymentDirection', required: false })
  direction?: PaymentDirection;

  @IsOptional()
  @IsEnum(PaymentMethod)
  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod', required: false })
  method?: PaymentMethod;

  @IsOptional()
  @IsEnum(PaymentRecordStatus)
  @ApiProperty({ enum: PaymentRecordStatus, enumName: 'PaymentRecordStatus', required: false })
  status?: PaymentRecordStatus;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class PaymentDto {
  id: string;
  number: string;
  @ApiProperty({ enum: PaymentDirection, enumName: 'PaymentDirection' })
  direction: PaymentDirection;
  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method: PaymentMethod;
  @ApiProperty({ enum: PaymentRecordStatus, enumName: 'PaymentRecordStatus' })
  status: PaymentRecordStatus;
  partnerId: string;
  partnerCode: string;
  partnerTitle: string;
  paymentDate: string;
  accountId: string | null;
  accountName: string | null;
  amount: string;
  currencyCode: string;
  exchangeRate: string;
  amountBase: string;
  /** Part of the amount settled against invoices. */
  allocatedAmount: string;
  chequeId: string | null;
  chequeNumber: string | null;
  description: string | null;
  createdAt: Date;
}

export class PaymentAllocationDto {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  invoiceTotal: string;
  amount: string;
}

export class PaymentDetailDto extends PaymentDto {
  allocations: PaymentAllocationDto[];
  createdByName: string;
  cancelledAt: Date | null;
}

export class OpenInvoicesQueryDto {
  @IsUUID()
  partnerId: string;

  @IsEnum(PaymentDirection)
  @ApiProperty({ enum: PaymentDirection, enumName: 'PaymentDirection' })
  direction: PaymentDirection;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;
}

export class OpenInvoiceDto {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  grandTotal: string;
  paidAmount: string;
  remaining: string;
  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  paymentStatus: PaymentStatus;
  overdue: boolean;
}

// ---------- Cheques and notes ----------

export class ChequeQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ChequeDirection)
  @ApiProperty({ enum: ChequeDirection, enumName: 'ChequeDirection', required: false })
  direction?: ChequeDirection;

  @IsOptional()
  @IsEnum(ChequeKind)
  @ApiProperty({ enum: ChequeKind, enumName: 'ChequeKind', required: false })
  kind?: ChequeKind;

  @IsOptional()
  @IsEnum(ChequeStatus)
  @ApiProperty({ enum: ChequeStatus, enumName: 'ChequeStatus', required: false })
  status?: ChequeStatus;

  /** Still open: in portfolio or at the bank (received), not yet paid (issued). */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  open?: boolean;

  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class ChequeDto {
  id: string;
  number: string;
  @ApiProperty({ enum: ChequeKind, enumName: 'ChequeKind' })
  kind: ChequeKind;
  @ApiProperty({ enum: ChequeDirection, enumName: 'ChequeDirection' })
  direction: ChequeDirection;
  @ApiProperty({ enum: ChequeStatus, enumName: 'ChequeStatus' })
  status: ChequeStatus;
  serialNo: string;
  bankName: string | null;
  branchName: string | null;
  drawer: string | null;
  issueDate: string;
  dueDate: string;
  /** Open and past its due date. */
  overdue: boolean;
  amount: string;
  currencyCode: string;
  exchangeRate: string;
  partnerId: string;
  partnerTitle: string;
  endorsedToId: string | null;
  endorsedToTitle: string | null;
  accountId: string | null;
  accountName: string | null;
  originPaymentId: string;
  originPaymentNumber: string;
  endorsementPaymentId: string | null;
  endorsementPaymentNumber: string | null;
  createdAt: Date;
}

export class ChequeEventDto {
  id: string;
  eventDate: string;
  @ApiProperty({ enum: ChequeStatus, enumName: 'ChequeStatus', nullable: true })
  fromStatus: ChequeStatus | null;
  @ApiProperty({ enum: ChequeStatus, enumName: 'ChequeStatus' })
  toStatus: ChequeStatus;
  accountName: string | null;
  partnerTitle: string | null;
  note: string | null;
  createdByName: string;
  createdAt: Date;
}

export class ChequeDetailDto extends ChequeDto {
  partnerCode: string;
  events: ChequeEventDto[];
}

export class ChequeActionDto {
  @IsDateString({ strict: true })
  date: string;

  /** deposit / collect: the receiving account; pay: the paying account (defaults to the drawn bank). */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// ---------- Reports ----------

export class AgingQueryDto {
  @IsIn(['RECEIVABLE', 'PAYABLE'])
  @ApiProperty({ enum: ['RECEIVABLE', 'PAYABLE'], enumName: 'AgingSide' })
  side: 'RECEIVABLE' | 'PAYABLE';

  /** Defaults to today. */
  @IsOptional()
  @IsDateString({ strict: true })
  asOf?: string;
}

export class AgingBucketsDto {
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90plus: string;
  total: string;
}

export class AgingRowDto extends AgingBucketsDto {
  partnerId: string;
  partnerCode: string;
  partnerTitle: string;
  invoiceCount: number;
  /** Oldest open due date. */
  oldestDueDate: string;
}

export class AgingReportDto {
  side: string;
  asOf: string;
  baseCurrency: string;
  rows: AgingRowDto[];
  totals: AgingBucketsDto;
}

export class FinanceSummaryDto {
  baseCurrency: string;
  receivables: string;
  overdueReceivables: string;
  payables: string;
  overduePayables: string;
  cashPosition: string;
  chequesInPortfolio: string;
  openPurchaseOrders: number;
  openSalesOrders: number;
}
