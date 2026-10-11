import { ApiProperty, OmitType } from '@nestjs/swagger';
import {
  InvoiceStatus,
  PaymentStatus,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  SupplierQuoteStatus,
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
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import {
  CurrencyInputDto,
  DocumentTotalsDto,
  TradeLineDto,
  TradeLineInputDto,
} from '../../partners/dto/trade.dto';

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

export class CancelDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class LinkedDocumentDto {
  id: string;
  number: string;
  date: string;
  status: string;
  /** Grand total in document currency, when the document has amounts. */
  total: string | null;
}

// ---------- Purchase requests ----------

export class RequestLineInputDto {
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  estimatedPrice?: number;
}

export class CreatePurchaseRequestDto {
  @IsString()
  @Length(3, 200)
  title: string;

  @IsOptional()
  @IsDateString({ strict: true })
  neededBy?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RequestLineInputDto)
  lines: RequestLineInputDto[];
}

export class PurchaseRequestQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PurchaseRequestStatus)
  @ApiProperty({ enum: PurchaseRequestStatus, enumName: 'PurchaseRequestStatus', required: false })
  status?: PurchaseRequestStatus;

  /** Only my own requests (always the case without `purchasing:read`). */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mine?: boolean;
}

export class PurchaseRequestDto {
  id: string;
  number: string;
  title: string;
  requestDate: string;
  neededBy: string | null;
  departmentId: string | null;
  departmentName: string | null;
  @ApiProperty({ enum: PurchaseRequestStatus, enumName: 'PurchaseRequestStatus' })
  status: PurchaseRequestStatus;
  requestedById: string;
  requestedByName: string;
  lineCount: number;
  /** Sum of quantity × estimated price (base currency). */
  estimatedTotal: string;
  quoteCount: number;
  workflowInstanceId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export class PurchaseRequestLineDto {
  id: string;
  lineNo: number;
  variantId: string | null;
  productId: string | null;
  sku: string | null;
  unitCode: string | null;
  description: string;
  quantity: string;
  estimatedPrice: string | null;
}

export class PurchaseRequestDetailDto extends PurchaseRequestDto {
  notes: string | null;
  lines: PurchaseRequestLineDto[];
  orders: LinkedDocumentDto[];
}

// ---------- Supplier quotes ----------

export class QuoteLineInputDto extends TradeLineInputDto {
  @IsOptional()
  @IsUUID()
  requestLineId?: string;
}

export class CreateSupplierQuoteDto extends CurrencyInputDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsUUID()
  partnerId: string;

  @IsDateString({ strict: true })
  quoteDate: string;

  @IsOptional()
  @IsDateString({ strict: true })
  validUntil?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  deliveryDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineInputDto)
  lines: QuoteLineInputDto[];
}

export class SupplierQuoteQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsEnum(SupplierQuoteStatus)
  @ApiProperty({ enum: SupplierQuoteStatus, enumName: 'SupplierQuoteStatus', required: false })
  status?: SupplierQuoteStatus;
}

export class SupplierQuoteDto extends DocumentTotalsDto {
  id: string;
  number: string;
  requestId: string | null;
  requestNumber: string | null;
  partnerId: string;
  partnerCode: string;
  partnerTitle: string;
  quoteDate: string;
  validUntil: string | null;
  deliveryDays: number | null;
  currencyCode: string;
  exchangeRate: string;
  @ApiProperty({ enum: SupplierQuoteStatus, enumName: 'SupplierQuoteStatus' })
  status: SupplierQuoteStatus;
  lineCount: number;
  orderId: string | null;
  orderNumber: string | null;
  createdAt: Date;
}

export class QuoteLineDto extends TradeLineDto {
  requestLineId: string | null;
}

export class SupplierQuoteDetailDto extends SupplierQuoteDto {
  notes: string | null;
  lines: QuoteLineDto[];
}

export class AcceptQuoteDto {
  @IsUUID()
  warehouseId: string;

  @IsOptional()
  @IsDateString({ strict: true })
  expectedDate?: string;
}

export class ComparisonPriceDto {
  requestLineId: string;
  quantity: string;
  unitPrice: string;
  /** Unit price after discount, before VAT, in base currency: comparable across quotes. */
  netUnitPriceBase: string;
  lineTotal: string;
}

export class ComparisonQuoteDto extends SupplierQuoteDto {
  prices: ComparisonPriceDto[];
}

export class QuoteComparisonDto {
  requestId: string;
  requestNumber: string;
  title: string;
  baseCurrency: string;
  lines: PurchaseRequestLineDto[];
  quotes: ComparisonQuoteDto[];
  /** Open quote with the lowest base-currency total among those pricing every line. */
  bestQuoteId: string | null;
}

