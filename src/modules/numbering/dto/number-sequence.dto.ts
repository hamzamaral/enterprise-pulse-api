import { OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class CreateNumberSequenceDto {
  /** Document type code used by modules, e.g. "ASSET_ASSIGNMENT". */
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @Matches(/^[A-Z0-9]{1,10}$/)
  prefix: string;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(12)
  padding?: number;

  @IsOptional()
  @IsBoolean()
  includeYear?: boolean;

  @IsOptional()
  @IsBoolean()
  resetYearly?: boolean;
}

export class UpdateNumberSequenceDto extends PartialType(
  OmitType(CreateNumberSequenceDto, ['code']),
) {
  @IsOptional()
  @IsInt()
  @Min(1)
  nextValue?: number;
}

export class NumberSequenceDto {
  id: string;
  companyId: string;
  code: string;
  name: string;
  prefix: string;
  padding: number;
  includeYear: boolean;
  resetYearly: boolean;
  currentYear: number;
  nextValue: number;
  /** The number the next document will receive. */
  preview: string;
}
