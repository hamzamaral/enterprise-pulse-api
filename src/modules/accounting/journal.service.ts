import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JournalEntryStatus, JournalSource, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import {
  ACCOUNTING_APPROVE,
  ACCOUNTING_UPDATE,
  assertOpenPeriod,
  isLocked,
  JOURNAL_SEQUENCE,
  lockAccounting,
  lockedUntil,
  reverseEntry,
} from './accounting-helpers';
import { isBalanced, lineTotals } from './accounting-math';
import type {
  JournalEntryDetailDto,
  JournalEntryDto,
  JournalQueryDto,
  ReverseJournalEntryDto,
  SaveJournalEntryDto,
} from './dto/accounting.dto';

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

const listInclude = {
  createdBy: { select: { firstName: true, lastName: true } },
  reversal: { select: { id: true, number: true } },
} satisfies Prisma.JournalEntryInclude;

const detailInclude = {
  ...listInclude,
  reverses: { select: { id: true, number: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      account: { select: { code: true, name: true } },
      partner: { select: { title: true } },
      employee: { select: { firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.JournalEntryInclude;

type ListRow = Prisma.JournalEntryGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.JournalEntryGetPayload<{ include: typeof detailInclude }>;

const SORTS = ['entryDate', 'number', 'total'] as const;

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  /** Yevmiye defteri; searches number, description and source document number. */
  async list(companyId: string, query: JournalQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.JournalEntryWhereInput = {
      companyId,
      source: query.source,
      status: query.status,
      entryDate: {
        gte: query.from ? parseDateOnly(query.from) : undefined,
        lte: query.to ? parseDateOnly(query.to) : undefined,
      },
      OR: search
        ? [
            { number: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { sourceNumber: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const sortBy = SORTS.includes(query.sortBy as (typeof SORTS)[number])
      ? (query.sortBy as (typeof SORTS)[number])
      : 'entryDate';
    const order = query.sortOrder ?? 'desc';
    const [rows, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: listInclude,
        orderBy: [{ [sortBy]: order }, { number: order }],
        ...toPageArgs(query),
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(user: AuthUser, id: string): Promise<JournalEntryDetailDto> {
    const row = await this.prisma.journalEntry.findFirst({
      where: { id, companyId: user.companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Journal entry not found');
    const until = await lockedUntil(this.prisma, user.companyId);
    const locked = isLocked(row.entryDate, until);
    const manual = row.source === JournalSource.MANUAL;
    const draft = row.status === JournalEntryStatus.DRAFT;
    const canUpdate = hasPermission(user, ACCOUNTING_UPDATE);
    const canApprove = hasPermission(user, ACCOUNTING_APPROVE);
    return {
      ...toDto(row),
      documentId: await this.documentId(row),
      lines: row.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        accountId: l.accountId,
        accountCode: l.account.code,
        accountName: l.account.name,
        partnerId: l.partnerId,
        partnerName: l.partner?.title ?? null,
        employeeId: l.employeeId,
        employeeName: l.employee ? fullName(l.employee) : null,
        description: l.description,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
      })),
      reverses: row.reverses,
      reversal: row.reversal,
      locked,
      canEdit: draft && canUpdate,
      canPost: draft && canApprove && !locked && isBalanced(row.lines),
      canReverse: !draft && manual && canApprove && !row.reversesId && !row.reversal,
      canDelete: draft && canUpdate,
    };
  }

  /** Manual entries start as drafts (taslak fiş). */
  async create(user: AuthUser, dto: SaveJournalEntryDto): Promise<JournalEntryDetailDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      const lines = await this.validateLines(tx, user.companyId, dto);
      const number = await this.numbering.next(user.companyId, JOURNAL_SEQUENCE, tx);
      const entry = await tx.journalEntry.create({
        data: {
          companyId: user.companyId,
          number,
          entryDate: parseDateOnly(dto.entryDate),
          description: dto.description.trim(),
          total: lineTotals(lines).debit,
          createdById: user.id,
          lines: { create: lines },
        },
      });
      return entry.id;
    });
    return this.findOne(user, id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: SaveJournalEntryDto,
  ): Promise<JournalEntryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, user.companyId, id);
      const lines = await this.validateLines(tx, user.companyId, dto);
      await tx.journalLine.deleteMany({ where: { entryId: id } });
      await tx.journalEntry.update({
        where: { id },
        data: {
          entryDate: parseDateOnly(dto.entryDate),
          description: dto.description.trim(),
          total: lineTotals(lines).debit,
          lines: { create: lines },
        },
      });
    });
    return this.findOne(user, id);
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, user.companyId, id);
      await tx.journalEntry.delete({ where: { id } });
    });
  }

  /** Borç = alacak, accounts active, date outside the locked period. */
  async post(user: AuthUser, id: string): Promise<JournalEntryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await lockAccounting(tx, user.companyId);
      const entry = await this.lockDraft(tx, user.companyId, id);
      assertOpenPeriod(entry.entryDate, await lockedUntil(tx, user.companyId));
      const lines = await tx.journalLine.findMany({
        where: { entryId: id },
        include: { account: { select: { code: true, isActive: true } } },
      });
      if (!isBalanced(lines)) {
        const { debit, credit } = lineTotals(lines);
        throw new BadRequestException(
          `Debit ${debit.toFixed(2)} and credit ${credit.toFixed(2)} must be equal`,
        );
      }
      const inactive = lines.find((l) => !l.account.isActive);
      if (inactive) throw new BadRequestException(`Account ${inactive.account.code} is inactive`);
      await tx.journalEntry.update({
        where: { id },
        data: { status: JournalEntryStatus.POSTED, postedAt: new Date() },
      });
    });
    return this.findOne(user, id);
  }

  /** Ters kayıt of a posted manual entry; automatic entries follow their source document. */
  async reverse(
    user: AuthUser,
    id: string,
    dto: ReverseJournalEntryDto,
  ): Promise<JournalEntryDetailDto> {
    const reversalId = await this.prisma.$transaction(async (tx) => {
      await lockAccounting(tx, user.companyId);
      await tx.$queryRaw`SELECT id FROM journal_entries WHERE id = ${id}::uuid FOR UPDATE`;
      const entry = await tx.journalEntry.findFirst({
        where: { id, companyId: user.companyId },
        include: { reversal: { select: { id: true } } },
      });
      if (!entry) throw new NotFoundException('Journal entry not found');
      if (entry.status !== JournalEntryStatus.POSTED) {
        throw new ConflictException('Only posted entries can be reversed');
      }
      if (entry.source !== JournalSource.MANUAL) {
        throw new ConflictException('Cancel the source document to reverse an automatic entry');
      }
      if (entry.reversesId || entry.reversal) {
        throw new ConflictException('The entry is already reversed');
      }
      const date = parseDateOnly(dto.date);
      if (date < entry.entryDate) {
        throw new BadRequestException('The reversal cannot be dated before the entry');
      }
      assertOpenPeriod(date, await lockedUntil(tx, user.companyId));
      const reversal = await reverseEntry(tx, this.numbering, {
        companyId: user.companyId,
        userId: user.id,
        entryId: id,
        date,
        note: dto.note,
      });
      return reversal.id;
    });
    return this.findOne(user, reversalId);
  }

  private async documentId(row: { source: JournalSource; sourceId: string | null }) {
    if (!row.sourceId) return null;
    switch (row.source) {
      case JournalSource.MANUAL:
        return null;
      case JournalSource.TREASURY_OPENING:
      case JournalSource.CHEQUE:
      case JournalSource.EXPENSE_PAYMENT:
      case JournalSource.PAYROLL_PAYMENT: {
        const tx = await this.prisma.treasuryTransaction.findUnique({
          where: { id: row.sourceId },
          select: { accountId: true, documentId: true },
        });
        if (!tx) return null;
        return row.source === JournalSource.TREASURY_OPENING ? tx.accountId : tx.documentId;
      }
      case JournalSource.PARTNER_OPENING: {
        const entry = await this.prisma.partnerLedgerEntry.findUnique({
          where: { id: row.sourceId },
          select: { partnerId: true },
        });
        return entry?.partnerId ?? null;
      }
      default:
        return row.sourceId;
    }
  }

  private async lockDraft(tx: PrismaTx, companyId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM journal_entries WHERE id = ${id}::uuid FOR UPDATE`;
    const entry = await tx.journalEntry.findFirst({ where: { id, companyId } });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.status !== JournalEntryStatus.DRAFT || entry.source !== JournalSource.MANUAL) {
      throw new ConflictException('Only draft entries can be changed');
    }
    return entry;
  }

  private async validateLines(tx: PrismaTx, companyId: string, dto: SaveJournalEntryDto) {
    for (const [index, line] of dto.lines.entries()) {
      if (line.debit > 0 === line.credit > 0) {
        throw new BadRequestException(`Line ${index + 1}: enter either a debit or a credit`);
      }
    }
    const ids = (values: (string | null | undefined)[]) => [
      ...new Set(values.filter((v): v is string => !!v)),
    ];
    const accountIds = ids(dto.lines.map((l) => l.accountId));
    const partnerIds = ids(dto.lines.map((l) => l.partnerId));
    const employeeIds = ids(dto.lines.map((l) => l.employeeId));
    const [accounts, partners, employees] = await Promise.all([
      tx.ledgerAccount.findMany({ where: { companyId, id: { in: accountIds }, isActive: true } }),
      tx.businessPartner.count({ where: { companyId, id: { in: partnerIds } } }),
      tx.employee.count({ where: { companyId, id: { in: employeeIds } } }),
    ]);
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException('Pick active accounts of this company');
    }
    if (partners !== partnerIds.length) throw new BadRequestException('Partner not found');
    if (employees !== employeeIds.length) throw new BadRequestException('Employee not found');
    return dto.lines.map((l, index) => ({
      lineNo: index + 1,
      accountId: l.accountId,
      partnerId: l.partnerId || null,
      employeeId: l.employeeId || null,
      description: l.description?.trim() || null,
      debit: new Prisma.Decimal(l.debit),
      credit: new Prisma.Decimal(l.credit),
    }));
  }
}

function toDto(row: ListRow | DetailRow): JournalEntryDto {
  return {
    id: row.id,
    number: row.number,
    entryDate: toDateOnly(row.entryDate),
    status: row.status,
    source: row.source,
    sourceId: row.sourceId,
    sourceNumber: row.sourceNumber,
    description: row.description,
    total: row.total.toFixed(2),
    isReversal: !!row.reversesId,
    isReversed: !!row.reversal,
    createdByName: fullName(row.createdBy),
    postedAt: row.postedAt?.toISOString() ?? null,
  };
}
