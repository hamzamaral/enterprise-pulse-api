import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectTaskPriority, ProjectTaskStatus } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  CreateProjectTaskDto,
  MoveProjectTaskDto,
  ProjectTaskDto,
  ProjectTaskQueryDto,
  UpdateProjectTaskDto,
} from './dto/project.dto';
import { CLOSED_STATUSES, isOverdue, reorder } from './project-math';
import { ProjectsService, type ProjectAccess } from './projects.service';

const OPEN_PROJECT = { status: { notIn: CLOSED_STATUSES } } satisfies Prisma.ProjectWhereInput;
const PRIORITY_RANK: Record<ProjectTaskPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const taskInclude = {
  project: { select: { number: true, name: true } },
  assignee: { select: { firstName: true, lastName: true, userId: true } },
} satisfies Prisma.ProjectTaskInclude;

type TaskRow = Prisma.ProjectTaskGetPayload<{ include: typeof taskInclude }>;

/** Kanban tasks of a project; any member works on them, deleting is for the people who run it. */
@Injectable()
export class ProjectTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(
    user: AuthUser,
    projectId: string,
    query: ProjectTaskQueryDto,
  ): Promise<ProjectTaskDto[]> {
    await this.projects.access(user, projectId);
    const rows = await this.prisma.projectTask.findMany({
      where: { projectId, assigneeId: query.assigneeId, status: query.status },
      include: taskInclude,
      orderBy: [{ sortOrder: 'asc' }, { taskNo: 'asc' }],
    });
    return this.toDtos(rows);
  }

  /** Open tasks assigned to the current user on open projects, most urgent first. */
  async mine(user: AuthUser): Promise<ProjectTaskDto[]> {
    const employee = await this.projects.ownEmployee(user);
    if (!employee) return [];
    const rows = await this.prisma.projectTask.findMany({
      where: {
        assigneeId: employee.id,
        status: { not: ProjectTaskStatus.DONE },
        project: { companyId: user.companyId, ...OPEN_PROJECT },
      },
      include: taskInclude,
    });
    rows.sort(
      (a, b) =>
        (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.taskNo - b.taskNo,
    );
    return this.toDtos(rows);
  }

  async create(
    user: AuthUser,
    projectId: string,
    dto: CreateProjectTaskDto,
  ): Promise<ProjectTaskDto> {
    const access = await this.workable(user, projectId);
    const assignee = this.assignee(access, dto.assigneeId);
    const status = dto.status ?? ProjectTaskStatus.TODO;
    const id = await this.prisma.$transaction(async (tx) => {
      await lockProject(tx, projectId);
      const [last, column] = await Promise.all([
        tx.projectTask.aggregate({ where: { projectId }, _max: { taskNo: true } }),
        tx.projectTask.aggregate({ where: { projectId, status }, _max: { sortOrder: true } }),
      ]);
      const task = await tx.projectTask.create({
        data: {
          projectId,
          taskNo: (last._max.taskNo ?? 0) + 1,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          status,
          priority: dto.priority ?? ProjectTaskPriority.MEDIUM,
          assigneeId: assignee?.employeeId ?? null,
          dueDate: dto.dueDate ? parseDateOnly(dto.dueDate) : null,
          estimatedHours: dto.estimatedHours ?? null,
          sortOrder: (column._max.sortOrder ?? -1) + 1,
          completedAt: status === ProjectTaskStatus.DONE ? new Date() : null,
          createdById: user.id,
        },
      });
      return task.id;
    });
    const task = await this.get(id);
    await this.notifyAssignee(user, task);
    return (await this.toDtos([task]))[0];
  }

  async update(user: AuthUser, id: string, dto: UpdateProjectTaskDto): Promise<ProjectTaskDto> {
    const current = await this.get(id);
    const access = await this.workable(user, current.projectId);
    const assignee =
      dto.assigneeId === undefined ? undefined : this.assignee(access, dto.assigneeId);
    const status = dto.status ?? current.status;
    await this.prisma.$transaction(async (tx) => {
      let sortOrder: number | undefined;
      if (status !== current.status) {
        await lockProject(tx, current.projectId);
        const column = await tx.projectTask.aggregate({
          where: { projectId: current.projectId, status },
          _max: { sortOrder: true },
        });
        sortOrder = (column._max.sortOrder ?? -1) + 1;
      }
      await tx.projectTask.update({
        where: { id },
        data: {
          title: dto.title?.trim(),
          description: dto.description === undefined ? undefined : dto.description?.trim() || null,
          status,
          sortOrder,
          priority: dto.priority,
          assigneeId: assignee === undefined ? undefined : (assignee?.employeeId ?? null),
          dueDate:
            dto.dueDate === undefined ? undefined : dto.dueDate && parseDateOnly(dto.dueDate),
          estimatedHours: dto.estimatedHours === undefined ? undefined : dto.estimatedHours,
          completedAt: completedAt(current, status),
        },
      });
    });
    const task = await this.get(id);
    if (task.assigneeId !== current.assigneeId) await this.notifyAssignee(user, task);
    return (await this.toDtos([task]))[0];
  }

  /** Drag and drop on the board: change column and position in one step. */
  async move(user: AuthUser, id: string, dto: MoveProjectTaskDto): Promise<ProjectTaskDto> {
    const current = await this.get(id);
    await this.workable(user, current.projectId);
    await this.prisma.$transaction(async (tx) => {
      await lockProject(tx, current.projectId);
      const column = await tx.projectTask.findMany({
        where: { projectId: current.projectId, status: dto.status },
        orderBy: [{ sortOrder: 'asc' }, { taskNo: 'asc' }],
        select: { id: true },
      });
      const ordered = reorder(
        column.map((t) => t.id),
        id,
        dto.position,
      );
      await tx.projectTask.update({
        where: { id },
        data: { status: dto.status, completedAt: completedAt(current, dto.status) },
      });
      await Promise.all(
        ordered.map((taskId, index) =>
          tx.projectTask.update({ where: { id: taskId }, data: { sortOrder: index } }),
        ),
      );
    });
    return (await this.toDtos([await this.get(id)]))[0];
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const task = await this.get(id);
    await this.projects.manageable(user, task.projectId);
    const logged = await this.prisma.timeEntry.count({ where: { taskId: id } });
    if (logged > 0) throw new ConflictException('Tasks with logged time cannot be deleted');
    await this.prisma.projectTask.delete({ where: { id } });
  }

  /** Visible to the user and the user may change tasks: a member or someone who runs it. */
  private async workable(user: AuthUser, projectId: string): Promise<ProjectAccess> {
    const access = await this.projects.access(user, projectId);
    if (!access.member && !access.canManage) {
      throw new ForbiddenException('Only project members can change tasks');
    }
    if (CLOSED_STATUSES.includes(access.project.status)) {
      throw new ConflictException('The project is closed');
    }
    return access;
  }

  private assignee(access: ProjectAccess, employeeId: string | null | undefined) {
    if (!employeeId) return null;
    const member = access.project.members.find((m) => m.employeeId === employeeId);
    if (!member) throw new BadRequestException('Tasks can only be assigned to project members');
    return member;
  }

  private async get(id: string): Promise<TaskRow> {
    const task = await this.prisma.projectTask.findUnique({ where: { id }, include: taskInclude });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private async toDtos(rows: TaskRow[]): Promise<ProjectTaskDto[]> {
    const hours = rows.length
      ? await this.prisma.timeEntry.groupBy({
          by: ['taskId'],
          where: { taskId: { in: rows.map((r) => r.id) } },
          _sum: { hours: true },
        })
      : [];
    const byTask = new Map(hours.map((h) => [h.taskId, h._sum.hours]));
    const now = toDateOnly(new Date());
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectNumber: row.project.number,
      projectName: row.project.name,
      taskNo: row.taskNo,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assigneeId: row.assigneeId,
      assigneeName: row.assignee ? `${row.assignee.firstName} ${row.assignee.lastName}` : null,
      dueDate: toDateOnly(row.dueDate),
      estimatedHours: row.estimatedHours?.toFixed(2) ?? null,
      loggedHours: new Prisma.Decimal(byTask.get(row.id) ?? 0).toFixed(2),
      sortOrder: row.sortOrder,
      completedAt: row.completedAt?.toISOString() ?? null,
      overdue: isOverdue(row.dueDate, row.status === ProjectTaskStatus.DONE, now),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async notifyAssignee(user: AuthUser, task: TaskRow) {
    const userId = task.assignee?.userId;
    if (!userId || userId === user.id) return;
    await this.notifications.notify({
      companyId: user.companyId,
      userIds: [userId],
      type: 'projects.task_assigned',
      title: `${task.project.number} #${task.taskNo} size atandı`,
      body: task.title,
      link: `/projects/${task.projectId}?tab=tasks`,
    });
  }
}

function completedAt(current: { status: ProjectTaskStatus }, status: ProjectTaskStatus) {
  if (status === current.status) return undefined;
  return status === ProjectTaskStatus.DONE ? new Date() : null;
}

/** Serialises task numbering and column ordering per project. */
async function lockProject(tx: PrismaTx, projectId: string) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
}
