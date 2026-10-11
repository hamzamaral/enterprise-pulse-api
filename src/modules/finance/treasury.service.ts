import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChequeDirection,
  ChequeStatus,
  Prisma,
  TreasuryAccountType,
  TreasuryDocumentType,
  type TreasuryAccount,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { toBase } from '../../common/money/document-totals';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type {
  CashPositionDto,
  CreateTreasuryAccountDto,
  TreasuryAccountDto,
  TreasuryAccountQueryDto,
  TreasuryStatementDto,
  TreasuryStatementQueryDto,
  UpdateTreasuryAccountDto,
} from './dto/finance.dto';

const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal.Value) => dec(value).toFixed(2);

export interface TreasuryPosting {
  accountId: string;
  txDate: Date;
  documentType: TreasuryDocumentType;
  documentId: string;
  documentNumber: string;
  description?: string | null;
  /** Account currency; exactly one is positive. */
  amountIn?: Prisma.Decimal.Value;
  amountOut?: Prisma.Decimal.Value;
  reversesId?: string;
}

/** Customer cheques still to be turned into money. */
export const PORTFOLIO_STATUSES: ChequeStatus[] = [ChequeStatus.PORTFOLIO, ChequeStatus.DEPOSITED];

/**
 * Cash boxes and bank accounts (kasa / banka). Balances only change through `post` inside the
 * transaction of the document that moves money; cancellations write reversing entries.
 */
