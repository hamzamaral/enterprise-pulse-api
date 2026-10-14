import { randomInt, randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EInvoiceDirection,
  EInvoiceProfile,
  EInvoiceStatus,
  InvoiceStatus,
  PartnerType,
  Prisma,
  ProductType,
} from '@prisma/client';
import { Queue } from 'bullmq';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { QUEUES } from '../../infrastructure/queue/queue.module';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { SUPPLIER_TYPES } from '../partners/partners.service';
import { PurchaseInvoicesService } from '../purchasing/purchase-invoices.service';
import type {
  EInvoiceDetailDto,
  EInvoiceDto,
  EInvoiceQueryDto,
  EInvoiceSettingsDto,
  EInvoiceSummaryDto,
  RespondEInvoiceDto,
  SendEInvoiceDto,
  SimulateIncomingDto,
  SyncResultDto,
  UnsentInvoiceDto,
  UpdateEInvoiceSettingsDto,
} from './dto/einvoice.dto';
import {
  buildLines,
  canRespond,
  GIB_CODES,
  nextOutgoingStep,
  resolveProfile,
  RESPONSE_DAYS,
  toGibNumber,
  validateForGib,
  type EInvoiceLine,
  type EInvoiceLineInput,
} from './einvoice-rules';
import { buildInvoiceXml, type UblParty } from './einvoice-xml';

export const EINVOICE_SYNC_JOB = 'einvoice-sync';
const SETTINGS_KEY = 'einvoice';
const TIME_ZONE = 'Europe/Istanbul';
const DAY = 86_400_000;
const SORTABLE = ['number', 'issueDate', 'payableAmount', 'createdAt'] as const;
const SEQUENCES = [
  { code: 'E_INVOICE', name: 'e-Fatura', prefix: 'EPF' },
  { code: 'E_ARCHIVE', name: 'e-Arşiv Fatura', prefix: 'EPA' },
];

const listInclude = {
  partner: { select: { code: true, title: true } },
  salesInvoice: { select: { number: true } },
  purchaseInvoice: { select: { number: true } },
} satisfies Prisma.EInvoiceInclude;

const detailInclude = {
  ...listInclude,
  purchaseInvoice: { select: { number: true, status: true } },
  salesInvoice: { select: { number: true, status: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  events: {
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.EInvoiceInclude;

const sourceInclude = {
  partner: true,
  order: { select: { number: true, orderDate: true } },
  lines: {
    include: {
      variant: { select: { sku: true, product: { select: { unit: { select: { code: true } } } } } },
    },
    orderBy: { lineNo: 'asc' },
  },
  eInvoice: { select: { id: true, status: true } },
} satisfies Prisma.SalesInvoiceInclude;

type ListRow = Prisma.EInvoiceGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.EInvoiceGetPayload<{ include: typeof detailInclude }>;
type SourceRow = Prisma.SalesInvoiceGetPayload<{ include: typeof sourceInclude }>;
type CompanyRow = Prisma.CompanyGetPayload<object>;

interface Step {
  status: EInvoiceStatus;
  code: string;
  message: string;
}

const localTime = (date: Date) =>
  date.toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, hour12: false });
const localToday = () =>
  parseDateOnly(new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE }));
const name = (u: { firstName: string; lastName: string } | null) =>
  u ? `${u.firstName} ${u.lastName}` : null;

const companyParty = (c: CompanyRow): UblParty => ({
  taxId: c.taxNumber,
  name: c.legalName ?? c.name,
  taxOffice: c.taxOffice,
  street: c.address,
  city: c.city,
  country: c.country,
  email: c.email,
});

const partnerParty = (p: {
  taxNumber: string | null;
  title: string;
  taxOffice: string | null;
  address: string | null;
  city: string | null;
  email: string | null;
}): UblParty => ({
  taxId: p.taxNumber,
  name: p.title,
  taxOffice: p.taxOffice,
  street: p.address,
  city: p.city,
  country: 'TR',
  email: p.email,
});

/**
 * e-Fatura / e-Arşiv simulation. Outgoing invoices are queued from sales invoices and moved
 * through GİB's states by the integrator run (`sync`); incoming ones are simulated supplier
 * invoices that are answered and recorded as purchase invoices.
 */
