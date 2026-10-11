import { ApiProperty } from '@nestjs/swagger';
import { AssetCondition, AssetCountStatus } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class CreateAssetCountDto {
  @IsDateString({ strict: true })
  countDate: string;

  /** Limit the count to assets stored at or assigned to this location. */
  @IsOptional()
  @IsUUID('4')
  locationId?: string;

  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ScanAssetDto {
  /** QR label content (asset URL), asset tag or serial number. */
  @IsString()
  @Length(1, 500)
  code: string;
}

export class UpdateAssetCountLineDto {
  @IsOptional()
  @IsBoolean()
  found?: boolean;

  @ApiProperty({
    enum: AssetCondition,
    enumName: 'AssetCondition',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(AssetCondition)
  condition?: AssetCondition | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class CompleteAssetCountDto {
  /** Copy the conditions observed during the count onto the asset cards. */
  @IsOptional()
  @IsBoolean()
  applyConditions?: boolean;
}

export class AssetCountQueryDto extends PaginationQueryDto {
  @ApiProperty({ enum: AssetCountStatus, enumName: 'AssetCountStatus', required: false })
  @IsOptional()
  @IsEnum(AssetCountStatus)
  status?: AssetCountStatus;
}

export class AssetCountDto {
  id: string;
  number: string;
  @ApiProperty({ enum: AssetCountStatus, enumName: 'AssetCountStatus' })
  status: AssetCountStatus;
  countDate: string;
  locationId: string | null;
  locationName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** Assets expected in scope. */
  expectedCount: number;
  foundCount: number;
  /** Expected but not (yet) found. */
  missingCount: number;
  /** Scanned assets that were outside the scope. */
  unexpectedCount: number;
  createdByName: string;
  createdAt: Date;
  completedAt: Date | null;
}

export class AssetCountLineDto {
  id: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  categoryName: string;
  serialNumber: string | null;
  expected: boolean;
  expectedHolder: string | null;
  found: boolean;
  foundAt: Date | null;
  foundByName: string | null;
  @ApiProperty({ enum: AssetCondition, enumName: 'AssetCondition', nullable: true })
  condition: AssetCondition | null;
  @ApiProperty({ enum: AssetCondition, enumName: 'AssetCondition' })
  currentCondition: AssetCondition;
  note: string | null;
}

export class AssetCountDetailDto extends AssetCountDto {
  notes: string | null;
  lines: AssetCountLineDto[];
}

export class AssetScanResultDto {
  @ApiProperty({ enum: ['FOUND', 'ALREADY_FOUND', 'UNEXPECTED'] })
  result: 'FOUND' | 'ALREADY_FOUND' | 'UNEXPECTED';
  line: AssetCountLineDto;
}
