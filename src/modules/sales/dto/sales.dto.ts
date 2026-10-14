import { ApiProperty, OmitType } from '@nestjs/swagger';
import {
  EInvoiceProfile,
  EInvoiceStatus,
  InvoiceStatus,
  PaymentStatus,
  SalesOrderStatus,
  SalesQuoteStatus,
  TrackingType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import {
  CurrencyInputDto,
  DocumentTotalsDto,
  LinkedDocumentDto,
  TradeLineDto,
  TradeLineInputDto,
} from '../../partners/dto/trade.dto';

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

// ---------- Sales quotes ----------

export class CreateSalesQuoteDto extends CurrencyInputDto {
  @IsUUID()
  partnerId: string;

  /** CRM opportunity the quote answers; it must belong to the same customer. */
  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @IsDateString({ strict: true })
  quoteDate: string;

  @IsOptional()
  @IsDateString({ strict: true })
  validUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TradeLineInputDto)
  lines: TradeLineInputDto[];
}

export class SalesQuoteQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(SalesQuoteStatus)
  @ApiProperty({ enum: SalesQuoteStatus, enumName: 'SalesQuoteStatus', required: false })
  status?: SalesQuoteStatus;

  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class SalesQuoteDto extends DocumentTotalsDto {
  id: string;
  number: string;
  partnerId: string;
  partnerCode: string;
  partnerTitle: string;
  opportunityId: string | null;
  opportunityNumber: string | null;
  opportunityTitle: string | null;
  quoteDate: string;
  validUntil: string | null;
  /** Open and past its validity date. */
  expired: boolean;
  currencyCode: string;
  exchangeRate: string;
  @ApiProperty({ enum: SalesQuoteStatus, enumName: 'SalesQuoteStatus' })
  status: SalesQuoteStatus;
  lineCount: number;
  orderId: string | null;
  orderNumber: string | null;
  createdByName: string;
  createdAt: Date;
}

export class SalesQuoteDetailDto extends SalesQuoteDto {
  notes: string | null;
  lines: TradeLineDto[];
}

export class ConvertQuoteDto {
  @IsUUID()
  warehouseId: string;

  @IsOptional()
  @IsDateString({ strict: true })
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  customerRef?: string;
}

// ---------- Sales orders ----------

export class CreateSalesOrderDto extends CurrencyInputDto {
  @IsUUID()
  partnerId: string;

  @IsDateString({ strict: true })
  orderDate: string;

  @IsOptional()
  @IsDateString({ strict: true })
  deliveryDate?: string;

  @IsUUID()
  warehouseId: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  customerRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TradeLineInputDto)
  lines: TradeLineInputDto[];
}

/** Replaces the header and lines of a DRAFT order. */
export class UpdateSalesOrderDto extends OmitType(CreateSalesOrderDto, ['partnerId']) {}

export class SalesOrderQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(SalesOrderStatus)
  @ApiProperty({ enum: SalesOrderStatus, enumName: 'SalesOrderStatus', required: false })
  status?: SalesOrderStatus;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  /** Approved orders that still have something to deliver or invoice. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  open?: boolean;
}

export class SalesOrderDto extends DocumentTotalsDto {
  id: string;
  number: string;
  partnerId: string;
  partnerCode: string;
  partnerTitle: string;
  orderDate: string;
  deliveryDate: string | null;
  warehouseId: string;
  warehouseName: string;
  customerRef: string | null;
  currencyCode: string;
  exchangeRate: string;
  @ApiProperty({ enum: SalesOrderStatus, enumName: 'SalesOrderStatus' })
  status: SalesOrderStatus;
  lineCount: number;
  /** Delivered share of ordered quantities, 0–100. */
  deliveredPercent: number;
  quoteId: string | null;
  quoteNumber: string | null;
  createdByName: string;
  approvedByName: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export class SalesOrderLineDto extends TradeLineDto {
  @ApiProperty({ enum: TrackingType, enumName: 'TrackingType', nullable: true })
  trackingType: TrackingType | null;
  deliveredQty: string;
  invoicedQty: string;
  /** Still reserved in the order's warehouse. */
  reservedQty: string;
}

export class CreditCheckDto {
  /** Null means unlimited. */
  creditLimit: string | null;
  /** Ledger balance (receivable) in base currency. */
  balance: string;
  /** Uninvoiced value of the customer's other approved orders, base currency. */
  openOrders: string;
  /** Balance + open orders + this order (when not yet invoiced). */
  exposure: string;
  exceeded: boolean;
}

export class SalesOrderDetailDto extends SalesOrderDto {
  notes: string | null;
  lines: SalesOrderLineDto[];
  deliveries: LinkedDocumentDto[];
  invoices: LinkedDocumentDto[];
  credit: CreditCheckDto;
}

// ---------- Delivery notes ----------

export class DeliveryLineInputDto {
  @IsUUID()
  orderLineId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  /** Required for lot tracked items. */
  @IsOptional()
  @IsUUID()
  lotId?: string;

