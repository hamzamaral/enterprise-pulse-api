import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class CreateDepartmentDto {
  @Matches(/^[A-Z0-9-]{2,20}$/)
  code: string;

  @IsString()
  @Length(2, 200)
  name: string;

  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  /** Employee who manages the department. */
  @IsOptional()
  @IsUUID('4')
  managerId?: string | null;
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class DepartmentDto {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  managerId: string | null;
  managerName: string | null;
  employeeCount: number;
  isActive: boolean;
  createdAt: Date;
}

export class CreatePositionDto {
  @Matches(/^[A-Z0-9-]{2,20}$/)
  code: string;

  @IsString()
  @Length(2, 200)
  name: string;

  @IsOptional()
  @IsUUID('4')
  departmentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

export class UpdatePositionDto extends PartialType(CreatePositionDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PositionQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  departmentId?: string;
}

export class PositionDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  departmentId: string | null;
  departmentName: string | null;
  employeeCount: number;
  isActive: boolean;
  createdAt: Date;
}
