import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, LeaveRequestStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { WorkflowService } from '../workflow/workflow.service';
import { parseDateOnly, toDateOnly } from './date-only';
import type {
  CancelLeaveRequestDto,
  CreateLeaveRequestDto,
  LeaveRequestDto,
  LeaveRequestQueryDto,
  WorkingDaysDto,
} from './dto/leave.dto';
import { hasPermission, LEAVE_WORKFLOW_CODE } from './hr-access';
import { LeaveSettingsService } from './leave-settings.service';
import { countWorkingDays } from './working-days';

const SORTABLE = ['number', 'startDate', 'createdAt', 'status'] as const;

const requestInclude = {
  employee: { select: { firstName: true, lastName: true, userId: true } },
  leaveType: { select: { name: true, color: true } },
} satisfies Prisma.LeaveRequestInclude;

type RequestRow = Prisma.LeaveRequestGetPayload<{ include: typeof requestInclude }>;

@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly workflow: WorkflowService,
    private readonly settings: LeaveSettingsService,
  ) {}

  async findAll(user: AuthUser, query: LeaveRequestQueryDto) {
    const onlyMine = query.mine === 'true' || !hasPermission(user, 'leave:read');
    const where: Prisma.LeaveRequestWhereInput = {
      companyId: user.companyId,
      status: query.status,
      employeeId: query.employeeId,
      leaveTypeId: query.leaveTypeId,
      ...(onlyMine ? { employee: { userId: user.id } } : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { employee: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { employee: { lastName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        include: requestInclude,
        orderBy: toOrderBy(query, SORTABLE, 'createdAt'),
        ...toPageArgs(query),
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return paginated(
      rows.map((row) => toDto(row, user)),
      total,
      query,
    );
  }

  async findOne(user: AuthUser, id: string): Promise<LeaveRequestDto> {
    return toDto(await this.getVisible(user, id), user);
  }

  async workingDays(
    companyId: string,
    startDate: string,
    endDate: string,
  ): Promise<WorkingDaysDto> {
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    const holidays = await this.settings.holidaySet(companyId, start, end);
    return { days: countWorkingDays(start, end, holidays) };
  }

  async create(user: AuthUser, dto: CreateLeaveRequestDto): Promise<LeaveRequestDto> {
    const { companyId } = user;
    const employee = await this.resolveEmployee(user, dto.employeeId);
    const type = await this.settings.getType(companyId, dto.leaveTypeId);
    if (!type.isActive) throw new BadRequestException('Leave type is not active');

    const start = parseDateOnly(dto.startDate);
    const end = parseDateOnly(dto.endDate);
    if (end < start) throw new BadRequestException('End date cannot be before the start date');
    const year = start.getUTCFullYear();
    if (end.getUTCFullYear() !== year) {
      throw new BadRequestException('A leave request cannot span two calendar years');
    }

    const { days } = await this.workingDays(companyId, dto.startDate, dto.endDate);
    if (!days) throw new BadRequestException('The selected range has no working days');

    const overlapping = await this.prisma.leaveRequest.count({
      where: {
        employeeId: employee.id,
        status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    if (overlapping) throw new ConflictException('Overlaps with another leave request');

    if (type.requiresBalance) {
      const balances = await this.settings.findBalances(companyId, {
        employeeId: employee.id,
        year,
      });
      const balance = balances.find((b) => b.leaveTypeId === type.id);
      if (!balance) throw new BadRequestException(`No ${type.name} balance defined for ${year}`);
      if (days > balance.remainingDays) {
        throw new BadRequestException(
          `Insufficient balance: ${balance.remainingDays} day(s) remaining, ${days} requested`,
        );
      }
    }

    // Without an active approval workflow the request is approved immediately.
    const hasWorkflow = await this.prisma.workflowDefinition.count({
      where: { companyId, code: LEAVE_WORKFLOW_CODE, isActive: true },
    });

    const request = await this.prisma.$transaction(async (tx) => {
      const number = await this.numbering.next(companyId, 'LEAVE_REQUEST', tx);
      const row = await tx.leaveRequest.create({
        data: {
          companyId,
          number,
          employeeId: employee.id,
          leaveTypeId: type.id,
          startDate: start,
          endDate: end,
          days,
          reason: dto.reason,
          createdById: user.id,
          status: hasWorkflow ? LeaveRequestStatus.PENDING : LeaveRequestStatus.APPROVED,
          decidedAt: hasWorkflow ? null : new Date(),
        },
      });
      if (!hasWorkflow) await this.adjustUsedDays(tx, row, days);
      return row;
    });

    if (hasWorkflow) {
      try {
        const instance = await this.workflow.start(user, {
          definitionCode: LEAVE_WORKFLOW_CODE,
          entityId: request.number,
          title: `${employee.firstName} ${employee.lastName} — ${type.name} (${days} gün)`,
        });
        await this.prisma.leaveRequest.update({
          where: { id: request.id },
          data: { workflowInstanceId: instance.id },
        });
      } catch (error) {
        await this.prisma.leaveRequest.delete({ where: { id: request.id } });
        throw error;
      }
    }
    return this.findOne(user, request.id);
  }

  /**
   * Pending requests are withdrawn by their creator (which cancels the approval). Approved requests
   * that have not started yet can be cancelled by HR (`leave:update`), restoring the balance.
   */
  async cancel(user: AuthUser, id: string, dto: CancelLeaveRequestDto): Promise<LeaveRequestDto> {
    const request = await this.getVisible(user, id);

    if (request.status === LeaveRequestStatus.PENDING) {
      if (request.createdById !== user.id && !user.isSuperAdmin) {
        throw new ForbiddenException('Only the requester can withdraw a pending request');
      }
      if (request.workflowInstanceId) {
        await this.workflow.cancel(user, request.workflowInstanceId, dto.comment);
      }
      await this.decide(request.companyId, request.number, LeaveRequestStatus.CANCELLED);
      return this.findOne(user, id);
    }

    if (request.status === LeaveRequestStatus.APPROVED) {
      if (!hasPermission(user, 'leave:update')) {
        throw new ForbiddenException('Approved requests can only be cancelled by HR');
      }
      if (hasStarted(request.startDate)) {
        throw new ConflictException('Leave has already started');
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.leaveRequest.update({
          where: { id },
          data: { status: LeaveRequestStatus.CANCELLED, decidedAt: new Date() },
        });
        await this.adjustUsedDays(tx, request, -request.days);
      });
      return this.findOne(user, id);
    }

    throw new ConflictException('Request is already closed');
  }

  /**
   * Applies a workflow outcome. Only pending requests change, so repeated events are harmless.
   */
  async decide(companyId: string, number: string, status: LeaveRequestStatus): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.leaveRequest.findFirst({
        where: { companyId, number, status: LeaveRequestStatus.PENDING },
      });
      if (!request) return;
      await tx.leaveRequest.update({
        where: { id: request.id },
        data: { status, decidedAt: new Date() },
      });
      if (status === LeaveRequestStatus.APPROVED) {
        await this.adjustUsedDays(tx, request, request.days);
      }
    });
  }

  private async adjustUsedDays(
    tx: PrismaTx,
    request: { employeeId: string; leaveTypeId: string; startDate: Date },
    delta: number,
  ) {
    await tx.leaveBalance.updateMany({
      where: {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        year: request.startDate.getUTCFullYear(),
        leaveType: { requiresBalance: true },
      },
      data: { usedDays: { increment: delta } },
    });
  }

  private async resolveEmployee(user: AuthUser, employeeId?: string) {
    const own = await this.prisma.employee.findFirst({
      where: { companyId: user.companyId, userId: user.id, deletedAt: null },
    });
    if (employeeId && employeeId !== own?.id) {
      if (!hasPermission(user, 'leave:create')) {
        throw new ForbiddenException('You can only request leave for yourself');
      }
      const other = await this.prisma.employee.findFirst({
        where: { id: employeeId, companyId: user.companyId, deletedAt: null },
      });
      if (!other) throw new NotFoundException('Employee not found');
      return assertActive(other);
    }
    if (!own) throw new NotFoundException('No employee record is linked to your account');
    return assertActive(own);
  }

  private async getVisible(user: AuthUser, id: string): Promise<RequestRow> {
    const row = await this.prisma.leaveRequest.findFirst({
      where: { id, companyId: user.companyId },
      include: requestInclude,
    });
    const visible =
      row &&
      (hasPermission(user, 'leave:read') ||
        row.employee.userId === user.id ||
        row.createdById === user.id);
    if (!visible) throw new NotFoundException('Leave request not found');
    return row;
  }
}

function assertActive<T extends { status: EmployeeStatus }>(employee: T): T {
  if (employee.status !== EmployeeStatus.ACTIVE) {
    throw new BadRequestException('Employee is not active');
  }
  return employee;
}

function hasStarted(startDate: Date): boolean {
  return startDate <= parseDateOnly(new Date().toISOString());
}

/** Mirrors the rules enforced by `cancel` so clients can show the action only when allowed. */
function canCancel(row: RequestRow, user: AuthUser): boolean {
  if (row.status === LeaveRequestStatus.PENDING) {
    return row.createdById === user.id || user.isSuperAdmin;
  }
  if (row.status === LeaveRequestStatus.APPROVED) {
    return hasPermission(user, 'leave:update') && !hasStarted(row.startDate);
  }
  return false;
}

function toDto(row: RequestRow, user: AuthUser): LeaveRequestDto {
  return {
    id: row.id,
    number: row.number,
    employeeId: row.employeeId,
    employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
    leaveTypeId: row.leaveTypeId,
    leaveTypeName: row.leaveType.name,
    leaveTypeColor: row.leaveType.color,
    startDate: toDateOnly(row.startDate),
    endDate: toDateOnly(row.endDate),
    days: row.days,
    reason: row.reason,
    status: row.status,
    workflowInstanceId: row.workflowInstanceId,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    canCancel: canCancel(row, user),
  };
}
