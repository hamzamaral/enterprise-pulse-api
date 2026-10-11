import { Type } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Type as TransformType } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @TransformType(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @TransformType(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  /** Free text search; each endpoint documents which fields are searched. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class PaginationMetaDto {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMetaDto;
}

/** Builds a concrete Swagger class `{ data: Item[]; meta }` so generated clients are fully typed. */
export function PaginatedResponseDto<T>(item: Type<T>): Type<Paginated<T>> {
  class PaginatedResponse {
    @ApiProperty({ type: [item] })
    data: T[];

    @ApiProperty({ type: PaginationMetaDto })
    meta: PaginationMetaDto;
  }
  Object.defineProperty(PaginatedResponse, 'name', { value: `Paginated${item.name}` });
  return PaginatedResponse;
}
