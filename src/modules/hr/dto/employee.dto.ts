import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { EmployeeStatus, EmploymentType, Gender } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class CreateEmployeeDto {
  @IsString()
  @Length(1, 100)
  firstName: string;

  @IsString()
  @Length(1, 100)
  lastName: string;

  /** Turkish national identity number (11 digits). */
  @IsOptional()
  @Matches(/^[1-9]\d{10}$/)
  nationalId?: string | null;

  @IsOptional()
  @IsEmail()
  @Transform(({ value }: { value: string | null }) => value && value.trim().toLowerCase())
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  birthDate?: string | null;

  @ApiProperty({ enum: Gender, enumName: 'Gender', required: false, nullable: true })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyContactPhone?: string | null;

  @IsDateString({ strict: true })
  hireDate: string;

  @ApiProperty({ enum: EmploymentType, enumName: 'EmploymentType', required: false })
  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsUUID('4')
  branchId?: string | null;

  @IsOptional()
  @IsUUID('4')
  departmentId?: string | null;

  @IsOptional()
  @IsUUID('4')
  positionId?: string | null;

  /** Direct manager (another employee). */
  @IsOptional()
  @IsUUID('4')
  managerId?: string | null;

  /** System user for self-service; must be a member of the company. */
  @IsOptional()
  @IsUUID('4')
  userId?: string | null;
}

/** `null` clears an optional field (e.g. removes the manager). */
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}

export class TerminateEmployeeDto {
  @IsDateString({ strict: true })
  terminationDate: string;

  @IsString()
  @Length(2, 500)
  reason: string;
}

export class EmployeeQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  departmentId?: string;

  @IsOptional()
  @IsUUID('4')
  positionId?: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @ApiProperty({ enum: EmployeeStatus, enumName: 'EmployeeStatus', required: false })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;
}

export class EmployeeRefDto {
  id: string;
  employeeNo: string;
  fullName: string;
}

export class EmployeeDto {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;

  @ApiProperty({ enum: EmployeeStatus, enumName: 'EmployeeStatus' })
  status: EmployeeStatus;

  @ApiProperty({ enum: EmploymentType, enumName: 'EmploymentType' })
  employmentType: EmploymentType;

  @ApiProperty({ example: '2024-03-01' })
  hireDate: string;

  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionName: string | null;
  branchId: string | null;
  branchName: string | null;
  managerId: string | null;
  managerName: string | null;
  userId: string | null;
}

export class EmployeeDetailDto extends EmployeeDto {
  nationalId: string | null;

  @ApiProperty({ example: '1990-05-17', nullable: true, type: String })
  birthDate: string | null;

  @ApiProperty({ enum: Gender, enumName: 'Gender', nullable: true })
  gender: Gender | null;

  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;

  @ApiProperty({ nullable: true, type: String })
  terminationDate: string | null;

  terminationReason: string | null;
  userEmail: string | null;
  reports: EmployeeRefDto[];
  createdAt: Date;
  updatedAt: Date;
}

export class OrgChartNodeDto {
  id: string;
  fullName: string;
  positionName: string | null;
  departmentName: string | null;

  @ApiProperty({ type: () => [OrgChartNodeDto] })
  children: OrgChartNodeDto[];
}
