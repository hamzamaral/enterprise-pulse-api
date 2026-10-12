import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  ExpenseCategoryKind,
  ExpenseReportStatus,
  Prisma,
  TreasuryDocumentType,
  type ExpenseCategory,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { toBase } from '../../common/money/document-totals';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { TreasuryService } from '../finance/treasury.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { ProjectsService } from '../projects/projects.service';
import { WorkflowService } from '../workflow/workflow.service';
import type {
  CreateExpenseReportDto,
  ExpenseLineInputDto,
  ExpenseReportDetailDto,
  ExpenseReportDto,
  ExpenseReportQueryDto,
  ExpenseSummaryDto,
  PayExpenseReportDto,
  UpdateExpenseReportDto,
} from './dto/expense.dto';
import {
  CANCELLABLE_STATUSES,
  EDITABLE_STATUSES,
  isMissingReceipt,
  isOverLimit,
  lineAmounts,
  reportTotal,
} from './expense-math';

export const EXPENSE_WORKFLOW = 'EXPENSE_REPORT';
/** `entityType` of uploaded receipts; `entityId` becomes the report id once attached. */
export const RECEIPT_ENTITY = 'ExpenseReceipt';

const SORTABLE = ['number', 'createdAt', 'submittedAt', 'totalAmount'] as const;
const DONE_STATUSES = [ExpenseReportStatus.APPROVED, ExpenseReportStatus.PAID];
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal.Value) => dec(value).toFixed(2);
const amountText = (value: Prisma.Decimal, currency: string) =>
  `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value.toNumber())} ${currency}`;

