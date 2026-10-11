import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerDocumentType, Prisma, type PartnerLedgerEntry } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { toBase } from '../../common/money/document-totals';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { PartnerStatementDto, StatementQueryDto } from './dto/partner.dto';

const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal.Value) => dec(value).toFixed(2);

export interface LedgerPosting {
  partnerId: string;
  entryDate: Date;
  dueDate?: Date | null;
  documentType: LedgerDocumentType;
  documentId: string;
  documentNumber: string;
  description?: string | null;
  /** Document currency; exactly one of debit/credit is positive. */
  debit?: Prisma.Decimal.Value;
  credit?: Prisma.Decimal.Value;
  currencyCode: string;
  exchangeRate: Prisma.Decimal.Value;
}

/**
 * Partner ledger (cari hesap). Entries are append-only: documents post here inside their own
 * transaction, and cancellations write reversing entries instead of deleting anything.
 */
@Injectable()
export class PartnerLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async post(tx: PrismaTx, user: AuthUser, posting: LedgerPosting): Promise<PartnerLedgerEntry> {
    const debit = dec(posting.debit ?? 0);
    const credit = dec(posting.credit ?? 0);
    if (debit.isNegative() || credit.isNegative() || debit.plus(credit).isZero()) {
      throw new BadRequestException('Ledger amount must be positive');
    }
    return tx.partnerLedgerEntry.create({
      data: {
        companyId: user.companyId,
        partnerId: posting.partnerId,
        entryDate: posting.entryDate,
        dueDate: posting.dueDate ?? null,
        documentType: posting.documentType,
        documentId: posting.documentId,
        documentNumber: posting.documentNumber,
        description: posting.description ?? null,
        debit,
        credit,
        currencyCode: posting.currencyCode,
        exchangeRate: dec(posting.exchangeRate),
        debitBase: toBase(debit, posting.exchangeRate),
        creditBase: toBase(credit, posting.exchangeRate),
        createdById: user.id,
      },
    });
  }

  /** Reverses every open entry of a document (debit ↔ credit) dated `entryDate`. */
  async reverse(
    tx: PrismaTx,
    user: AuthUser,
    documentType: LedgerDocumentType,
    documentId: string,
    entryDate: Date,
    description: string,
  ): Promise<void> {
    const entries = await tx.partnerLedgerEntry.findMany({
      where: {
        companyId: user.companyId,
        documentType,
        documentId,
        reversesId: null,
        reversal: null,
      },
    });
    for (const entry of entries) {
      await tx.partnerLedgerEntry.create({
        data: {
          companyId: entry.companyId,
          partnerId: entry.partnerId,
          entryDate,
          documentType,
          documentId,
          documentNumber: entry.documentNumber,
          description,
          debit: entry.credit,
          credit: entry.debit,
          currencyCode: entry.currencyCode,
          exchangeRate: entry.exchangeRate,
          debitBase: entry.creditBase,
          creditBase: entry.debitBase,
          reversesId: entry.id,
          createdById: user.id,
        },
      });
    }
  }

  /** Base currency balances (debit − credit) by partner. */
  async balances(
    companyId: string,
    partnerIds: string[],
    client: PrismaTx | PrismaService = this.prisma,
  ): Promise<Map<string, Prisma.Decimal>> {
    const rows = await client.partnerLedgerEntry.groupBy({
      by: ['partnerId'],
      where: { companyId, partnerId: { in: partnerIds } },
      _sum: { debitBase: true, creditBase: true },
    });
    const result = new Map(partnerIds.map((id) => [id, dec(0)]));
    for (const row of rows) {
      result.set(row.partnerId, dec(row._sum.debitBase ?? 0).minus(row._sum.creditBase ?? 0));
    }
    return result;
  }

  async balance(companyId: string, partnerId: string, client?: PrismaTx): Promise<Prisma.Decimal> {
    return (await this.balances(companyId, [partnerId], client)).get(partnerId)!;
  }

  /** Ekstre: opening balance before `dateFrom`, entries with running balance, closing balance. */
  async statement(
    companyId: string,
    partnerId: string,
    query: StatementQueryDto,
  ): Promise<PartnerStatementDto> {
    const partner = await this.prisma.businessPartner.findFirst({
      where: { id: partnerId, companyId, deletedAt: null },
      include: { company: { select: { baseCurrency: true } } },
    });
    if (!partner) throw new NotFoundException('Partner not found');
    const dateFrom = query.dateFrom ? parseDateOnly(query.dateFrom) : undefined;
    const dateTo = query.dateTo ? parseDateOnly(query.dateTo) : undefined;

    const opening = dateFrom
      ? await this.prisma.partnerLedgerEntry.aggregate({
          where: { companyId, partnerId, entryDate: { lt: dateFrom } },
          _sum: { debitBase: true, creditBase: true },
        })
      : null;
    const openingBalance = dec(opening?._sum.debitBase ?? 0).minus(opening?._sum.creditBase ?? 0);

    const rows = await this.prisma.partnerLedgerEntry.findMany({
      where: { companyId, partnerId, entryDate: { gte: dateFrom, lte: dateTo } },
      orderBy: [{ entryDate: 'asc' }, { seq: 'asc' }],
    });
    let running = openingBalance;
    let totalDebit = dec(0);
    let totalCredit = dec(0);
    const entries = rows.map((row) => {
      running = running.plus(row.debitBase).minus(row.creditBase);
      totalDebit = totalDebit.plus(row.debitBase);
      totalCredit = totalCredit.plus(row.creditBase);
      return {
        id: row.id,
        entryDate: toDateOnly(row.entryDate),
        dueDate: row.dueDate ? toDateOnly(row.dueDate) : null,
        documentType: row.documentType,
        documentId: row.documentId,
        documentNumber: row.documentNumber,
        description: row.description,
        currencyCode: row.currencyCode,
        exchangeRate: row.exchangeRate.toFixed(4),
        debit: money(row.debit),
        credit: money(row.credit),
        debitBase: money(row.debitBase),
        creditBase: money(row.creditBase),
        balance: money(running),
        isReversal: row.reversesId !== null,
      };
    });
    return {
      partnerId: partner.id,
      code: partner.code,
      title: partner.title,
      baseCurrency: partner.company.baseCurrency,
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      openingBalance: money(openingBalance),
      totalDebit: money(totalDebit),
      totalCredit: money(totalCredit),
      closingBalance: money(running),
      entries,
    };
  }
}
