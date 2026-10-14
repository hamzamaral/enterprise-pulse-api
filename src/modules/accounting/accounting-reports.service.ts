import { BadRequestException, Injectable } from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isResultAccount, mainCode } from './accounting-chart';
import { accountingToday, lockedUntil, SETTINGS_KEY, ZERO } from './accounting-helpers';
import {
  balanceSheet,
  compareCodes,
  incomeStatement,
  trialBalance,
  type AmountRow,
  type TrialBalanceRow,
} from './accounting-math';
import { AccountingPostingService } from './accounting-posting.service';
import type {
  AccountingOptionsDto,
  AccountingSettingsDto,
  AccountingSummaryDto,
  BalanceSheetDto,
  BalanceSheetQueryDto,
  DateRangeQueryDto,
  IncomeStatementDto,
  TrialBalanceDto,
  TrialBalanceQueryDto,
  UpdateAccountingSettingsDto,
} from './dto/accounting.dto';

type Dec = Prisma.Decimal;

interface CodeSums {
  code: string;
  name: string;
  openingDebit: Dec;
  openingCredit: Dec;
  periodDebit: Dec;
  periodCredit: Dec;
}

const money = (value: Dec) => value.toFixed(2);
const REVENUE_PREFIXES = ['60', '61', '64', '67'];

