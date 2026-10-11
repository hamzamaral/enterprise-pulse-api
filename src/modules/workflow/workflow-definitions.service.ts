import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApproverType } from '@prisma/client';
import { PrismaService, PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type {
  CreateWorkflowDefinitionDto,
  UpdateWorkflowDefinitionDto,
  WorkflowStepInputDto,
} from './dto/workflow.dto';

const withSteps = { steps: { orderBy: { order: 'asc' } } } as const;

@Injectable()
export class WorkflowDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(companyId: string) {
    return this.prisma.workflowDefinition.findMany({
      where: { companyId },
      include: withSteps,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const definition = await this.prisma.workflowDefinition.findFirst({
      where: { id, companyId },
      include: withSteps,
    });
    if (!definition) throw new NotFoundException('Workflow definition not found');
    return definition;
  }

  async create(companyId: string, dto: CreateWorkflowDefinitionDto) {
    const { steps, ...data } = dto;
    return this.prisma.$transaction(async (tx) => {
      await this.assertApprovers(tx, companyId, steps);
      return tx.workflowDefinition.create({
        data: { ...data, companyId, steps: { create: toStepRows(steps) } },
        include: withSteps,
      });
    });
  }

  /** Replacing steps only affects new instances; running instances keep their step order. */
  async update(companyId: string, id: string, dto: UpdateWorkflowDefinitionDto) {
    await this.findOne(companyId, id);
    const { steps, ...data } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (steps) {
        await this.assertApprovers(tx, companyId, steps);
        await tx.workflowStep.deleteMany({ where: { definitionId: id } });
        await tx.workflowStep.createMany({
          data: toStepRows(steps).map((row) => ({ ...row, definitionId: id })),
        });
      }
      return tx.workflowDefinition.update({ where: { id }, data, include: withSteps });
    });
  }

  private async assertApprovers(tx: PrismaTx, companyId: string, steps: WorkflowStepInputDto[]) {
    for (const step of steps) {
      if (step.approverType === ApproverType.ROLE) {
        const role = await tx.role.findFirst({
          where: {
            id: step.approverRoleId,
            deletedAt: null,
            OR: [{ companyId }, { companyId: null }],
          },
        });
        if (!role) throw new BadRequestException(`Step "${step.name}": role not found`);
      } else {
        const member = await tx.userCompany.findFirst({
          where: { userId: step.approverUserId, companyId },
        });
        if (!member) throw new BadRequestException(`Step "${step.name}": user is not a member`);
      }
    }
  }
}

function toStepRows(steps: WorkflowStepInputDto[]) {
  return steps.map((step, index) => ({
    order: index + 1,
    name: step.name,
    approverType: step.approverType,
    approverRoleId: step.approverType === ApproverType.ROLE ? step.approverRoleId : null,
    approverUserId: step.approverType === ApproverType.USER ? step.approverUserId : null,
  }));
}
