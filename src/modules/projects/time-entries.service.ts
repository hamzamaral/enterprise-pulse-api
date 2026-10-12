import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  SaveTimeWeekDto,
  TimeEntryDto,
  TimeEntryQueryDto,
  TimeWeekQueryDto,
  TimeWeekRowDto,
  TimeWeekDto,
} from './dto/project.dto';
import { MAX_DAY_HOURS, WORKING_STATUSES, entryCost, weekDays, weekStart } from './project-math';
import { ProjectsService } from './projects.service';

const SORTABLE = ['workDate', 'hours', 'createdAt'] as const;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const entryInclude = {
  project: { select: { number: true, name: true } },
  task: { select: { taskNo: true, title: true } },
  employee: { select: { firstName: true, lastName: true } },
} satisfies Prisma.TimeEntryInclude;

type EntryRow = Prisma.TimeEntryGetPayload<{ include: typeof entryInclude }>;

/** Rows of the weekly timesheet are keyed by project and task. */
const rowKey = (projectId: string, taskId: string | null | undefined) =>
  `${projectId}:${taskId ?? ''}`;

/**
 * Time entries (zaman kaydı). Members log their own hours on a weekly timesheet; managers and leads
 * see everybody's time and cost on their projects, `projects:read` sees all of it.
 */
@Injectable()
export class TimeEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async findAll(user: AuthUser, query: TimeEntryQueryDto) {
    const [employee, costs] = await Promise.all([
      this.projects.ownEmployee(user),
      this.costVisibility(user),
    ]);
    if (query.projectId) await this.projects.access(user, query.projectId);
    const mine = query.mine === 'true';
    if (mine && !employee) return paginated([], 0, query);

