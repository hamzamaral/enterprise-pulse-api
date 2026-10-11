import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseRequestStatus } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { toDateOnly, parseDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { qty, tradeVariantSelect, TradeService, variantLabel } from '../partners/trade.service';
import { WorkflowService } from '../workflow/workflow.service';
import type {
  CancelDocumentDto,
  CreatePurchaseRequestDto,
  PurchaseRequestDetailDto,
  PurchaseRequestDto,
  PurchaseRequestQueryDto,
} from './dto/purchasing.dto';

export const PURCHASE_REQUEST_WORKFLOW = 'PURCHASE_REQUEST';
const SORTABLE = ['number', 'requestDate', 'createdAt'] as const;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const listInclude = {
  department: { select: { name: true } },
  requestedBy: { select: { firstName: true, lastName: true } },
  lines: { select: { quantity: true, estimatedPrice: true } },
  _count: { select: { quotes: true } },
} satisfies Prisma.PurchaseRequestInclude;

const detailInclude = {
  ...listInclude,
  lines: { include: { variant: { select: tradeVariantSelect } }, orderBy: { lineNo: 'asc' } },
  orders: {
    select: { id: true, number: true, orderDate: true, status: true, grandTotal: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PurchaseRequestInclude;

type ListRow = Prisma.PurchaseRequestGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.PurchaseRequestGetPayload<{ include: typeof detailInclude }>;

/**
 * Purchase requests (satın alma talepleri). Anyone who can start workflows may request; the
 * PURCHASE_REQUEST workflow approves or rejects, and buyers (`purchasing:read`) see every request.
 */
@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly workflow: WorkflowService,
    private readonly trade: TradeService,
  ) {}

  async findAll(user: AuthUser, query: PurchaseRequestQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.PurchaseRequestWhereInput = {
      companyId: user.companyId,
      status: query.status,
      ...(this.ownOnly(user, query.mine) && { requestedById: user.id }),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.purchaseRequest.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(user: AuthUser, id: string): Promise<PurchaseRequestDetailDto> {
    const row = await this.prisma.purchaseRequest.findFirst({
      where: { id, companyId: user.companyId },
      include: detailInclude,
    });
    if (!row || (this.ownOnly(user) && row.requestedById !== user.id)) {
      throw new NotFoundException('Purchase request not found');
    }
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreatePurchaseRequestDto): Promise<PurchaseRequestDetailDto> {
    const { companyId } = user;
    const hasWorkflow = await this.prisma.workflowDefinition.count({
      where: { companyId, code: PURCHASE_REQUEST_WORKFLOW, isActive: true },
    });

    const request = await this.prisma.$transaction(async (tx) => {
      const variants = await this.trade.loadVariants(
        tx,
        companyId,
        dto.lines.map((l) => l.variantId),
      );
      if (dto.departmentId) {
        const department = await tx.department.count({
          where: { id: dto.departmentId, companyId },
        });
        if (!department) throw new BadRequestException('Department not found');
      }
      const number = await this.numbering.next(companyId, 'PURCHASE_REQUEST', tx);
      return tx.purchaseRequest.create({
        data: {
          companyId,
          number,
          title: dto.title.trim(),
          requestDate: parseDateOnly(new Date().toISOString().slice(0, 10)),
          neededBy: dto.neededBy ? parseDateOnly(dto.neededBy) : null,
          departmentId: dto.departmentId ?? null,
          notes: dto.notes?.trim() || null,
          requestedById: user.id,
          status: hasWorkflow ? PurchaseRequestStatus.PENDING : PurchaseRequestStatus.APPROVED,
          decidedAt: hasWorkflow ? null : new Date(),
          lines: {
            create: dto.lines.map((line, index) => {
              const variant = line.variantId ? variants.get(line.variantId) : undefined;
              const description =
                line.description?.trim() || (variant ? variantLabel(variant) : '');
              if (!description) {
                throw new BadRequestException(`Line ${index + 1}: description is required`);
              }
              return {
                lineNo: index + 1,
                variantId: variant?.id ?? null,
                description,
                quantity: dec(line.quantity),
                estimatedPrice: line.estimatedPrice === undefined ? null : dec(line.estimatedPrice),
              };
            }),
          },
        },
      });
    });

    if (hasWorkflow) {
      try {
        const instance = await this.workflow.start(user, {
          definitionCode: PURCHASE_REQUEST_WORKFLOW,
          entityId: request.number,
          title: `${request.number} — ${request.title}`,
        });
        await this.prisma.purchaseRequest.update({
          where: { id: request.id },
          data: { workflowInstanceId: instance.id },
        });
      } catch (error) {
        await this.prisma.purchaseRequest.delete({ where: { id: request.id } });
        throw error;
      }
    }
    return this.findOne(user, request.id);
  }

  /** The requester withdraws a pending or approved (not yet ordered) request. */
  async cancel(
    user: AuthUser,
    id: string,
    dto: CancelDocumentDto,
  ): Promise<PurchaseRequestDetailDto> {
    const request = await this.prisma.purchaseRequest.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!request) throw new NotFoundException('Purchase request not found');
    if (request.requestedById !== user.id && !hasPermission(user, 'purchasing:update')) {
      throw new ForbiddenException('Only the requester can cancel this request');
    }
    if (
      request.status !== PurchaseRequestStatus.PENDING &&
      request.status !== PurchaseRequestStatus.APPROVED
    ) {
      throw new ConflictException('Request is already closed');
    }
    if (request.status === PurchaseRequestStatus.PENDING && request.workflowInstanceId) {
      await this.workflow.cancel(user, request.workflowInstanceId, dto.reason);
    }
    await this.prisma.purchaseRequest.updateMany({
      where: {
        id,
        status: { in: [PurchaseRequestStatus.PENDING, PurchaseRequestStatus.APPROVED] },
      },
      data: { status: PurchaseRequestStatus.CANCELLED, decidedAt: new Date() },
    });
    return this.findOne(user, id);
  }

  /** Applies a workflow outcome; only pending requests change, so repeated events are harmless. */
  async decide(companyId: string, number: string, status: PurchaseRequestStatus): Promise<void> {
    await this.prisma.purchaseRequest.updateMany({
      where: { companyId, number, status: PurchaseRequestStatus.PENDING },
      data: { status, decidedAt: new Date() },
    });
  }

  private ownOnly(user: AuthUser, mine?: boolean) {
    return mine || !hasPermission(user, 'purchasing:read');
  }
}

function toDto(row: ListRow): PurchaseRequestDto {
  const estimated = row.lines.reduce(
    (sum, line) => sum.plus(line.quantity.times(line.estimatedPrice ?? 0)),
    dec(0),
  );
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    requestDate: toDateOnly(row.requestDate),
    neededBy: row.neededBy ? toDateOnly(row.neededBy) : null,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    status: row.status,
    requestedById: row.requestedById,
    requestedByName: `${row.requestedBy.firstName} ${row.requestedBy.lastName}`,
    lineCount: row.lines.length,
    estimatedTotal: estimated.toFixed(2),
    quoteCount: row._count.quotes,
    workflowInstanceId: row.workflowInstanceId,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}

function toDetailDto(row: DetailRow): PurchaseRequestDetailDto {
  return {
    ...toDto(row),
    notes: row.notes,
    lines: row.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      variantId: line.variantId,
      productId: line.variant?.productId ?? null,
      sku: line.variant?.sku ?? null,
      unitCode: line.variant?.product.unit.code ?? null,
      description: line.description,
      quantity: qty(line.quantity),
      estimatedPrice: line.estimatedPrice?.toFixed(2) ?? null,
    })),
    orders: row.orders.map((order) => ({
      id: order.id,
      number: order.number,
      date: toDateOnly(order.orderDate),
      status: order.status,
      total: order.grandTotal.toFixed(2),
    })),
  };
}
