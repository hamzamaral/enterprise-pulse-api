import { ApiProperty, PartialType } from '@nestjs/swagger';
import { LedgerDocumentType, PartnerType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { ALIAS_PATTERN } from '../../einvoice/einvoice-rules';

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

export class CreatePartnerDto {
  /** Generated from the PARTNER number sequence when omitted. */
  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{2,30}$/)
  code?: string;

  @IsString()
  @Length(2, 200)
  title: string;

  @IsEnum(PartnerType)
  @ApiProperty({ enum: PartnerType, enumName: 'PartnerType' })
  type: PartnerType;

  @IsOptional()
  @Matches(/^\d{10,11}$/, { message: 'taxNumber must be 10 (VKN) or 11 (TCKN) digits' })
  taxNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxOffice?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactName?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;

  /** e-Fatura mailbox alias; registered users receive e-Fatura, the rest e-Arşiv. */
  @IsOptional()
  @Matches(ALIAS_PATTERN, { message: 'eInvoiceAlias must look like urn:mail:pk@example.com' })
  @MaxLength(150)
  eInvoiceAlias?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  creditLimit?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdatePartnerDto extends PartialType(CreatePartnerDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PartnerQueryDto extends PaginationQueryDto {
  /** CUSTOMER and SUPPLIER also match BOTH. */
  @IsOptional()
  @IsEnum(PartnerType)
  @ApiProperty({ enum: PartnerType, enumName: 'PartnerType', required: false })
  type?: PartnerType;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class PartnerDto {
  id: string;
  code: string;
  title: string;
  @ApiProperty({ enum: PartnerType, enumName: 'PartnerType' })
  type: PartnerType;
  taxNumber: string | null;
  taxOffice: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  contactName: string | null;
  paymentTermDays: number;
  currencyCode: string;
  eInvoiceAlias: string | null;
  creditLimit: string | null;
  notes: string | null;
  isActive: boolean;
  /** Base currency; positive = receivable (partner owes us), negative = payable. */
  balance: string;
  createdAt: Date;
}

export class StatementQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;
}

export class StatementEntryDto {
  id: string;
  entryDate: string;
  dueDate: string | null;
  @ApiProperty({ enum: LedgerDocumentType, enumName: 'LedgerDocumentType' })
  documentType: LedgerDocumentType;
  documentId: string | null;
  documentNumber: string;
  description: string | null;
  currencyCode: string;
  exchangeRate: string;
  /** Document currency. */
  debit: string;
  credit: string;
  /** Base currency. */
  debitBase: string;
  creditBase: string;
  /** Running balance in base currency after this entry. */
  balance: string;
  isReversal: boolean;
}

export class PartnerStatementDto {
  partnerId: string;
  code: string;
  title: string;
  baseCurrency: string;
  dateFrom: string | null;
  dateTo: string | null;
  openingBalance: string;
  totalDebit: string;
  totalCredit: string;
  closingBalance: string;
  entries: StatementEntryDto[];
}
