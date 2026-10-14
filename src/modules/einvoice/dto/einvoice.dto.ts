import { ApiProperty } from '@nestjs/swagger';
import { EInvoiceDirection, EInvoiceProfile, EInvoiceStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { ALIAS_PATTERN } from '../einvoice-rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class EInvoiceQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(EInvoiceDirection)
  @ApiProperty({ enum: EInvoiceDirection, enumName: 'EInvoiceDirection', required: false })
  direction?: EInvoiceDirection;

  @IsOptional()
  @IsEnum(EInvoiceStatus)
  @ApiProperty({ enum: EInvoiceStatus, enumName: 'EInvoiceStatus', required: false })
  status?: EInvoiceStatus;

  @IsOptional()
  @IsEnum(EInvoiceProfile)
  @ApiProperty({ enum: EInvoiceProfile, enumName: 'EInvoiceProfile', required: false })
  profile?: EInvoiceProfile;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}

export class EInvoiceDto {
  id: string;
  @ApiProperty({ enum: EInvoiceDirection, enumName: 'EInvoiceDirection' })
  direction: EInvoiceDirection;
  @ApiProperty({ enum: EInvoiceProfile, enumName: 'EInvoiceProfile' })
  profile: EInvoiceProfile;
  @ApiProperty({ enum: EInvoiceStatus, enumName: 'EInvoiceStatus' })
  status: EInvoiceStatus;
  number: string;
  uuid: string;
  partnerId: string;
  partnerCode: string;
  partnerTitle: string;
  issueDate: string;
  currencyCode: string;
  taxTotal: string;
  payableAmount: string;
  salesInvoiceId: string | null;
  salesInvoiceNumber: string | null;
  purchaseInvoiceId: string | null;
  purchaseInvoiceNumber: string | null;
  statusCode: string | null;
  statusMessage: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  respondedAt: Date | null;
  /** Ticari fatura still inside the 8-day response window. */
  canRespond: boolean;
  createdAt: Date;
}

export class EInvoiceLineDto {
  lineNo: number;
  description: string;
  sellerCode: string | null;
  variantId: string | null;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  discountRate: string;
  gross: string;
  discount: string;
  net: string;
  vatRate: string;
  vat: string;
}

export class EInvoiceTaxDto {
  rate: string;
  base: string;
  vat: string;
}

export class EInvoiceEventDto {
  id: string;
  @ApiProperty({ enum: EInvoiceStatus, enumName: 'EInvoiceStatus' })
  status: EInvoiceStatus;
  code: string | null;
  message: string;
  userName: string | null;
  createdAt: Date;
}

export class EInvoiceDetailDto extends EInvoiceDto {
  exchangeRate: string;
  lineExtensionAmount: string;
  allowanceTotal: string;
  senderAlias: string | null;
  receiverAlias: string | null;
  senderTaxId: string | null;
  receiverTaxId: string | null;
  responseNote: string | null;
  /** Last day a ticari fatura can be answered; null for other profiles. */
  responseDeadline: string | null;
  lines: EInvoiceLineDto[];
  taxes: EInvoiceTaxDto[];
  events: EInvoiceEventDto[];
  xml: string;
  createdByName: string | null;
  /** Outgoing envelope refused by GİB whose sales invoice is still open. */
  canResend: boolean;
  /** Incoming invoice that can be recorded as a purchase invoice. */
  canRecord: boolean;
}

export class EInvoiceSummaryDto {
  /** Issued sales invoices without an e-invoice. */
  unsent: number;
  /** Queued or sent, waiting for GİB. */
  inProgress: number;
  errors: number;
  /** Outgoing ticari faturas waiting for the receiver. */
  awaitingResponse: number;
  /** Incoming ticari faturas we still have to accept or reject. */
  toRespond: number;
  /** Incoming invoices not yet recorded as purchase invoices. */
  toRecord: number;
  outgoingThisMonth: number;
  outgoingAmountThisMonth: string;
  incomingThisMonth: number;
}

export class UnsentInvoiceDto {
  id: string;
  number: string;
  partnerId: string;
  partnerTitle: string;
  invoiceDate: string;
  currencyCode: string;
  grandTotal: string;
  @ApiProperty({ enum: EInvoiceProfile, enumName: 'EInvoiceProfile' })
  profile: EInvoiceProfile;
}

export class SendEInvoiceDto {
  @IsUUID()
  salesInvoiceId: string;

  /** Defaults to the settings for registered receivers, e-Arşiv otherwise. */
  @IsOptional()
  @IsEnum(EInvoiceProfile)
  @ApiProperty({ enum: EInvoiceProfile, enumName: 'EInvoiceProfile', required: false })
  profile?: EInvoiceProfile;
}

export class RespondEInvoiceDto {
  @IsIn(['ACCEPT', 'REJECT'])
  @ApiProperty({ enum: ['ACCEPT', 'REJECT'] })
  action: 'ACCEPT' | 'REJECT';

  /** Required when rejecting. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class SimulateIncomingDto {
  /** A supplier; picked at random when omitted. */
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsIn([EInvoiceProfile.TEMELFATURA, EInvoiceProfile.TICARIFATURA])
  @ApiProperty({
    enum: [EInvoiceProfile.TEMELFATURA, EInvoiceProfile.TICARIFATURA],
    required: false,
  })
  profile?: EInvoiceProfile;
}

export class SyncResultDto {
  processed: number;
}

export class EInvoiceSettingsDto {
  senderAlias: string;
  @ApiProperty({ enum: EInvoiceProfile, enumName: 'EInvoiceProfile' })
  defaultProfile: EInvoiceProfile;
  /** Send every new sales invoice automatically. */
  autoSend: boolean;
}

export class UpdateEInvoiceSettingsDto {
  @IsOptional()
  @Transform(trim)
  @Matches(ALIAS_PATTERN, { message: 'senderAlias must look like urn:mail:pk@example.com' })
  @MaxLength(150)
  senderAlias?: string;

  @IsOptional()
  @IsIn([EInvoiceProfile.TEMELFATURA, EInvoiceProfile.TICARIFATURA])
  @ApiProperty({
    enum: [EInvoiceProfile.TEMELFATURA, EInvoiceProfile.TICARIFATURA],
    required: false,
  })
  defaultProfile?: EInvoiceProfile;

  @IsOptional()
  @IsBoolean()
  autoSend?: boolean;
}
