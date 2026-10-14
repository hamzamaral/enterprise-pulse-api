import { JournalEntryStatus, Prisma, type PrismaClient } from '@prisma/client';
import { defaultChart } from '../src/modules/accounting/accounting-chart';
import { formatNumber } from '../src/modules/numbering/number-format';

const YEAR = new Date().getFullYear();

interface AccountingSeedContext {
  companyId: string;
  adminId: string;
}

interface EntrySeed {
  date: Date;
  description: string;
  status: JournalEntryStatus;
  lines: [code: string, debit: number, credit: number, description?: string][];
}

/**
 * Standard chart for every company and a few manual entries for the demo company. Source
 * documents are posted by "Muhasebeleştir" or the nightly job.
 */
export async function seedAccounting(
  prisma: PrismaClient,
  companyIds: string[],
  ctx: AccountingSeedContext,
): Promise<void> {
  const chart = defaultChart();
  for (const companyId of companyIds) {
    await prisma.ledgerAccount.createMany({
      data: chart.map((a) => ({ ...a, companyId })),
      skipDuplicates: true,
    });
  }

  const { companyId, adminId } = ctx;
  if (await prisma.journalEntry.count({ where: { companyId } })) return;

  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const previousMonthEnd = new Date(monthStart.getTime() - 86_400_000);
  const rentDay = new Date(Math.min(monthStart.getTime() + 4 * 86_400_000, today.getTime()));
  const rentDate = new Date(
    Date.UTC(rentDay.getUTCFullYear(), rentDay.getUTCMonth(), rentDay.getUTCDate()),
  );

  const entries: EntrySeed[] = [
    {
      date: previousMonthEnd,
      description: 'Banka hesap işletim ücreti ve EFT masrafları',
      status: JournalEntryStatus.POSTED,
      lines: [
        ['653', 1_250, 0, 'Hesap işletim ücreti ve EFT'],
        ['102', 0, 1_250],
      ],
    },
    {
      date: previousMonthEnd,
      description: 'Vadeli mevduat faiz geliri',
      status: JournalEntryStatus.POSTED,
      lines: [
        ['102', 3_400, 0],
        ['642', 0, 3_400, 'Aylık vadeli mevduat faizi'],
      ],
    },
    {
      date: rentDate,
      description: 'Merkez ofis kirası (%20 stopaj)',
      status: JournalEntryStatus.POSTED,
      lines: [
        ['770', 60_000, 0, 'Brüt kira'],
        ['360', 0, 12_000, 'Kira stopajı'],
        ['102', 0, 48_000, 'Net kira ödemesi'],
      ],
    },
    {
      date: previousMonthEnd,
      description: 'Demirbaş amortismanı',
      status: JournalEntryStatus.DRAFT,
      lines: [
        ['770', 8_500, 0, 'Aylık amortisman payı'],
        ['257', 0, 8_500],
      ],
    },
  ];

  const accounts = await prisma.ledgerAccount.findMany({
    where: { companyId },
    select: { id: true, code: true },
  });
  const ids = new Map(accounts.map((a) => [a.code, a.id]));
  for (const entry of entries) {
    const seq = await prisma.numberSequence.update({
      where: { companyId_code: { companyId, code: 'JOURNAL_ENTRY' } },
      data: { nextValue: { increment: 1 }, currentYear: YEAR },
    });
    const total = entry.lines.reduce((sum, [, debit]) => sum + debit, 0);
    await prisma.journalEntry.create({
      data: {
        companyId,
        number: formatNumber(seq, YEAR, seq.nextValue - 1),
        entryDate: entry.date,
        status: entry.status,
        description: entry.description,
        total: new Prisma.Decimal(total),
        postedAt: entry.status === JournalEntryStatus.POSTED ? new Date() : null,
        createdById: adminId,
        lines: {
          create: entry.lines.map(([code, debit, credit, description], index) => ({
            lineNo: index + 1,
            accountId: ids.get(code)!,
            description: description ?? null,
            debit: new Prisma.Decimal(debit),
            credit: new Prisma.Decimal(credit),
          })),
        },
      },
    });
  }
}
