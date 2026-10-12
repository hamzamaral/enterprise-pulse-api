import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  ExpenseReportStatus,
  Prisma,
  ProjectMemberRole,
  ProjectStatus,
  ProjectTaskStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { CUSTOMER_TYPES, PartnersService } from '../partners/partners.service';
import type {
  AddProjectMemberDto,
  CreateProjectDto,
  ProjectDetailDto,
  ProjectDto,
  ProjectExpenseDto,
  ProjectMemberDto,
  ProjectQueryDto,
  ProjectSummaryDto,
  UpdateProjectDto,
  UpdateProjectMemberDto,
} from './dto/project.dto';
import {
  CLOSED_STATUSES,
  WORKING_STATUSES,
  budgetUsage,
  isOverdue,
  progress,
  weekDays,
  weekStart,
} from './project-math';

const SORTABLE = ['number', 'name', 'dueDate', 'createdAt'] as const;
const OPEN_STATUSES = [ProjectStatus.PLANNED, ProjectStatus.ACTIVE, ProjectStatus.ON_HOLD];
const COUNTED_EXPENSES: ExpenseReportStatus[] = [
  ExpenseReportStatus.APPROVED,
  ExpenseReportStatus.PAID,
];
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal.Value) => dec(value).toFixed(2);
const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
const today = () => toDateOnly(new Date());

const listInclude = {
  partner: { select: { code: true, title: true } },
  manager: { select: { firstName: true, lastName: true, userId: true } },
  _count: { select: { members: true } },
} satisfies Prisma.ProjectInclude;

