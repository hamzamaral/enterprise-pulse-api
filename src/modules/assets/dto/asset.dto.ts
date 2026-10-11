import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  AssetCondition,
  AssetStatus,
  AssigneeType,
  AssignmentStatus,
  MaintenanceStatus,
  MaintenanceType,
} from '@prisma/client';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const CODE = /^[A-Z0-9-]{2,20}$/;

// ---------- Categories & locations ----------

export class CreateAssetCategoryDto {
  @Matches(CODE)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @IsInt()
  @Min(1)
  @Max(600)
  usefulLifeMonths: number;
}

export class UpdateAssetCategoryDto extends PartialType(CreateAssetCategoryDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AssetCategoryDto {
  id: string;
  code: string;
  name: string;
  usefulLifeMonths: number;
  isActive: boolean;
  assetCount: number;
}

export class CreateAssetLocationDto {
  @Matches(CODE)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class UpdateAssetLocationDto extends PartialType(CreateAssetLocationDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AssetLocationDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  branchId: string | null;
  branchName: string | null;
  isActive: boolean;
  assetCount: number;
}

// ---------- Assets ----------

export class CreateAssetDto {
  @IsString()
  @Length(2, 200)
  name: string;

  @IsUUID('4')
  categoryId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string | null;

  @ApiProperty({ enum: AssetCondition, enumName: 'AssetCondition', required: false })
  @IsOptional()
  @IsEnum(AssetCondition)
  condition?: AssetCondition;

  @IsOptional()
  @IsUUID('4')
  locationId?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  purchaseDate?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchaseCost?: number | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salvageValue?: number;

  /** Overrides the category's useful life. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  usefulLifeMonths?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplier?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoiceNo?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  warrantyEndDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateAssetDto extends PartialType(CreateAssetDto) {}

export class AssetQueryDto extends PaginationQueryDto {
  @ApiProperty({ enum: AssetStatus, enumName: 'AssetStatus', required: false })
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;

  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @IsOptional()
  @IsUUID('4')
  locationId?: string;
}

export class RetireAssetDto {
  @ApiProperty({ enum: ['RETIRED', 'LOST'] })
  @IsIn([AssetStatus.RETIRED, AssetStatus.LOST])
  status: 'RETIRED' | 'LOST';

  @IsString()
  @Length(2, 500)
  reason: string;
}

export class AssetHolderDto {
  @ApiProperty({ enum: AssigneeType, enumName: 'AssigneeType' })
  type: AssigneeType;

  id: string;
  name: string;
  assignmentId: string;
}

export class AssetDto {
  id: string;
  assetTag: string;
  name: string;
  categoryId: string;
  categoryName: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;

  @ApiProperty({ enum: AssetStatus, enumName: 'AssetStatus' })
  status: AssetStatus;

  @ApiProperty({ enum: AssetCondition, enumName: 'AssetCondition' })
  condition: AssetCondition;

  locationId: string | null;
  locationName: string | null;

  @ApiProperty({ type: AssetHolderDto, nullable: true })
  holder: AssetHolderDto | null;

  @ApiProperty({ nullable: true, type: String, example: '2026-01-15' })
  purchaseDate: string | null;

  /** Decimal as string, e.g. "45999.90". */
  @ApiProperty({ nullable: true, type: String })
  purchaseCost: string | null;

  currency: string;

  @ApiProperty({ nullable: true, type: String })
  warrantyEndDate: string | null;
}

export class DepreciationYearDto {
  year: number;
  months: number;
  depreciation: string;
  bookValueEnd: string;
}

export class DepreciationDto {
  usefulLifeMonths: number;
  monthlyAmount: string;
  elapsedMonths: number;
  accumulated: string;
  bookValue: string;
  fullyDepreciated: boolean;

  @ApiProperty({ type: [DepreciationYearDto] })
  schedule: DepreciationYearDto[];
}

export class AssetDetailDto extends AssetDto {
  salvageValue: string;

  @ApiProperty({ nullable: true, type: Number })
  usefulLifeMonths: number | null;

  supplier: string | null;
  invoiceNo: string | null;
  notes: string | null;
  retiredAt: Date | null;
  retireReason: string | null;

  /** Null when purchase date or cost is missing. */
  @ApiProperty({ type: DepreciationDto, nullable: true })
  depreciation: DepreciationDto | null;

  createdAt: Date;
  updatedAt: Date;
}

// ---------- Assignments (zimmet) ----------

export class AssignAssetDto {
  @ApiProperty({ enum: AssigneeType, enumName: 'AssigneeType' })
  @IsEnum(AssigneeType)
  assigneeType: AssigneeType;

  @ValidateIf((o: AssignAssetDto) => o.assigneeType === AssigneeType.EMPLOYEE)
  @IsUUID('4')
  employeeId?: string;

  @ValidateIf((o: AssignAssetDto) => o.assigneeType === AssigneeType.DEPARTMENT)
  @IsUUID('4')
  departmentId?: string;

  @ValidateIf((o: AssignAssetDto) => o.assigneeType === AssigneeType.LOCATION)
  @IsUUID('4')
  locationId?: string;

  @IsDateString({ strict: true })
  assignedAt: string;

  @IsOptional()
  @IsDateString({ strict: true })
  expectedReturnDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ReturnAssetDto {
  @IsDateString({ strict: true })
  returnedAt: string;

  @ApiProperty({ enum: AssetCondition, enumName: 'AssetCondition' })
  @IsEnum(AssetCondition)
  conditionIn: AssetCondition;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  returnNotes?: string;

  /** Where the asset is stored after the return. */
  @IsOptional()
  @IsUUID('4')
  locationId?: string;
}

export class AssignmentQueryDto extends PaginationQueryDto {
  @ApiProperty({ enum: AssignmentStatus, enumName: 'AssignmentStatus', required: false })
  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;

  @ApiProperty({ enum: AssigneeType, enumName: 'AssigneeType', required: false })
  @IsOptional()
  @IsEnum(AssigneeType)
  assigneeType?: AssigneeType;

  @IsOptional()
  @IsUUID('4')
  assetId?: string;

  @IsOptional()
  @IsUUID('4')
  employeeId?: string;
}

export class AssignmentDto {
  id: string;
  number: string;
  assetId: string;
  assetTag: string;
  assetName: string;

  @ApiProperty({ enum: AssigneeType, enumName: 'AssigneeType' })
  assigneeType: AssigneeType;

  assigneeId: string;
  assigneeName: string;

  @ApiProperty({ enum: AssignmentStatus, enumName: 'AssignmentStatus' })
  status: AssignmentStatus;

  @ApiProperty({ example: '2026-10-01' })
  assignedAt: string;

  @ApiProperty({ nullable: true, type: String })
  expectedReturnDate: string | null;

  @ApiProperty({ enum: AssetCondition, enumName: 'AssetCondition' })
  conditionOut: AssetCondition;

  notes: string | null;
  acknowledgedAt: Date | null;

  @ApiProperty({ nullable: true, type: String })
  returnedAt: string | null;

  @ApiProperty({ enum: AssetCondition, enumName: 'AssetCondition', nullable: true })
  conditionIn: AssetCondition | null;

  returnNotes: string | null;
  assignedByName: string;
  returnedByName: string | null;
}

export class AssignmentDocumentAssetDto {
  assetTag: string;
  name: string;
  categoryName: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
}

export class AssignmentDocumentPartyDto {
  name: string;

  @ApiProperty({ nullable: true, type: String })
  employeeNo: string | null;

  @ApiProperty({ nullable: true, type: String })
  departmentName: string | null;

  @ApiProperty({ nullable: true, type: String })
  positionName: string | null;
}

export class AssignmentDocumentDto extends AssignmentDto {
  companyName: string;
  companyAddress: string | null;

  @ApiProperty({ type: AssignmentDocumentAssetDto })
  asset: AssignmentDocumentAssetDto;

  @ApiProperty({ type: AssignmentDocumentPartyDto })
  assignee: AssignmentDocumentPartyDto;

  /** True for the employee the asset is assigned to while it is still unacknowledged. */
  canAcknowledge: boolean;
}

// ---------- Maintenance ----------

export class CreateMaintenanceDto {
  @ApiProperty({ enum: MaintenanceType, enumName: 'MaintenanceType' })
  @IsEnum(MaintenanceType)
  type: MaintenanceType;

  @IsString()
  @Length(2, 200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendor?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @IsDateString({ strict: true })
  startedAt: string;
}

export class CompleteMaintenanceDto {
  @IsDateString({ strict: true })
  completedAt: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class MaintenanceDto {
  id: string;

  @ApiProperty({ enum: MaintenanceType, enumName: 'MaintenanceType' })
  type: MaintenanceType;

  @ApiProperty({ enum: MaintenanceStatus, enumName: 'MaintenanceStatus' })
  status: MaintenanceStatus;

  title: string;
  description: string | null;
  vendor: string | null;

  @ApiProperty({ nullable: true, type: String })
  cost: string | null;

  @ApiProperty({ example: '2026-10-01' })
  startedAt: string;

  @ApiProperty({ nullable: true, type: String })
  completedAt: string | null;
}
