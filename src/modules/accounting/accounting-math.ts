import { Prisma } from '@prisma/client';
import {
  ACCOUNT_GROUPS,
  BALANCE_CLASSES,
  INCOME_SECTIONS,
  incomeSection,
  mainCode,
  type IncomeSectionKey,
} from './accounting-chart';

type Dec = Prisma.Decimal;
type Numeric = Dec | number | string;

const ZERO = new Prisma.Decimal(0);
const dec = (value: Numeric) => new Prisma.Decimal(value);

/** Document amount in the base currency, rounded half up to 2 decimals. */
export const toBase = (amount: Numeric, rate: Numeric) =>
  dec(amount).times(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface DraftLine {
  code: string;
  debit?: Numeric;
  credit?: Numeric;
  partnerId?: string | null;
  employeeId?: string | null;
  description?: string | null;
}

export interface PostingLine {
  code: string;
  debit: Dec;
  credit: Dec;
  partnerId: string | null;
  employeeId: string | null;
  description: string | null;
}

/**
 * Drops zero lines, moves negative amounts to the other side and merges lines with the same
 * account, partner, employee, description and side. Debit lines come first (fiş düzeni).
 */
export function normalizeLines(lines: DraftLine[]): PostingLine[] {
  const merged = new Map<string, PostingLine>();
  for (const line of lines) {
    const net = dec(line.debit ?? 0).minus(dec(line.credit ?? 0));
    if (net.isZero()) continue;
    const side = net.isPositive() ? 'D' : 'C';
    const partnerId = line.partnerId ?? null;
    const employeeId = line.employeeId ?? null;
    const description = line.description?.trim() || null;
    const key = [side, line.code, partnerId, employeeId, description].join('|');
    const current = merged.get(key) ?? {
      code: line.code,
      debit: ZERO,
      credit: ZERO,
      partnerId,
      employeeId,
      description,
    };
    if (side === 'D') current.debit = current.debit.plus(net);
    else current.credit = current.credit.plus(net.negated());
    merged.set(key, current);
  }
  const rows = [...merged.values()];
  return [...rows.filter((l) => l.debit.gt(0)), ...rows.filter((l) => l.credit.gt(0))];
}

export function lineTotals(lines: { debit: Numeric; credit: Numeric }[]) {
  return lines.reduce<{ debit: Dec; credit: Dec }>(
    (sum, l) => ({ debit: sum.debit.plus(l.debit), credit: sum.credit.plus(l.credit) }),
    { debit: ZERO, credit: ZERO },
  );
}

/** Borç = alacak and the entry is not empty. */
export function isBalanced(lines: { debit: Numeric; credit: Numeric }[]): boolean {
  const { debit, credit } = lineTotals(lines);
  return debit.gt(0) && debit.eq(credit);
}

/** Ters kayıt: every debit becomes a credit and vice versa. */
export function reverseLines<T extends { debit: Dec; credit: Dec }>(lines: T[]): T[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

/** Order-independent identity of the lines; a changed source document gets a new fingerprint. */
export function fingerprint(
  lines: {
    code: string;
    debit: Numeric;
    credit: Numeric;
    partnerId?: string | null;
    employeeId?: string | null;
  }[],
): string {
  return lines
    .map((l) =>
      [
        l.code,
        dec(l.debit).toFixed(2),
        dec(l.credit).toFixed(2),
        l.partnerId ?? '',
        l.employeeId ?? '',
      ].join('|'),
    )
    .sort()
    .join(';');
}

// ---------- Trial balance (mizan) ----------

export interface AccountRef {
  code: string;
  name: string;
}

export interface AccountMovement {
  code: string;
  /** Before the period. */
  openingDebit: Dec;
  openingCredit: Dec;
  periodDebit: Dec;
  periodCredit: Dec;
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  /** 0 for main accounts, 1+ for sub-accounts. */
  level: number;
  periodDebit: Dec;
  periodCredit: Dec;
  totalDebit: Dec;
  totalCredit: Dec;
  balanceDebit: Dec;
  balanceCredit: Dec;
}

const levelOf = (code: string) => code.split('.').length - 1;
const covers = (parent: string, code: string) => code === parent || code.startsWith(`${parent}.`);

/**
 * Mizan rows: each account totals its own and its sub-accounts' movements; accounts without any
 * movement are left out. `totals` adds up the main accounts only.
 */
export function trialBalance(
  accounts: AccountRef[],
  movements: AccountMovement[],
  detailed: boolean,
): { rows: TrialBalanceRow[]; totals: Omit<TrialBalanceRow, 'code' | 'name' | 'level'> } {
  const names = new Map(accounts.map((a) => [a.code, a.name]));
  const codes = new Set<string>();
  for (const m of movements) {
    const parts = m.code.split('.');
    for (let i = 1; i <= parts.length; i++) codes.add(parts.slice(0, i).join('.'));
  }
  const rows: TrialBalanceRow[] = [];
  for (const code of [...codes].sort(compareCodes)) {
    const level = levelOf(code);
    if (!detailed && level > 0) continue;
    const own = movements.filter((m) => covers(code, m.code));
    const periodDebit = sum(own.map((m) => m.periodDebit));
    const periodCredit = sum(own.map((m) => m.periodCredit));
    const totalDebit = periodDebit.plus(sum(own.map((m) => m.openingDebit)));
    const totalCredit = periodCredit.plus(sum(own.map((m) => m.openingCredit)));
    if (totalDebit.isZero() && totalCredit.isZero()) continue;
    const balance = totalDebit.minus(totalCredit);
    rows.push({
      code,
      name: names.get(code) ?? code,
      level,
      periodDebit,
      periodCredit,
      totalDebit,
      totalCredit,
      balanceDebit: balance.isPositive() ? balance : ZERO,
      balanceCredit: balance.isNegative() ? balance.negated() : ZERO,
    });
  }
  const mains = rows.filter((r) => r.level === 0);
  return {
    rows,
    totals: {
      periodDebit: sum(mains.map((r) => r.periodDebit)),
      periodCredit: sum(mains.map((r) => r.periodCredit)),
      totalDebit: sum(mains.map((r) => r.totalDebit)),
      totalCredit: sum(mains.map((r) => r.totalCredit)),
      balanceDebit: sum(mains.map((r) => r.balanceDebit)),
      balanceCredit: sum(mains.map((r) => r.balanceCredit)),
    },
  };
}

/** "100" < "100.01" < "100.02" < "101". */
export function compareCodes(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

const sum = (values: Dec[]) => values.reduce((acc, v) => acc.plus(v), ZERO);

// ---------- Balance sheet (bilanço) ----------

export interface AmountRow {
  code: string;
  name: string;
  amount: Dec;
}

export interface StatementGroup {
  code: string;
  name: string;
  total: Dec;
  accounts: AmountRow[];
}

export interface StatementClass {
  code: string;
  name: string;
  total: Dec;
  groups: StatementGroup[];
}

export interface BalanceSheet {
  assets: StatementClass[];
  liabilities: StatementClass[];
  totalAssets: Dec;
  totalLiabilities: Dec;
}

/**
 * Bilanço from main-account balances (debit − credit) up to the date. Classes 6 and 7 are not
 * closed, so their result shows as the period's net profit and, for earlier fiscal years, as
 * retained earnings.
 */
export function balanceSheet(
  balances: { code: string; name: string; balance: Dec }[],
  currentResult: Dec,
  priorResult: Dec,
): BalanceSheet {
  const rows = balances
    .filter((b) => Number(b.code[0]) <= 5 && !b.balance.isZero())
    .map((b) => ({
      code: mainCode(b.code),
      name: b.name,
      amount: Number(b.code[0]) <= 2 ? b.balance : b.balance.negated(),
    }));
  const addResult = (code: string, name: string, amount: Dec) => {
    if (amount.isZero()) return;
    const row = rows.find((r) => r.code === code);
    if (row) row.amount = row.amount.plus(amount);
    else rows.push({ code, name, amount });
  };
  addResult('570', 'Geçmiş Yıllar Kârları (Zararları)', priorResult);
  addResult('590', 'Dönem Net Kârı (Zararı)', currentResult);

  const classes = (digits: string[]) =>
    digits
      .map((cls) => {
        const inClass = rows
          .filter((r) => r.code[0] === cls)
          .sort((a, b) => compareCodes(a.code, b.code));
        const groupCodes = [...new Set(inClass.map((r) => r.code.slice(0, 2)))];
        const groups = groupCodes.map((code) => {
          const accounts = inClass.filter((r) => r.code.startsWith(code));
          return {
            code,
            name: ACCOUNT_GROUPS[code] ?? code,
            total: sum(accounts.map((a) => a.amount)),
            accounts,
          };
        });
        return {
          code: cls,
          name: BALANCE_CLASSES[cls],
          total: sum(groups.map((g) => g.total)),
          groups,
        };
      })
      .filter((c) => c.groups.length > 0);
  const assets = classes(['1', '2']);
  const liabilities = classes(['3', '4', '5']);
  return {
    assets,
    liabilities,
    totalAssets: sum(assets.map((c) => c.total)),
    totalLiabilities: sum(liabilities.map((c) => c.total)),
  };
}

// ---------- Income statement (gelir tablosu) ----------

export interface IncomeSection {
  key: IncomeSectionKey;
  name: string;
  total: Dec;
  accounts: AmountRow[];
}

export interface IncomeStatement {
  sections: IncomeSection[];
  netSales: Dec;
  grossProfit: Dec;
  operatingProfit: Dec;
  ordinaryProfit: Dec;
  profitBeforeTax: Dec;
  netProfit: Dec;
}

/** Gelir tablosu from main-account results (credit − debit) of classes 6 and 7. */
export function incomeStatement(
  results: { code: string; name: string; amount: Dec }[],
): IncomeStatement {
  const sections = INCOME_SECTIONS.map(({ key, label }) => {
    const accounts = results
      .filter((r) => incomeSection(r.code) === key && !r.amount.isZero())
      .sort((a, b) => compareCodes(a.code, b.code));
    return { key, name: label, total: sum(accounts.map((a) => a.amount)), accounts };
  });
  const total = (key: IncomeSectionKey) => sections.find((s) => s.key === key)!.total;
  const netSales = total('grossSales').plus(total('salesDeductions'));
  const grossProfit = netSales.plus(total('costOfSales'));
  const operatingProfit = grossProfit.plus(total('operatingExpenses'));
  const ordinaryProfit = operatingProfit
    .plus(total('otherIncome'))
    .plus(total('otherExpenses'))
    .plus(total('financeExpenses'));
  const profitBeforeTax = ordinaryProfit
    .plus(total('extraordinaryIncome'))
    .plus(total('extraordinaryExpenses'));
  return {
    sections,
    netSales,
    grossProfit,
    operatingProfit,
    ordinaryProfit,
    profitBeforeTax,
    netProfit: profitBeforeTax.plus(total('taxProvision')),
  };
}