const detailInclude = {
  ...listInclude,
  createdBy: { select: { firstName: true, lastName: true } },
  members: {
    include: {
      employee: {
        select: {
          firstName: true,
          lastName: true,
          userId: true,
          position: { select: { name: true } },
        },
      },
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.ProjectInclude;

type ListRow = Prisma.ProjectGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.ProjectGetPayload<{ include: typeof detailInclude }>;

interface ProjectStats {
  counts: Record<ProjectTaskStatus, number>;
  hours: Prisma.Decimal;
  labor: Prisma.Decimal;
}

/** What the current user may do on one project. */
export interface ProjectAccess {
  project: DetailRow;
  /** The user's own membership, if any. */
  member: DetailRow['members'][number] | null;
  canManage: boolean;
  /** Sees costs and everybody's time. */
  canSeeCosts: boolean;
}

const emptyCounts = (): Record<ProjectTaskStatus, number> => ({
  TODO: 0,
  IN_PROGRESS: 0,
  REVIEW: 0,
  DONE: 0,
});

/**
 * Projects (proje yönetimi). Members work on their projects without a permission; the manager and
 * LEAD members run them, `projects:update` runs every project and `projects:read` sees them all.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly partners: PartnersService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(user: AuthUser, query: ProjectQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.ProjectWhereInput = {
      AND: [
        this.scope(user, query.mine === 'true'),
        {
          status: query.status ?? (query.open === 'true' ? { in: OPEN_STATUSES } : undefined),
          partnerId: query.partnerId,
        },
        search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { partner: { title: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {},
      ],
    };
    const [rows, total, base] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.project.count({ where }),
      this.baseCurrency(user.companyId),
    ]);
    const [stats, managed] = await Promise.all([
      this.stats(rows.map((r) => r.id)),
      hasPermission(user, 'projects:read') || hasPermission(user, 'projects:update')
        ? null
        : this.managedProjectIds(user).then((ids) => new Set(ids)),
    ]);
    return paginated(
      rows.map((row) => {
        const dto = toDto(row, stats.get(row.id), base);
        return !managed || managed.has(row.id) ? dto : withoutCosts(dto);
      }),
      total,
      query,
    );
  }

  async findOne(user: AuthUser, id: string): Promise<ProjectDetailDto> {
    const access = await this.access(user, id);
    return this.detail(user, access);
  }

  async create(user: AuthUser, dto: CreateProjectDto): Promise<ProjectDetailDto> {
    const { companyId } = user;
    const manager = await this.activeEmployee(companyId, dto.managerId);
    assertDates(dto.startDate, dto.dueDate);
    const status = dto.status ?? ProjectStatus.PLANNED;
    if (!WORKING_STATUSES.includes(status)) {
      throw new BadRequestException('New projects start as planned or active');
    }
    const id = await this.prisma.$transaction(async (tx) => {
      if (dto.partnerId) {
        await this.partners.getForDocument(tx, companyId, dto.partnerId, CUSTOMER_TYPES);
      }
      const project = await tx.project.create({
        data: {
          companyId,
          number: await this.numbering.next(companyId, 'PROJECT', tx),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          partnerId: dto.partnerId ?? null,
          managerId: manager.id,
          status,
          startDate: dto.startDate ? parseDateOnly(dto.startDate) : null,
          dueDate: dto.dueDate ? parseDateOnly(dto.dueDate) : null,
          budgetAmount: dto.budgetAmount ?? null,
          createdById: user.id,
          members: { create: { employeeId: manager.id, role: ProjectMemberRole.LEAD } },
        },
      });
      return project.id;
    });
    const result = await this.findOne(user, id);
    await this.notifyMember(user, manager.userId, result, 'projects.manager');
    return result;
  }

  async update(user: AuthUser, id: string, dto: UpdateProjectDto): Promise<ProjectDetailDto> {
    const { project } = await this.manageable(user, id);
    const { companyId } = user;
    const startDate = dto.startDate === undefined ? toDateOnly(project.startDate) : dto.startDate;
    const dueDate = dto.dueDate === undefined ? toDateOnly(project.dueDate) : dto.dueDate;
    assertDates(startDate, dueDate);
    const manager =
      dto.managerId && dto.managerId !== project.managerId
        ? await this.activeEmployee(companyId, dto.managerId)
        : null;
    const status = dto.status ?? project.status;

    await this.prisma.$transaction(async (tx) => {
      if (dto.partnerId && dto.partnerId !== project.partnerId) {
        await this.partners.getForDocument(tx, companyId, dto.partnerId, CUSTOMER_TYPES);
      }
      await tx.project.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          description: dto.description === undefined ? undefined : dto.description?.trim() || null,
          partnerId: dto.partnerId === undefined ? undefined : dto.partnerId,
          managerId: manager?.id,
          status,
          startDate:
            dto.startDate === undefined ? undefined : startDate && parseDateOnly(startDate),
          dueDate: dto.dueDate === undefined ? undefined : dueDate && parseDateOnly(dueDate),
          budgetAmount: dto.budgetAmount === undefined ? undefined : dto.budgetAmount,
          completedAt:
            status === project.status
              ? undefined
              : status === ProjectStatus.COMPLETED
                ? new Date()
                : null,
        },
      });
      if (manager) {
        await tx.projectMember.upsert({
          where: { projectId_employeeId: { projectId: id, employeeId: manager.id } },
          create: { projectId: id, employeeId: manager.id, role: ProjectMemberRole.LEAD },
          update: { role: ProjectMemberRole.LEAD },
        });
      }
    });
    const result = await this.findOne(user, id);
    if (manager) await this.notifyMember(user, manager.userId, result, 'projects.manager');
    return result;
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.access(user, id);
    const [entries, reports] = await Promise.all([
      this.prisma.timeEntry.count({ where: { projectId: id } }),
      this.prisma.project.findUniqueOrThrow({
        where: { id },
        select: { _count: { select: { expenseReports: true } } },
      }),
    ]);
    if (entries > 0 || reports._count.expenseReports > 0) {
      throw new ConflictException(
        'Projects with logged time or expense reports can only be cancelled',
      );
    }
    await this.prisma.project.delete({ where: { id } });
  }

  // ---------- Members ----------

  async addMember(user: AuthUser, id: string, dto: AddProjectMemberDto): Promise<ProjectDetailDto> {
    const { project } = await this.manageable(user, id);
    const employee = await this.activeEmployee(user.companyId, dto.employeeId);
    if (project.members.some((m) => m.employeeId === employee.id)) {
      throw new ConflictException(`${fullName(employee)} is already a member`);
    }
    await this.prisma.projectMember.create({
      data: {
        projectId: id,
        employeeId: employee.id,
        role: dto.role ?? ProjectMemberRole.MEMBER,
        hourlyCost: dto.hourlyCost ?? null,
      },
    });
    const result = await this.findOne(user, id);
    await this.notifyMember(user, employee.userId, result, 'projects.member');
    return result;
  }

  async updateMember(
    user: AuthUser,
    id: string,
    memberId: string,
    dto: UpdateProjectMemberDto,
  ): Promise<ProjectDetailDto> {
    const { project } = await this.manageable(user, id);
    const member = project.members.find((m) => m.id === memberId);
    if (!member) throw new NotFoundException('Member not found');
    if (
      member.employeeId === project.managerId &&
      dto.role &&
      dto.role !== ProjectMemberRole.LEAD
    ) {
      throw new BadRequestException('The project manager stays a lead');
    }
    await this.prisma.projectMember.update({
      where: { id: memberId },
      data: {
        role: dto.role,
        hourlyCost: dto.hourlyCost === undefined ? undefined : dto.hourlyCost,
      },
    });
    return this.findOne(user, id);
  }

  async removeMember(user: AuthUser, id: string, memberId: string): Promise<ProjectDetailDto> {
    const { project } = await this.manageable(user, id);
    const member = project.members.find((m) => m.id === memberId);
    if (!member) throw new NotFoundException('Member not found');
    if (member.employeeId === project.managerId) {
      throw new BadRequestException('Change the project manager before removing them');
    }
    await this.prisma.$transaction([
      this.prisma.projectTask.updateMany({
        where: { projectId: id, assigneeId: member.employeeId, status: { not: 'DONE' } },
        data: { assigneeId: null },
      }),
      this.prisma.projectMember.delete({ where: { id: memberId } }),
    ]);
    return this.findOne(user, id);
  }

  async expenses(user: AuthUser, id: string): Promise<ProjectExpenseDto[]> {
    const { canSeeCosts } = await this.access(user, id);
    if (!canSeeCosts) throw new ForbiddenException('Only people who run the project see its costs');
    const rows = await this.prisma.expenseReport.findMany({
      where: { projectId: id, status: { not: ExpenseReportStatus.DRAFT } },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      employeeName: fullName(r.employee),
      status: r.status,
      totalAmount: money(r.totalAmount),
      submittedAt: r.submittedAt?.toISOString() ?? null,
      counted: COUNTED_EXPENSES.includes(r.status),
    }));
  }

  // ---------- Summary ----------

  async summary(user: AuthUser): Promise<ProjectSummaryDto> {
    const { companyId } = user;
    const now = today();
    const employee = await this.ownEmployee(user);
    const [open, base, myTasks, myHours] = await Promise.all([
      this.prisma.project.findMany({
        where: { AND: [this.scope(user, false), { status: { in: OPEN_STATUSES } }] },
        select: {
          id: true,
          status: true,
          dueDate: true,
          budgetAmount: true,
          expenseCost: true,
          managerId: true,
          members: { where: { employee: { userId: user.id } }, select: { id: true } },
        },
      }),
      this.baseCurrency(companyId),
      employee
        ? this.prisma.projectTask.findMany({
            where: {
              assigneeId: employee.id,
              status: { not: ProjectTaskStatus.DONE },
              project: { status: { in: OPEN_STATUSES } },
            },
            select: { dueDate: true },
          })
        : [],
      employee
        ? this.prisma.timeEntry.aggregate({
            where: {
              employeeId: employee.id,
              workDate: {
                gte: parseDateOnly(weekStart(now)),
                lte: parseDateOnly(weekDays(weekStart(now))[6]),
              },
            },
            _sum: { hours: true },
          })
        : null,
    ]);
    const labor = await this.laborByProject(open.map((p) => p.id));
    return {
      currencyCode: base,
      activeCount: open.filter((p) => p.status === ProjectStatus.ACTIVE).length,
      overdueCount: open.filter((p) => isOverdue(p.dueDate, false, now)).length,
      overBudgetCount: open.filter(
        (p) =>
          p.budgetAmount !== null &&
          (labor.get(p.id) ?? dec(0)).add(p.expenseCost).greaterThan(p.budgetAmount),
      ).length,
      myProjectCount: open.filter((p) => p.members.length > 0).length,
      myOpenTaskCount: myTasks.length,
      myOverdueTaskCount: myTasks.filter((t) => isOverdue(t.dueDate, false, now)).length,
      myHoursThisWeek: dec(myHours?._sum.hours ?? 0).toFixed(2),
    };
  }

  // ---------- Shared with tasks, time and expenses ----------

  /** Loads a project the user may see; others get 404 so ids don't leak. */
  async access(user: AuthUser, id: string): Promise<ProjectAccess> {
    const project = await this.prisma.project.findFirst({
      where: { id, companyId: user.companyId },
      include: detailInclude,
    });
    const member = project?.members.find((m) => m.employee.userId === user.id) ?? null;
    const runs =
      !!project &&
      (hasPermission(user, 'projects:update') ||
        project.manager.userId === user.id ||
        member?.role === ProjectMemberRole.LEAD);
    if (!project || !(runs || member || hasPermission(user, 'projects:read'))) {
      throw new NotFoundException('Project not found');
    }
    return {
      project,
      member,
      canManage: runs,
      canSeeCosts: runs || hasPermission(user, 'projects:read'),
    };
  }

  async manageable(user: AuthUser, id: string): Promise<ProjectAccess> {
    const access = await this.access(user, id);
    if (!access.canManage) {
      throw new ForbiddenException('Only the project manager or a lead can do this');
    }
    return access;
  }

  /** Projects whose costs and time the user may see besides their own entries. */
  async managedProjectIds(user: AuthUser): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: {
        companyId: user.companyId,
        OR: [
          { manager: { userId: user.id } },
          { members: { some: { role: ProjectMemberRole.LEAD, employee: { userId: user.id } } } },
        ],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Expense reports may be charged to working projects the employee belongs to. */
  async assertChargeable(
    tx: PrismaTx,
    companyId: string,
    projectId: string,
    employeeId: string,
  ): Promise<void> {
    const project = await tx.project.findFirst({
      where: { id: projectId, companyId },
      select: {
        name: true,
        status: true,
        members: { where: { employeeId }, select: { id: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!WORKING_STATUSES.includes(project.status)) {
      throw new BadRequestException(`${project.name} does not accept new costs`);
    }
    if (project.members.length === 0) {
      throw new BadRequestException(`The employee is not a member of ${project.name}`);
    }
  }

  /** Called by the expenses module when a charged report is approved (+) or cancelled (−). */
  async addExpenseCost(tx: PrismaTx, projectId: string, delta: Prisma.Decimal): Promise<void> {
    await tx.project.update({
      where: { id: projectId },
      data: { expenseCost: { increment: delta } },
    });
  }

  async ownEmployee(user: AuthUser) {
    return this.prisma.employee.findFirst({
      where: { companyId: user.companyId, userId: user.id, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
  }

  async baseCurrency(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { baseCurrency: true },
    });
    return company.baseCurrency;
  }

  // ---------- Internals ----------

  private scope(user: AuthUser, mineOnly: boolean): Prisma.ProjectWhereInput {
    if (!mineOnly && hasPermission(user, 'projects:read')) return { companyId: user.companyId };
    return {
      companyId: user.companyId,
      OR: [
        { manager: { userId: user.id } },
        { members: { some: { employee: { userId: user.id } } } },
      ],
    };
  }

  private async detail(user: AuthUser, access: ProjectAccess): Promise<ProjectDetailDto> {
    const { project, member, canManage, canSeeCosts } = access;
    const [stats, base, memberHours, extra] = await Promise.all([
      this.stats([project.id]),
      this.baseCurrency(user.companyId),
      this.prisma.timeEntry.groupBy({
        by: ['employeeId'],
        where: { projectId: project.id },
        _sum: { hours: true },
      }),
      this.prisma.projectTask.findMany({
        where: { projectId: project.id },
        select: { status: true, dueDate: true, estimatedHours: true },
      }),
    ]);
    const hoursByEmployee = new Map(memberHours.map((r) => [r.employeeId, dec(r._sum.hours ?? 0)]));
    const now = today();
    const dto = toDto(project, stats.get(project.id), base);
    const hidden = <T>(value: T) => (canSeeCosts ? value : null);
    const shown = canSeeCosts ? dto : withoutCosts(dto);
    const members: ProjectMemberDto[] = project.members.map((m) => ({
      id: m.id,
      employeeId: m.employeeId,
      employeeName: fullName(m.employee),
      positionName: m.employee.position?.name ?? null,
      userId: m.employee.userId,
      role: m.role,
      hourlyCost: hidden(m.hourlyCost === null ? null : money(m.hourlyCost)),
      loggedHours: (hoursByEmployee.get(m.employeeId) ?? dec(0)).toFixed(2),
    }));
    return {
      ...shown,
      description: project.description,
      completedAt: project.completedAt?.toISOString() ?? null,
      createdByName: fullName(project.createdBy),
      createdAt: project.createdAt.toISOString(),
      members,
      taskCounts: stats.get(project.id)?.counts ?? emptyCounts(),
      overdueTaskCount: extra.filter((t) => isOverdue(t.dueDate, t.status === 'DONE', now)).length,
      estimatedHours: extra.reduce((sum, t) => sum.add(t.estimatedHours ?? 0), dec(0)).toFixed(2),
      canManage,
      canSeeCosts,
      canDelete: hasPermission(user, 'projects:delete'),
      isMember: !!member,
      canLogTime: !!member && WORKING_STATUSES.includes(project.status),
    };
  }

  private async stats(ids: string[]): Promise<Map<string, ProjectStats>> {
    const result = new Map<string, ProjectStats>(
      ids.map((id) => [id, { counts: emptyCounts(), hours: dec(0), labor: dec(0) }]),
    );
    if (!ids.length) return result;
    const [tasks, time] = await Promise.all([
      this.prisma.projectTask.groupBy({
        by: ['projectId', 'status'],
        where: { projectId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.timeEntry.groupBy({
        by: ['projectId'],
        where: { projectId: { in: ids } },
        _sum: { hours: true, costAmount: true },
      }),
    ]);
    for (const row of tasks) result.get(row.projectId)!.counts[row.status] = row._count._all;
    for (const row of time) {
      const stats = result.get(row.projectId)!;
      stats.hours = dec(row._sum.hours ?? 0);
      stats.labor = dec(row._sum.costAmount ?? 0);
    }
    return result;
  }

  private async laborByProject(ids: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.timeEntry.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids } },
      _sum: { costAmount: true },
    });
    return new Map(rows.map((r) => [r.projectId, dec(r._sum.costAmount ?? 0)]));
  }

  private async activeEmployee(companyId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, userId: true, status: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException(`${fullName(employee)} is not active`);
    }
    return employee;
  }

  private async notifyMember(
    user: AuthUser,
    userId: string | null,
    project: ProjectDetailDto,
    type: 'projects.manager' | 'projects.member',
  ) {
    if (!userId || userId === user.id) return;
    await this.notifications.notify({
      companyId: user.companyId,
      userIds: [userId],
      type,
      title:
        type === 'projects.manager'
          ? `${project.number} projesinin yöneticisi oldunuz`
          : `${project.number} projesine eklendiniz`,
      body: project.name,
      link: `/projects/${project.id}`,
    });
  }
}

function assertDates(start: string | null | undefined, due: string | null | undefined) {
  if (start && due && due < start) {
    throw new BadRequestException('The due date cannot be before the start date');
  }
}

/** Budgets and costs are visible to people who run the project and to `projects:read`. */
function withoutCosts(dto: ProjectDto): ProjectDto {
  return {
    ...dto,
    budgetAmount: null,
    laborCost: null,
    expenseCost: null,
    totalCost: null,
    budgetUsage: null,
  };
}

function toDto(row: ListRow, stats: ProjectStats | undefined, base: string): ProjectDto {
  const s = stats ?? { counts: emptyCounts(), hours: dec(0), labor: dec(0) };
  const total = s.labor.add(row.expenseCost);
  const taskCount = Object.values(s.counts).reduce((sum, n) => sum + n, 0);
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    status: row.status,
    partnerId: row.partnerId,
    partnerCode: row.partner?.code ?? null,
    partnerTitle: row.partner?.title ?? null,
    managerId: row.managerId,
    managerName: fullName(row.manager),
    startDate: toDateOnly(row.startDate),
    dueDate: toDateOnly(row.dueDate),
    budgetAmount: row.budgetAmount === null ? null : money(row.budgetAmount),
    currencyCode: base,
    memberCount: row._count.members,
    taskCount,
    doneTaskCount: s.counts.DONE,
    progress: progress(s.counts),
    loggedHours: s.hours.toFixed(2),
    laborCost: money(s.labor),
    expenseCost: money(row.expenseCost),
    totalCost: money(total),
    budgetUsage: budgetUsage(total, row.budgetAmount),
    overdue: isOverdue(row.dueDate, CLOSED_STATUSES.includes(row.status), today()),
  };
}