@Injectable()
export class EInvoiceService {
  private readonly logger = new Logger(EInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
    private readonly purchaseInvoices: PurchaseInvoicesService,
    private readonly config: AppConfigService,
    @InjectQueue(QUEUES.EINVOICE) private readonly queue: Queue,
  ) {}

  async list(companyId: string, query: EInvoiceQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.EInvoiceWhereInput = {
      companyId,
      direction: query.direction,
      status: query.status,
      profile: query.profile,
      partnerId: query.partnerId,
      ...((query.from || query.to) && {
        issueDate: {
          ...(query.from && { gte: parseDateOnly(query.from) }),
          ...(query.to && { lte: parseDateOnly(query.to) }),
        },
      }),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
          { salesInvoice: { number: { contains: search, mode: 'insensitive' } } },
          { purchaseInvoice: { number: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.eInvoice.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.eInvoice.count({ where }),
    ]);
    const now = new Date();
    return paginated(
      rows.map((row) => toDto(row, now)),
      total,
      query,
    );
  }

  async summary(companyId: string): Promise<EInvoiceSummaryDto> {
    const today = localToday();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const windowStart = new Date(Date.now() - RESPONSE_DAYS * DAY);
    const out = { companyId, direction: EInvoiceDirection.OUTGOING };
    const inc = { companyId, direction: EInvoiceDirection.INCOMING };
    const [unsent, inProgress, errors, awaiting, toRespond, toRecord, month, incoming] =
      await this.prisma.$transaction([
        this.prisma.salesInvoice.count({
          where: { companyId, status: InvoiceStatus.ISSUED, eInvoice: null },
        }),
        this.prisma.eInvoice.count({
          where: { ...out, status: { in: [EInvoiceStatus.QUEUED, EInvoiceStatus.SENT] } },
        }),
        this.prisma.eInvoice.count({ where: { ...out, status: EInvoiceStatus.ERROR } }),
        this.prisma.eInvoice.count({
          where: {
            ...out,
            profile: EInvoiceProfile.TICARIFATURA,
            status: EInvoiceStatus.DELIVERED,
          },
        }),
        this.prisma.eInvoice.count({
          where: {
            ...inc,
            profile: EInvoiceProfile.TICARIFATURA,
            status: EInvoiceStatus.DELIVERED,
            deliveredAt: { gte: windowStart },
          },
        }),
        this.prisma.eInvoice.count({
          where: {
            ...inc,
            status: { not: EInvoiceStatus.REJECTED },
            OR: [
              { purchaseInvoiceId: null },
              { purchaseInvoice: { status: InvoiceStatus.CANCELLED } },
            ],
          },
        }),
        this.prisma.eInvoice.aggregate({
          where: {
            ...out,
            issueDate: { gte: monthStart },
            status: { notIn: [EInvoiceStatus.ERROR, EInvoiceStatus.CANCELLED] },
          },
          _count: true,
          _sum: { payableAmount: true },
        }),
        this.prisma.eInvoice.count({ where: { ...inc, issueDate: { gte: monthStart } } }),
      ]);
    return {
      unsent,
      inProgress,
      errors,
      awaitingResponse: awaiting,
      toRespond,
      toRecord,
      outgoingThisMonth: month._count,
      outgoingAmountThisMonth: (month._sum.payableAmount ?? new Prisma.Decimal(0)).toFixed(2),
      incomingThisMonth: incoming,
    };
  }

  /** Issued sales invoices that have not been sent yet, newest first. */
  async unsent(companyId: string): Promise<UnsentInvoiceDto[]> {
    const [settings, rows] = await Promise.all([
      this.readSettings(this.prisma, companyId),
      this.prisma.salesInvoice.findMany({
        where: { companyId, status: InvoiceStatus.ISSUED, eInvoice: null },
        include: { partner: { select: { title: true, eInvoiceAlias: true } } },
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      }),
    ]);
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      partnerId: row.partnerId,
      partnerTitle: row.partner.title,
      invoiceDate: toDateOnly(row.invoiceDate),
      currencyCode: row.currencyCode,
      grandTotal: row.grandTotal.toFixed(2),
      profile: resolveProfile(row.partner.eInvoiceAlias, undefined, settings.defaultProfile)!,
    }));
  }

  async findOne(companyId: string, id: string): Promise<EInvoiceDetailDto> {
    const row = await this.prisma.eInvoice.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('e-Invoice not found');
    return toDetailDto(row, new Date());
  }

  /** Queues a sales invoice for GİB. */
  async send(user: AuthUser, dto: SendEInvoiceDto): Promise<EInvoiceDetailDto> {
    const { companyId } = user;
    const { salesInvoiceId } = dto;
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id = ${salesInvoiceId}::uuid FOR UPDATE`;
      const invoice = await tx.salesInvoice.findFirst({
        where: { id: salesInvoiceId, companyId },
        include: sourceInclude,
      });
      if (!invoice) throw new NotFoundException('Sales invoice not found');
      if (invoice.status !== InvoiceStatus.ISSUED) {
        throw new ConflictException('Cancelled invoices cannot be sent');
      }
      if (invoice.eInvoice) {
        throw new ConflictException(
          invoice.eInvoice.status === EInvoiceStatus.ERROR
            ? 'GİB refused this e-invoice; resend it instead'
            : 'The invoice was already sent',
        );
      }
      const settings = await this.readSettings(tx, companyId);
      const alias = invoice.partner.eInvoiceAlias;
      const profile = resolveProfile(alias, dto.profile, settings.defaultProfile);
      if (!profile) {
        throw new BadRequestException(
          alias
            ? `${invoice.partner.title} is an e-Fatura user; e-Arşiv cannot be used`
            : `${invoice.partner.title} is not an e-Fatura user; send it as e-Arşiv`,
        );
      }
      const number = await this.nextNumber(tx, companyId, profile);
      const data = await this.outgoingData(tx, invoice, profile, number, settings.senderAlias);
      const created = await tx.eInvoice.create({
        data: {
          ...data,
          companyId,
          direction: EInvoiceDirection.OUTGOING,
          salesInvoiceId: invoice.id,
          partnerId: invoice.partnerId,
          createdById: user.id,
          events: {
            create: { status: EInvoiceStatus.QUEUED, ...queuedStep(), userId: user.id },
          },
        },
      });
      return created.id;
    });
    await this.schedule(companyId);
    return this.findOne(companyId, id);
  }

  /** Sends an envelope refused by GİB again with fresh data and a new ETTN. */
  async resend(user: AuthUser, id: string): Promise<EInvoiceDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, companyId, id);
      if (current.direction !== EInvoiceDirection.OUTGOING) {
        throw new ConflictException('Only outgoing invoices can be resent');
      }
      if (current.status !== EInvoiceStatus.ERROR) {
        throw new ConflictException('Only invoices refused by GİB can be resent');
      }
      const invoice = await tx.salesInvoice.findFirst({
        where: { id: current.salesInvoiceId ?? undefined, companyId },
        include: sourceInclude,
      });
      if (!invoice || invoice.status !== InvoiceStatus.ISSUED) {
        throw new ConflictException('The sales invoice was cancelled');
      }
      const settings = await this.readSettings(tx, companyId);
      const alias = invoice.partner.eInvoiceAlias;
      const profile =
        resolveProfile(alias, current.profile, settings.defaultProfile) ??
        resolveProfile(alias, undefined, settings.defaultProfile)!;
      const sameSeries =
        (profile === EInvoiceProfile.EARSIVFATURA) ===
        (current.profile === EInvoiceProfile.EARSIVFATURA);
      const number = sameSeries ? current.number : await this.nextNumber(tx, companyId, profile);
      const data = await this.outgoingData(tx, invoice, profile, number, settings.senderAlias);
      await tx.eInvoice.update({
        where: { id },
        data: {
          ...data,
          partnerId: invoice.partnerId,
          sentAt: null,
          deliveredAt: null,
          respondedAt: null,
          responseNote: null,
          events: {
            create: {
              status: EInvoiceStatus.QUEUED,
              code: GIB_CODES.QUEUED,
              message: `Yeniden gönderildi (yeni ETTN ${data.uuid})`,
              userId: user.id,
            },
          },
        },
      });
    });
    await this.schedule(companyId);
    return this.findOne(companyId, id);
  }

  /**
   * One integrator run: queued envelopes are validated (SENT or ERROR), sent ones reach the
   * receiver, and unanswered ticari faturas are accepted after 8 days.
   */
  async sync(companyId?: string): Promise<SyncResultDto> {
    const now = new Date();
    const rows = await this.prisma.eInvoice.findMany({
      where: {
        companyId,
        direction: EInvoiceDirection.OUTGOING,
        OR: [
          { status: { in: [EInvoiceStatus.QUEUED, EInvoiceStatus.SENT] } },
          { status: EInvoiceStatus.DELIVERED, profile: EInvoiceProfile.TICARIFATURA },
        ],
      },
      include: { partner: { select: { title: true } } },
      orderBy: { createdAt: 'asc' },
    });
    let processed = 0;
    for (const row of rows) {
      const step = nextOutgoingStep(
        row,
        () =>
          validateForGib({
            profile: row.profile,
            number: row.number,
            supplierTaxId: row.senderTaxId,
            customerTaxId: row.receiverTaxId,
            receiverAlias: row.receiverAlias,
            currencyCode: row.currencyCode,
            exchangeRate: row.exchangeRate,
            lines: row.lines as unknown as EInvoiceLine[],
            payable: row.payableAmount,
          }),
        now,
      );
      if (!step) continue;
      if (!(await this.transition(row.id, row.status, step, null))) continue;
      processed += 1;
      if (step.status === EInvoiceStatus.ERROR) {
        await this.notifyCompany(row.companyId, 'einvoice:send', {
          title: `e-Fatura reddedildi: ${row.number}`,
          body: `${row.partner.title} — ${step.message}`,
          link: `/e-invoices/${row.id}`,
        });
      }
    }
    return { processed };
  }

  /** Accept or reject an incoming ticari fatura. */
  async respond(user: AuthUser, id: string, dto: RespondEInvoiceDto): Promise<EInvoiceDetailDto> {
    await this.answer(user, id, dto, EInvoiceDirection.INCOMING);
    return this.findOne(user.companyId, id);
  }

  /** Simulates the receiver's answer to an outgoing ticari fatura. */
  async simulateResponse(
    user: AuthUser,
    id: string,
    dto: RespondEInvoiceDto,
  ): Promise<EInvoiceDetailDto> {
    const row = await this.answer(user, id, dto, EInvoiceDirection.OUTGOING);
    if (dto.action === 'REJECT') {
      await this.notifyCompany(user.companyId, 'einvoice:send', {
        title: `Ticari fatura reddedildi: ${row.number}`,
        body: dto.note ?? '',
        link: `/e-invoices/${id}`,
      });
    }
    return this.findOne(user.companyId, id);
  }

  /** Simulates an e-Fatura arriving from a supplier, priced at the products' purchase prices. */
  async simulateIncoming(user: AuthUser, dto: SimulateIncomingDto): Promise<EInvoiceDetailDto> {
    const { companyId } = user;
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const partner = dto.partnerId
      ? await this.prisma.businessPartner.findFirst({
          where: { id: dto.partnerId, companyId, deletedAt: null },
        })
      : await this.randomSupplier(companyId, company.baseCurrency);
    if (!partner) throw new NotFoundException('Supplier not found');
    if (!(SUPPLIER_TYPES as PartnerType[]).includes(partner.type)) {
      throw new BadRequestException(`${partner.title} is not a supplier`);
    }
    if (partner.currencyCode !== company.baseCurrency) {
      throw new BadRequestException('Only suppliers invoicing in the base currency are simulated');
    }
    const products = await this.prisma.productVariant.findMany({
      where: {
        companyId,
        isActive: true,
        product: { isActive: true, deletedAt: null, purchasePrice: { gt: 0 } },
      },
      select: {
        id: true,
        sku: true,
        name: true,
        product: {
          select: {
            name: true,
            type: true,
            purchasePrice: true,
            unit: { select: { code: true } },
            vatRate: { select: { rate: true } },
          },
        },
      },
    });
    if (!products.length) {
      throw new BadRequestException('Add products with a purchase price first');
    }
    const picks = [...products].sort(() => Math.random() - 0.5).slice(0, randomInt(1, 4));
    const inputs: EInvoiceLineInput[] = picks.map((v) => ({
      description: v.name ? `${v.product.name} ${v.name}` : v.product.name,
      sellerCode: v.sku,
      variantId: v.id,
      unit: v.product.unit.code,
      quantity: v.product.type === ProductType.SERVICE ? randomInt(1, 4) : randomInt(1, 11),
      unitPrice: v.product.purchasePrice!,
      discountRate: 0,
      vatRate: v.product.vatRate?.rate ?? 20,
    }));
    const { lines, totals } = buildLines(inputs);
    const settings = await this.readSettings(this.prisma, companyId);
    const now = new Date();
    const issueDate = localToday();
    const prefix = (partner.code.replace(/[^A-Z0-9]/gi, '').toUpperCase() + 'XXX').slice(0, 3);
    const number = `${prefix}${issueDate.getUTCFullYear()}${String(randomInt(1, 1e9)).padStart(9, '0')}`;
    const uuid = randomUUID();
    const profile = dto.profile ?? EInvoiceProfile.TICARIFATURA;
    const senderAlias =
      partner.eInvoiceAlias ?? `urn:mail:defaultgb@${partner.code.toLowerCase()}.com.tr`;
    const xml = buildInvoiceXml({
      profile,
      number,
      uuid,
      issueDate: toDateOnly(issueDate),
      issueTime: localTime(now),
      currencyCode: partner.currencyCode,
      exchangeRate: null,
      notes: [`Vade: ${partner.paymentTermDays} gün`],
      supplier: partnerParty(partner),
      customer: companyParty(company),
      lines,
      totals,
      orderReference: null,
    });
    const created = await this.prisma.eInvoice.create({
      data: {
        companyId,
        direction: EInvoiceDirection.INCOMING,
        profile,
        status: EInvoiceStatus.DELIVERED,
        number,
        uuid,
        partnerId: partner.id,
        issueDate,
        currencyCode: partner.currencyCode,
        exchangeRate: 1,
        lineExtensionAmount: totals.lineExtension,
        allowanceTotal: totals.allowance,
        taxTotal: sumVat(lines),
        payableAmount: totals.payable,
        senderAlias,
        receiverAlias: settings.senderAlias,
        senderTaxId: partner.taxNumber,
        receiverTaxId: company.taxNumber,
        lines: lines as unknown as Prisma.InputJsonValue,
        xml,
        statusCode: GIB_CODES.COMPLETED,
        statusMessage: 'Gelen kutusuna ulaştı',
        sentAt: now,
        deliveredAt: now,
        events: {
          create: {
            status: EInvoiceStatus.DELIVERED,
            code: GIB_CODES.COMPLETED,
            message: 'Gelen kutusuna ulaştı (simülasyon)',
            userId: user.id,
          },
        },
      },
    });
    await this.notifyCompany(companyId, 'einvoice:update', {
      title: `Yeni gelen e-Fatura: ${partner.title}`,
      body: `${number} · ${totals.payable} ${partner.currencyCode}`,
      link: `/e-invoices/${created.id}`,
    });
    return this.findOne(companyId, created.id);
  }

  /** Records an incoming invoice as a purchase invoice (ticari faturas must be accepted first). */
  async record(user: AuthUser, id: string): Promise<EInvoiceDetailDto> {
    const { companyId } = user;
    const row = await this.prisma.eInvoice.findFirst({
      where: { id, companyId },
      include: { purchaseInvoice: { select: { status: true } } },
    });
    if (!row) throw new NotFoundException('e-Invoice not found');
    if (row.direction !== EInvoiceDirection.INCOMING) {
      throw new ConflictException('Only incoming invoices can be recorded');
    }
    if (row.purchaseInvoice && row.purchaseInvoice.status !== InvoiceStatus.CANCELLED) {
      throw new ConflictException('The invoice is already recorded');
    }
    if (row.status === EInvoiceStatus.REJECTED) {
      throw new ConflictException('Rejected invoices cannot be recorded');
    }
    if (row.profile === EInvoiceProfile.TICARIFATURA && row.status !== EInvoiceStatus.ACCEPTED) {
      throw new ConflictException('Accept the ticari fatura first');
    }
    const lines = row.lines as unknown as EInvoiceLine[];
    const known = new Set(
      (
        await this.prisma.productVariant.findMany({
          where: {
            companyId,
            id: { in: lines.map((l) => l.variantId).filter((v): v is string => !!v) },
            isActive: true,
            product: { isActive: true, deletedAt: null },
          },
          select: { id: true },
        })
      ).map((v) => v.id),
    );
    const invoice = await this.purchaseInvoices.create(user, {
      partnerId: row.partnerId,
      supplierInvoiceNo: row.number,
      invoiceDate: toDateOnly(row.issueDate),
      currencyCode: row.currencyCode,
      ...(!row.exchangeRate.equals(1) && { exchangeRate: row.exchangeRate.toNumber() }),
      notes: `e-Fatura ${row.number} (ETTN ${row.uuid})`,
      lines: lines.map((line) => ({
        variantId: line.variantId && known.has(line.variantId) ? line.variantId : undefined,
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        discountRate: Number(line.discountRate),
        vatRate: Number(line.vatRate),
      })),
    });
    await this.prisma.eInvoice.update({
      where: { id },
      data: {
        purchaseInvoiceId: invoice.id,
        events: {
          create: {
            status: row.status,
            message: `Alış faturası oluşturuldu: ${invoice.number}`,
            userId: user.id,
          },
        },
      },
    });
    return this.findOne(companyId, id);
  }

  async settings(companyId: string): Promise<EInvoiceSettingsDto> {
    return this.readSettings(this.prisma, companyId);
  }

  async updateSettings(
    companyId: string,
    dto: UpdateEInvoiceSettingsDto,
  ): Promise<EInvoiceSettingsDto> {
    const value = { ...(await this.readSettings(this.prisma, companyId)), ...dto };
    await this.prisma.setting.upsert({
      where: { companyId_key: { companyId, key: SETTINGS_KEY } },
      create: { companyId, key: SETTINGS_KEY, value: { ...value } },
      update: { value: { ...value } },
    });
    return value;
  }

  /** Sends a new sales invoice when automatic sending is on; failures only log. */
  async autoSend(user: AuthUser, salesInvoiceId: string): Promise<void> {
    const settings = await this.readSettings(this.prisma, user.companyId);
    if (!settings.autoSend) return;
    try {
      await this.send(user, { salesInvoiceId });
    } catch (error) {
      this.logger.warn(`Automatic e-invoice for ${salesInvoiceId} failed: ${String(error)}`);
    }
  }

  private async answer(
    user: AuthUser,
    id: string,
    dto: RespondEInvoiceDto,
    direction: EInvoiceDirection,
  ) {
    const note = dto.note?.trim();
    if (dto.action === 'REJECT' && !note) {
      throw new BadRequestException('Enter a reason to reject the invoice');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, user.companyId, id);
      if (row.direction !== direction) {
        throw new ConflictException(
          direction === EInvoiceDirection.INCOMING
            ? 'Only incoming invoices can be answered'
            : 'Only outgoing invoices can be answered by the receiver',
        );
      }
      if (!canRespond(row, new Date())) {
        throw new ConflictException(
          `Only delivered ticari faturas can be answered within ${RESPONSE_DAYS} days`,
        );
      }
      if (dto.action === 'REJECT' && row.purchaseInvoiceId) {
        const purchase = await tx.purchaseInvoice.findUnique({
          where: { id: row.purchaseInvoiceId },
          select: { status: true },
        });
        if (purchase?.status === InvoiceStatus.ISSUED) {
          throw new ConflictException('Cancel the purchase invoice before rejecting');
        }
      }
      const accepted = dto.action === 'ACCEPT';
      const incoming = direction === EInvoiceDirection.INCOMING;
      const step: Step = accepted
        ? {
            status: EInvoiceStatus.ACCEPTED,
            code: GIB_CODES.ACCEPTED,
            message: incoming ? 'Fatura kabul edildi' : 'Alıcı faturayı kabul etti',
          }
        : {
            status: EInvoiceStatus.REJECTED,
            code: GIB_CODES.REJECTED,
            message: `${incoming ? 'Fatura reddedildi' : 'Alıcı faturayı reddetti'}: ${note}`,
          };
      await this.applyStep(tx, row.id, step, user.id, accepted ? null : (note ?? null));
      return row;
    });
  }

  /** Moves an e-invoice from `from` to the step's status; false when it changed meanwhile. */
  private async transition(
    id: string,
    from: EInvoiceStatus,
    step: Step,
    userId: string | null,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: EInvoiceStatus }[]>`
        SELECT status FROM e_invoices WHERE id = ${id}::uuid FOR UPDATE`;
      if (rows[0]?.status !== from) return false;
      await this.applyStep(tx, id, step, userId, null);
      return true;
    });
  }

  private async applyStep(
    tx: PrismaTx,
    id: string,
    step: Step,
    userId: string | null,
    responseNote: string | null,
  ) {
    const now = new Date();
    await tx.eInvoice.update({
      where: { id },
      data: {
        status: step.status,
        statusCode: step.code,
        statusMessage: step.message,
        ...(step.status === EInvoiceStatus.SENT && { sentAt: now }),
        ...(step.status === EInvoiceStatus.DELIVERED && { deliveredAt: now }),
        ...((step.status === EInvoiceStatus.ACCEPTED ||
          step.status === EInvoiceStatus.REJECTED) && { respondedAt: now, responseNote }),
        events: {
          create: { status: step.status, code: step.code, message: step.message, userId },
        },
      },
    });
  }

  private async lock(tx: PrismaTx, companyId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM e_invoices WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.eInvoice.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('e-Invoice not found');
    return row;
  }

  private async outgoingData(
    tx: PrismaTx,
    invoice: SourceRow,
    profile: EInvoiceProfile,
    number: string,
    senderAlias: string,
  ) {
    const company = await tx.company.findUniqueOrThrow({ where: { id: invoice.companyId } });
    const { lines, totals } = buildLines(
      invoice.lines.map((line) => ({
        description: line.description,
        sellerCode: line.variant?.sku ?? null,
        variantId: line.variantId,
        unit: line.variant?.product.unit.code ?? null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountRate: line.discountRate,
        vatRate: line.vatRate,
      })),
    );
    const uuid = randomUUID();
    const eArchive = profile === EInvoiceProfile.EARSIVFATURA;
    const receiverAlias = eArchive ? null : invoice.partner.eInvoiceAlias;
    const xml = buildInvoiceXml({
      profile,
      number,
      uuid,
      issueDate: toDateOnly(invoice.invoiceDate),
      issueTime: localTime(new Date()),
      currencyCode: invoice.currencyCode,
      exchangeRate: invoice.currencyCode === 'TRY' ? null : invoice.exchangeRate.toFixed(4),
      notes: [
        `Fatura no: ${invoice.number}`,
        `Son ödeme tarihi: ${toDateOnly(invoice.dueDate)}`,
        ...(invoice.notes ? [invoice.notes] : []),
      ],
      supplier: companyParty(company),
      customer: partnerParty(invoice.partner),
      lines,
      totals,
      orderReference: invoice.order
        ? { number: invoice.order.number, date: toDateOnly(invoice.order.orderDate) }
        : null,
    });
    const queued = queuedStep();
    return {
      profile,
      status: EInvoiceStatus.QUEUED,
      number,
      uuid,
      issueDate: invoice.invoiceDate,
      currencyCode: invoice.currencyCode,
      exchangeRate: invoice.exchangeRate,
      lineExtensionAmount: totals.lineExtension,
      allowanceTotal: totals.allowance,
      taxTotal: sumVat(lines),
      payableAmount: totals.payable,
      senderAlias,
      receiverAlias,
      senderTaxId: company.taxNumber,
      receiverTaxId: invoice.partner.taxNumber,
      lines: lines as unknown as Prisma.InputJsonValue,
      xml,
      statusCode: queued.code,
      statusMessage: queued.message,
    };
  }

  private async nextNumber(tx: PrismaTx, companyId: string, profile: EInvoiceProfile) {
    const year = localToday().getUTCFullYear();
    for (const s of SEQUENCES) {
      await tx.numberSequence.upsert({
        where: { companyId_code: { companyId, code: s.code } },
        create: { companyId, ...s, padding: 9, currentYear: year },
        update: {},
      });
    }
    const code = profile === EInvoiceProfile.EARSIVFATURA ? 'E_ARCHIVE' : 'E_INVOICE';
    return toGibNumber(await this.numbering.next(companyId, code, tx));
  }

  private async readSettings(
    client: PrismaService | PrismaTx,
    companyId: string,
  ): Promise<EInvoiceSettingsDto> {
    const row = await client.setting.findUnique({
      where: { companyId_key: { companyId, key: SETTINGS_KEY } },
    });
    const value = (row?.value ?? {}) as Partial<EInvoiceSettingsDto>;
    return {
      senderAlias: value.senderAlias ?? 'urn:mail:defaultgb@enterprisepulse.dev',
      defaultProfile: value.defaultProfile ?? EInvoiceProfile.TICARIFATURA,
      autoSend: value.autoSend ?? false,
    };
  }

  private async randomSupplier(companyId: string, currencyCode: string) {
    const suppliers = await this.prisma.businessPartner.findMany({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        type: { in: SUPPLIER_TYPES },
        currencyCode,
        taxNumber: { not: null },
      },
    });
    return suppliers.length ? suppliers[randomInt(suppliers.length)] : null;
  }

  /** Runs the integrator shortly after a send so the status moves without waiting for the poll. */
  private async schedule(companyId: string) {
    if (this.config.get('NODE_ENV') === 'test') return;
    for (const delay of [3_000, 8_000]) {
      await this.queue.add(EINVOICE_SYNC_JOB, { companyId }, { delay });
    }
  }

  private async notifyCompany(
    companyId: string,
    permission: string,
    message: { title: string; body: string; link: string },
  ) {
    const userIds = await this.notifications.findUserIdsWithPermission(companyId, permission);
    await this.notifications.notify({ companyId, userIds, type: 'einvoice', ...message });
  }
}

const queuedStep = () => ({ code: GIB_CODES.QUEUED, message: 'Zarf kuyruğa eklendi' });

const sumVat = (lines: EInvoiceLine[]) =>
  lines.reduce((sum, line) => sum.plus(line.vat), new Prisma.Decimal(0));

function toDto(row: ListRow, now: Date): EInvoiceDto {
  return {
    id: row.id,
    direction: row.direction,
    profile: row.profile,
    status: row.status,
    number: row.number,
    uuid: row.uuid,
    partnerId: row.partnerId,
    partnerCode: row.partner.code,
    partnerTitle: row.partner.title,
    issueDate: toDateOnly(row.issueDate),
    currencyCode: row.currencyCode,
    taxTotal: row.taxTotal.toFixed(2),
    payableAmount: row.payableAmount.toFixed(2),
    salesInvoiceId: row.salesInvoiceId,
    salesInvoiceNumber: row.salesInvoice?.number ?? null,
    purchaseInvoiceId: row.purchaseInvoiceId,
    purchaseInvoiceNumber: row.purchaseInvoice?.number ?? null,
    statusCode: row.statusCode,
    statusMessage: row.statusMessage,
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt,
    respondedAt: row.respondedAt,
    canRespond: canRespond(row, now),
    createdAt: row.createdAt,
  };
}

function toDetailDto(row: DetailRow, now: Date): EInvoiceDetailDto {
  const incoming = row.direction === EInvoiceDirection.INCOMING;
  const recorded = !!row.purchaseInvoice && row.purchaseInvoice.status !== InvoiceStatus.CANCELLED;
  return {
    ...toDto(row, now),
    exchangeRate: row.exchangeRate.toFixed(4),
    lineExtensionAmount: row.lineExtensionAmount.toFixed(2),
    allowanceTotal: row.allowanceTotal.toFixed(2),
    senderAlias: row.senderAlias,
    receiverAlias: row.receiverAlias,
    senderTaxId: row.senderTaxId,
    receiverTaxId: row.receiverTaxId,
    responseNote: row.responseNote,
    responseDeadline:
      row.profile === EInvoiceProfile.TICARIFATURA && row.deliveredAt
        ? new Date(row.deliveredAt.getTime() + RESPONSE_DAYS * DAY).toLocaleDateString('en-CA', {
            timeZone: TIME_ZONE,
          })
        : null,
    lines: row.lines as unknown as EInvoiceLine[],
    taxes: taxesOf(row.lines as unknown as EInvoiceLine[]),
    events: row.events.map((e) => ({
      id: e.id,
      status: e.status,
      code: e.code,
      message: e.message,
      userName: name(e.user),
      createdAt: e.createdAt,
    })),
    xml: row.xml,
    createdByName: name(row.createdBy),
    canResend:
      !incoming &&
      row.status === EInvoiceStatus.ERROR &&
      row.salesInvoice?.status === InvoiceStatus.ISSUED,
    canRecord:
      incoming &&
      !recorded &&
      (row.profile === EInvoiceProfile.TICARIFATURA
        ? row.status === EInvoiceStatus.ACCEPTED
        : row.status !== EInvoiceStatus.REJECTED),
  };
}

function taxesOf(lines: EInvoiceLine[]) {
  const byRate = new Map<string, { base: Prisma.Decimal; vat: Prisma.Decimal }>();
  for (const line of lines) {
    const entry = byRate.get(line.vatRate) ?? {
      base: new Prisma.Decimal(0),
      vat: new Prisma.Decimal(0),
    };
    byRate.set(line.vatRate, { base: entry.base.plus(line.net), vat: entry.vat.plus(line.vat) });
  }
  return [...byRate.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([rate, t]) => ({ rate, base: t.base.toFixed(2), vat: t.vat.toFixed(2) }));
}
