import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChequeDirection,
  ChequeKind,
  ChequeStatus,
  Prisma,
  TreasuryAccountType,
  TreasuryDocumentType,
  type Cheque,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type {
  ChequeActionDto,
  ChequeDetailDto,
  ChequeDto,
  ChequeQueryDto,
} from './dto/finance.dto';
import { PaymentsService } from './payments.service';
import { PORTFOLIO_STATUSES, TreasuryService } from './treasury.service';

const SORTABLE = ['number', 'dueDate', 'issueDate', 'amount', 'createdAt'] as const;
const today = () => parseDateOnly(new Date().toISOString().slice(0, 10));

export const OPEN_CHEQUE_FILTER: Prisma.ChequeWhereInput = {
  OR: [
    { direction: ChequeDirection.RECEIVED, status: { in: PORTFOLIO_STATUSES } },
    { direction: ChequeDirection.ISSUED, status: ChequeStatus.ISSUED },
  ],
};

const listInclude = {
  partner: { select: { code: true, title: true } },
  endorsedTo: { select: { title: true } },
  account: { select: { name: true } },
  originPayment: { select: { number: true } },
  endorsementPayment: { select: { number: true } },
} satisfies Prisma.ChequeInclude;

const detailInclude = {
  ...listInclude,
  events: {
    include: {
      account: { select: { name: true } },
      partner: { select: { title: true } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ChequeInclude;

type ListRow = Prisma.ChequeGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.ChequeGetPayload<{ include: typeof detailInclude }>;

/**
 * Cheque and note portfolio (çek / senet). Received documents go from the portfolio to the bank
 * and are collected, endorsed to a supplier (through a payment) or bounce; own documents are paid
 * at maturity. Every step is recorded as an event; money moves only when collected or paid.
 */
@Injectable()
export class ChequesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly treasury: TreasuryService,
    private readonly payments: PaymentsService,
  ) {}

  async findAll(companyId: string, query: ChequeQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.ChequeWhereInput = {
      companyId,
      direction: query.direction,
      kind: query.kind,
      status: query.status,
      partnerId: query.partnerId,
      AND: [
        ...(query.open ? [OPEN_CHEQUE_FILTER] : []),
        ...(search
          ? [
              {
                OR: [
                  { number: { contains: search, mode: 'insensitive' as const } },
                  { serialNo: { contains: search, mode: 'insensitive' as const } },
                  { drawer: { contains: search, mode: 'insensitive' as const } },
                  { partner: { title: { contains: search, mode: 'insensitive' as const } } },
                ],
              },
            ]
          : []),
      ],
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.cheque.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.cheque.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<ChequeDetailDto> {
    const row = await this.prisma.cheque.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Cheque not found');
    return toDetailDto(row);
  }

  /** Hands a received cheque to the bank for collection; no money moves yet. */
  async deposit(user: AuthUser, id: string, dto: ChequeActionDto): Promise<ChequeDetailDto> {
    return this.transition(user, id, dto, async (tx, cheque, date) => {
      this.expect(cheque, ChequeDirection.RECEIVED, [ChequeStatus.PORTFOLIO]);
      if (cheque.kind !== ChequeKind.CHEQUE) {
        throw new BadRequestException('Only cheques are deposited to a bank');
      }
      const account = await this.account(tx, user, cheque, dto.accountId, [
        TreasuryAccountType.BANK,
      ]);
      await this.move(tx, user, cheque, ChequeStatus.DEPOSITED, date, dto.note, {
        accountId: account.id,
      });
    });
  }

  /** Money of a received cheque / note arrives in a cash box or bank account. */
  async collect(user: AuthUser, id: string, dto: ChequeActionDto): Promise<ChequeDetailDto> {
    return this.transition(user, id, dto, async (tx, cheque, date) => {
      this.expect(cheque, ChequeDirection.RECEIVED, PORTFOLIO_STATUSES);
      const account = await this.account(tx, user, cheque, dto.accountId ?? cheque.accountId, [
        TreasuryAccountType.BANK,
        TreasuryAccountType.CASH,
      ]);
      await this.treasury.post(tx, user, {
        accountId: account.id,
        txDate: date,
        documentType: TreasuryDocumentType.CHEQUE_COLLECTION,
        documentId: cheque.id,
        documentNumber: cheque.number,
        description: `${cheque.serialNo} — ${cheque.drawer ?? ''}`.trim(),
        amountIn: cheque.amount,
      });
      await this.move(tx, user, cheque, ChequeStatus.COLLECTED, date, dto.note, {
        accountId: account.id,
      });
    });
  }

  /** Unpaid at maturity (karşılıksız): the collection is reversed and the debt reopens. */
  async bounce(user: AuthUser, id: string, dto: ChequeActionDto): Promise<ChequeDetailDto> {
    return this.transition(user, id, dto, async (tx, cheque, date) => {
      this.expect(cheque, ChequeDirection.RECEIVED, PORTFOLIO_STATUSES);
      const payment = await this.payments.lockPayment(tx, user.companyId, cheque.originPaymentId);
      await this.payments.voidPayment(
        tx,
        user,
        payment,
        `Karşılıksız: ${cheque.number}${dto.note?.trim() ? ` — ${dto.note.trim()}` : ''}`,
      );
      await this.move(tx, user, cheque, ChequeStatus.BOUNCED, date, dto.note);
    });
  }

  /** Own cheque / note paid at maturity from a bank (or, for notes, cash) account. */
  async pay(user: AuthUser, id: string, dto: ChequeActionDto): Promise<ChequeDetailDto> {
    return this.transition(user, id, dto, async (tx, cheque, date) => {
      this.expect(cheque, ChequeDirection.ISSUED, [ChequeStatus.ISSUED]);
      const allowed =
        cheque.kind === ChequeKind.CHEQUE
          ? [TreasuryAccountType.BANK]
          : [TreasuryAccountType.BANK, TreasuryAccountType.CASH];
      const account = await this.account(
        tx,
        user,
        cheque,
        dto.accountId ?? cheque.accountId,
        allowed,
      );
      await this.treasury.post(tx, user, {
        accountId: account.id,
        txDate: date,
        documentType: TreasuryDocumentType.CHEQUE_PAYMENT,
        documentId: cheque.id,
        documentNumber: cheque.number,
        description: cheque.serialNo,
        amountOut: cheque.amount,
      });
      await this.move(tx, user, cheque, ChequeStatus.PAID, date, dto.note, {
        accountId: account.id,
      });
    });
  }

  private async transition(
    user: AuthUser,
    id: string,
    dto: ChequeActionDto,
    apply: (tx: PrismaTx, cheque: Cheque, date: Date) => Promise<void>,
  ): Promise<ChequeDetailDto> {
    const date = parseDateOnly(dto.date);
    if (date > today()) throw new BadRequestException('Date cannot be in the future');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cheques WHERE id = ${id}::uuid FOR UPDATE`;
      const cheque = await tx.cheque.findFirst({ where: { id, companyId: user.companyId } });
      if (!cheque) throw new NotFoundException('Cheque not found');
      if (date < cheque.issueDate) {
        throw new BadRequestException('Date cannot be before the issue date');
      }
      await apply(tx, cheque, date);
    });
    return this.findOne(user.companyId, id);
  }

  private expect(cheque: Cheque, direction: ChequeDirection, statuses: ChequeStatus[]): void {
    if (cheque.direction !== direction || !statuses.includes(cheque.status)) {
      throw new ConflictException(`Not allowed while the cheque is ${cheque.status}`);
    }
  }

  private async account(
    tx: PrismaTx,
    user: AuthUser,
    cheque: Cheque,
    accountId: string | null | undefined,
    types: TreasuryAccountType[],
  ) {
    if (!accountId) throw new BadRequestException('Pick an account');
    const account = await this.treasury.lockAccount(tx, user.companyId, accountId);
    if (!types.includes(account.type)) {
      throw new BadRequestException(
        types.length === 1 ? 'Pick a bank account' : 'Pick a cash or bank account',
      );
    }
    if (account.currencyCode !== cheque.currencyCode) {
      throw new BadRequestException(`${account.name} is kept in ${account.currencyCode}`);
    }
    return account;
  }

  private async move(
    tx: PrismaTx,
    user: AuthUser,
    cheque: Cheque,
    status: ChequeStatus,
    date: Date,
    note: string | undefined,
    data: { accountId?: string } = {},
  ): Promise<void> {
    await tx.cheque.update({ where: { id: cheque.id }, data: { status, ...data } });
    await tx.chequeEvent.create({
      data: {
        chequeId: cheque.id,
        eventDate: date,
        fromStatus: cheque.status,
        toStatus: status,
        accountId: data.accountId ?? null,
        note: note?.trim() || null,
        createdById: user.id,
      },
    });
  }
}

function isOpen(row: Cheque): boolean {
  return row.direction === ChequeDirection.RECEIVED
    ? PORTFOLIO_STATUSES.includes(row.status)
    : row.status === ChequeStatus.ISSUED;
}

function toDto(row: ListRow): ChequeDto {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    direction: row.direction,
    status: row.status,
    serialNo: row.serialNo,
    bankName: row.bankName,
    branchName: row.branchName,
    drawer: row.drawer,
    issueDate: toDateOnly(row.issueDate),
    dueDate: toDateOnly(row.dueDate),
    overdue: isOpen(row) && row.dueDate < today(),
    amount: row.amount.toFixed(2),
    currencyCode: row.currencyCode,
    exchangeRate: row.exchangeRate.toFixed(4),
    partnerId: row.partnerId,
    partnerTitle: row.partner.title,
    endorsedToId: row.endorsedToId,
    endorsedToTitle: row.endorsedTo?.title ?? null,
    accountId: row.accountId,
    accountName: row.account?.name ?? null,
    originPaymentId: row.originPaymentId,
    originPaymentNumber: row.originPayment.number,
    endorsementPaymentId: row.endorsementPaymentId,
    endorsementPaymentNumber: row.endorsementPayment?.number ?? null,
    createdAt: row.createdAt,
  };
}

function toDetailDto(row: DetailRow): ChequeDetailDto {
  return {
    ...toDto(row),
    partnerCode: row.partner.code,
    events: row.events.map((event) => ({
      id: event.id,
      eventDate: toDateOnly(event.eventDate),
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      accountName: event.account?.name ?? null,
      partnerTitle: event.partner?.title ?? null,
      note: event.note,
      createdByName: `${event.createdBy.firstName} ${event.createdBy.lastName}`,
      createdAt: event.createdAt,
    })),
  };
}
