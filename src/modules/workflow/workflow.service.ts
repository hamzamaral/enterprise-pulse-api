import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApproverType,
  Prisma,
  WorkflowActionType,
  WorkflowStatus,
  type WorkflowStep,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginated, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  StartWorkflowDto,
  WorkflowInstanceDetailDto,
  WorkflowInstanceDto,
  WorkflowInstanceQueryDto,
} from './dto/workflow.dto';
import { WORKFLOW_EVENTS, type WorkflowFinishedEvent } from './workflow.events';

const instanceInclude = {
  definition: { include: { steps: { orderBy: { order: 'asc' } } } },
} satisfies Prisma.WorkflowInstanceInclude;

type InstanceWithDefinition = Prisma.WorkflowInstanceGetPayload<{
  include: typeof instanceInclude;
}>;

/**
 * Generic multi-step approval engine. Any module can start a workflow for one of its documents
 * (`entityType` + `entityId`) and react to WORKFLOW_EVENTS when it finishes.
 */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  async start(user: AuthUser, dto: StartWorkflowDto): Promise<WorkflowInstanceDetailDto> {
    const definition = await this.prisma.workflowDefinition.findFirst({
      where: { companyId: user.companyId, code: dto.definitionCode, isActive: true },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!definition) throw new NotFoundException(`Workflow "${dto.definitionCode}" not found`);
    if (!definition.steps.length) throw new BadRequestException('Workflow has no steps');

    const running = await this.prisma.workflowInstance.count({
      where: {
        companyId: user.companyId,
        entityType: definition.entityType,
        entityId: dto.entityId,
        status: WorkflowStatus.PENDING,
      },
    });
    if (running) throw new ConflictException('An approval is already in progress for this record');

    const instance = await this.prisma.workflowInstance.create({
      data: {
        companyId: user.companyId,
        definitionId: definition.id,
        entityType: definition.entityType,
        entityId: dto.entityId,
        title: dto.title,
        currentStepOrder: 1,
        startedById: user.id,
        actions: { create: { stepOrder: 0, type: WorkflowActionType.START, userId: user.id } },
      },
      include: instanceInclude,
    });

    await this.notifyApprovers(instance, definition.steps[0]);
    return this.findOne(user, instance.id);
  }

  async approve(user: AuthUser, id: string, comment?: string): Promise<WorkflowInstanceDetailDto> {
    const instance = await this.getPending(user, id);
    const step = currentStep(instance);
    await this.assertCanAct(user, step);

    const isLast = step.order === instance.definition.steps.length;
    await this.transition(instance, user.id, WorkflowActionType.APPROVE, comment, {
      currentStepOrder: isLast ? step.order : step.order + 1,
      status: isLast ? WorkflowStatus.APPROVED : WorkflowStatus.PENDING,
      completedAt: isLast ? new Date() : null,
    });

    if (isLast) {
      this.emitFinished(WORKFLOW_EVENTS.APPROVED, instance, user.id);
      await this.notifications.notify({
        userIds: [instance.startedById],
        companyId: instance.companyId,
        type: 'workflow.approved',
        title: 'Onay tamamlandı',
        body: `"${instance.title}" onaylandı.`,
        link: `/workflow/instances/${instance.id}`,
      });
    } else {
      const next = instance.definition.steps.find((s) => s.order === step.order + 1);
      if (next) await this.notifyApprovers(instance, next);
    }
    return this.findOne(user, id);
  }

  async reject(user: AuthUser, id: string, comment: string): Promise<WorkflowInstanceDetailDto> {
    const instance = await this.getPending(user, id);
    await this.assertCanAct(user, currentStep(instance));

    await this.transition(instance, user.id, WorkflowActionType.REJECT, comment, {
      status: WorkflowStatus.REJECTED,
      completedAt: new Date(),
    });
    this.emitFinished(WORKFLOW_EVENTS.REJECTED, instance, user.id);
    await this.notifications.notify({
      userIds: [instance.startedById],
      companyId: instance.companyId,
      type: 'workflow.rejected',
      title: 'Onay reddedildi',
      body: `"${instance.title}" reddedildi: ${comment}`,
      link: `/workflow/instances/${instance.id}`,
    });
    return this.findOne(user, id);
  }

  async cancel(user: AuthUser, id: string, comment?: string): Promise<WorkflowInstanceDetailDto> {
    const instance = await this.getPending(user, id);
    if (instance.startedById !== user.id && !user.isSuperAdmin) {
      throw new ForbiddenException('Only the requester can cancel this approval');
    }
    await this.transition(instance, user.id, WorkflowActionType.CANCEL, comment, {
      status: WorkflowStatus.CANCELLED,
      completedAt: new Date(),
    });
    this.emitFinished(WORKFLOW_EVENTS.CANCELLED, instance, user.id);
    return this.findOne(user, id);
  }

  async findAll(user: AuthUser, query: WorkflowInstanceQueryDto) {
    const where: Prisma.WorkflowInstanceWhereInput = {
      companyId: user.companyId,
      status: query.status,
      entityType: query.entityType,
      ...(query.mine === 'true' ? { startedById: user.id } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.workflowInstance.findMany({
        where,
        include: instanceInclude,
        orderBy: { startedAt: query.sortOrder ?? 'desc' },
        ...toPageArgs(query),
      }),
      this.prisma.workflowInstance.count({ where }),
    ]);
    return paginated(await this.toDtos(rows), total, query);
  }

  /** Pending instances whose current step can be decided by the current user. */
  async inbox(user: AuthUser, query: WorkflowInstanceQueryDto) {
    const roleIds = await this.userRoleIds(user);
    const pending = await this.prisma.workflowInstance.findMany({
      where: { companyId: user.companyId, status: WorkflowStatus.PENDING },
      include: instanceInclude,
      orderBy: { startedAt: 'asc' },
    });
    const mine = pending.filter((instance) => isApprover(user, currentStep(instance), roleIds));
    const page = mine.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    return paginated(await this.toDtos(page), mine.length, query);
  }

  async findOne(user: AuthUser, id: string): Promise<WorkflowInstanceDetailDto> {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id, companyId: user.companyId },
      include: { ...instanceInclude, actions: { orderBy: { createdAt: 'asc' } } },
    });
    if (!instance) throw new NotFoundException('Workflow instance not found');

    const [dto] = await this.toDtos([instance]);
    const names = await this.userNames(instance.actions.map((a) => a.userId));
    const roleIds = await this.userRoleIds(user);

    return {
      ...dto,
      steps: instance.definition.steps,
      actions: instance.actions.map((a) => ({
        id: a.id,
        stepOrder: a.stepOrder,
        type: a.type,
        userId: a.userId,
        userName: names.get(a.userId) ?? '',
        comment: a.comment,
        createdAt: a.createdAt,
      })),
      canAct:
        instance.status === WorkflowStatus.PENDING &&
        isApprover(user, currentStep(instance), roleIds),
    };
  }

  private async getPending(user: AuthUser, id: string): Promise<InstanceWithDefinition> {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id, companyId: user.companyId },
      include: instanceInclude,
    });
    if (!instance) throw new NotFoundException('Workflow instance not found');
    if (instance.status !== WorkflowStatus.PENDING) {
      throw new ConflictException(`Workflow is already ${instance.status.toLowerCase()}`);
    }
    return instance;
  }

  /**
   * Optimistic concurrency: the update only matches if nobody moved the instance in the meantime,
   * so two approvers clicking at the same time cannot both succeed.
   */
  private async transition(
    instance: InstanceWithDefinition,
    userId: string,
    type: WorkflowActionType,
    comment: string | undefined,
    data: Prisma.WorkflowInstanceUpdateManyMutationInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.workflowInstance.updateMany({
        where: {
          id: instance.id,
          status: WorkflowStatus.PENDING,
          currentStepOrder: instance.currentStepOrder,
        },
        data,
      });
      if (!count) throw new ConflictException('Workflow was updated by someone else, reload it');
      await tx.workflowAction.create({
        data: {
          instanceId: instance.id,
          stepOrder: instance.currentStepOrder,
          type,
          userId,
          comment,
        },
      });
    });
  }

  private async assertCanAct(user: AuthUser, step: WorkflowStep): Promise<void> {
    if (!isApprover(user, step, await this.userRoleIds(user))) {
      throw new ForbiddenException('You are not an approver for the current step');
    }
  }

  private async notifyApprovers(instance: InstanceWithDefinition, step: WorkflowStep) {
    const userIds =
      step.approverType === ApproverType.USER
        ? [step.approverUserId!]
        : (
            await this.prisma.userRole.findMany({
              where: {
                roleId: step.approverRoleId!,
                companyId: instance.companyId,
                user: { isActive: true, deletedAt: null },
              },
              select: { userId: true },
            })
          ).map((r) => r.userId);

    await this.notifications.notify({
      userIds,
      companyId: instance.companyId,
      type: 'workflow.approval_requested',
      title: 'Onayınızı bekleyen talep',
      body: `"${instance.title}" — ${step.name}`,
      link: `/workflow/instances/${instance.id}`,
    });
  }

  private emitFinished(event: string, instance: InstanceWithDefinition, actorId: string) {
    this.events.emit(event, {
      instanceId: instance.id,
      companyId: instance.companyId,
      definitionCode: instance.definition.code,
      entityType: instance.entityType,
      entityId: instance.entityId,
      actorId,
    } satisfies WorkflowFinishedEvent);
  }

  private async userRoleIds(user: AuthUser): Promise<Set<string>> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId: user.id, companyId: user.companyId },
      select: { roleId: true },
    });
    return new Set(rows.map((r) => r.roleId));
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  }

  private async toDtos(rows: InstanceWithDefinition[]): Promise<WorkflowInstanceDto[]> {
    const names = await this.userNames(rows.map((r) => r.startedById));
    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      definitionId: row.definitionId,
      definitionName: row.definition.name,
      entityType: row.entityType,
      entityId: row.entityId,
      title: row.title,
      status: row.status,
      currentStepOrder: row.currentStepOrder,
      currentStepName:
        row.definition.steps.find((s) => s.order === row.currentStepOrder)?.name ?? null,
      totalSteps: row.definition.steps.length,
      startedById: row.startedById,
      startedByName: names.get(row.startedById) ?? '',
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    }));
  }
}

function currentStep(instance: InstanceWithDefinition): WorkflowStep {
  const step = instance.definition.steps.find((s) => s.order === instance.currentStepOrder);
  if (!step) throw new ConflictException('Workflow definition no longer contains the current step');
  return step;
}

function isApprover(user: AuthUser, step: WorkflowStep, roleIds: Set<string>): boolean {
  if (user.isSuperAdmin) return true;
  return step.approverType === ApproverType.USER
    ? step.approverUserId === user.id
    : !!step.approverRoleId && roleIds.has(step.approverRoleId);
}