@Injectable()
export class TreasuryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string, query: TreasuryAccountQueryDto): Promise<TreasuryAccountDto[]> {
    const accounts = await this.prisma.treasuryAccount.findMany({
      where: { companyId, type: query.type, ...(query.activeOnly && { isActive: true }) },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
    const balances = await this.balances(
      companyId,
      accounts.map((a) => a.id),
    );
    const rates = await this.latestRates(
      companyId,
      accounts.map((a) => a.currencyCode),
    );
    return accounts.map((account) => toDto(account, balances.get(account.id)!, rates));
  }

  async findOne(companyId: string, id: string): Promise<TreasuryAccountDto> {
    const account = await this.prisma.treasuryAccount.findFirst({ where: { id, companyId } });
    if (!account) throw new NotFoundException('Account not found');
    const balance = (await this.balances(companyId, [id])).get(id)!;
    const rates = await this.latestRates(companyId, [account.currencyCode]);
    return toDto(account, balance, rates);
  }

  async create(user: AuthUser, dto: CreateTreasuryAccountDto): Promise<TreasuryAccountDto> {
    const { companyId } = user;
    const code = dto.code.trim().toUpperCase();
    const account = await this.prisma.$transaction(async (tx) => {
      const taken = await tx.treasuryAccount.findFirst({ where: { companyId, code } });
      if (taken) throw new ConflictException(`Account code ${code} is already in use`);
      const currency = await tx.currency.findUnique({ where: { code: dto.currencyCode } });
      if (!currency?.isActive)
        throw new BadRequestException(`Unknown currency ${dto.currencyCode}`);
      const created = await tx.treasuryAccount.create({
        data: {
          companyId,
          code,
          name: dto.name.trim(),
          type: dto.type,
          currencyCode: dto.currencyCode,
          bankName: dto.bankName?.trim() || null,
          branchName: dto.branchName?.trim() || null,
          iban: dto.iban?.replace(/\s+/g, '').toUpperCase() || null,
        },
      });
      if (dto.openingBalance) {
        await this.post(tx, user, {
          accountId: created.id,
          txDate: parseDateOnly(dto.openingDate ?? new Date().toISOString()),
          documentType: TreasuryDocumentType.OPENING,
          documentId: created.id,
          documentNumber: code,
          description: 'Açılış bakiyesi',
          amountIn: dto.openingBalance,
        });
      }
      return created;
    });
    return this.findOne(companyId, account.id);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateTreasuryAccountDto,
  ): Promise<TreasuryAccountDto> {
    const account = await this.prisma.treasuryAccount.findFirst({ where: { id, companyId } });
    if (!account) throw new NotFoundException('Account not found');
    await this.prisma.treasuryAccount.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        bankName: dto.bankName === undefined ? undefined : dto.bankName.trim() || null,
        branchName: dto.branchName === undefined ? undefined : dto.branchName.trim() || null,
        iban:
          dto.iban === undefined ? undefined : dto.iban.replace(/\s+/g, '').toUpperCase() || null,
        isActive: dto.isActive,
      },
    });
    return this.findOne(companyId, id);
  }

  /** Account ledger: opening balance before `dateFrom`, entries with running balance. */
  async statement(
    companyId: string,
    id: string,
    query: TreasuryStatementQueryDto,
  ): Promise<TreasuryStatementDto> {
    const account = await this.findOne(companyId, id);
    const dateFrom = query.dateFrom ? parseDateOnly(query.dateFrom) : undefined;
    const dateTo = query.dateTo ? parseDateOnly(query.dateTo) : undefined;
    const opening = dateFrom
      ? await this.prisma.treasuryTransaction.aggregate({
          where: { companyId, accountId: id, txDate: { lt: dateFrom } },
          _sum: { amountIn: true, amountOut: true },
        })
      : null;
    const openingBalance = dec(opening?._sum.amountIn ?? 0).minus(opening?._sum.amountOut ?? 0);
    const rows = await this.prisma.treasuryTransaction.findMany({
      where: { companyId, accountId: id, txDate: { gte: dateFrom, lte: dateTo } },
      orderBy: [{ txDate: 'asc' }, { seq: 'asc' }],
    });
    let running = openingBalance;
    let totalIn = dec(0);
    let totalOut = dec(0);
    const entries = rows.map((row) => {
      running = running.plus(row.amountIn).minus(row.amountOut);
      totalIn = totalIn.plus(row.amountIn);
      totalOut = totalOut.plus(row.amountOut);
      return {
        id: row.id,
        txDate: toDateOnly(row.txDate),
        documentType: row.documentType,
        documentId: row.documentId,
        documentNumber: row.documentNumber,
        description: row.description,
        amountIn: money(row.amountIn),
        amountOut: money(row.amountOut),
        balance: money(running),
        isReversal: row.reversesId !== null,
      };
    });
    return {
      account,
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      openingBalance: money(openingBalance),
      totalIn: money(totalIn),
      totalOut: money(totalOut),
      closingBalance: money(running),
      entries,
    };
  }

  /** Cash and bank balances per currency plus open cheques, converted at the latest rates. */
  async position(companyId: string): Promise<CashPositionDto> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { baseCurrency: true },
    });
    const accounts = await this.prisma.treasuryAccount.findMany({
      where: { companyId, isActive: true },
    });
    const balances = await this.balances(
      companyId,
      accounts.map((a) => a.id),
    );
    const cheques = await this.prisma.cheque.groupBy({
      by: ['direction', 'currencyCode'],
      where: {
        companyId,
        OR: [
          { direction: ChequeDirection.RECEIVED, status: { in: PORTFOLIO_STATUSES } },
          { direction: ChequeDirection.ISSUED, status: ChequeStatus.ISSUED },
        ],
      },
      _sum: { amount: true },
    });
    const rates = await this.latestRates(companyId, [
      ...accounts.map((a) => a.currencyCode),
      ...cheques.map((c) => c.currencyCode),
    ]);
    const rateOf = (code: string) => rates.get(code) ?? dec(1);

    const byCurrency = new Map<string, { cash: Prisma.Decimal; bank: Prisma.Decimal }>();
    for (const account of accounts) {
      const entry = byCurrency.get(account.currencyCode) ?? { cash: dec(0), bank: dec(0) };
      const balance = balances.get(account.id)!;
      if (account.type === TreasuryAccountType.CASH) entry.cash = entry.cash.plus(balance);
      else entry.bank = entry.bank.plus(balance);
      byCurrency.set(account.currencyCode, entry);
    }
    let totalBase = dec(0);
    const currencies = [...byCurrency.entries()]
      .sort(([a], [b]) =>
        a === company.baseCurrency ? -1 : b === company.baseCurrency ? 1 : a.localeCompare(b),
      )
      .map(([currencyCode, { cash, bank }]) => {
        const total = cash.plus(bank);
        const base = toBase(total, rateOf(currencyCode));
        totalBase = totalBase.plus(base);
        return {
          currencyCode,
          cash: money(cash),
          bank: money(bank),
          total: money(total),
          totalBase: money(base),
        };
      });
    const chequeTotal = (direction: ChequeDirection) =>
      cheques
        .filter((c) => c.direction === direction)
        .reduce((sum, c) => sum.plus(toBase(c._sum.amount ?? 0, rateOf(c.currencyCode))), dec(0));
    return {
      baseCurrency: company.baseCurrency,
      currencies,
      chequesInPortfolioBase: money(chequeTotal(ChequeDirection.RECEIVED)),
      chequesIssuedBase: money(chequeTotal(ChequeDirection.ISSUED)),
      totalBase: money(totalBase),
    };
  }

  /** Active account of the company, row-locked so concurrent postings see each other's balance. */
  async lockAccount(tx: PrismaTx, companyId: string, id: string): Promise<TreasuryAccount> {
    await tx.$queryRaw`SELECT id FROM treasury_accounts WHERE id = ${id}::uuid FOR UPDATE`;
    const account = await tx.treasuryAccount.findFirst({ where: { id, companyId } });
    if (!account) throw new BadRequestException('Account not found');
    if (!account.isActive) throw new ConflictException(`${account.name} is inactive`);
    return account;
  }

  /** Appends a transaction; a cash box can never go below zero. */
  async post(tx: PrismaTx, user: AuthUser, posting: TreasuryPosting): Promise<void> {
    const amountIn = dec(posting.amountIn ?? 0);
    const amountOut = dec(posting.amountOut ?? 0);
    if (amountIn.isNegative() || amountOut.isNegative() || amountIn.plus(amountOut).isZero()) {
      throw new BadRequestException('Transaction amount must be positive');
    }
    const account = await this.lockAccount(tx, user.companyId, posting.accountId);
    if (amountOut.greaterThan(0) && account.type === TreasuryAccountType.CASH) {
      const balance = (await this.balances(user.companyId, [account.id], tx)).get(account.id)!;
      if (balance.minus(amountOut).isNegative()) {
        throw new BadRequestException(
          `Insufficient cash in ${account.name}: balance ${money(balance)} ${account.currencyCode}`,
        );
      }
    }
    await tx.treasuryTransaction.create({
      data: {
        companyId: user.companyId,
        accountId: account.id,
        txDate: posting.txDate,
        documentType: posting.documentType,
        documentId: posting.documentId,
        documentNumber: posting.documentNumber,
        description: posting.description ?? null,
        amountIn,
        amountOut,
        reversesId: posting.reversesId ?? null,
        createdById: user.id,
      },
    });
  }

  /** Reverses every open transaction of a document (in ↔ out) dated `txDate`. */
  async reverse(
    tx: PrismaTx,
    user: AuthUser,
    documentType: TreasuryDocumentType,
    documentId: string,
    txDate: Date,
    description: string,
  ): Promise<void> {
    const entries = await tx.treasuryTransaction.findMany({
      where: {
        companyId: user.companyId,
        documentType,
        documentId,
        reversesId: null,
        reversal: null,
      },
    });
    for (const entry of entries) {
      await this.post(tx, user, {
        accountId: entry.accountId,
        txDate,
        documentType,
        documentId,
        documentNumber: entry.documentNumber,
        description,
        amountIn: entry.amountOut,
        amountOut: entry.amountIn,
        reversesId: entry.id,
      });
    }
  }

  async balances(
    companyId: string,
    accountIds: string[],
    client: PrismaTx | PrismaService = this.prisma,
  ): Promise<Map<string, Prisma.Decimal>> {
    const rows = await client.treasuryTransaction.groupBy({
      by: ['accountId'],
      where: { companyId, accountId: { in: accountIds } },
      _sum: { amountIn: true, amountOut: true },
    });
    const result = new Map(accountIds.map((id) => [id, dec(0)]));
    for (const row of rows) {
      result.set(row.accountId, dec(row._sum.amountIn ?? 0).minus(row._sum.amountOut ?? 0));
    }
    return result;
  }

  /** Latest stored selling rate per currency; the company currency is 1. */
  async latestRates(companyId: string, codes: string[]): Promise<Map<string, Prisma.Decimal>> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { baseCurrency: true },
    });
    const result = new Map<string, Prisma.Decimal>([[company.baseCurrency, dec(1)]]);
    for (const code of new Set(codes)) {
      if (result.has(code)) continue;
      const latest = await this.prisma.exchangeRate.findFirst({
        where: { currencyCode: code },
        orderBy: { rateDate: 'desc' },
      });
      if (latest) result.set(code, latest.selling);
    }
    return result;
  }
}

function toDto(
  account: TreasuryAccount,
  balance: Prisma.Decimal,
  rates: Map<string, Prisma.Decimal>,
): TreasuryAccountDto {
  const rate = rates.get(account.currencyCode);
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    currencyCode: account.currencyCode,
    bankName: account.bankName,
    branchName: account.branchName,
    iban: account.iban,
    isActive: account.isActive,
    balance: money(balance),
    balanceBase: rate ? money(toBase(balance, rate)) : money(0),
    createdAt: account.createdAt,
  };
}