// ---------- Purchase orders ----------

export class OrderLineInputDto extends TradeLineInputDto {
  @IsOptional()
  @IsUUID()
  requestLineId?: string;
}

export class CreatePurchaseOrderDto extends CurrencyInputDto {
  @IsUUID()
  partnerId: string;

  @IsDateString({ strict: true })
  orderDate: string;

  @IsOptional()
  @IsDateString({ strict: true })
  expectedDate?: string;

  @IsUUID()
  warehouseId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines: OrderLineInputDto[];
}

/** Replaces the header and lines of a DRAFT order. */
export class UpdatePurchaseOrderDto extends OmitType(CreatePurchaseOrderDto, ['partnerId']) {}

export class PurchaseOrderQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  @ApiProperty({ enum: PurchaseOrderStatus, enumName: 'PurchaseOrderStatus', required: false })
  status?: PurchaseOrderStatus;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  /** Orders that still have something to receive or invoice. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  open?: boolean;
}

export class PurchaseOrderDto extends DocumentTotalsDto {
  id: string;
  number: string;
  partnerId: string;
  partnerCode: string;
  partnerTitle: string;
  orderDate: string;
  expectedDate: string | null;
  warehouseId: string;
  warehouseName: string;
  currencyCode: string;
  exchangeRate: string;
  @ApiProperty({ enum: PurchaseOrderStatus, enumName: 'PurchaseOrderStatus' })
  status: PurchaseOrderStatus;
  lineCount: number;
  /** Received share of ordered quantities, 0–100. */
  receivedPercent: number;
  requestId: string | null;
  requestNumber: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  createdByName: string;
  approvedByName: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export class PurchaseOrderLineDto extends TradeLineDto {
  requestLineId: string | null;
  @ApiProperty({ enum: TrackingType, enumName: 'TrackingType', nullable: true })
  trackingType: TrackingType | null;
  receivedQty: string;
  invoicedQty: string;
}

export class PurchaseOrderDetailDto extends PurchaseOrderDto {
  notes: string | null;
  lines: PurchaseOrderLineDto[];
  receipts: LinkedDocumentDto[];
  invoices: LinkedDocumentDto[];
}

// ---------- Goods receipts ----------

export class ReceiptLineInputDto {
  @IsUUID()
  orderLineId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  lotNo?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  expiryDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  serialNos?: string[];
}

export class CreateGoodsReceiptDto {
  @IsUUID()
  orderId: string;

  @IsDateString({ strict: true })
  receiptDate: string;

  /** Defaults to the order's warehouse. */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  deliveryNoteNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineInputDto)
  lines: ReceiptLineInputDto[];
}

export class GoodsReceiptQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

export class GoodsReceiptDto {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  partnerId: string;
  partnerTitle: string;
  warehouseId: string;
  warehouseName: string;
  receiptDate: string;
  deliveryNoteNo: string | null;
  lineCount: number;
  stockMovementId: string | null;
  stockMovementNumber: string | null;
  createdByName: string;
  createdAt: Date;
}

export class GoodsReceiptLineDto {
  id: string;
  orderLineId: string;
  variantId: string;
  productId: string;
  sku: string;
  description: string;
  unitCode: string;
  quantity: string;
  lotNo: string | null;
  expiryDate: string | null;
  serialNos: string[];
}

export class GoodsReceiptDetailDto extends GoodsReceiptDto {
  notes: string | null;
  lines: GoodsReceiptLineDto[];
}

// ---------- Purchase invoices ----------

export class PurchaseInvoiceLineInputDto extends TradeLineInputDto {
  @IsOptional()
  @IsUUID()
  orderLineId?: string;
}

export class CreatePurchaseInvoiceDto extends CurrencyInputDto {
  @IsUUID()
  partnerId: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsString()
  @Length(1, 60)
  supplierInvoiceNo: string;

  @IsDateString({ strict: true })
  invoiceDate: string;

  /** Defaults to invoice date + the supplier's payment term. */
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
  @Type(() => PurchaseInvoiceLineInputDto)
  lines: PurchaseInvoiceLineInputDto[];
}

export class PurchaseInvoiceQueryDto extends PaginationQueryDto {
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

export class PurchaseInvoiceDto extends DocumentTotalsDto {
  id: string;
  number: string;
  supplierInvoiceNo: string;
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

export class PurchaseInvoiceLineDto extends TradeLineDto {
  orderLineId: string | null;
}

export class PurchaseInvoiceDetailDto extends PurchaseInvoiceDto {
  notes: string | null;
  lines: PurchaseInvoiceLineDto[];
  createdByName: string;
  cancelledAt: Date | null;
}
