import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JournalEntryStatus, Prisma, type LedgerAccount } from '@prisma/client';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { accountType } from './accounting-chart';
import { accountingToday, installChart, ZERO } from './accounting-helpers';
import { compareCodes } from './accounting-math';
import type {
  AccountLedgerDto,
  AccountLedgerQueryDto,
  CreateLedgerAccountDto,
  InstallChartResultDto,
  LedgerAccountDto,
  UpdateLedgerAccountDto,
} from './dto/accounting.dto';

const covers = (parent: string, code: string) => code === parent || code.startsWith(`${parent}.`);
const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

interface AccountSums {
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  lines: number;
}

@Injectable()
export class LedgerAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The whole chart with balances; parents include their sub-accounts. */
  async list(companyId: string): Promise<LedgerAccountDto[]> {
    const [accounts, sums] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ where: { companyId } }),
      this.sums(companyId),
    ]);
    const byId = new Map(sums.map((s) => [s.accountId, s]));
    accounts.sort((a, b) => compareCodes(a.code, b.code));
    return accounts.map((account) => this.toDto(account, accounts, byId));
  }

  async findOne(companyId: string, id: string): Promise<LedgerAccountDto> {
    const list = await this.list(companyId);
    const account = list.find((a) => a.id === id);
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async install(companyId: string): Promise<InstallChartResultDto> {
    return { created: await installChart(this.prisma, companyId) };
  }

  /** Sub-accounts inherit the type of their parent; main accounts take it from the class. */
  async create(companyId: string, dto: CreateLedgerAccountDto): Promise<LedgerAccountDto> {
    const code = dto.code.trim();
    const dot = code.lastIndexOf('.');
    let parent: LedgerAccount | null = null;
    if (dot > 0) {
      parent = await this.prisma.ledgerAccount.findUnique({
        where: { companyId_code: { companyId, code: code.slice(0, dot) } },
      });
      if (!parent) throw new BadRequestException(`Account ${code.slice(0, dot)} does not exist`);
    }
    try {
      const row = await this.prisma.ledgerAccount.create({
        data: {
          companyId,
          code,
          name: dto.name.trim(),
          type: parent?.type ?? accountType(code),
          parentId: parent?.id ?? null,
        },
      });
      return this.findOne(companyId, row.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Account ${code} already exists`);
      }
      throw error;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateLedgerAccountDto,
  ): Promise<LedgerAccountDto> {
    const account = await this.get(companyId, id);
    if (dto.isActive === false && account.isSystem) {
      throw new ConflictException('System accounts are used by automatic postings');
    }
    await this.prisma.ledgerAccount.update({
      where: { id },
      data: { name: dto.name?.trim(), isActive: dto.isActive },
    });
    return this.findOne(companyId, id);
  }

  /** Only unused accounts without sub-accounts; the others are deactivated instead. */
  async remove(companyId: string, id: string): Promise<void> {
    const account = await this.get(companyId, id);
    if (account.isSystem) throw new ConflictException('System accounts cannot be deleted');
    const [children, lines] = await Promise.all([
      this.prisma.ledgerAccount.count({ where: { parentId: id } }),
      this.prisma.journalLine.count({ where: { accountId: id } }),
    ]);
    if (children || lines) {
      throw new ConflictException('The account has sub-accounts or entries; deactivate it instead');
    }
    await this.prisma.ledgerAccount.delete({ where: { id } });
  }

  /** Muavin defter: posted lines of the account and its sub-accounts with a running balance. */
  async ledger(
    companyId: string,
    id: string,
    query: AccountLedgerQueryDto,
  ): Promise<AccountLedgerDto> {
    const account = await this.findOne(companyId, id);
    const today = accountingToday();
    const to = query.to ? parseDateOnly(query.to) : today;
    const from = query.from
      ? parseDateOnly(query.from)
      : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
    if (from > to) throw new BadRequestException('"from" must not be after "to"');

    const codes = await this.prisma.ledgerAccount.findMany({
      where: { companyId },
      select: { id: true, code: true },
    });
    const accountIds = codes.filter((c) => covers(account.code, c.code)).map((c) => c.id);
    const where: Prisma.JournalLineWhereInput = {
      accountId: { in: accountIds },
      partnerId: query.partnerId,
      entry: { companyId, status: JournalEntryStatus.POSTED },
    };
    const [before, lines] = await Promise.all([
      this.prisma.journalLine.aggregate({
        where: { ...where, entry: { ...(where.entry as object), entryDate: { lt: from } } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalLine.findMany({
        where: {
          ...where,
          entry: { ...(where.entry as object), entryDate: { gte: from, lte: to } },
        },
        include: {
          entry: true,
          account: { select: { code: true } },
          partner: { select: { title: true } },
          employee: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ entry: { entryDate: 'asc' } }, { entry: { number: 'asc' } }, { lineNo: 'asc' }],
      }),
    ]);
    const opening = (before._sum.debit ?? ZERO).minus(before._sum.credit ?? ZERO);
    let balance = opening;
    let totalDebit = ZERO;
    let totalCredit = ZERO;
    const rows = lines.map((l) => {
      balance = balance.plus(l.debit).minus(l.credit);
      totalDebit = totalDebit.plus(l.debit);
      totalCredit = totalCredit.plus(l.credit);
      return {
        entryId: l.entryId,
        entryNumber: l.entry.number,
        entryDate: toDateOnly(l.entry.entryDate),
        source: l.entry.source,
        sourceNumber: l.entry.sourceNumber,
        description: l.entry.description,
        lineDescription: l.description,
        accountCode: l.account.code,
        partnerName: l.partner?.title ?? null,
        employeeName: l.employee ? fullName(l.employee) : null,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
        balance: balance.toFixed(2),
      };
    });
    return {
      account,
      from: toDateOnly(from),
      to: toDateOnly(to),
      opening: opening.toFixed(2),
      rows,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
      closing: balance.toFixed(2),
    };
  }

  private async get(companyId: string, id: string): Promise<LedgerAccount> {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { id, companyId } });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  private async sums(companyId: string): Promise<AccountSums[]> {
    const rows = await this.prisma.$queryRaw<
      {
        accountId: string;
        debit: Prisma.Decimal | null;
        credit: Prisma.Decimal | null;
        lines: bigint;
      }[]
    >`
      SELECT l."accountId",
        SUM(CASE WHEN e.status = 'POSTED' THEN l.debit ELSE 0 END) AS debit,
        SUM(CASE WHEN e.status = 'POSTED' THEN l.credit ELSE 0 END) AS credit,
        COUNT(*) AS lines
      FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId"
      WHERE e."companyId" = ${companyId}::uuid
      GROUP BY l."accountId"`;
    return rows.map((r) => ({
      accountId: r.accountId,
      debit: new Prisma.Decimal(r.debit ?? 0),
      credit: new Prisma.Decimal(r.credit ?? 0),
      lines: Number(r.lines),
    }));
  }

  private toDto(
    account: LedgerAccount,
    all: LedgerAccount[],
    sums: Map<string, AccountSums>,
  ): LedgerAccountDto {
    const covered = all.filter((a) => covers(account.code, a.code));
    const own = covered.map((a) => sums.get(a.id)).filter((s): s is AccountSums => !!s);
    const debit = own.reduce((sum, s) => sum.plus(s.debit), ZERO);
    const credit = own.reduce((sum, s) => sum.plus(s.credit), ZERO);
    return {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      parentId: account.parentId,
      level: account.code.split('.').length - 1,
      isSystem: account.isSystem,
      isActive: account.isActive,
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      balance: debit.minus(credit).toFixed(2),
      hasEntries: own.some((s) => s.lines > 0),
      childCount: all.filter((a) => a.parentId === account.id).length,
    };
  }
}
