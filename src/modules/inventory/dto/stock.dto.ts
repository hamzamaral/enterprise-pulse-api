import { ApiProperty } from '@nestjs/swagger';
import { SerialStatus, StockCountStatus, StockMovementType, TrackingType } from '@prisma/client';
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

// ---------- Stock items & balances ----------

export class StockItemQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** When set, `onHand` is the quantity in this warehouse. */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /** Only items with stock in `warehouseId` (e.g. for issues and transfers). */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  inStock?: boolean;
}

/** A stockable variant, as offered by item pickers. */
export class StockItemDto {
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  unitCode: string;
  @ApiProperty({ enum: TrackingType, enumName: 'TrackingType' })
  trackingType: TrackingType;
  averageCost: string;
  onHand: string;
}

export class StockLevelQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Only variants below their reorder point. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  lowStock?: boolean;
}

export class StockLevelDto {
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  categoryName: string | null;
  unitCode: string;
  @ApiProperty({ enum: TrackingType, enumName: 'TrackingType' })
  trackingType: TrackingType;
  /** On hand in the selected warehouse, or in all warehouses. */
  quantity: string;
  minStock: string;
  averageCost: string;
  stockValue: string;
  lowStock: boolean;
}

export class StockSummaryDto {
  itemCount: number;
  lowStockCount: number;
  stockValue: string;
  warehouseCount: number;
}

export class LotQueryDto {
  @IsUUID()
  variantId: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

/** Quantity of a lot in one warehouse. */
export class LotStockDto {
  lotId: string;
  lotNo: string;
  expiryDate: string | null;
  warehouseId: string;
  warehouseName: string;
  quantity: string;
}

export class SerialQueryDto {
  @IsUUID()
  variantId: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsEnum(SerialStatus)
  @ApiProperty({ enum: SerialStatus, enumName: 'SerialStatus', required: false })
  status?: SerialStatus;
}

export class SerialDto {
  id: string;
  serialNo: string;
  @ApiProperty({ enum: SerialStatus, enumName: 'SerialStatus' })
  status: SerialStatus;
  warehouseId: string | null;
  warehouseName: string | null;
}

export class LedgerQueryDto extends PaginationQueryDto {
  @IsUUID()
  variantId: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

/** One line of the stock card (stok kartı hareket dökümü). */
export class LedgerEntryDto {
  id: string;
  movementId: string;
  movementNumber: string;
  @ApiProperty({ enum: StockMovementType, enumName: 'StockMovementType' })
  movementType: StockMovementType;
  movementDate: string;
  warehouseId: string;
  warehouseName: string;
  lotNo: string | null;
  /** Signed: positive into the warehouse, negative out of it. */
  quantity: string;
  unitCost: string;
  balanceAfter: string;
  createdAt: Date;
}

// ---------- Movements ----------

export class MovementLineInputDto {
  @IsUUID()
  variantId: string;

  /** Positive; ADJUSTMENT lines are signed (+ found, − missing). */
  @IsNumber({ maxDecimalPlaces: 3 })
  quantity: number;

  /** Receipts only; defaults to the variant's average cost. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost?: number;

  /** Existing lot (lot-tracked items going out). */
  @IsOptional()
  @IsUUID()
  lotId?: string;

  /** New or existing lot number (lot-tracked items coming in). */
  @ValidateIf((line: MovementLineInputDto) => line.lotNo !== undefined)
  @IsString()
  @Length(1, 60)
  lotNo?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  expiryDate?: string;

  /** Serial-tracked items coming in. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  serialNos?: string[];

  /** Serial-tracked items going out. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  serialIds?: string[];
}

export class CreateStockMovementDto {
  @IsEnum(StockMovementType)
  @ApiProperty({ enum: StockMovementType, enumName: 'StockMovementType' })
  type: StockMovementType;

  @IsDateString({ strict: true })
  movementDate: string;

  @IsOptional()
  @IsUUID()
  sourceWarehouseId?: string;

  @IsOptional()
  @IsUUID()
  targetWarehouseId?: string;

  /** External document, e.g. supplier delivery note or invoice number. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MovementLineInputDto)
  lines: MovementLineInputDto[];
}

export class MovementQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(StockMovementType)
  @ApiProperty({ enum: StockMovementType, enumName: 'StockMovementType', required: false })
  type?: StockMovementType;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;
}

export class StockMovementDto {
  id: string;
  number: string;
  @ApiProperty({ enum: StockMovementType, enumName: 'StockMovementType' })
  type: StockMovementType;
  movementDate: string;
  sourceWarehouseId: string | null;
  sourceWarehouseName: string | null;
  targetWarehouseId: string | null;
  targetWarehouseName: string | null;
  reference: string | null;
  lineCount: number;
  /** Sum of line values (quantity × unit cost). */
  totalValue: string;
  createdByName: string;
  createdAt: Date;
}

export class MovementLineDto {
  id: string;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  unitCode: string;
  quantity: string;
  unitCost: string;
  lineValue: string;
  lotNo: string | null;
  expiryDate: string | null;
  serialNos: string[];
}

export class StockMovementDetailDto extends StockMovementDto {
  notes: string | null;
  lines: MovementLineDto[];
  /** Set when the movement was generated by a stock count. */
  stockCountId: string | null;
  stockCountNumber: string | null;
}

// ---------- Stock counts ----------

export class CreateStockCountDto {
  @IsUUID()
  warehouseId: string;

  @IsDateString({ strict: true })
  countDate: string;

  /** Limit the count to one product category. */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CountLineInputDto {
  @IsUUID()
  id: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  countedQty: number | null;
}

export class UpdateCountLinesDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CountLineInputDto)
  lines: CountLineInputDto[];
}

/** Adds an item found during the count that the system did not expect. */
export class AddCountLineDto {
  @IsUUID()
  variantId: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  lotNo?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  countedQty?: number;
}

export class StockCountQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(StockCountStatus)
  @ApiProperty({ enum: StockCountStatus, enumName: 'StockCountStatus', required: false })
  status?: StockCountStatus;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class StockCountDto {
  id: string;
  number: string;
  warehouseId: string;
  warehouseName: string;
  @ApiProperty({ enum: StockCountStatus, enumName: 'StockCountStatus' })
  status: StockCountStatus;
  countDate: string;
  lineCount: number;
  countedCount: number;
  differenceCount: number;
  createdByName: string;
  completedAt: Date | null;
  adjustmentId: string | null;
  adjustmentNumber: string | null;
}

export class StockCountLineDto {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  unitCode: string;
  lotId: string | null;
  lotNo: string | null;
  expectedQty: string;
  countedQty: string | null;
  /** counted − expected; null until counted. */
  difference: string | null;
}

export class StockCountDetailDto extends StockCountDto {
  notes: string | null;
  lines: StockCountLineDto[];
}
