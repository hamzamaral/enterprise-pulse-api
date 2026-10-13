import { Injectable } from '@nestjs/common';
import { ContractFlow, ContractStatus, Prisma } from '@prisma/client';
import { toDateOnly } from '../../common/dates/date-only';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ContractSummaryDto } from './dto/contract.dto';
import { contractInclude, toContractDto, today } from './contract-helpers';
import { actionDate, addDays, addMonths, annualValue, contractState } from './contract-math';

const RECENT_DAYS = 90;
const NEXT_ACTIONS = 8;

/** Contract dashboard: counts, yearly values, upcoming ends and the next decisions. */
@Injectable()
export class ContractSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(companyId: string): Promise<ContractSummaryDto> {
    const now = today();
    const recent = addDays(now, -RECENT_DAYS);
    const [rows, types] = await Promise.all([
      this.prisma.contract.findMany({
        where: {
          companyId,
          OR: [
            { status: { in: [ContractStatus.ACTIVE, ContractStatus.DRAFT] } },
            { status: ContractStatus.EXPIRED, endDate: { gte: recent } },
            { status: ContractStatus.TERMINATED, terminatedOn: { gte: recent } },
          ],
        },
        include: contractInclude,
      }),
      this.prisma.contractType.findMany({
        where: { companyId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, isActive: true },
      }),
    ]);
    const active = rows.filter((r) => r.status === ContractStatus.ACTIVE);
    const states = active.map((r) => contractState(r, now));

    const values = new Map<string, { income: Prisma.Decimal; expense: Prisma.Decimal }>();
    for (const row of active) {
      const value = annualValue(row);
      if (!value || row.type.flow === ContractFlow.NONE) continue;
      const entry = values.get(row.currencyCode) ?? {
        income: new Prisma.Decimal(0),
        expense: new Prisma.Decimal(0),
      };
      if (row.type.flow === ContractFlow.INCOME) entry.income = entry.income.add(value);
      else entry.expense = entry.expense.add(value);
      values.set(row.currencyCode, entry);
    }

    const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const upcoming = Array.from({ length: 12 }, (_, i) => ({
      month: toDateOnly(addMonths(firstOfMonth, i)).slice(0, 7),
      ending: 0,
      renewing: 0,
    }));
    const byMonth = new Map(upcoming.map((m) => [m.month, m]));
    for (const row of active) {
      const last = row.terminatedOn ?? row.endDate;
      const bucket = last && byMonth.get(toDateOnly(last).slice(0, 7));
      if (!bucket) continue;
      if (row.autoRenew && !row.terminatedOn) bucket.renewing += 1;
      else bucket.ending += 1;
    }

    const activeByType = new Map<string, number>();
    for (const row of active) activeByType.set(row.typeId, (activeByType.get(row.typeId) ?? 0) + 1);

    const due = (row: (typeof active)[number]) => row.terminatedOn ?? actionDate(row);
    const nextActions = active
      .filter((row) => due(row))
      .sort((a, b) => due(a)!.getTime() - due(b)!.getTime())
      .slice(0, NEXT_ACTIONS)
      .map((row) => toContractDto(row, now));

    return {
      activeCount: active.length,
      draftCount: rows.filter((r) => r.status === ContractStatus.DRAFT).length,
      expiringCount: states.filter((s) => s === 'EXPIRING').length,
      terminatingCount: states.filter((s) => s === 'TERMINATING').length,
      autoRenewCount: active.filter((r) => r.autoRenew && !r.terminatedOn).length,
      endedRecentlyCount: rows.filter(
        (r) => r.status === ContractStatus.EXPIRED || r.status === ContractStatus.TERMINATED,
      ).length,
      values: [...values.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currencyCode, v]) => ({
          currencyCode,
          income: v.income.toFixed(2),
          expense: v.expense.toFixed(2),
        })),
      upcoming,
      byType: types
        .filter((t) => t.isActive || activeByType.has(t.id))
        .map((t) => ({ typeId: t.id, name: t.name, activeCount: activeByType.get(t.id) ?? 0 })),
      nextActions,
    };
  }
}
