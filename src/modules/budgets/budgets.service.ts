import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BudgetAlertLevel,
  BudgetEventType,
  BudgetItemKind,
  BudgetStatus,
  Prisma,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly } from '../../common/dates/date-only';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BudgetActualsService, type ActualRecord } from './budget-actuals.service';
import {
  alertLevel,
  compare,
  departmentScope,
  elapsedMonths,
  emptyMonths,
  scaleAmounts,
  utilization,
  ZERO,
  type ComparisonRow,
  type ComparisonTotals,
} from './budget-math';
import type {
  BudgetActualDto,
  BudgetActualsQueryDto,
  BudgetAttentionDto,
  BudgetDetailDto,
  BudgetDto,
  BudgetListDto,
  BudgetOptionsDto,
  BudgetRowDto,
  BudgetRunResultDto,
  BudgetTotalsDto,
  CreateBudgetDto,
  ReopenBudgetDto,
  SaveBudgetPlanDto,
  UpdateBudgetDto,
} from './dto/budget.dto';

export const BUDGET_READ = 'budgets:read';

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const trimOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

/** Today in Istanbul as a UTC-midnight date. */
export const budgetToday = () =>
  parseDateOnly(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }));

const budgetInclude = {
  department: { select: { name: true } },
  owner: { select: { firstName: true, lastName: true } },
  lines: { select: { itemId: true, month: true, amount: true } },
} satisfies Prisma.BudgetInclude;

type BudgetRow = Prisma.BudgetGetPayload<{ include: typeof budgetInclude }>;

interface Context {
  currencyCode: string;
  elapsed: number;
  items: Map<
    string,
    {
      id: string;
      code: string;
      name: string;
      kind: BudgetItemKind;
      sortOrder: number;
      source: string;
    }
  >;
  departments: { id: string; parentId: string | null; name: string }[];
  records: ActualRecord[];
}

interface Notice {
  userIds: string[];
  budgetId: string;
  title: string;
  body: string;
  email?: boolean;
}

const STATE_ORDER = { OVER: 0, BEHIND: 1, WARNING: 2, ON_TRACK: 3 } as const;