  /** Required for serial tracked items: one serial per unit. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  serialIds?: string[];
}

export class CreateDeliveryNoteDto {
  @IsUUID()
  orderId: string;

  @IsDateString({ strict: true })
  deliveryDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  shippingAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  carrier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DeliveryLineInputDto)
  lines: DeliveryLineInputDto[];
}

export class DeliveryNoteQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class DeliveryNoteDto {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  partnerId: string;
  partnerTitle: string;
  warehouseId: string;
  warehouseName: string;
  deliveryDate: string;
  carrier: string | null;
  lineCount: number;
  stockMovementId: string | null;
  stockMovementNumber: string | null;
  createdByName: string;
  createdAt: Date;
}

export class DeliveryNoteLineDto {
  id: string;
  orderLineId: string;
  variantId: string;
  productId: string;
  sku: string;
  description: string;
  unitCode: string;
  quantity: string;
  lotNo: string | null;
  serialNos: string[];
}

export class DeliveryNoteDetailDto extends DeliveryNoteDto {
  shippingAddress: string | null;
  notes: string | null;
  partnerCode: string;
  partnerAddress: string | null;
  lines: DeliveryNoteLineDto[];
}

// ---------- Sales invoices ----------

export class SalesInvoiceLineInputDto extends TradeLineInputDto {
  @IsOptional()
  @IsUUID()
  orderLineId?: string;
}

export class CreateSalesInvoiceDto extends CurrencyInputDto {
  @IsUUID()
  partnerId: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsDateString({ strict: true })
  invoiceDate: string;

  /** Defaults to invoice date + the customer's payment term. */
  @IsOptional()
  @IsDateString({ strict: true })
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SalesInvoiceLineInputDto)
  lines: SalesInvoiceLineInputDto[];
}

export class SalesInvoiceQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  @ApiProperty({ enum: InvoiceStatus, enumName: 'InvoiceStatus', required: false })
  status?: InvoiceStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus', required: false })
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class SalesInvoiceDto extends DocumentTotalsDto {
  id: string;
  number: string;
  partnerId: string;
  partnerCode: string;
  partnerTitle: string;
  orderId: string | null;
  orderNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  exchangeRate: string;
  @ApiProperty({ enum: InvoiceStatus, enumName: 'InvoiceStatus' })
  status: InvoiceStatus;
  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  paymentStatus: PaymentStatus;
  paidAmount: string;
  /** Unpaid and past its due date. */
  overdue: boolean;
  createdAt: Date;
}

export class SalesInvoiceLineDto extends TradeLineDto {
  orderLineId: string | null;
  @ApiProperty({ enum: TrackingType, enumName: 'TrackingType', nullable: true })
  trackingType: TrackingType | null;
  returnedQty: string;
}

export class SalesInvoiceEInvoiceDto {
  id: string;
  number: string;
  @ApiProperty({ enum: EInvoiceProfile, enumName: 'EInvoiceProfile' })
  profile: EInvoiceProfile;
  @ApiProperty({ enum: EInvoiceStatus, enumName: 'EInvoiceStatus' })
  status: EInvoiceStatus;
  statusMessage: string | null;
}

export class SalesInvoiceDetailDto extends SalesInvoiceDto {
  notes: string | null;
  partnerAddress: string | null;
  partnerTaxNumber: string | null;
  partnerTaxOffice: string | null;
  lines: SalesInvoiceLineDto[];
  returns: LinkedDocumentDto[];
  createdByName: string;
  cancelledAt: Date | null;
  /** e-Fatura / e-Arşiv sent for this invoice. */
  eInvoice: SalesInvoiceEInvoiceDto | null;
}

// ---------- Sales returns ----------

export class ReturnLineInputDto {
  @IsUUID()
  invoiceLineId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  /** Lot the goods come back into (lot tracked items). */
  @IsOptional()
  @IsString()
  @Length(1, 60)
  lotNo?: string;

  /** Returned serial numbers (serial tracked items). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  serialNos?: string[];
}

export class CreateSalesReturnDto {
  @IsUUID()
  invoiceId: string;

  @IsDateString({ strict: true })
  returnDate: string;

  /** Defaults to the order's warehouse. */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsString()
  @Length(3, 500)
  reason: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineInputDto)
  lines: ReturnLineInputDto[];
}

export class SalesReturnQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class SalesReturnDto extends DocumentTotalsDto {
  id: string;
  number: string;
  invoiceId: string;
  invoiceNumber: string;
  partnerId: string;
  partnerTitle: string;
  warehouseId: string;
  warehouseName: string;
  returnDate: string;
  reason: string;
  currencyCode: string;
  exchangeRate: string;
  lineCount: number;
  stockMovementId: string | null;
  stockMovementNumber: string | null;
  createdByName: string;
  createdAt: Date;
}

export class SalesReturnLineDto extends TradeLineDto {
  invoiceLineId: string;
  lotNo: string | null;
  serialNos: string[];
}

export class SalesReturnDetailDto extends SalesReturnDto {
  partnerCode: string;
  lines: SalesReturnLineDto[];
}
