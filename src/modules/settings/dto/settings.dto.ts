import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsDefined,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

// ---------- Currencies (global) ----------

export class CreateCurrencyDto {
  @Matches(/^[A-Z]{3}$/)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @IsString()
  @Length(1, 5)
  symbol: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  decimals?: number;
}

export class UpdateCurrencyDto extends PartialType(OmitType(CreateCurrencyDto, ['code'])) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CurrencyDto {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  isActive: boolean;
}

// ---------- Exchange rates ----------

export class CreateExchangeRateDto {
  @Matches(/^[A-Z]{3}$/)
  currencyCode: string;

  @Type(() => Date)
  @IsDate()
  rateDate: Date;

  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  buying: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  selling: number;
}

export class ExchangeRateQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;
}

export class ExchangeRateDto {
  id: string;
  currencyCode: string;
  rateDate: Date;
  /** Decimal serialized as string to keep precision. */
  buying: string;
  selling: string;
  source: string;
  createdAt: Date;
}

// ---------- Tax rates ----------

export class CreateTaxRateDto {
  @Matches(/^[A-Z0-9_]{2,20}$/)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateTaxRateDto extends PartialType(CreateTaxRateDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TaxRateDto {
  id: string;
  companyId: string;
  code: string;
  name: string;
  rate: string;
  isDefault: boolean;
  isActive: boolean;
}

// ---------- Units ----------

export class CreateUnitDto {
  @Matches(/^[A-Z0-9_]{1,20}$/)
  code: string;

  @IsString()
  @Length(1, 100)
  name: string;
}

export class UpdateUnitDto extends PartialType(CreateUnitDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UnitDto {
  id: string;
  companyId: string;
  code: string;
  name: string;
  isActive: boolean;
}

// ---------- Company key / value settings ----------

export class UpsertSettingDto {
  @ApiProperty({ description: 'Any JSON value' })
  @IsDefined()
  value: unknown;
}

export class SettingDto {
  key: string;
  @ApiProperty({ description: 'Any JSON value' })
  value: unknown;
  updatedAt: Date;
}
