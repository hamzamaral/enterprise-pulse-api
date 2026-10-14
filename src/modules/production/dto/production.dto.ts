import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { WorkOrderStatus } from '@prisma/client';
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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

export const AVAILABILITY = ['OK', 'PARTIAL', 'MISSING'] as const;
export type Availability = (typeof AVAILABILITY)[number];

// ---------- Bills of materials ----------

export class BomLineInputDto {
  @IsUUID()
  variantId: string;

  /** Per batch. */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity: number;

  /** Expected loss in percent. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  scrapRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string | null;
}

export class CreateBomDto {
  /** Defaults to "<sku>-R<n>". */
  @IsOptional()
  @IsString()
  @Length(2, 40)
  code?: string;

  @IsString()
  @Length(2, 150)
  name: string;

  /** The variant this BOM makes. */
  @IsUUID()
  variantId: string;

  /** Output of one batch. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  laborCost?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  overheadCost?: number;

  /** Make this the BOM that planning uses for the variant. The first BOM always is. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BomLineInputDto)
  lines: BomLineInputDto[];
}

export class UpdateBomDto extends PartialType(OmitType(CreateBomDto, ['variantId'] as const)) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BomQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class BomDto {
  id: string;
  code: string;
  name: string;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  unitCode: string;
  quantity: string;
  laborCost: string;
  overheadCost: string;
  isDefault: boolean;
  isActive: boolean;
  lineCount: number;
  /** Standard cost of one unit at current average costs. */
  unitCost: string;
  workOrderCount: number;
  updatedAt: Date;
}

export class BomLineDto {
  id: string;
  lineNo: number;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  unitCode: string;
  quantity: string;
  scrapRate: string;
  /** Planned use per unit of output, scrap included. */
  quantityPer: string;
  unitCost: string;
  /** Cost of the line per batch. */
  lineCost: string;
  onHand: string;
  /** The component has its own default BOM (semi-finished good). */
  made: boolean;
  madeBomId: string | null;
  notes: string | null;
}

export class BomDetailDto extends BomDto {
  notes: string | null;
  materialCost: string;
  createdByName: string;
  createdAt: Date;
  lines: BomLineDto[];
  /** How many units the stock on hand in all warehouses allows. */
  buildable: string;
  canDelete: boolean;
}

export class BomPlanQueryDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  /** Stock of this warehouse only; all warehouses otherwise. */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class BomPlanLineDto {
  level: number;
  variantId: string;
  parentId: string;
  sku: string;
  name: string;
  unitCode: string;
  required: string;
  onHand: string;
  shortage: string;
  made: boolean;
  @ApiProperty({ enum: AVAILABILITY, enumName: 'MaterialAvailability' })
  availability: Availability;
}

export class BomPlanDto {
  quantity: string;
  materialCost: string;
  laborCost: string;
  overheadCost: string;
  totalCost: string;
  lines: BomPlanLineDto[];
}

// ---------- Work orders ----------

export class CreateWorkOrderDto {
  @IsUUID()
  bomId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsDateString({ strict: true })
  plannedStart: string;

  @IsDateString({ strict: true })
  plannedEnd: string;

  @IsUUID()
  sourceWarehouseId: string;

  @IsUUID()
  targetWarehouseId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateWorkOrderDto extends PartialType(
  OmitType(CreateWorkOrderDto, ['bomId'] as const),
) {}

export class WorkOrderQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(WorkOrderStatus)
  @ApiProperty({ enum: WorkOrderStatus, enumName: 'WorkOrderStatus', required: false })
  status?: WorkOrderStatus;

  /** Open orders only (draft, released, in progress). */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  open?: boolean;

  /** Open orders past their planned end. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  late?: boolean;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  @IsUUID()
  bomId?: string;
}

export class WorkOrderDto {
  id: string;
  number: string;
  @ApiProperty({ enum: WorkOrderStatus, enumName: 'WorkOrderStatus' })
  status: WorkOrderStatus;
  bomId: string;
  bomCode: string;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  unitCode: string;
  quantity: string;
  producedQty: string;
  /** Produced share, 0–100. */
  progress: number;
  plannedStart: string;
  plannedEnd: string;
  late: boolean;
  sourceWarehouseId: string;
  sourceWarehouseName: string;
  targetWarehouseId: string;
  targetWarehouseName: string;
  reference: string | null;
  createdAt: Date;
}