@Injectable()
export class AccountingReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: AccountingPostingService,
  ) {}

  /** Mizan; defaults to the current year up to today. */
  async trialBalance(companyId: string, query: TrialBalanceQueryDto): Promise<TrialBalanceDto> {
    const { from, to } = this.range(query);
    const [sums, accounts] = await Promise.all([
      this.sums(companyId, from, to),
      this.prisma.ledgerAccount.findMany({
        where: { companyId },
        select: { id: true, code: true, name: true },
      }),
    ]);
    const ids = new Map(accounts.map((a) => [a.code, a.id]));
    const result = trialBalance(
      accounts,
      sums.map((s) => ({ ...s })),
      query.detailed ?? false,
    );
    return {
      from: toDateOnly(from),
      to: toDateOnly(to),
      rows: result.rows.map((r) => ({
        accountId: ids.get(r.code) ?? null,
        code: r.code,
        name: r.name,
        level: r.level,
        ...totalsDto(r),
      })),
      totals: totalsDto(result.totals),
    };
  }

  /** Bilanço on a date (default today). */
  async balanceSheet(companyId: string, query: BalanceSheetQueryDto): Promise<BalanceSheetDto> {
    const date = query.date ? parseDateOnly(query.date) : accountingToday();
    const yearStart = await this.fiscalYearStart(companyId, date);
    const [all, names] = await Promise.all([
      this.sums(companyId, yearStart, date),
      this.mainNames(companyId),
    ]);
    const balances = mainRows(all, names, (s) =>
      s.openingDebit.plus(s.periodDebit).minus(s.openingCredit).minus(s.periodCredit),
    );
    const result = (rows: CodeSums[], period: boolean) =>
      rows
        .filter((s) => isResultAccount(s.code))
        .reduce(
          (sum, s) =>
            period
              ? sum.plus(s.periodCredit).minus(s.periodDebit)
              : sum.plus(s.openingCredit).minus(s.openingDebit),
          ZERO,
        );
    const sheet = balanceSheet(
      balances.map((b) => ({ code: b.code, name: b.name, balance: b.amount })),
      result(all, true),
      result(all, false),
    );
    const classes = (list: typeof sheet.assets) =>
      list.map((c) => ({
        code: c.code,
        name: c.name,
        total: money(c.total),
        groups: c.groups.map((g) => ({
          code: g.code,
          name: g.name,
          total: money(g.total),
          accounts: g.accounts.map((a) => ({
            code: a.code,
            name: a.name,
            amount: money(a.amount),
          })),
        })),
      }));
    return {
      date: toDateOnly(date),
      assets: classes(sheet.assets),
      liabilities: classes(sheet.liabilities),
      totalAssets: money(sheet.totalAssets),
      totalLiabilities: money(sheet.totalLiabilities),
    };
  }

  /** Gelir tablosu; defaults to the current year up to today. */
  async incomeStatement(companyId: string, query: DateRangeQueryDto): Promise<IncomeStatementDto> {
    const { from, to } = this.range(query);
    const [sums, names] = await Promise.all([
      this.sums(companyId, from, to),
      this.mainNames(companyId),
    ]);
    const statement = incomeStatement(
      mainRows(
        sums.filter((s) => isResultAccount(s.code)),
        names,
        (s) => s.periodCredit.minus(s.periodDebit),
      ),
    );
    return {
      from: toDateOnly(from),
      to: toDateOnly(to),
      sections: statement.sections.map((s) => ({
        key: s.key,
        name: s.name,
        total: money(s.total),
        accounts: s.accounts.map((a) => ({ code: a.code, name: a.name, amount: money(a.amount) })),
      })),
      netSales: money(statement.netSales),
      grossProfit: money(statement.grossProfit),
      operatingProfit: money(statement.operatingProfit),
      ordinaryProfit: money(statement.ordinaryProfit),
      profitBeforeTax: money(statement.profitBeforeTax),
      netProfit: money(statement.netProfit),
    };
  }

  async summary(companyId: string, year?: number): Promise<AccountingSummaryDto> {
    const today = accountingToday();
    const y = year ?? today.getUTCFullYear();
    const start = new Date(Date.UTC(y, 0, 1));
    const end = new Date(Date.UTC(y, 11, 31));
    const balanceDate = end < today ? end : today;
    const [company, balances, months, pending, entryCount, accounts, until] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { baseCurrency: true },
      }),
      this.sums(companyId, balanceDate, balanceDate),
      this.prisma.$queryRaw<{ month: number; prefix: string; debit: Dec; credit: Dec }[]>`
        SELECT EXTRACT(MONTH FROM e."entryDate")::int AS month, LEFT(a.code, 2) AS prefix,
          SUM(l.debit) AS debit, SUM(l.credit) AS credit
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."entryId"
        JOIN ledger_accounts a ON a.id = l."accountId"
        WHERE e."companyId" = ${companyId}::uuid AND e.status = 'POSTED'
          AND e."entryDate" BETWEEN ${start} AND ${end}
          AND LEFT(a.code, 1) IN ('6', '7')
        GROUP BY 1, 2`,
      this.posting.pending(companyId),
      this.prisma.journalEntry.count({
        where: { companyId, entryDate: { gte: start, lte: end } },
      }),
      this.prisma.ledgerAccount.count({ where: { companyId } }),
      lockedUntil(this.prisma, companyId),
    ]);
    const balance = (prefix: string, sign: 1 | -1) =>
      balances
        .filter((s) => s.code.startsWith(prefix))
        .reduce(
          (sum, s) =>
            sum.plus(
              s.openingDebit
                .plus(s.periodDebit)
                .minus(s.openingCredit)
                .minus(s.periodCredit)
                .times(sign),
            ),
          ZERO,
        );
    const monthly = Array.from({ length: 12 }, (_, index) => {
      const rows = months.filter((m) => m.month === index + 1);
      const revenue = rows
        .filter((m) => REVENUE_PREFIXES.includes(m.prefix))
        .reduce((sum, m) => sum.plus(m.credit).minus(m.debit), ZERO);
      const expense = rows
        .filter((m) => !REVENUE_PREFIXES.includes(m.prefix))
        .reduce((sum, m) => sum.plus(m.debit).minus(m.credit), ZERO);
      return { month: index + 1, revenue, expense, profit: revenue.minus(expense) };
    });
    const netSales = months
      .filter((m) => m.prefix === '60' || m.prefix === '61')
      .reduce((sum, m) => sum.plus(m.credit).minus(m.debit), ZERO);
    return {
      year: y,
      currencyCode: company.baseCurrency,
      cash: money(balance('10', 1)),
      receivables: money(balance('12', 1)),
      payables: money(balance('32', -1)),
      netSales: money(netSales),
      netProfit: money(monthly.reduce((sum, m) => sum.plus(m.profit), ZERO)),
      months: monthly.map((m) => ({
        month: m.month,
        revenue: money(m.revenue),
        expense: money(m.expense),
        profit: money(m.profit),
      })),
      pendingCount: pending.length,
      entryCount,
      lockedUntil: until ? toDateOnly(until) : null,
      chartInstalled: accounts > 0,
    };
  }

  async settings(companyId: string): Promise<AccountingSettingsDto> {
    const until = await lockedUntil(this.prisma, companyId);
    return { lockedUntil: until ? toDateOnly(until) : null };
  }

  /** Dönem kilidi; it cannot move past today. */
  async updateSettings(
    companyId: string,
    dto: UpdateAccountingSettingsDto,
  ): Promise<AccountingSettingsDto> {
    const value = dto.lockedUntil ?? null;
    if (value && parseDateOnly(value) > accountingToday()) {
      throw new BadRequestException('The lock date cannot be in the future');
    }
    await this.prisma.setting.upsert({
      where: { companyId_key: { companyId, key: SETTINGS_KEY } },
      create: { companyId, key: SETTINGS_KEY, value: { lockedUntil: value } },
      update: { value: { lockedUntil: value } },
    });
    return { lockedUntil: value };
  }

  /** Active accounts, partners and employees for the entry form. */
  async options(companyId: string): Promise<AccountingOptionsDto> {
    const [accounts, partners, employees] = await Promise.all([
      this.prisma.ledgerAccount.findMany({
        where: { companyId, isActive: true },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.businessPartner.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        select: { id: true, code: true, title: true },
        orderBy: { title: 'asc' },
      }),
      this.prisma.employee.findMany({
        where: { companyId, deletedAt: null, status: EmployeeStatus.ACTIVE },
        select: { id: true, employeeNo: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
    ]);
    return {
      accounts: accounts.sort((a, b) => compareCodes(a.code, b.code)),
      partners: partners.map((p) => ({ id: p.id, code: p.code, name: p.title })),
      employees: employees.map((e) => ({
        id: e.id,
        code: e.employeeNo,
        name: `${e.firstName} ${e.lastName}`,
      })),
    };
  }

  // ---------- Helpers ----------

  private range(query: DateRangeQueryDto): { from: Date; to: Date } {
    const to = query.to ? parseDateOnly(query.to) : accountingToday();
    const from = query.from
      ? parseDateOnly(query.from)
      : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
    if (from > to) throw new BadRequestException('"from" must not be after "to"');
    return { from, to };
  }

  private async mainNames(companyId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.ledgerAccount.findMany({
      where: { companyId, parentId: null },
      select: { code: true, name: true },
    });
    return new Map(rows.map((r) => [r.code, r.name]));
  }

  private async fiscalYearStart(companyId: string, date: Date): Promise<Date> {
    const general = await this.prisma.setting.findUnique({
      where: { companyId_key: { companyId, key: 'general' } },
    });
    const month = Number(
      (general?.value as { fiscalYearStartMonth?: number } | null)?.fiscalYearStartMonth ?? 1,
    );
    const year =
      date.getUTCMonth() + 1 >= month ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
    return new Date(Date.UTC(year, month - 1, 1));
  }

  /** Posted totals per account: before `from` and between `from` and `to`. */
  private async sums(companyId: string, from: Date, to: Date): Promise<CodeSums[]> {
    const rows = await this.prisma.$queryRaw<
      {
        code: string;
        name: string;
        openingDebit: Dec;
        openingCredit: Dec;
        periodDebit: Dec;
        periodCredit: Dec;
      }[]
    >`
      SELECT a.code, a.name,
        SUM(CASE WHEN e."entryDate" < ${from} THEN l.debit ELSE 0 END) AS "openingDebit",
        SUM(CASE WHEN e."entryDate" < ${from} THEN l.credit ELSE 0 END) AS "openingCredit",
        SUM(CASE WHEN e."entryDate" >= ${from} THEN l.debit ELSE 0 END) AS "periodDebit",
        SUM(CASE WHEN e."entryDate" >= ${from} THEN l.credit ELSE 0 END) AS "periodCredit"
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l."entryId"
      JOIN ledger_accounts a ON a.id = l."accountId"
      WHERE e."companyId" = ${companyId}::uuid AND e.status = 'POSTED' AND e."entryDate" <= ${to}
      GROUP BY a.code, a.name`;
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      openingDebit: new Prisma.Decimal(r.openingDebit),
      openingCredit: new Prisma.Decimal(r.openingCredit),
      periodDebit: new Prisma.Decimal(r.periodDebit),
      periodCredit: new Prisma.Decimal(r.periodCredit),
    }));
  }
}

function totalsDto(t: Omit<TrialBalanceRow, 'code' | 'name' | 'level'>) {
  return {
    periodDebit: money(t.periodDebit),
    periodCredit: money(t.periodCredit),
    totalDebit: money(t.totalDebit),
    totalCredit: money(t.totalCredit),
    balanceDebit: money(t.balanceDebit),
    balanceCredit: money(t.balanceCredit),
  };
}

/** Rolls sub-accounts up into their three-digit main account. */
function mainRows(
  sums: CodeSums[],
  names: Map<string, string>,
  amount: (s: CodeSums) => Dec,
): AmountRow[] {
  const rows = new Map<string, AmountRow>();
  for (const s of sums) {
    const code = mainCode(s.code);
    const row = rows.get(code) ?? { code, name: names.get(code) ?? code, amount: ZERO };
    row.amount = row.amount.plus(amount(s));
    rows.set(code, row);
  }
  return [...rows.values()];
}
