import { BadRequestException, ConflictException } from '@nestjs/common';
import { JournalEntryStatus, JournalSource, Prisma } from '@prisma/client';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import type { PrismaService, PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { NumberingService } from '../numbering/numbering.service';
import { defaultChart } from './accounting-chart';
import { lineTotals, normalizeLines, type DraftLine } from './accounting-math';

export const ACCOUNTING_READ = 'accounting:read';
export const ACCOUNTING_UPDATE = 'accounting:update';
export const ACCOUNTING_APPROVE = 'accounting:approve';
export const ACCOUNTING_CLOSE = 'accounting:close';

export const JOURNAL_SEQUENCE = 'JOURNAL_ENTRY';
export const SETTINGS_KEY = 'accounting';

const TIME_ZONE = 'Europe/Istanbul';

/** Calendar day of a timestamp in Istanbul. */
export const localDate = (value: Date) =>
  parseDateOnly(value.toLocaleDateString('en-CA', { timeZone: TIME_ZONE }));

export const accountingToday = () => localDate(new Date());

/** Entries on or before this day are locked (dönem kilidi); null when nothing is locked. */
export async function lockedUntil(
  prisma: PrismaService | PrismaTx,
  companyId: string,
): Promise<Date | null> {
  const row = await prisma.setting.findUnique({
    where: { companyId_key: { companyId, key: SETTINGS_KEY } },
  });
  const value = (row?.value as { lockedUntil?: string | null } | null)?.lockedUntil;
  return value ? parseDateOnly(value) : null;
}

export const isLocked = (date: Date, until: Date | null) => !!until && date <= until;

export function assertOpenPeriod(date: Date, until: Date | null): void {
  if (isLocked(date, until)) {
    throw new BadRequestException(
      `The period is locked until ${toDateOnly(until)}; pick a later date`,
    );
  }
}

/** Adds the missing accounts of the standard chart; existing accounts keep their names. */
export async function installChart(
  prisma: PrismaService | PrismaTx,
  companyId: string,
): Promise<number> {
  const chart = defaultChart();
  const created = await prisma.ledgerAccount.createMany({
    data: chart.map((a) => ({ ...a, companyId })),
    skipDuplicates: true,
  });
  await prisma.ledgerAccount.updateMany({
    where: { companyId, code: { in: chart.filter((a) => a.isSystem).map((a) => a.code) } },
    data: { isSystem: true, isActive: true },
  });
  return created.count;
}

/** Account ids by code; throws when a code is missing from the chart. */
export async function accountIds(
  prisma: PrismaService | PrismaTx,
  companyId: string,
  codes: string[],
): Promise<Map<string, string>> {
  const rows = await prisma.ledgerAccount.findMany({
    where: { companyId, code: { in: [...new Set(codes)] } },
    select: { id: true, code: true },
  });
  const map = new Map(rows.map((r) => [r.code, r.id]));
  const missing = codes.filter((c) => !map.has(c));
  if (missing.length) {
    throw new ConflictException(`Account ${missing[0]} is missing from the chart of accounts`);
  }
  return map;
}

export interface PostEntryInput {
  companyId: string;
  userId: string;
  date: Date;
  source: JournalSource;
  sourceId: string | null;
  sourceNumber: string | null;
  description: string;
  lines: DraftLine[];
  reversesId?: string | null;
}

/** Writes a posted journal entry; the lines must balance. */
export async function postEntry(
  tx: PrismaTx,
  numbering: NumberingService,
  input: PostEntryInput,
): Promise<{ id: string; number: string }> {
  const lines = normalizeLines(input.lines);
  const { debit, credit } = lineTotals(lines);
  if (!debit.gt(0) || !debit.eq(credit)) {
    throw new BadRequestException(
      `Entry does not balance: debit ${debit.toFixed(2)}, credit ${credit.toFixed(2)}`,
    );
  }
  const ids = await accountIds(
    tx,
    input.companyId,
    lines.map((l) => l.code),
  );
  const number = await numbering.next(input.companyId, JOURNAL_SEQUENCE, tx);
  const entry = await tx.journalEntry.create({
    data: {
      companyId: input.companyId,
      number,
      entryDate: input.date,
      status: JournalEntryStatus.POSTED,
      source: input.source,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber,
      description: input.description,
      total: debit,
      reversesId: input.reversesId ?? null,
      postedAt: new Date(),
      createdById: input.userId,
      lines: {
        create: lines.map((l, index) => ({
          lineNo: index + 1,
          accountId: ids.get(l.code)!,
          partnerId: l.partnerId,
          employeeId: l.employeeId,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
        })),
      },
    },
    select: { id: true, number: true },
  });
  return entry;
}

/** Posts the reversal (ters kayıt) of a posted entry on `date`. */
export async function reverseEntry(
  tx: PrismaTx,
  numbering: NumberingService,
  input: { companyId: string; userId: string; entryId: string; date: Date; note?: string | null },
): Promise<{ id: string; number: string }> {
  const original = await tx.journalEntry.findFirstOrThrow({
    where: { id: input.entryId, companyId: input.companyId },
    include: { lines: { include: { account: { select: { code: true } } } } },
  });
  const note = input.note?.trim();
  return postEntry(tx, numbering, {
    companyId: input.companyId,
    userId: input.userId,
    date: input.date,
    source: original.source,
    sourceId: original.sourceId,
    sourceNumber: original.sourceNumber,
    description: `Ters kayıt: ${original.number} ${original.description}${note ? ` — ${note}` : ''}`,
    reversesId: original.id,
    lines: original.lines.map((l) => ({
      code: l.account.code,
      debit: l.credit,
      credit: l.debit,
      partnerId: l.partnerId,
      employeeId: l.employeeId,
      description: l.description,
    })),
  });
}

/** Serializes posting runs and manual postings of one company. */
export async function lockAccounting(tx: PrismaTx, companyId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`accounting:${companyId}`}))) AS l`;
}

export const ZERO = new Prisma.Decimal(0);