/** Bütçe: yearly company and department budgets, planned versus actual. */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actuals: BudgetActualsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Budgets of a year; users without `budgets:read` see the ones they own. */
  async list(user: AuthUser, year: number): Promise<BudgetListDto> {
    const budgets = await this.prisma.budget.findMany({
      where: {
        companyId: user.companyId,
        year,
        ...(hasPermission(user, BUDGET_READ) ? {} : { ownerId: user.id }),
      },
      include: budgetInclude,
      orderBy: [{ departmentId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });
    const ctx = await this.context(user.companyId, year);
    const attention: BudgetAttentionDto[] = [];
    const rows = budgets.map((budget) => {
      const result = this.evaluate(budget, ctx);
      for (const row of result.rows) {
        if (row.state === 'ON_TRACK') continue;
        attention.push({
          budgetId: budget.id,
          budgetName: budget.name,
          itemId: row.item.id,
          itemName: row.item.name,
          kind: row.item.kind,
          state: row.state,
          plannedYtd: row.plannedYtd.toFixed(2),
          actualYtd: row.actualYtd.toFixed(2),
          utilization: utilization(row.plannedYtd, row.actualYtd),
        });
      }
      return this.toDto(budget, result);
    });
    const gap = (a: BudgetAttentionDto) => Math.abs(Number(a.actualYtd) - Number(a.plannedYtd));
    attention.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || gap(b) - gap(a));
    return {
      year,
      currencyCode: ctx.currencyCode,
      elapsedMonths: ctx.elapsed,
      budgets: rows,
      attention: attention.slice(0, 10),
    };
  }

  /** `budgets:read` holders and the owner can open a budget. */
  async findOne(user: AuthUser, id: string): Promise<BudgetDetailDto> {
    const budget = await this.prisma.budget.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        ...budgetInclude,
        createdBy: { select: { firstName: true, lastName: true } },
        approvedBy: { select: { firstName: true, lastName: true } },
        events: {
          include: { actor: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!budget || !this.canSee(user, budget)) throw new NotFoundException('Budget not found');
    const ctx = await this.context(user.companyId, budget.year);
    const result = this.evaluate(budget, ctx);
    const canUpdate = hasPermission(user, 'budgets:update');
    const canApprove = hasPermission(user, 'budgets:approve');
    const draft = budget.status === BudgetStatus.DRAFT;
    return {
      ...this.toDto(budget, result),
      currencyCode: ctx.currencyCode,
      elapsedMonths: ctx.elapsed,
      note: budget.note,
      createdByName: fullName(budget.createdBy),
      approvedByName: budget.approvedBy ? fullName(budget.approvedBy) : null,
      rows: result.rows.map((row) => this.toRowDto(row, ctx)),
      income: totalsDto(result.income),
      expense: totalsDto(result.expense),
      events: budget.events.map((e) => ({
        id: e.id,
        type: e.type,
        actorName: e.actor ? fullName(e.actor) : null,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
      canUpdate,
      canEdit: canUpdate && draft,
      canApprove: canApprove && draft,
      canReopen: canApprove && budget.status === BudgetStatus.APPROVED,
      canDelete: canUpdate && draft,
    };
  }

  /** The documents behind an item's actual, newest first. */
  async actualsOf(
    user: AuthUser,
    id: string,
    query: BudgetActualsQueryDto,
  ): Promise<BudgetActualDto[]> {
    const budget = await this.prisma.budget.findFirst({ where: { id, companyId: user.companyId } });
    if (!budget || !this.canSee(user, budget)) throw new NotFoundException('Budget not found');
    const ctx = await this.context(user.companyId, budget.year);
    const names = new Map(ctx.departments.map((d) => [d.id, d.name]));
    return this.inScope(budget.departmentId, ctx)
      .filter((r) => r.itemId === query.itemId && (!query.month || r.month === query.month))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((r) => ({
        documentType: r.documentType,
        documentId: r.documentId,
        reference: r.reference,
        date: r.date,
        month: r.month,
        description: r.description,
        departmentName: r.departmentId ? (names.get(r.departmentId) ?? null) : null,
        amount: r.amount.toFixed(2),
      }));
  }

  async options(companyId: string): Promise<BudgetOptionsDto> {
    const [departments, users] = await Promise.all([
      this.prisma.department.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        select: { id: true, code: true, name: true, manager: { select: { userId: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null, memberships: { some: { companyId } } },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
    ]);
    return {
      departments: departments.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        managerUserId: d.manager?.userId ?? null,
      })),
      owners: users.map((u) => ({ id: u.id, name: fullName(u) })),
    };
  }

  async create(user: AuthUser, dto: CreateBudgetDto): Promise<BudgetDetailDto> {
    const companyId = user.companyId;
    const departmentId = dto.departmentId ?? null;
    const department = departmentId
      ? await this.prisma.department.findFirst({
          where: { id: departmentId, companyId, deletedAt: null },
          include: { manager: { select: { userId: true } } },
        })
      : null;
    if (departmentId && !department) throw new BadRequestException('Department not found');
    const ownerId =
      dto.ownerId === undefined ? (department?.manager?.userId ?? user.id) : dto.ownerId;
    if (ownerId) await this.assertOwner(companyId, ownerId);
    const plan = await this.initialPlan(companyId, dto, departmentId);
    const name =
      dto.name?.trim() ||
      `${dto.year} ${department ? `${department.name} Bütçesi` : 'Şirket Bütçesi'}`;

    const budget = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`budget:${companyId}:${dto.year}`}))) AS l`;
      const existing = await tx.budget.findFirst({
        where: { companyId, year: dto.year, departmentId },
      });
      if (existing) {
        throw new ConflictException('A budget already exists for this year and department');
      }
      const row = await tx.budget.create({
        data: {
          companyId,
          year: dto.year,
          departmentId,
          name,
          ownerId,
          note: trimOrNull(dto.note) ?? null,
          createdById: user.id,
        },
      });
      if (plan.length) {
        await tx.budgetLine.createMany({
          data: plan.map((p) => ({ budgetId: row.id, ...p })),
        });
      }
      await tx.budgetEvent.create({
        data: { budgetId: row.id, actorId: user.id, type: BudgetEventType.CREATED },
      });
      return row;
    });
    if (ownerId && ownerId !== user.id) {
      await this.notify(user.companyId, user.id, [
        {
          userIds: [ownerId],
          budgetId: budget.id,
          title: `Bütçe sorumlusu oldunuz: ${budget.name}`,
          body: 'Planı inceleyip onaya hazırlayabilirsiniz.',
        },
      ]);
    }
    return this.findOne(user, budget.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateBudgetDto): Promise<BudgetDetailDto> {
    if (dto.ownerId) await this.assertOwner(user.companyId, dto.ownerId);
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, user.companyId, id);
      const name = dto.name?.trim();
      await tx.budget.update({
        where: { id },
        data: { name, ownerId: dto.ownerId, note: trimOrNull(dto.note) },
      });
      await tx.budgetEvent.create({
        data: { budgetId: id, actorId: user.id, type: BudgetEventType.UPDATED },
      });
      if (dto.ownerId && dto.ownerId !== current.ownerId) {
        notices.push({
          userIds: [dto.ownerId],
          budgetId: id,
          title: `Bütçe sorumlusu oldunuz: ${name ?? current.name}`,
          body: `${current.year} yılı bütçesi`,
        });
      }
    });
    await this.notify(user.companyId, user.id, notices);
    return this.findOne(user, id);
  }

  /** Replaces the monthly plan of a draft budget; all-zero items are dropped. */
  async savePlan(user: AuthUser, id: string, dto: SaveBudgetPlanDto): Promise<BudgetDetailDto> {
    const itemIds = dto.lines.map((l) => l.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException('Each item can appear once');
    }
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, user.companyId, id);
      if (current.status !== BudgetStatus.DRAFT) {
        throw new ConflictException('Reopen the approved budget to change its plan');
      }
      const [items, planned] = await Promise.all([
        tx.budgetItem.findMany({
          where: { companyId: user.companyId, id: { in: itemIds } },
          select: { id: true, isActive: true },
        }),
        tx.budgetLine.findMany({
          where: { budgetId: id },
          distinct: ['itemId'],
          select: { itemId: true },
        }),
      ]);
      const inPlan = new Set(planned.map((p) => p.itemId));
      const usable = new Set(items.filter((i) => i.isActive || inPlan.has(i.id)).map((i) => i.id));
      if (itemIds.some((itemId) => !usable.has(itemId))) {
        throw new BadRequestException('Budget item not found');
      }
      await tx.budgetLine.deleteMany({ where: { budgetId: id } });
      const data = dto.lines.flatMap((line) =>
        line.amounts
          .map((amount, index) => ({ budgetId: id, itemId: line.itemId, month: index + 1, amount }))
          .filter((l) => l.amount > 0),
      );
      if (data.length) await tx.budgetLine.createMany({ data });
      await tx.budgetEvent.create({
        data: { budgetId: id, actorId: user.id, type: BudgetEventType.PLAN_UPDATED },
      });
    });
    return this.findOne(user, id);
  }

  async approve(user: AuthUser, id: string): Promise<BudgetDetailDto> {
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, user.companyId, id);
      if (current.status !== BudgetStatus.DRAFT) {
        throw new ConflictException('Only draft budgets can be approved');
      }
      if (!(await tx.budgetLine.count({ where: { budgetId: id } }))) {
        throw new BadRequestException('Plan the budget before approving it');
      }
      await tx.budget.update({
        where: { id },
        data: { status: BudgetStatus.APPROVED, approvedAt: new Date(), approvedById: user.id },
      });
      await tx.budgetEvent.create({
        data: { budgetId: id, actorId: user.id, type: BudgetEventType.APPROVED },
      });
      if (current.ownerId) {
        notices.push({
          userIds: [current.ownerId],
          budgetId: id,
          title: `Bütçe onaylandı: ${current.name}`,
          body: 'Gerçekleşenler artık bu plana göre izleniyor.',
        });
      }
    });
    await this.notify(user.companyId, user.id, notices);
    return this.findOne(user, id);
  }

  /** Opens an approved budget for revision; its alerts start over after the next approval. */
  async reopen(user: AuthUser, id: string, dto: ReopenBudgetDto): Promise<BudgetDetailDto> {
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, user.companyId, id);
      if (current.status !== BudgetStatus.APPROVED) {
        throw new ConflictException('Only approved budgets can be reopened');
      }
      await tx.budget.update({
        where: { id },
        data: {
          status: BudgetStatus.DRAFT,
          approvedAt: null,
          approvedById: null,
          revision: { increment: 1 },
        },
      });
      await tx.budgetAlert.deleteMany({ where: { budgetId: id } });
      await tx.budgetEvent.create({
        data: {
          budgetId: id,
          actorId: user.id,
          type: BudgetEventType.REOPENED,
          note: dto.reason.trim(),
        },
      });
      if (current.ownerId) {
        notices.push({
          userIds: [current.ownerId],
          budgetId: id,
          title: `Bütçe revizyona açıldı: ${current.name}`,
          body: dto.reason.trim(),
        });
      }
    });
    await this.notify(user.companyId, user.id, notices);
    return this.findOne(user, id);
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, user.companyId, id);
      if (current.status !== BudgetStatus.DRAFT) {
        throw new ConflictException('Only draft budgets can be deleted');
      }
      await tx.budget.delete({ where: { id } });
    });
  }

  /**
   * Daily check of the approved budgets of the current year: an expense item reaching 90% of
   * its yearly plan, then exceeding it, notifies the owner (or the approvers) once per level.
   */
  async run(companyId: string, now: Date = budgetToday()): Promise<BudgetRunResultDto> {
    const year = now.getUTCFullYear();
    const budgets = await this.prisma.budget.findMany({
      where: { companyId, year, status: BudgetStatus.APPROVED },
      include: budgetInclude,
    });
    if (!budgets.length) return { budgets: 0, alerts: 0 };
    const ctx = await this.context(companyId, year, now);
    let approvers: string[] | null = null;
    const notices: Notice[] = [];
    let alerts = 0;
    for (const budget of budgets) {
      const result = this.evaluate(budget, ctx);
      const due = result.rows.flatMap((row) => {
        if (row.item.kind !== BudgetItemKind.EXPENSE) return [];
        const level = alertLevel(row.plannedTotal, row.actualTotal);
        if (!level) return [];
        const levels =
          level === BudgetAlertLevel.OVER
            ? [BudgetAlertLevel.WARNING, BudgetAlertLevel.OVER]
            : [BudgetAlertLevel.WARNING];
        return [{ row, levels }];
      });
      if (!due.length) continue;
      const recipients = budget.ownerId
        ? [budget.ownerId]
        : (approvers ??= await this.notifications.findUserIdsWithPermission(
            companyId,
            'budgets:approve',
          ));
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, companyId, budget.id);
        const existing = new Set(
          (await tx.budgetAlert.findMany({ where: { budgetId: budget.id } })).map(
            (a) => `${a.itemId}:${a.level}`,
          ),
        );
        for (const { row, levels } of due) {
          const fresh = levels.filter((level) => !existing.has(`${row.item.id}:${level}`));
          if (!fresh.length) continue;
          await tx.budgetAlert.createMany({
            data: fresh.map((level) => ({ budgetId: budget.id, itemId: row.item.id, level })),
          });
          const over = fresh.includes(BudgetAlertLevel.OVER);
          const usage = utilization(row.plannedTotal, row.actualTotal);
          await tx.budgetEvent.create({
            data: {
              budgetId: budget.id,
              type: BudgetEventType.ALERT_SENT,
              note: `${row.item.name} · %${usage}`,
            },
          });
          alerts += fresh.length;
          const money = (value: Prisma.Decimal) =>
            new Intl.NumberFormat('tr-TR', {
              style: 'currency',
              currency: ctx.currencyCode,
            }).format(value.toNumber());
          notices.push({
            userIds: recipients,
            budgetId: budget.id,
            title: over
              ? `Bütçe aşıldı: ${row.item.name}`
              : `Bütçenin %90'ı kullanıldı: ${row.item.name}`,
            body: `${budget.name} · gerçekleşen ${money(row.actualTotal)} / plan ${money(row.plannedTotal)} (%${usage})`,
            email: true,
          });
        }
      });
    }
    await this.notify(companyId, null, notices);
    return { budgets: budgets.length, alerts };
  }

  async runAll(): Promise<void> {
    const year = budgetToday().getUTCFullYear();
    const companies = await this.prisma.budget.findMany({
      where: { year, status: BudgetStatus.APPROVED },
      distinct: ['companyId'],
      select: { companyId: true },
    });
    for (const { companyId } of companies) await this.run(companyId);
  }

  // ---------- helpers ----------

  private canSee(user: AuthUser, budget: { ownerId: string | null }) {
    return hasPermission(user, BUDGET_READ) || budget.ownerId === user.id;
  }

  private async context(companyId: string, year: number, now = budgetToday()): Promise<Context> {
    const [company, items, departments, records] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { baseCurrency: true },
      }),
      this.prisma.budgetItem.findMany({
        where: { companyId },
        select: { id: true, code: true, name: true, kind: true, sortOrder: true, source: true },
      }),
      this.prisma.department.findMany({
        where: { companyId },
        select: { id: true, parentId: true, name: true },
      }),
      this.actuals.collect(companyId, year),
    ]);
    return {
      currencyCode: company.baseCurrency,
      elapsed: elapsedMonths(year, now),
      items: new Map(items.map((i) => [i.id, i])),
      departments,
      records,
    };
  }

  /** Actuals counted by a budget: everything, or its department and sub-departments. */
  private inScope(departmentId: string | null, ctx: Context): ActualRecord[] {
    if (!departmentId) return ctx.records;
    const scope = departmentScope(ctx.departments, departmentId);
    return ctx.records.filter((r) => r.departmentId && scope.has(r.departmentId));
  }

  private evaluate(budget: BudgetRow, ctx: Context) {
    return compare(
      [...ctx.items.values()],
      budget.lines,
      this.inScope(budget.departmentId, ctx),
      ctx.elapsed,
    );
  }

  private toDto(budget: BudgetRow, result: ReturnType<typeof compare>): BudgetDto {
    const count = (state: string) => result.rows.filter((r) => r.state === state).length;
    return {
      id: budget.id,
      year: budget.year,
      name: budget.name,
      departmentId: budget.departmentId,
      departmentName: budget.department?.name ?? null,
      status: budget.status,
      ownerId: budget.ownerId,
      ownerName: budget.owner ? fullName(budget.owner) : null,
      revision: budget.revision,
      approvedAt: budget.approvedAt?.toISOString() ?? null,
      incomePlanned: result.income.plannedTotal.toFixed(2),
      expensePlanned: result.expense.plannedTotal.toFixed(2),
      incomePlannedYtd: result.income.plannedYtd.toFixed(2),
      incomeActualYtd: result.income.actualYtd.toFixed(2),
      expensePlannedYtd: result.expense.plannedYtd.toFixed(2),
      expenseActualYtd: result.expense.actualYtd.toFixed(2),
      expenseUtilization: utilization(result.expense.plannedYtd, result.expense.actualYtd),
      overCount: count('OVER'),
      warningCount: count('WARNING'),
      behindCount: count('BEHIND'),
    };
  }

  private toRowDto(row: ComparisonRow, ctx: Context): BudgetRowDto {
    const item = ctx.items.get(row.item.id)!;
    return {
      ...totalsDto(row),
      itemId: item.id,
      code: item.code,
      name: item.name,
      kind: item.kind,
      source: item.source as BudgetRowDto['source'],
      variance: row.actualYtd.minus(row.plannedYtd).toFixed(2),
      yearUsage: utilization(row.plannedTotal, row.actualTotal),
      state: row.state,
    };
  }

  /** Plan lines of a new budget: empty, copied from a budget or from last year's actuals. */
  private async initialPlan(
    companyId: string,
    dto: CreateBudgetDto,
    departmentId: string | null,
  ): Promise<{ itemId: string; month: number; amount: Prisma.Decimal }[]> {
    const basis = dto.basis ?? 'EMPTY';
    if (basis === 'EMPTY') return [];
    const months = new Map<string, Prisma.Decimal[]>();
    const add = (itemId: string, month: number, amount: Prisma.Decimal) => {
      const values = months.get(itemId) ?? emptyMonths();
      values[month - 1] = values[month - 1].plus(amount);
      months.set(itemId, values);
    };
    if (basis === 'BUDGET') {
      const source = dto.sourceBudgetId
        ? await this.prisma.budget.findFirst({
            where: { id: dto.sourceBudgetId, companyId },
            include: { lines: true },
          })
        : null;
      if (!source) throw new BadRequestException('Source budget not found');
      source.lines.forEach((l) => add(l.itemId, l.month, l.amount));
    } else {
      const ctx = await this.context(companyId, dto.year - 1);
      this.inScope(departmentId, ctx).forEach((r) => add(r.itemId, r.month, r.amount));
    }
    const active = new Set(
      (
        await this.prisma.budgetItem.findMany({
          where: { companyId, isActive: true },
          select: { id: true },
        })
      ).map((i) => i.id),
    );
    return [...months.entries()]
      .filter(([itemId]) => active.has(itemId))
      .flatMap(([itemId, values]) =>
        scaleAmounts(values, dto.adjustPercent ?? 0).map((amount, index) => ({
          itemId,
          month: index + 1,
          amount,
        })),
      )
      .filter((line) => line.amount.gt(ZERO));
  }

  private async assertOwner(companyId: string, userId: string) {
    const found = await this.prisma.user.count({
      where: { id: userId, isActive: true, deletedAt: null, memberships: { some: { companyId } } },
    });
    if (!found) throw new BadRequestException('Owner must be an active user of the company');
  }

  private async lock(tx: PrismaTx, companyId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM budgets WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.budget.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Budget not found');
    return row;
  }

  private async notify(companyId: string, actorId: string | null, notices: Notice[]) {
    for (const notice of notices) {
      const userIds = notice.userIds.filter((id) => id !== actorId);
      if (!userIds.length) continue;
      await this.notifications.notify({
        companyId,
        userIds,
        type: 'budgets.budget',
        title: notice.title,
        body: notice.body,
        link: `/budgets/${notice.budgetId}`,
        sendEmail: notice.email,
      });
    }
  }
}

const totalsDto = (t: ComparisonTotals): BudgetTotalsDto => ({
  planned: t.planned.map((v) => v.toFixed(2)),
  actual: t.actual.map((v) => v.toFixed(2)),
  plannedTotal: t.plannedTotal.toFixed(2),
  actualTotal: t.actualTotal.toFixed(2),
  plannedYtd: t.plannedYtd.toFixed(2),
  actualYtd: t.actualYtd.toFixed(2),
  utilization: utilization(t.plannedYtd, t.actualYtd),
});