const listInclude = {
  employee: {
    select: {
      firstName: true,
      lastName: true,
      userId: true,
      department: { select: { name: true } },
    },
  },
  project: { select: { number: true, name: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.ExpenseReportInclude;

const detailInclude = {
  ...listInclude,
  lines: {
    include: { category: true, receipt: { select: { originalName: true } } },
    orderBy: { lineNo: 'asc' },
  },
  paymentAccount: { select: { name: true } },
  paidBy: { select: { firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ExpenseReportInclude;

type ListRow = Prisma.ExpenseReportGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.ExpenseReportGetPayload<{ include: typeof detailInclude }>;
type LineData = Omit<Prisma.ExpenseLineCreateManyInput, 'reportId' | 'amountBase'> & {
  amountBase: Prisma.Decimal;
};

/**
 * Expense reports (masraf formları). Employees fill in their own reports; `expenses:read` sees every
 * report, `expenses:create` files them for others and `expenses:pay` reimburses approved ones.
 */
@Injectable()
export class ExpenseReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly workflow: WorkflowService,
    private readonly treasury: TreasuryService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly projects: ProjectsService,
  ) {}

  async findAll(user: AuthUser, query: ExpenseReportQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.ExpenseReportWhereInput = {
      AND: [
        this.scope(user, query.mine === 'true'),
        { status: query.status, employeeId: query.employeeId, projectId: query.projectId },
        search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' } },
                { title: { contains: search, mode: 'insensitive' } },
                { employee: { firstName: { contains: search, mode: 'insensitive' } } },
                { employee: { lastName: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {},
      ],
    };
    const [rows, total, base] = await Promise.all([
      this.prisma.expenseReport.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.expenseReport.count({ where }),
      this.baseCurrency(user.companyId),
    ]);
    return paginated(
      rows.map((row) => toDto(row, base)),
      total,
      query,
    );
  }

  async findOne(user: AuthUser, id: string): Promise<ExpenseReportDetailDto> {
    const [row, base] = await Promise.all([
      this.getVisible(user, id),
      this.baseCurrency(user.companyId),
    ]);
    return toDetailDto(row, base, user);
  }

  async create(user: AuthUser, dto: CreateExpenseReportDto): Promise<ExpenseReportDetailDto> {
    const { companyId } = user;
    const employee = await this.resolveEmployee(user, dto.employeeId);
    const base = await this.baseCurrency(companyId);
    const report = await this.prisma.$transaction(async (tx) => {
      if (dto.projectId) {
        await this.projects.assertChargeable(tx, companyId, dto.projectId, employee.id);
      }
      const lines = await this.buildLines(tx, user, dto.lines, base, null);
      const created = await tx.expenseReport.create({
        data: {
          companyId,
          number: await this.numbering.next(companyId, 'EXPENSE_REPORT', tx),
          employeeId: employee.id,
          projectId: dto.projectId ?? null,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          totalAmount: reportTotal(lines),
          createdById: user.id,
          lines: { createMany: { data: lines } },
        },
      });
      await this.attachReceipts(tx, created.id, lines);
      return created;
    });
    return this.findOne(user, report.id);
  }

  /** Replaces title and lines; a rejected report goes back to draft. */
  async update(
    user: AuthUser,
    id: string,
    dto: UpdateExpenseReportDto,
  ): Promise<ExpenseReportDetailDto> {
    const base = await this.baseCurrency(user.companyId);
    await this.prisma.$transaction(async (tx) => {
      const report = await this.lockOwned(tx, user, id);
      if (!EDITABLE_STATUSES.includes(report.status)) {
        throw new ConflictException('Only draft or rejected reports can be edited');
      }
      const projectId = dto.projectId ?? null;
      if (projectId && projectId !== report.projectId) {
        await this.projects.assertChargeable(tx, user.companyId, projectId, report.employeeId);
      }
      const lines = await this.buildLines(tx, user, dto.lines, base, id);
      await tx.expenseLine.deleteMany({ where: { reportId: id } });
      await tx.expenseReport.update({
        where: { id },
        data: {
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          projectId,
          totalAmount: reportTotal(lines),
          status: ExpenseReportStatus.DRAFT,
          lines: { createMany: { data: lines } },
        },
      });
      await this.attachReceipts(tx, id, lines);
    });
    return this.findOne(user, id);
  }

  /** Sends the report for approval, or approves it at once when no workflow is active. */
  async submit(user: AuthUser, id: string): Promise<ExpenseReportDetailDto> {
    const row = await this.getVisible(user, id);
    if (!isOwner(row, user)) throw new ForbiddenException('Only the owner can submit this report');
    if (!EDITABLE_STATUSES.includes(row.status)) {
      throw new ConflictException('Report has already been submitted');
    }
    if (!row.lines.length) throw new BadRequestException('Add at least one expense line');
    const missing = row.lines.filter((line) => isMissingReceipt(lineCheck(line))).length;
    if (missing) throw new BadRequestException(`${missing} line(s) need a receipt`);

    const hasWorkflow = await this.prisma.workflowDefinition.count({
      where: { companyId: user.companyId, code: EXPENSE_WORKFLOW, isActive: true },
    });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.expenseReport.updateMany({
        where: { id, status: row.status },
        data: {
          status: hasWorkflow ? ExpenseReportStatus.PENDING : ExpenseReportStatus.APPROVED,
          submittedAt: now,
          decidedAt: hasWorkflow ? null : now,
        },
      });
      if (!moved.count) throw new ConflictException('Report was changed by someone else');
      if (!hasWorkflow) await this.chargeProject(tx, row, 1);
    });

    if (!hasWorkflow) {
      await this.notifyPayers(row, user.companyId);
      return this.findOne(user, id);
    }
    try {
      const base = await this.baseCurrency(user.companyId);
      const instance = await this.workflow.start(user, {
        definitionCode: EXPENSE_WORKFLOW,
        entityId: row.number,
        title: `${row.number} — ${employeeName(row)}: ${row.title} (${amountText(row.totalAmount, base)})`,
      });
      await this.prisma.expenseReport.update({
        where: { id },
        data: { workflowInstanceId: instance.id },
      });
    } catch (error) {
      await this.prisma.expenseReport.update({
        where: { id },
        data: { status: row.status, submittedAt: row.submittedAt },
      });
      throw error;
    }
    return this.findOne(user, id);
  }

  /** Pulls a pending report back to draft by cancelling its approval. */
  async withdraw(user: AuthUser, id: string): Promise<ExpenseReportDetailDto> {
    const row = await this.getVisible(user, id);
    if (!isOwner(row, user))
      throw new ForbiddenException('Only the owner can withdraw this report');
    if (row.status !== ExpenseReportStatus.PENDING) {
      throw new ConflictException('Only pending reports can be withdrawn');
    }
    if (row.workflowInstanceId) await this.workflow.cancel(user, row.workflowInstanceId);
    await this.prisma.expenseReport.updateMany({
      where: { id, status: ExpenseReportStatus.PENDING },
      data: { status: ExpenseReportStatus.DRAFT, decidedAt: null },
    });
    return this.findOne(user, id);
  }

  async cancel(user: AuthUser, id: string, reason?: string): Promise<ExpenseReportDetailDto> {
    const row = await this.getVisible(user, id);
    if (!canCancel(row, user)) throw new ForbiddenException('You cannot cancel this report');
    if (row.status === ExpenseReportStatus.PENDING && row.workflowInstanceId) {
      await this.workflow.cancel(user, row.workflowInstanceId, reason);
    }
    await this.prisma.$transaction(async (tx) => {
      const report = await this.lock(tx, user.companyId, id);
      if (!CANCELLABLE_STATUSES.includes(report.status)) {
        throw new ConflictException('Report is already closed');
      }
      await tx.expenseReport.update({
        where: { id },
        data: { status: ExpenseReportStatus.CANCELLED, decidedAt: new Date() },
      });
      if (report.status === ExpenseReportStatus.APPROVED) {
        await this.chargeProject(tx, report, -1);
      }
    });
    return this.findOne(user, id);
  }

  /** Drafts that were never submitted can be deleted outright. */
  async remove(user: AuthUser, id: string): Promise<void> {
    const row = await this.getVisible(user, id);
    if (!isOwner(row, user)) throw new ForbiddenException('Only the owner can delete this report');
    if (row.status !== ExpenseReportStatus.DRAFT || row.submittedAt) {
      throw new ConflictException('Only unsubmitted drafts can be deleted; cancel it instead');
    }
    await this.prisma.expenseReport.delete({ where: { id } });
  }

  /** Applies a workflow outcome; only pending reports change, so repeated events are harmless. */
  async decide(
    companyId: string,
    number: string,
    outcome: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  ): Promise<void> {
    const status =
      outcome === 'CANCELLED' ? ExpenseReportStatus.DRAFT : ExpenseReportStatus[outcome];
    const moved = await this.prisma.$transaction(async (tx) => {
      const result = await tx.expenseReport.updateMany({
        where: { companyId, number, status: ExpenseReportStatus.PENDING },
        data: { status, decidedAt: outcome === 'CANCELLED' ? null : new Date() },
      });
      if (result.count && status === ExpenseReportStatus.APPROVED) {
        const report = await tx.expenseReport.findFirstOrThrow({ where: { companyId, number } });
        await this.chargeProject(tx, report, 1);
      }
      return result;
    });
    if (moved.count && status === ExpenseReportStatus.APPROVED) {
      const row = await this.prisma.expenseReport.findFirstOrThrow({
        where: { companyId, number },
        include: listInclude,
      });
      await this.notifyPayers(row, companyId);
    }
  }

  /** Reimburses the employee from a cash / bank account in the company currency. */
  async pay(user: AuthUser, id: string, dto: PayExpenseReportDto): Promise<ExpenseReportDetailDto> {
    const base = await this.baseCurrency(user.companyId);
    const row = await this.prisma.$transaction(async (tx) => {
      const report = await this.lock(tx, user.companyId, id);
      if (report.status !== ExpenseReportStatus.APPROVED) {
        throw new ConflictException('Only approved reports can be paid');
      }
      const account = await tx.treasuryAccount.findFirst({
        where: { id: dto.accountId, companyId: user.companyId },
      });
      if (!account) throw new BadRequestException('Account not found');
      if (account.currencyCode !== base) {
        throw new BadRequestException(`Expenses are paid from ${base} accounts`);
      }
      const paymentDate = parseDateOnly(dto.paymentDate ?? new Date().toISOString());
      await this.treasury.post(tx, user, {
        accountId: account.id,
        txDate: paymentDate,
        documentType: TreasuryDocumentType.EXPENSE_PAYMENT,
        documentId: report.id,
        documentNumber: report.number,
        description: `Masraf ödemesi: ${employeeName(report)} — ${report.title}`,
        amountOut: report.totalAmount,
      });
      await tx.expenseReport.update({
        where: { id },
        data: {
          status: ExpenseReportStatus.PAID,
          paymentAccountId: account.id,
          paymentDate,
          paidAt: new Date(),
          paidById: user.id,
        },
      });
      return report;
    });
    if (row.employee.userId && row.employee.userId !== user.id) {
      await this.notifications.notify({
        userIds: [row.employee.userId],
        companyId: user.companyId,
        type: 'expenses.paid',
        title: 'Masrafınız ödendi',
        body: `${row.number} — ${row.title}: ${amountText(row.totalAmount, base)}`,
        link: `/expenses/${row.id}`,
      });
    }
    return this.findOne(user, id);
  }

  /** Undoes a payment with a reversing cash / bank entry; the report is approved again. */
  async reversePayment(user: AuthUser, id: string): Promise<ExpenseReportDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const report = await this.lock(tx, user.companyId, id);
      if (report.status !== ExpenseReportStatus.PAID) {
        throw new ConflictException('Report is not paid');
      }
      await this.treasury.reverse(
        tx,
        user,
        TreasuryDocumentType.EXPENSE_PAYMENT,
        report.id,
        parseDateOnly(new Date().toISOString()),
        `Masraf ödemesi iptali: ${report.number}`,
      );
      await tx.expenseReport.update({
        where: { id },
        data: {
          status: ExpenseReportStatus.APPROVED,
          paymentAccountId: null,
          paymentDate: null,
          paidAt: null,
          paidById: null,
        },
      });
    });
    return this.findOne(user, id);
  }

  async uploadReceipt(user: AuthUser, file: Express.Multer.File) {
    if (!hasPermission(user, 'expenses:create')) await this.resolveEmployee(user);
    return this.files.upload(user.companyId, user.id, file, { entityType: RECEIPT_ENTITY });
  }

  async receiptUrl(user: AuthUser, id: string, lineId: string) {
    const row = await this.getVisible(user, id);
    const line = row.lines.find((l) => l.id === lineId);
    if (!line?.receiptFileId) throw new NotFoundException('Receipt not found');
    return this.files.getDownloadUrl(user.companyId, line.receiptFileId);
  }

  async summary(user: AuthUser): Promise<ExpenseSummaryDto> {
    const scope = this.scope(user, false);
    const mine = this.scope(user, true);
    const today = new Date();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    const sixMonthsAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
    const sum = (where: Prisma.ExpenseReportWhereInput) =>
      this.prisma.expenseReport.aggregate({
        where,
        _count: true,
        _sum: { totalAmount: true },
      });
    const doneLines = { report: { AND: [scope, { status: { in: DONE_STATUSES } }] } };

    const [base, pending, toPay, paid, myDraft, myPending, myToPay, byCategory, recent] =
      await Promise.all([
        this.baseCurrency(user.companyId),
        sum({ AND: [scope, { status: ExpenseReportStatus.PENDING }] }),
        sum({ AND: [scope, { status: ExpenseReportStatus.APPROVED }] }),
        sum({
          AND: [scope, { status: ExpenseReportStatus.PAID, paymentDate: { gte: monthStart } }],
        }),
        sum({ AND: [mine, { status: ExpenseReportStatus.DRAFT }] }),
        sum({ AND: [mine, { status: ExpenseReportStatus.PENDING }] }),
        sum({ AND: [mine, { status: ExpenseReportStatus.APPROVED }] }),
        this.prisma.expenseLine.groupBy({
          by: ['categoryId'],
          where: { ...doneLines, expenseDate: { gte: yearStart } },
          _sum: { amountBase: true },
        }),
        this.prisma.expenseLine.findMany({
          where: { ...doneLines, expenseDate: { gte: sixMonthsAgo } },
          select: { expenseDate: true, amountBase: true },
        }),
      ]);

    const categories = await this.prisma.expenseCategory.findMany({
      where: { id: { in: byCategory.map((row) => row.categoryId) } },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const months = new Map<string, Prisma.Decimal>();
    for (let i = 0; i < 6; i++) {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5 + i, 1));
      months.set(toDateOnly(date).slice(0, 7), dec(0));
    }
    for (const line of recent) {
      const key = toDateOnly(line.expenseDate).slice(0, 7);
      months.set(key, (months.get(key) ?? dec(0)).plus(line.amountBase));
    }

    return {
      currencyCode: base,
      pendingCount: pending._count,
      pendingAmount: money(pending._sum.totalAmount ?? 0),
      toPayCount: toPay._count,
      toPayAmount: money(toPay._sum.totalAmount ?? 0),
      paidThisMonthAmount: money(paid._sum.totalAmount ?? 0),
      byCategory: byCategory
        .map((row) => {
          const category = categoryById.get(row.categoryId) as ExpenseCategory;
          return {
            categoryId: row.categoryId,
            name: category.name,
            kind: category.kind,
            amount: money(row._sum.amountBase ?? 0),
          };
        })
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      byMonth: [...months.entries()].map(([month, amount]) => ({ month, amount: money(amount) })),
      myDraftCount: myDraft._count,
      myPendingCount: myPending._count,
      myToPayAmount: money(myToPay._sum.totalAmount ?? 0),
    };
  }

  // ---------- helpers ----------

  private scope(user: AuthUser, mineOnly: boolean): Prisma.ExpenseReportWhereInput {
    if (!mineOnly && hasPermission(user, 'expenses:read')) return { companyId: user.companyId };
    return {
      companyId: user.companyId,
      OR: [{ employee: { userId: user.id } }, { createdById: user.id }],
    };
  }

  private async getVisible(user: AuthUser, id: string): Promise<DetailRow> {
    const row = await this.prisma.expenseReport.findFirst({
      where: { id, companyId: user.companyId },
      include: detailInclude,
    });
    if (!row || !(isOwner(row, user) || hasPermission(user, 'expenses:read'))) {
      throw new NotFoundException('Expense report not found');
    }
    return row;
  }

  private async lock(tx: PrismaTx, companyId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM expense_reports WHERE id = ${id}::uuid FOR UPDATE`;
    const report = await tx.expenseReport.findFirst({
      where: { id, companyId },
      include: listInclude,
    });
    if (!report) throw new NotFoundException('Expense report not found');
    return report;
  }

  private async lockOwned(tx: PrismaTx, user: AuthUser, id: string) {
    const report = await this.lock(tx, user.companyId, id);
    if (!isOwner(report, user)) {
      if (hasPermission(user, 'expenses:read')) {
        throw new ForbiddenException('Only the owner can change this report');
      }
      throw new NotFoundException('Expense report not found');
    }
    return report;
  }

  private async resolveEmployee(user: AuthUser, employeeId?: string) {
    const own = await this.prisma.employee.findFirst({
      where: { companyId: user.companyId, userId: user.id, deletedAt: null },
    });
    const target =
      employeeId && employeeId !== own?.id ? await this.otherEmployee(user, employeeId) : own;
    if (!target) throw new NotFoundException('No employee record is linked to your account');
    if (target.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Employee is not active');
    }
    return target;
  }

  private async otherEmployee(user: AuthUser, employeeId: string) {
    if (!hasPermission(user, 'expenses:create')) {
      throw new ForbiddenException('You can only file expenses for yourself');
    }
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId: user.companyId, deletedAt: null },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  private async buildLines(
    tx: PrismaTx,
    user: AuthUser,
    inputs: ExpenseLineInputDto[],
    base: string,
    reportId: string | null,
  ): Promise<LineData[]> {
    const { companyId } = user;
    const categories = new Map(
      (
        await tx.expenseCategory.findMany({
          where: { companyId, id: { in: inputs.map((l) => l.categoryId) } },
        })
      ).map((c) => [c.id, c]),
    );
    const currencies = [
      ...new Set(inputs.map((l) => l.currencyCode ?? base).filter((c) => c !== base)),
    ];
    if (currencies.length) {
      const known = await tx.currency.count({ where: { code: { in: currencies } } });
      if (known !== currencies.length) throw new BadRequestException('Unknown currency');
    }
    const rates = await this.treasury.latestRates(companyId, currencies);
    const receiptIds = inputs.map((l) => l.receiptFileId).filter((id): id is string => !!id);
    if (receiptIds.length) {
      const owned = await tx.fileObject.count({
        where: {
          id: { in: receiptIds },
          companyId,
          deletedAt: null,
          entityType: RECEIPT_ENTITY,
          OR: [{ uploadedById: user.id }, ...(reportId ? [{ entityId: reportId }] : [])],
        },
      });
      if (owned !== new Set(receiptIds).size) throw new BadRequestException('Receipt not found');
    }
    const latestDate = parseDateOnly(new Date(Date.now() + 86_400_000).toISOString());

    return inputs.map((input, index) => {
      const label = `Line ${index + 1}`;
      const category = categories.get(input.categoryId);
      if (!category?.isActive) throw new BadRequestException(`${label}: category not found`);
      const expenseDate = parseDateOnly(input.expenseDate);
      if (expenseDate > latestDate) {
        throw new BadRequestException(`${label}: expense date is in the future`);
      }
      const isReceipt = category.kind === ExpenseCategoryKind.RECEIPT;
      if (isReceipt && !input.amount) throw new BadRequestException(`${label}: amount is required`);
      if (!isReceipt && !input.quantity) {
        throw new BadRequestException(`${label}: quantity is required`);
      }
      const currencyCode = isReceipt ? (input.currencyCode ?? base) : base;
      const exchangeRate =
        currencyCode === base ? dec(1) : dec(input.exchangeRate ?? rates.get(currencyCode) ?? 0);
      if (exchangeRate.isZero()) {
        throw new BadRequestException(`${label}: no exchange rate for ${currencyCode}`);
      }
      const amounts = lineAmounts(category, {
        quantity: input.quantity,
        amount: input.amount,
        exchangeRate,
      });
      const vatAmount = isReceipt ? dec(input.vatAmount ?? 0) : dec(0);
      if (vatAmount.greaterThan(amounts.amount)) {
        throw new BadRequestException(`${label}: VAT cannot exceed the amount`);
      }
      return {
        lineNo: index + 1,
        categoryId: category.id,
        expenseDate,
        description: input.description.trim(),
        merchant: input.merchant?.trim() || null,
        quantity: amounts.quantity,
        amount: amounts.amount,
        vatAmount,
        currencyCode,
        exchangeRate,
        amountBase: amounts.amountBase,
        receiptFileId: input.receiptFileId ?? null,
      };
    });
  }

  private async attachReceipts(tx: PrismaTx, reportId: string, lines: LineData[]) {
    const ids = lines.map((l) => l.receiptFileId).filter((id): id is string => !!id);
    if (!ids.length) return;
    await tx.fileObject.updateMany({ where: { id: { in: ids } }, data: { entityId: reportId } });
  }

  /** Approved and paid reports count towards their project's cost. */
  private async chargeProject(
    tx: PrismaTx,
    report: { projectId: string | null; totalAmount: Prisma.Decimal },
    sign: 1 | -1,
  ) {
    if (!report.projectId) return;
    await this.projects.addExpenseCost(tx, report.projectId, report.totalAmount.mul(sign));
  }

  /** Tells whoever reimburses expenses (`expenses:pay`) that a report is ready to pay. */
  private async notifyPayers(row: ListRow, companyId: string) {
    const userIds = await this.notifications.findUserIdsWithPermission(companyId, 'expenses:pay');
    const base = await this.baseCurrency(companyId);
    await this.notifications.notify({
      userIds,
      companyId,
      type: 'expenses.approved',
      title: 'Ödenecek masraf',
      body: `${row.number} — ${employeeName(row)}: ${amountText(row.totalAmount, base)}`,
      link: `/expenses/${row.id}`,
    });
  }

  private async baseCurrency(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { baseCurrency: true },
    });
    return company.baseCurrency;
  }
}

function employeeName(row: ListRow): string {
  return `${row.employee.firstName} ${row.employee.lastName}`;
}

function isOwner(row: ListRow & { createdById: string }, user: AuthUser): boolean {
  return row.employee.userId === user.id || row.createdById === user.id;
}

/** Owners cancel anything still open; `expenses:update` can also close others' non-pending reports. */
function canCancel(row: DetailRow, user: AuthUser): boolean {
  if (!CANCELLABLE_STATUSES.includes(row.status)) return false;
  if (isOwner(row, user)) return true;
  return row.status !== ExpenseReportStatus.PENDING && hasPermission(user, 'expenses:update');
}

function lineCheck(line: DetailRow['lines'][number]) {
  return {
    kind: line.category.kind,
    requiresReceipt: line.category.requiresReceipt,
    receiptFileId: line.receiptFileId,
  };
}

function toDto(row: ListRow, base: string): ExpenseReportDto {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    employeeId: row.employeeId,
    employeeName: employeeName(row),
    departmentName: row.employee.department?.name ?? null,
    projectId: row.projectId,
    projectNumber: row.project?.number ?? null,
    projectName: row.project?.name ?? null,
    status: row.status,
    totalAmount: money(row.totalAmount),
    currencyCode: base,
    lineCount: row._count.lines,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
    paymentDate: row.paymentDate ? toDateOnly(row.paymentDate) : null,
    createdAt: row.createdAt,
  };
}

function toDetailDto(row: DetailRow, base: string, user: AuthUser): ExpenseReportDetailDto {
  const owner = isOwner(row, user);
  const canPay = hasPermission(user, 'expenses:pay');
  const lines = row.lines.map((line) => ({
    id: line.id,
    lineNo: line.lineNo,
    categoryId: line.categoryId,
    categoryName: line.category.name,
    categoryKind: line.category.kind,
    expenseDate: toDateOnly(line.expenseDate),
    description: line.description,
    merchant: line.merchant,
    quantity: money(line.quantity),
    amount: money(line.amount),
    vatAmount: money(line.vatAmount),
    currencyCode: line.currencyCode,
    exchangeRate: line.exchangeRate.toString(),
    amountBase: money(line.amountBase),
    receiptFileId: line.receiptFileId,
    receiptName: line.receipt?.originalName ?? null,
    overLimit: isOverLimit(line.amountBase, line.category.limitAmount),
    missingReceipt: isMissingReceipt(lineCheck(line)),
  }));
  const editable = owner && EDITABLE_STATUSES.includes(row.status);
  const missingReceiptCount = lines.filter((l) => l.missingReceipt).length;
  return {
    ...toDto(row, base),
    description: row.description,
    lines,
    workflowInstanceId: row.workflowInstanceId,
    paymentAccountId: row.paymentAccountId,
    paymentAccountName: row.paymentAccount?.name ?? null,
    paidAt: row.paidAt,
    paidByName: row.paidBy ? `${row.paidBy.firstName} ${row.paidBy.lastName}` : null,
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    vatTotal: money(
      row.lines.reduce((sum, l) => sum.plus(toBase(l.vatAmount, l.exchangeRate)), dec(0)),
    ),
    overLimitCount: lines.filter((l) => l.overLimit).length,
    missingReceiptCount,
    canEdit: editable,
    canSubmit: editable && lines.length > 0 && !missingReceiptCount,
    canWithdraw: owner && row.status === ExpenseReportStatus.PENDING,
    canCancel: canCancel(row, user),
    canPay: canPay && row.status === ExpenseReportStatus.APPROVED,
    canReversePayment: canPay && row.status === ExpenseReportStatus.PAID,
  };
}