    const where: Prisma.TimeEntryWhereInput = {
      AND: [
        { companyId: user.companyId },
        mine
          ? { employeeId: employee!.id }
          : costs === 'all'
            ? {}
            : {
                OR: [
                  ...(employee ? [{ employeeId: employee.id }] : []),
                  { projectId: { in: [...costs] } },
                ],
              },
        {
          projectId: query.projectId,
          employeeId: query.employeeId,
          workDate: {
            gte: query.from ? parseDateOnly(query.from) : undefined,
            lte: query.to ? parseDateOnly(query.to) : undefined,
          },
        },
      ],
    };
    const [rows, total, sum] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where,
        include: entryInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'workDate'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.timeEntry.count({ where }),
      this.prisma.timeEntry.aggregate({ where, _sum: { hours: true } }),
    ]);
    return {
      ...paginated(
        rows.map((row) => toDto(row, costs === 'all' || costs.has(row.projectId))),
        total,
        query,
      ),
      totalHours: dec(sum._sum.hours ?? 0).toFixed(2),
    };
  }

  /** The current user's hours for the week containing `date`, one row per project and task. */
  async week(user: AuthUser, query: TimeWeekQueryDto): Promise<TimeWeekDto> {
    const start = weekStart(query.date ?? toDateOnly(new Date()));
    const days = weekDays(start);
    const employee = await this.projects.ownEmployee(user);
    const entries = employee ? await this.entries(employee.id, days) : [];
    const projectIds = [...new Set(entries.map((e) => e.projectId))];
    const open = employee ? await this.openProjects(employee.id, projectIds) : new Set<string>();

    const rows = new Map<string, TimeWeekRowDto & { cells: Prisma.Decimal[] }>();
    for (const entry of entries) {
      const key = rowKey(entry.projectId, entry.taskId);
      let row = rows.get(key);
      if (!row) {
        row = {
          projectId: entry.projectId,
          projectNumber: entry.project.number,
          projectName: entry.project.name,
          taskId: entry.taskId,
          taskNo: entry.task?.taskNo ?? null,
          taskTitle: entry.task?.title ?? null,
          description: null,
          hours: [],
          locked: !open.has(entry.projectId),
          cells: days.map(() => dec(0)),
        };
        rows.set(key, row);
      }
      const day = days.indexOf(toDateOnly(entry.workDate));
      row.cells[day] = row.cells[day].add(entry.hours);
      row.description ??= entry.description;
    }

    const dayTotals = days.map(() => dec(0));
    const result: TimeWeekRowDto[] = [...rows.values()]
      .sort(
        (a, b) =>
          a.projectNumber.localeCompare(b.projectNumber) || (a.taskNo ?? 0) - (b.taskNo ?? 0),
      )
      .map(({ cells, ...row }) => {
        cells.forEach((hours, i) => (dayTotals[i] = dayTotals[i].add(hours)));
        return { ...row, hours: cells.map((h) => h.toFixed(2)) };
      });
    return {
      weekStart: start,
      days,
      rows: result,
      dayTotals: dayTotals.map((h) => h.toFixed(2)),
      total: dayTotals.reduce((sum, h) => sum.add(h), dec(0)).toFixed(2),
    };
  }

  /**
   * Replaces the current user's week with the submitted rows. Rows of projects that no longer accept
   * time must come back unchanged.
   */
  async save(user: AuthUser, dto: SaveTimeWeekDto): Promise<TimeWeekDto> {
    const employee = await this.projects.ownEmployee(user);
    if (!employee) throw new BadRequestException('Your user is not linked to an employee');
    if (weekStart(dto.weekStart) !== dto.weekStart) {
      throw new BadRequestException('weekStart must be a Monday');
    }
    const days = weekDays(dto.weekStart);

    const incoming = new Map<string, (typeof dto.rows)[number]>();
    for (const row of dto.rows) {
      const key = rowKey(row.projectId, row.taskId);
      if (incoming.has(key)) throw new BadRequestException('Each project and task fits one row');
      incoming.set(key, row);
    }
    days.forEach((day, i) => {
      const total = dto.rows.reduce((sum, row) => sum.add(row.hours[i]), dec(0));
      if (total.greaterThan(MAX_DAY_HOURS)) {
        throw new BadRequestException(`More than ${MAX_DAY_HOURS} hours on ${day}`);
      }
    });

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.timeEntry.findMany({
        where: {
          employeeId: employee.id,
          workDate: { gte: parseDateOnly(days[0]), lte: parseDateOnly(days[6]) },
        },
        include: { project: { select: { name: true } } },
      });
      const cells = new Map<string, typeof existing>();
      for (const entry of existing) {
        const key = `${rowKey(entry.projectId, entry.taskId)}@${toDateOnly(entry.workDate)}`;
        cells.set(key, [...(cells.get(key) ?? []), entry]);
      }

      const keys = new Set([
        ...incoming.keys(),
        ...existing.map((e) => rowKey(e.projectId, e.taskId)),
      ]);
      const projectIds = [...new Set([...keys].map((k) => k.split(':')[0]))];
      const projects = await tx.project.findMany({
        where: { id: { in: projectIds }, companyId: user.companyId },
        select: {
          id: true,
          name: true,
          status: true,
          members: { where: { employeeId: employee.id }, select: { hourlyCost: true } },
          tasks: { select: { id: true } },
        },
      });
      const byId = new Map(projects.map((p) => [p.id, p]));

      for (const key of keys) {
        const [projectId, taskId] = key.split(':');
        const project = byId.get(projectId);
        if (!project) throw new NotFoundException('Project not found');
        if (taskId && !project.tasks.some((t) => t.id === taskId)) {
          throw new BadRequestException(`The task does not belong to ${project.name}`);
        }
        const row = incoming.get(key);
        const membership = project.members[0];
        const open = !!membership && WORKING_STATUSES.includes(project.status);

        for (const [i, day] of days.entries()) {
          const current = cells.get(`${key}@${day}`) ?? [];
          const before = current.reduce((sum, e) => sum.add(e.hours), dec(0));
          const hours = dec(row?.hours[i] ?? 0);
          const description = row?.description?.trim() || null;
          const unchanged =
            before.equals(hours) && current.every((e) => e.description === description);
          if (unchanged || (hours.isZero() && current.length === 0)) continue;
          if (!open) {
            throw new ConflictException(
              membership
                ? `${project.name} no longer accepts time`
                : `You are not a member of ${project.name}`,
            );
          }
          if (hours.isZero()) {
            await tx.timeEntry.deleteMany({ where: { id: { in: current.map((e) => e.id) } } });
            continue;
          }
          const data = {
            hours,
            description,
            costAmount: entryCost(hours, membership.hourlyCost),
          };
          const [first, ...extra] = current;
          if (extra.length) {
            await tx.timeEntry.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
          }
          if (first) {
            await tx.timeEntry.update({ where: { id: first.id }, data });
          } else {
            await tx.timeEntry.create({
              data: {
                ...data,
                companyId: user.companyId,
                projectId,
                taskId: taskId || null,
                employeeId: employee.id,
                workDate: parseDateOnly(day),
              },
            });
          }
        }
      }
    });
    return this.week(user, { date: dto.weekStart });
  }

  /** 'all' or the projects whose costs and everybody's time the user may see. */
  private async costVisibility(user: AuthUser): Promise<'all' | Set<string>> {
    if (hasPermission(user, 'projects:read') || hasPermission(user, 'projects:update')) {
      return 'all';
    }
    return new Set(await this.projects.managedProjectIds(user));
  }

  private entries(employeeId: string, days: string[]): Promise<EntryRow[]> {
    return this.prisma.timeEntry.findMany({
      where: {
        employeeId,
        workDate: { gte: parseDateOnly(days[0]), lte: parseDateOnly(days[6]) },
      },
      include: entryInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Projects among `ids` the employee still belongs to and that accept time. */
  private async openProjects(employeeId: string, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.prisma.project.findMany({
      where: {
        id: { in: ids },
        status: { in: WORKING_STATUSES },
        members: { some: { employeeId } },
      },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }
}

function toDto(row: EntryRow, showCost: boolean): TimeEntryDto {
  return {
    id: row.id,
    projectId: row.projectId,
    projectNumber: row.project.number,
    projectName: row.project.name,
    taskId: row.taskId,
    taskNo: row.task?.taskNo ?? null,
    taskTitle: row.task?.title ?? null,
    employeeId: row.employeeId,
    employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
    workDate: toDateOnly(row.workDate),
    hours: row.hours.toFixed(2),
    description: row.description,
    costAmount: showCost ? row.costAmount.toFixed(2) : null,
  };
}
