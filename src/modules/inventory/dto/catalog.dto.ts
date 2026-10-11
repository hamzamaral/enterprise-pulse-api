import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { ProductType, TrackingType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const CODE = /^[A-Z0-9-]{2,20}$/;
/** SKUs are case sensitive and may contain dots, e.g. "TSH-001.BLK.M". */
const SKU = /^[A-Za-z0-9._-]{2,40}$/;

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

// ---------- Product categories ----------

export class CreateProductCategoryDto {
  @Matches(CODE)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class UpdateProductCategoryDto extends PartialType(CreateProductCategoryDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ProductCategoryDto {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  isActive: boolean;
  productCount: number;
}

// ---------- Warehouses ----------

export class CreateWarehouseDto {
  @Matches(CODE)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;
}

export class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class WarehouseDto {
  id: string;
  code: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
  address: string | null;
  isActive: boolean;
  /** Number of variants with stock on hand. */
  itemCount: number;
  /** Decimal as string: on-hand quantity × average cost. */
  stockValue: string;
}

// ---------- Products & variants ----------

export class CreateProductDto {
  @Matches(SKU)
  code: string;

  @IsString()
  @Length(2, 200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsUUID()
  unitId: string;

  @IsOptional()
  @IsEnum(ProductType)
  @ApiProperty({ enum: ProductType, enumName: 'ProductType', required: false })
  type?: ProductType;

  @IsOptional()
  @IsEnum(TrackingType)
  @ApiProperty({ enum: TrackingType, enumName: 'TrackingType', required: false })
  trackingType?: TrackingType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchasePrice?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salePrice?: number | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsUUID()
  vatRateId?: string | null;

  /** Barcode of the default variant. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  /** Reorder point of the default variant. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minStock?: number;
}

/** Code is immutable; barcode and reorder point are edited per variant. */
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['code', 'barcode', 'minStock'] as const),
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ProductQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(ProductType)
  @ApiProperty({ enum: ProductType, enumName: 'ProductType', required: false })
  type?: ProductType;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateVariantDto {
  @Matches(SKU)
  sku: string;

  @IsString()
  @Length(1, 100)
  name: string;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { Renk: 'Siyah', Beden: 'M' },
  })
  attributes?: Record<string, string> | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minStock?: number;
}

export class UpdateVariantDto extends PartialType(OmitType(CreateVariantDto, ['name'] as const)) {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class VariantDto {
  id: string;
  sku: string;
  /** Null for the default variant of a product without variants. */
  name: string | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, nullable: true })
  attributes: Record<string, string> | null;
  barcode: string | null;
  /** Decimal as string. */
  minStock: string;
  /** Moving weighted average unit cost, decimal as string. */
  averageCost: string;
  isDefault: boolean;
  isActive: boolean;
  /** On-hand quantity across warehouses, decimal as string. */
  onHand: string;
  lowStock: boolean;
}

export class ProductDto {
  id: string;
  code: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unitId: string;
  unitCode: string;
  @ApiProperty({ enum: ProductType, enumName: 'ProductType' })
  type: ProductType;
  @ApiProperty({ enum: TrackingType, enumName: 'TrackingType' })
  trackingType: TrackingType;
  purchasePrice: string | null;
  salePrice: string | null;
  currency: string;
  isActive: boolean;
  variantCount: number;
  /** On-hand quantity across all variants and warehouses. */
  onHand: string;
  /** True when any active variant is below its reorder point. */
  lowStock: boolean;
}

export class ProductStockDto {
  warehouseId: string;
  warehouseName: string;
  variantId: string;
  quantity: string;
}

export class ProductDetailDto extends ProductDto {
  description: string | null;
  vatRateId: string | null;
  vatRateName: string | null;
  /** True once stock has moved; tracking type and product type are then locked. */
  hasTransactions: boolean;
  variants: VariantDto[];
  stock: ProductStockDto[];
  createdAt: Date;
  updatedAt: Date;
}
