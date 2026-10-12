import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TreasuryDocumentType } from '@prisma/client';
import { toBase } from '../../common/money/document-totals';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TreasuryService } from '../finance/treasury.service';
import type { CashFlowDto, CashFlowQueryDto } from './dto/reports.dto';
import { monthKey, monthKeys, reportRange } from './report-math';

const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const ZERO = dec(0);

interface Flow {
  amountIn: Prisma.Decimal;
  amountOut: Prisma.Decimal;
}
const emptyFlow = (): Flow => ({ amountIn: ZERO, amountOut: ZERO });

/**
 * Monthly cash and bank movements. Opening entries count towards the opening balance and a
 * cancellation reversed within the range drops out together with its original entry.
 */
@Injectable()
export class CashFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly treasury: TreasuryService,
  ) {}

  async report(companyId: string, query: CashFlowQueryDto): Promise<CashFlowDto> {
    const { from, to } = reportRange(query.from, query.to);
    const accounts = await this.prisma.treasuryAccount.findMany({
      where: { companyId, ...(query.accountId ? { id: query.accountId } : {}) },
      select: { id: true, currencyCode: true },
    });
    if (query.accountId && !accounts.length) throw new NotFoundException('Account not found');

    const single = query.accountId ? accounts[0] : null;
    const currencyCode = single
      ? single.currencyCode
      : (
          await this.prisma.company.findUniqueOrThrow({
            where: { id: companyId },
            select: { baseCurrency: true },
          })
        ).baseCurrency;
    const rates = single
      ? new Map([[single.currencyCode, dec(1)]])
      : await this.treasury.latestRates(
          companyId,
          accounts.map((a) => a.currencyCode),
        );
    const rateOf = new Map<string, Prisma.Decimal>();
    const unconverted = new Set<string>();
    for (const account of accounts) {
      const rate = rates.get(account.currencyCode);
      if (rate) rateOf.set(account.id, rate);
      else unconverted.add(account.currencyCode);
    }
    const ids = [...rateOf.keys()];
    const convert = (accountId: string, amount: Prisma.Decimal) =>
      toBase(amount, rateOf.get(accountId)!);

    const [openingRows, entries] = await Promise.all([
      this.prisma.treasuryTransaction.groupBy({
        by: ['accountId'],
        where: {
          companyId,
          accountId: { in: ids },
          OR: [
            { txDate: { lt: from } },
            { documentType: TreasuryDocumentType.OPENING, txDate: { lte: to } },
          ],
        },
        _sum: { amountIn: true, amountOut: true },
      }),
      this.prisma.treasuryTransaction.findMany({
        where: {
          companyId,
          accountId: { in: ids },
          txDate: { gte: from, lte: to },
          documentType: { not: TreasuryDocumentType.OPENING },
        },
        select: {
          id: true,
          accountId: true,
          txDate: true,
          documentType: true,
          amountIn: true,
          amountOut: true,
          reversesId: true,
        },
      }),
    ]);

    const opening = openingRows.reduce(
      (sum, row) =>
        sum.plus(
          convert(row.accountId, dec(row._sum.amountIn ?? 0).minus(row._sum.amountOut ?? 0)),
        ),
      ZERO,
    );

    const inRange = new Set(entries.map((e) => e.id));
    const reversedInRange = new Set(entries.flatMap((e) => (e.reversesId ? [e.reversesId] : [])));
    const months = new Map(monthKeys(from, to).map((key) => [key, emptyFlow()]));
    const byType = new Map<TreasuryDocumentType, Flow>();
    const total = emptyFlow();
    for (const entry of entries) {
      if (reversedInRange.has(entry.id)) continue;
      if (entry.reversesId && inRange.has(entry.reversesId)) continue;
      const amountIn = convert(entry.accountId, entry.amountIn);
      const amountOut = convert(entry.accountId, entry.amountOut);
      if (!byType.has(entry.documentType)) byType.set(entry.documentType, emptyFlow());
      const flows = [months.get(monthKey(entry.txDate))!, byType.get(entry.documentType)!, total];
      for (const flow of flows) {
        flow.amountIn = flow.amountIn.plus(amountIn);
        flow.amountOut = flow.amountOut.plus(amountOut);
      }
    }

    const net = total.amountIn.minus(total.amountOut);
    return {
      from: query.from,
      to: query.to,
      currencyCode,
      opening: opening.toFixed(2),
      amountIn: total.amountIn.toFixed(2),
      amountOut: total.amountOut.toFixed(2),
      net: net.toFixed(2),
      closing: opening.plus(net).toFixed(2),
      months: [...months.entries()].map(([period, flow]) => ({
        period,
        amountIn: flow.amountIn.toFixed(2),
        amountOut: flow.amountOut.toFixed(2),
        net: flow.amountIn.minus(flow.amountOut).toFixed(2),
      })),
      byType: [...byType.entries()].map(([documentType, flow]) => ({
        documentType,
        amountIn: flow.amountIn.toFixed(2),
        amountOut: flow.amountOut.toFixed(2),
      })),
      unconvertedCurrencies: [...unconverted],
    };
  }
}
