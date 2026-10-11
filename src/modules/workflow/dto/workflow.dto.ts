import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { ApproverType, WorkflowActionType, WorkflowStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class WorkflowStepInputDto {
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({ enum: ApproverType, enumName: 'ApproverType' })
  @IsEnum(ApproverType)
  approverType: ApproverType;

  @ValidateIf((o: WorkflowStepInputDto) => o.approverType === ApproverType.ROLE)
  @IsUUID('4')
  approverRoleId?: string;

  @ValidateIf((o: WorkflowStepInputDto) => o.approverType === ApproverType.USER)
  @IsUUID('4')
  approverUserId?: string;
}

export class CreateWorkflowDefinitionDto {
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/)
  code: string;

  @IsString()
  @Length(2, 100)
  name: string;

  /** Document type this workflow applies to, e.g. "PurchaseRequest". */
  @IsString()
  @Length(2, 100)
  entityType: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Ordered approval steps; order is taken from array position. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepInputDto)
  steps: WorkflowStepInputDto[];
}

export class UpdateWorkflowDefinitionDto extends PartialType(
  OmitType(CreateWorkflowDefinitionDto, ['code']),
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class WorkflowStepDto {
  id: string;
  order: number;
  name: string;
  @ApiProperty({ enum: ApproverType, enumName: 'ApproverType' })
  approverType: ApproverType;
  approverRoleId: string | null;
  approverUserId: string | null;
}

export class WorkflowDefinitionDto {
  id: string;
  companyId: string;
  code: string;
  name: string;
  entityType: string;
  description: string | null;
  isActive: boolean;
  @ApiProperty({ type: [WorkflowStepDto] })
  steps: WorkflowStepDto[];
  createdAt: Date;
  updatedAt: Date;
}

export class StartWorkflowDto {
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/)
  definitionCode: string;

  @IsString()
  @Length(1, 100)
  entityId: string;

  @IsString()
  @Length(2, 200)
  title: string;
}

export class WorkflowDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RejectWorkflowDto {
  @IsString()
  @Length(2, 1000)
  comment: string;
}

export class WorkflowInstanceQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(WorkflowStatus)
  @ApiProperty({ enum: WorkflowStatus, enumName: 'WorkflowStatus', required: false })
  status?: WorkflowStatus;

  @IsOptional()
  @IsString()
  entityType?: string;

  /** "true" = only instances started by the current user. */
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false';
}

export class WorkflowActionDto {
  id: string;
  stepOrder: number;
  @ApiProperty({ enum: WorkflowActionType, enumName: 'WorkflowActionType' })
  type: WorkflowActionType;
  userId: string;
  userName: string;
  comment: string | null;
  createdAt: Date;
}

export class WorkflowInstanceDto {
  id: string;
  companyId: string;
  definitionId: string;
  definitionName: string;
  entityType: string;
  entityId: string;
  title: string;
  @ApiProperty({ enum: WorkflowStatus, enumName: 'WorkflowStatus' })
  status: WorkflowStatus;
  currentStepOrder: number;
  currentStepName: string | null;
  totalSteps: number;
  startedById: string;
  startedByName: string;
  startedAt: Date;
  completedAt: Date | null;
}

export class WorkflowInstanceDetailDto extends WorkflowInstanceDto {
  @ApiProperty({ type: [WorkflowStepDto] })
  steps: WorkflowStepDto[];
  @ApiProperty({ type: [WorkflowActionDto] })
  actions: WorkflowActionDto[];
  /** True when the current user may approve / reject the current step. */
  canAct: boolean;
}
