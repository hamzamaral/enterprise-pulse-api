import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsStrongPassword,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class CreateUserDto {
  @IsEmail()
  @Transform(({ value }: { value: string }) => value?.trim().toLowerCase())
  email: string;

  @IsString()
  @Length(1, 100)
  firstName: string;

  @IsString()
  @Length(1, 100)
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsIn(['tr', 'en'])
  locale?: string;

  /** When omitted the user receives an invitation e-mail to set their own password. */
  @IsOptional()
  @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 0,
  })
  password?: string;

  /** Roles granted in the active company. */
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds: string[];

  @IsOptional()
  @IsUUID('4')
  defaultBranchId?: string;
}

export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['email', 'password'])) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UserQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => String)
  @IsIn(['true', 'false'])
  isActive?: 'true' | 'false';

  @IsOptional()
  @IsUUID('4')
  roleId?: string;
}

export class RoleRefDto {
  id: string;
  code: string;
  name: string;
}

export class UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: string | null;
  locale: string;
  isActive: boolean;
  isSuperAdmin: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  defaultBranchId: string | null;
  @ApiProperty({ type: [RoleRefDto] })
  roles: RoleRefDto[];
}
