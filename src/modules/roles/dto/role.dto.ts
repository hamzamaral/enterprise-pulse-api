import { PartialType } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateRoleDto {
  @Matches(/^[a-z0-9-]{2,50}$/)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Permission codes such as "users:read". */
  @IsArray()
  @ArrayUnique()
  @Matches(/^[a-z-]+:[a-z-]+$/, { each: true })
  permissionCodes: string[];
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}

export class RoleDto {
  id: string;
  companyId: string | null;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCodes: string[];
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class PermissionDto {
  id: string;
  code: string;
  module: string;
  action: string;
  description: string | null;
}