export class WorkOrderComponentDto {
  id: string;
  lineNo: number;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  unitCode: string;
  quantityPer: string;
  requiredQty: string;
  consumedQty: string;
  remainingQty: string;
  /** On hand in the source warehouse. */
  onHand: string;
  @ApiProperty({ enum: AVAILABILITY, enumName: 'MaterialAvailability' })
  availability: Availability;
  lotTracked: boolean;
}

export class ProductionRecordDto {
  id: string;
  number: string;
  recordDate: string;
  quantity: string;
  materialCost: string;
  laborCost: string;
  overheadCost: string;
  totalCost: string;
  unitCost: string;
  issueMovementId: string | null;
  issueMovementNumber: string | null;
  receiptMovementId: string;
  receiptMovementNumber: string;
  lotNo: string | null;
  notes: string | null;
  createdByName: string;
  createdAt: Date;
}

export class WorkOrderDetailDto extends WorkOrderDto {
  notes: string | null;
  laborPerUnit: string;
  overheadPerUnit: string;
  /** Standard cost of one unit with the planned materials at current average cost. */
  standardUnitCost: string;
  /** Average cost of the output posted so far. */
  actualUnitCost: string | null;
  lotTracked: boolean;
  createdByName: string;
  releasedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  components: WorkOrderComponentDto[];
  records: ProductionRecordDto[];
  /** Whole units the source warehouse stock allows for the remaining quantity. */
  buildable: string;
  canEdit: boolean;
  canRelease: boolean;
  canRecord: boolean;
  canCancel: boolean;
  canComplete: boolean;
}

export class RecordComponentInputDto {
  @IsUUID()
  variantId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity: number;
}

export class CreateProductionRecordDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  /** Defaults to today. */
  @IsOptional()
  @IsDateString({ strict: true })
  recordDate?: string;

  /** Actual material use; components left out use the standard quantity. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RecordComponentInputDto)
  components?: RecordComponentInputDto[];

  /** Lot of the output for lot-tracked products; defaults to the work order number. */
  @IsOptional()
  @IsString()
  @Length(1, 60)
  lotNo?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  expiryDate?: string;

  /** Close the work order after this record even if the planned quantity is not reached. */
  @IsOptional()
  @IsBoolean()
  finish?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

// ---------- MRP ----------

export class RequirementOrderDto {
  id: string;
  number: string;
  quantity: string;
  date: string;
}

export class RequirementDto {
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  unitCode: string;
  /** Materials still to be used by open work orders. */
  productionDemand: string;
  /** Still to deliver on approved sales orders. */
  salesDemand: string;
  gross: string;
  onHand: string;
  /** Open purchase order quantities still to be received. */
  purchaseIncoming: string;
  /** Open work order output still to be produced. */
  productionIncoming: string;
  shortage: string;
  /** Earliest date the demand is needed. */
  neededBy: string | null;
  /** Made in house (has a default BOM); otherwise bought. */
  made: boolean;
  defaultBomId: string | null;
  purchasePrice: string | null;
  workOrders: RequirementOrderDto[];
  salesOrders: RequirementOrderDto[];
}

export class PurchaseRequirementLineDto {
  @IsUUID()
  variantId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;
}

export class CreateRequirementRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequirementLineDto)
  lines: PurchaseRequirementLineDto[];

  @IsOptional()
  @IsDateString({ strict: true })
  neededBy?: string;
}

export class CreatedDocumentDto {
  id: string;
  number: string;
}

export class ProductionSummaryDto {
  activeBoms: number;
  draft: number;
  released: number;
  inProgress: number;
  late: number;
  completedThisMonth: number;
  /** Cost of the output posted this month. */
  producedValueThisMonth: string;
  /** Materials and products short in MRP. */
  shortages: number;
  upcoming: WorkOrderDto[];
}
