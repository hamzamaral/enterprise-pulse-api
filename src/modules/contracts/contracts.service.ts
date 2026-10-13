import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractEventType,
  ContractParty,
  ContractStatus,
  Prisma,
  type Contract,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { DownloadUrlDto } from '../files/dto/file.dto';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import type {
  ActivateContractDto,
  ContractDetailDto,
  ContractOwnerDto,
  ContractQueryDto,
  ContractRunResultDto,
  CreateContractDto,
  RenewContractDto,
  TerminateContractDto,
  UpdateContractDto,
} from './dto/contract.dto';
import {
  CONTRACT_ENTITY,
  contractInclude,
  fullName,
  lockContract,
  toContractDto,
  today,
  trimOrNull,
} from './contract-helpers';
import { addDays, noticeDeadline, reminderDue, settle, termEnd } from './contract-math';

const SORTABLE = ['number', 'title', 'startDate', 'endDate', 'status', 'createdAt'] as const;
export const OWNER_PERMISSION = 'contracts:read';

interface Notice {
  userId: string;
  contractId: string;
  title: string;
  body: string;
  email?: boolean;
}

/** dd.MM.yyyy for notification texts. */
const trDate = (date: Date) => toDateOnly(date).split('-').reverse().join('.');

/** Sözleşmeler: partner and employee contracts, renewals, terminations and expiry reminders. */
@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
  ) {}

  async findAll(user: AuthUser, query: ContractQueryDto) {
    const now = today();
    const search = query.search?.trim();
    const where: Prisma.ContractWhereInput = {
      companyId: user.companyId,
      status: query.status,
      party: query.party,
      typeId: query.typeId,
      partnerId: query.partnerId,
      employeeId: query.employeeId,
      ownerId: query.ownerId === 'me' ? user.id : query.ownerId,
      AND: [
        search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' } },
                { title: { contains: search, mode: 'insensitive' } },
                { partner: { title: { contains: search, mode: 'insensitive' } } },
                { employee: { firstName: { contains: search, mode: 'insensitive' } } },
                { employee: { lastName: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {},
        query.expiring === 'true'
          ? { id: { in: await this.expiringIds(user.companyId, now) } }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: contractInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.contract.count({ where }),
    ]);
    return paginated(
      rows.map((row) => toContractDto(row, now)),
      total,
      query,
    );
  }

  /** Active contracts inside their reminder window (see `contractState`). */
  private async expiringIds(companyId: string, now: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM contracts
      WHERE "companyId" = ${companyId}::uuid
        AND status = 'ACTIVE'
        AND "terminatedOn" IS NULL
        AND "endDate" IS NOT NULL
        AND "endDate" - (CASE WHEN "autoRenew" THEN "noticeDays" ELSE 0 END) - "reminderDays"
          <= ${now}::date`;
    return rows.map((r) => r.id);
  }

  /** `contracts:read` holders and the contract owner can open a contract. */
  async findOne(user: AuthUser, id: string): Promise<ContractDetailDto> {
    const now = today();
    const row = await this.prisma.contract.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        ...contractInclude,
        type: { select: { name: true, flow: true, defaultTermMonths: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        events: {
          include: { actor: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row || !(hasPermission(user, OWNER_PERMISSION) || row.ownerId === user.id)) {
      throw new NotFoundException('Contract not found');
    }

    const files = await this.prisma.fileObject.findMany({
      where: {
        companyId: user.companyId,
        entityType: CONTRACT_ENTITY,
        entityId: id,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    const uploaderIds = [...new Set(files.map((f) => f.uploadedById).filter((v) => v !== null))];
    const uploaders = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: uploaderIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      ).map((u) => [u.id, fullName(u)]),
    );

    const canUpdate = hasPermission(user, 'contracts:update');
    const active = row.status === ContractStatus.ACTIVE;
    const renewable =
      !!row.endDate && ((active && !row.terminatedOn) || row.status === ContractStatus.EXPIRED);
    const renewalMonths = row.renewalMonths ?? row.type.defaultTermMonths ?? 12;
    return {
      ...toContractDto(row, now),
      description: row.description,
      terminationReason: row.terminationReason,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      createdByName: fullName(row.createdBy),
      suggestedRenewalEnd: row.endDate
        ? toDateOnly(termEnd(addDays(row.endDate, 1), renewalMonths))
        : null,
      events: row.events.map((e) => ({
        id: e.id,
        type: e.type,
        actorName: e.actor ? fullName(e.actor) : null,
        fromValue: e.fromValue,
        toValue: e.toValue,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
      attachments: files.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
        uploadedByName: f.uploadedById ? (uploaders.get(f.uploadedById) ?? null) : null,
        createdAt: f.createdAt.toISOString(),
      })),
      canEdit: canUpdate && (active || row.status === ContractStatus.DRAFT),
      canActivate: canUpdate && row.status === ContractStatus.DRAFT,
      canRenew: canUpdate && renewable,
      canTerminate: canUpdate && active && !row.terminatedOn,
      canCancelTermination: canUpdate && active && !!row.terminatedOn,
      canDelete: hasPermission(user, 'contracts:delete') && row.status === ContractStatus.DRAFT,
    };
  }

  /** Users who can own contracts, with the number of active contracts they own. */
  async owners(companyId: string): Promise<ContractOwnerDto[]> {
    const ids = await this.notifications.findUserIdsWithPermission(companyId, OWNER_PERMISSION);
    const [users, load] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.contract.groupBy({
        by: ['ownerId'],
        where: { companyId, ownerId: { in: ids }, status: ContractStatus.ACTIVE },
        _count: true,
      }),
    ]);
    const active = new Map(load.map((g) => [g.ownerId, g._count]));
    return users.map((u) => ({
      id: u.id,
      name: fullName(u),
      email: u.email,
      activeCount: active.get(u.id) ?? 0,
    }));
  }

  async create(user: AuthUser, dto: CreateContractDto): Promise<ContractDetailDto> {
    const type = await this.prisma.contractType.findFirst({
      where: { id: dto.typeId, companyId: user.companyId, isActive: true },
    });
    if (!type) throw new BadRequestException('Contract type not found');
    await this.assertParty(user.companyId, type.party, dto.partnerId, dto.employeeId);
    const ownerId = dto.ownerId ?? user.id;
    if (ownerId !== user.id) await this.assertOwner(user.companyId, ownerId);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: user.companyId },
      select: { baseCurrency: true },
    });

    const startDate = parseDateOnly(dto.startDate);
    const endDate = dto.endDate ? parseDateOnly(dto.endDate) : null;
    const autoRenew = dto.autoRenew ?? false;
    const renewalMonths = dto.renewalMonths ?? (autoRenew ? type.defaultTermMonths : null);
    assertTerms({ startDate, endDate, autoRenew, renewalMonths });

    const now = new Date();
    const contract = await this.prisma.$transaction(async (tx) => {
      const row = await tx.contract.create({
        data: {
          companyId: user.companyId,
          number: await this.numbering.next(user.companyId, 'CONTRACT', tx),
          title: dto.title.trim(),
          typeId: type.id,
          party: type.party,
          partnerId: type.party === ContractParty.PARTNER ? dto.partnerId : null,
          employeeId: type.party === ContractParty.EMPLOYEE ? dto.employeeId : null,
          ownerId,
          startDate,
          endDate,
          signedDate: dto.signedDate ? parseDateOnly(dto.signedDate) : null,
          amount: dto.amount ?? null,
          currencyCode: dto.currencyCode ?? company.baseCurrency,
          billingCycle: dto.billingCycle,
          autoRenew,
          renewalMonths,
          noticeDays: dto.noticeDays ?? type.defaultNoticeDays,
          reminderDays: dto.reminderDays ?? 30,
          description: trimOrNull(dto.description) ?? null,
          createdById: user.id,
          createdAt: now,
        },
      });
      await tx.contractEvent.create({
        data: {
          contractId: row.id,
          actorId: user.id,
          type: ContractEventType.CREATED,
          createdAt: now,
        },
      });
      return row;
    });
    if (ownerId !== user.id) {
      await this.notify(user.id, [
        {
          userId: ownerId,
          contractId: contract.id,
          title: `Sözleşme sorumlusu oldunuz: ${contract.number}`,
          body: contract.title,
        },
      ]);
    }
    return this.findOne(user, contract.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateContractDto): Promise<ContractDetailDto> {
    if (dto.ownerId && dto.ownerId !== user.id) await this.assertOwner(user.companyId, dto.ownerId);
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, user.companyId, id);
      const draft = current.status === ContractStatus.DRAFT;
      if (!draft && current.status !== ContractStatus.ACTIVE) {
        throw new ConflictException('Ended contracts cannot be changed');
      }
      const startDate = dto.startDate ? parseDateOnly(dto.startDate) : current.startDate;
      const endDate =
        dto.endDate === undefined
          ? current.endDate
          : dto.endDate
            ? parseDateOnly(dto.endDate)
            : null;
      if (
        !draft &&
        (startDate.getTime() !== current.startDate.getTime() ||
          endDate?.getTime() !== current.endDate?.getTime())
      ) {
        throw new ConflictException('Renew or terminate an active contract to change its dates');
      }
      let typeId = current.typeId;
      if (dto.typeId && dto.typeId !== current.typeId) {
        const type = await tx.contractType.findFirst({
          where: { id: dto.typeId, companyId: user.companyId, isActive: true },
        });
        if (!type) throw new BadRequestException('Contract type not found');
        if (type.party !== current.party) {
          throw new BadRequestException('The new type must be for the same party');
        }
        typeId = type.id;
      }
      const autoRenew = dto.autoRenew ?? current.autoRenew;
      const renewalMonths =
        dto.renewalMonths === undefined ? current.renewalMonths : dto.renewalMonths;
      assertTerms({ startDate, endDate, autoRenew, renewalMonths });

      await tx.contract.update({
        where: { id },
        data: {
          title: dto.title?.trim(),
          typeId,
          ownerId: dto.ownerId,
          startDate,
          endDate,
          signedDate:
            dto.signedDate === undefined
              ? undefined
              : dto.signedDate
                ? parseDateOnly(dto.signedDate)
                : null,
          amount: dto.amount,
          currencyCode: dto.currencyCode,
          billingCycle: dto.billingCycle,
          autoRenew,
          renewalMonths,
          noticeDays: dto.noticeDays,
          reminderDays: dto.reminderDays,
          description: trimOrNull(dto.description),
        },
      });
      await tx.contractEvent.create({
        data: { contractId: id, actorId: user.id, type: ContractEventType.UPDATED },
      });
      if (dto.ownerId && dto.ownerId !== current.ownerId) {
        notices.push({
          userId: dto.ownerId,
          contractId: id,
          title: `Sözleşme sorumlusu oldunuz: ${current.number}`,
          body: dto.title?.trim() ?? current.title,
        });
      }
    });
    await this.notify(user.id, notices);
    return this.findOne(user, id);
  }

  /** Signs a draft; contracts whose term has already passed are settled right away. */
  async activate(user: AuthUser, id: string, dto: ActivateContractDto): Promise<ContractDetailDto> {
    const now = today();
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, user.companyId, id);
      if (current.status !== ContractStatus.DRAFT) {
        throw new ConflictException('Only draft contracts can be activated');
      }
      const signedDate = dto.signedDate
        ? parseDateOnly(dto.signedDate)
        : (current.signedDate ?? now);
      const at = new Date();
      const activated = await tx.contract.update({
        where: { id },
        data: { status: ContractStatus.ACTIVE, signedDate, activatedAt: at },
      });
      await tx.contractEvent.create({
        data: {
          contractId: id,
          actorId: user.id,
          type: ContractEventType.ACTIVATED,
          toValue: toDateOnly(signedDate),
          createdAt: at,
        },
      });
      await this.process(tx, activated, now, notices, new Date(at.getTime() + 1));
    });
    await this.notify(user.id, notices);
    return this.findOne(user, id);
  }

  /** Extends the term in place; an expired contract becomes active again. */
  async renew(user: AuthUser, id: string, dto: RenewContractDto): Promise<ContractDetailDto> {
    const now = today();
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, user.companyId, id);
      const renewable =
        (current.status === ContractStatus.ACTIVE && !current.terminatedOn) ||
        current.status === ContractStatus.EXPIRED;
      if (!renewable || !current.endDate) {
        throw new ConflictException('Only active or expired fixed-term contracts can be renewed');
      }
      const endDate = parseDateOnly(dto.endDate);
      if (endDate <= current.endDate || endDate < now) {
        throw new BadRequestException('The new end date must be after the current end and today');
      }
      await tx.contract.update({
        where: { id },
        data: {
          endDate,
          amount: dto.amount,
          status: ContractStatus.ACTIVE,
          renewalCount: { increment: 1 },
          remindedFor: null,
        },
      });
      await tx.contractEvent.create({
        data: {
          contractId: id,
          actorId: user.id,
          type: ContractEventType.RENEWED,
          fromValue: toDateOnly(current.endDate),
          toValue: toDateOnly(endDate),
          note: trimOrNull(dto.note) ?? null,
        },
      });
      notices.push({
        userId: current.ownerId,
        contractId: id,
        title: `Sözleşme yenilendi: ${current.number}`,
        body: `${current.title} · yeni bitiş ${trDate(endDate)}`,
      });
    });
    await this.notify(user.id, notices);
    return this.findOne(user, id);
  }

  /** Ends the contract on `terminatedOn`; a past date ends it right away. */
  async terminate(
    user: AuthUser,
    id: string,
    dto: TerminateContractDto,
  ): Promise<ContractDetailDto> {
    const now = today();
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, user.companyId, id);
      if (current.status !== ContractStatus.ACTIVE || current.terminatedOn) {
        throw new ConflictException('Only active contracts can be terminated');
      }
      const terminatedOn = parseDateOnly(dto.terminatedOn);
      if (terminatedOn < current.startDate) {
        throw new BadRequestException('The termination date is before the start date');
      }
      if (current.endDate && terminatedOn > current.endDate) {
        throw new BadRequestException('The termination date is after the end date');
      }
      const immediate = terminatedOn < now;
      await tx.contract.update({
        where: { id },
        data: {
          terminatedOn,
          terminationReason: dto.reason.trim(),
          status: immediate ? ContractStatus.TERMINATED : undefined,
        },
      });
      await tx.contractEvent.create({
        data: {
          contractId: id,
          actorId: user.id,
          type: immediate ? ContractEventType.TERMINATED : ContractEventType.TERMINATION_SCHEDULED,
          toValue: toDateOnly(terminatedOn),
          note: dto.reason.trim(),
        },
      });
      notices.push({
        userId: current.ownerId,
        contractId: id,
        title: `Sözleşme feshedildi: ${current.number}`,
        body: `${current.title} · son gün ${trDate(terminatedOn)}`,
      });
    });
    await this.notify(user.id, notices);
    return this.findOne(user, id);
  }

  async cancelTermination(user: AuthUser, id: string): Promise<ContractDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, user.companyId, id);
      if (current.status !== ContractStatus.ACTIVE || !current.terminatedOn) {
        throw new ConflictException('The contract has no scheduled termination');
      }
      await tx.contract.update({
        where: { id },
        data: { terminatedOn: null, terminationReason: null },
      });
      await tx.contractEvent.create({
        data: {
          contractId: id,
          actorId: user.id,
          type: ContractEventType.TERMINATION_CANCELLED,
          fromValue: toDateOnly(current.terminatedOn),
        },
      });
    });
    return this.findOne(user, id);
  }

  /** Only drafts can be deleted; signed contracts stay for the record. */
  async remove(user: AuthUser, id: string): Promise<void> {
    const row = await this.prisma.contract.findFirst({ where: { id, companyId: user.companyId } });
    if (!row) throw new NotFoundException('Contract not found');
    if (row.status !== ContractStatus.DRAFT) {
      throw new ConflictException('Only draft contracts can be deleted');
    }
    const files = await this.prisma.fileObject.findMany({
      where: {
        companyId: user.companyId,
        entityType: CONTRACT_ENTITY,
        entityId: id,
        deletedAt: null,
      },
      select: { id: true },
    });
    await this.prisma.contract.delete({ where: { id } });
    for (const file of files) await this.files.remove(user.companyId, file.id);
  }

  async uploadAttachment(
    user: AuthUser,
    id: string,
    file: Express.Multer.File,
  ): Promise<ContractDetailDto> {
    await this.findOne(user, id);
    await this.files.upload(user.companyId, user.id, file, {
      entityType: CONTRACT_ENTITY,
      entityId: id,
    });
    await this.prisma.contract.update({ where: { id }, data: { updatedAt: new Date() } });
    return this.findOne(user, id);
  }

  async attachmentUrl(user: AuthUser, id: string, fileId: string): Promise<DownloadUrlDto> {
    const detail = await this.findOne(user, id);
    if (!detail.attachments.some((a) => a.id === fileId)) {
      throw new NotFoundException('File not found');
    }
    return this.files.getDownloadUrl(user.companyId, fileId);
  }

  async removeAttachment(user: AuthUser, id: string, fileId: string): Promise<ContractDetailDto> {
    const detail = await this.findOne(user, id);
    if (!detail.attachments.some((a) => a.id === fileId)) {
      throw new NotFoundException('File not found');
    }
    await this.files.remove(user.companyId, fileId);
    return this.findOne(user, id);
  }

  /**
   * The daily job for one company: renews, expires and terminates contracts whose last day has
   * passed and reminds owners once per term.
   */
  async run(companyId: string, now = today()): Promise<ContractRunResultDto> {
    const candidates = await this.prisma.contract.findMany({
      where: {
        companyId,
        status: ContractStatus.ACTIVE,
        OR: [{ endDate: { not: null } }, { terminatedOn: { not: null } }],
      },
      select: { id: true },
    });
    const result: ContractRunResultDto = { renewed: 0, expired: 0, terminated: 0, reminded: 0 };
    const notices: Notice[] = [];
    for (const { id } of candidates) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        await lockContract(tx, id);
        const row = await tx.contract.findUniqueOrThrow({ where: { id } });
        return this.process(tx, row, now, notices);
      });
      for (const key of outcome) result[key] += 1;
    }
    await this.notify(null, notices);
    return result;
  }

  /** Runs the daily job for every company with active contracts. */
  async runAll(): Promise<void> {
    const companies = await this.prisma.contract.findMany({
      where: { status: ContractStatus.ACTIVE },
      distinct: ['companyId'],
      select: { companyId: true },
    });
    for (const { companyId } of companies) await this.run(companyId);
  }

  /** Settles one locked contract and queues its reminder; returns what happened. */
  private async process(
    tx: PrismaTx,
    row: Contract,
    now: Date,
    notices: Notice[],
    at = new Date(),
  ): Promise<(keyof ContractRunResultDto)[]> {
    const done: (keyof ContractRunResultDto)[] = [];
    if (row.status !== ContractStatus.ACTIVE) return done;
    const outcome = settle(row, now);
    let current = row;
    if (outcome.kind === 'TERMINATE' || outcome.kind === 'EXPIRE') {
      const terminated = outcome.kind === 'TERMINATE';
      await tx.contract.update({
        where: { id: row.id },
        data: { status: terminated ? ContractStatus.TERMINATED : ContractStatus.EXPIRED },
      });
      await tx.contractEvent.create({
        data: {
          contractId: row.id,
          type: terminated ? ContractEventType.TERMINATED : ContractEventType.EXPIRED,
          toValue: toDateOnly(terminated ? row.terminatedOn : row.endDate),
          createdAt: at,
        },
      });
      notices.push({
        userId: row.ownerId,
        contractId: row.id,
        title: terminated
          ? `Sözleşme sona erdi (fesih): ${row.number}`
          : `Sözleşmenin süresi doldu: ${row.number}`,
        body: row.title,
        email: true,
      });
      done.push(terminated ? 'terminated' : 'expired');
      return done;
    }
    if (outcome.kind === 'RENEW') {
      current = await tx.contract.update({
        where: { id: row.id },
        data: {
          endDate: outcome.endDate,
          renewalCount: { increment: outcome.times },
          remindedFor: null,
        },
      });
      await tx.contractEvent.create({
        data: {
          contractId: row.id,
          type: ContractEventType.AUTO_RENEWED,
          fromValue: toDateOnly(row.endDate),
          toValue: toDateOnly(outcome.endDate),
          createdAt: at,
        },
      });
      notices.push({
        userId: row.ownerId,
        contractId: row.id,
        title: `Sözleşme otomatik yenilendi: ${row.number}`,
        body: `${row.title} · yeni bitiş ${trDate(outcome.endDate)}`,
        email: true,
      });
      done.push('renewed');
    }
    if (reminderDue(current, now) && current.endDate) {
      await tx.contract.update({ where: { id: row.id }, data: { remindedFor: current.endDate } });
      await tx.contractEvent.create({
        data: {
          contractId: row.id,
          type: ContractEventType.REMINDER_SENT,
          toValue: toDateOnly(current.endDate),
          createdAt: new Date(at.getTime() + 1),
        },
      });
      const deadline = noticeDeadline(current);
      notices.push({
        userId: current.ownerId,
        contractId: row.id,
        title: current.autoRenew
          ? `Sözleşme yenilenecek: ${current.number}`
          : `Sözleşme bitiyor: ${current.number}`,
        body:
          current.autoRenew && deadline
            ? `${current.title} · ${trDate(current.endDate)} tarihinde ${current.renewalMonths} ay ` +
              `yenilenecek; fesih için son gün ${trDate(deadline)}`
            : `${current.title} · bitiş ${trDate(current.endDate)}`,
        email: true,
      });
      done.push('reminded');
    }
    return done;
  }

  private async lock(tx: PrismaTx, companyId: string, id: string) {
    const row = await tx.contract.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!row) throw new NotFoundException('Contract not found');
    await lockContract(tx, id);
    return tx.contract.findUniqueOrThrow({ where: { id } });
  }

  private async assertParty(
    companyId: string,
    party: ContractParty,
    partnerId: string | null | undefined,
    employeeId: string | null | undefined,
  ) {
    if (party === ContractParty.PARTNER) {
      const found =
        partnerId &&
        (await this.prisma.businessPartner.count({
          where: { id: partnerId, companyId, deletedAt: null },
        }));
      if (!found) throw new BadRequestException('Select the partner of the contract');
    } else {
      const found =
        employeeId &&
        (await this.prisma.employee.count({
          where: { id: employeeId, companyId, deletedAt: null },
        }));
      if (!found) throw new BadRequestException('Select the employee of the contract');
    }
  }

  private async assertOwner(companyId: string, userId: string) {
    const ids = await this.notifications.findUserIdsWithPermission(companyId, OWNER_PERMISSION);
    if (!ids.includes(userId)) {
      throw new BadRequestException('The owner must be able to read contracts');
    }
  }

  /** Notifies everyone but the actor; the daily job (`actorId = null`) also sends e-mail. */
  private async notify(actorId: string | null, notices: Notice[]) {
    if (!notices.length) return;
    const companies = new Map(
      (
        await this.prisma.contract.findMany({
          where: { id: { in: [...new Set(notices.map((n) => n.contractId))] } },
          select: { id: true, companyId: true },
        })
      ).map((c) => [c.id, c.companyId]),
    );
    for (const notice of notices) {
      if (notice.userId === actorId) continue;
      await this.notifications.notify({
        companyId: companies.get(notice.contractId),
        userIds: [notice.userId],
        type: 'contracts.contract',
        title: notice.title,
        body: notice.body,
        link: `/contracts/${notice.contractId}`,
        sendEmail: notice.email ?? false,
      });
    }
  }
}

function assertTerms(c: {
  startDate: Date;
  endDate: Date | null;
  autoRenew: boolean;
  renewalMonths: number | null;
}) {
  if (c.endDate && c.endDate < c.startDate) {
    throw new BadRequestException('The end date is before the start date');
  }
  if (c.autoRenew && (!c.endDate || !c.renewalMonths)) {
    throw new BadRequestException('Automatic renewal needs an end date and a renewal term');
  }
}
