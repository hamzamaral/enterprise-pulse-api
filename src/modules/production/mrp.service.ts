import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, PurchaseOrderStatus, SalesOrderStatus, WorkOrderStatus } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { toDateOnly } from '../../common/dates/date-only';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { qty } from '../inventory/stock-math';
import { PurchaseRequestsService } from '../purchasing/purchase-requests.service';
import type {
  CreatedDocumentDto,
  CreateRequirementRequestDto,
  ProductionSummaryDto,
  RequirementDto,
  RequirementOrderDto,
} from './dto/production.dto';
import {
  defaultBoms,
  onHandByVariant,
  productionToday,
  toWorkOrderDto,
  variantFields,
  variantSelect,
  workOrderInclude,
} from './production-helpers';
import { netRequirement, OPEN_STATUSES, ZERO } from './production-math';

type Dec = Prisma.Decimal;

interface Demand {
  production: Dec;
  sales: Dec;
  productionIncoming: Dec;
  neededBy: Date | null;
  workOrders: RequirementOrderDto[];
  salesOrders: RequirementOrderDto[];
}

const positive = (value: Dec) => Prisma.Decimal.max(value, ZERO);
const earliest = (a: Date | null, b: Date) => (a && a.getTime() <= b.getTime() ? a : b);

/** Malzeme ihtiyaç planlaması (MRP) and the production dashboard. */
@Injectable()
export class MrpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: PurchaseRequestsService,
  ) {}

  /**
   * Net requirements of every item that open work orders consume and of every made product that
   * approved sales orders still wait for. Shortages first, then by the date they are needed.
   */
  async requirements(companyId: string): Promise<RequirementDto[]> {
    const [orders, boms] = await Promise.all([
      this.prisma.workOrder.findMany({
        where: { companyId, status: { in: OPEN_STATUSES } },
        include: { components: true },
        orderBy: [{ plannedStart: 'asc' }, { number: 'asc' }],
      }),
      defaultBoms(this.prisma, companyId),
    ]);
    const demands = new Map<string, Demand>();
    const demandOf = (variantId: string) => {
      let demand = demands.get(variantId);
      if (!demand) {
        demand = {
          production: ZERO,
          sales: ZERO,
          productionIncoming: ZERO,
          neededBy: null,
          workOrders: [],
          salesOrders: [],
        };
        demands.set(variantId, demand);
      }
      return demand;
    };

    const output = new Map<string, Dec>();
    for (const order of orders) {
      output.set(
        order.variantId,
        (output.get(order.variantId) ?? ZERO).plus(
          positive(order.quantity.minus(order.producedQty)),
        ),
      );
      for (const component of order.components) {
        const remaining = positive(component.requiredQty.minus(component.consumedQty));
        if (remaining.isZero()) continue;
        const demand = demandOf(component.variantId);
        demand.production = demand.production.plus(remaining);
        demand.neededBy = earliest(demand.neededBy, order.plannedStart);
        demand.workOrders.push({
          id: order.id,
          number: order.number,
          quantity: qty(remaining),
          date: toDateOnly(order.plannedStart),
        });
      }
    }

    const salesLines = await this.prisma.salesOrderLine.findMany({
      where: {
        variantId: { in: [...boms.keys()] },
        order: {
          companyId,
          status: { in: [SalesOrderStatus.APPROVED, SalesOrderStatus.PARTIALLY_DELIVERED] },
        },
      },
      include: {
        order: { select: { id: true, number: true, orderDate: true, deliveryDate: true } },
      },
      orderBy: { order: { orderDate: 'asc' } },
    });
    for (const line of salesLines) {
      const remaining = positive(line.quantity.minus(line.deliveredQty));
      if (remaining.isZero()) continue;
      const demand = demandOf(line.variantId);
      const date = line.order.deliveryDate ?? line.order.orderDate;
      demand.sales = demand.sales.plus(remaining);
      demand.neededBy = earliest(demand.neededBy, date);
      demand.salesOrders.push({
        id: line.order.id,
        number: line.order.number,
        quantity: qty(remaining),
        date: toDateOnly(date),
      });
    }
    for (const [variantId, quantity] of output) {
      if (demands.has(variantId)) demandOf(variantId).productionIncoming = quantity;
    }

    const ids = [...demands.keys()];
    if (!ids.length) return [];
    const [onHand, purchaseLines, variants] = await Promise.all([
      onHandByVariant(this.prisma, companyId, ids),
      this.prisma.purchaseOrderLine.findMany({
        where: {
          variantId: { in: ids },
          order: {
            companyId,
            status: { in: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
          },
        },
        select: { variantId: true, quantity: true, receivedQty: true },
      }),
      this.prisma.productVariant.findMany({ where: { id: { in: ids } }, select: variantSelect }),
    ]);
    const incoming = new Map<string, Dec>();
    for (const line of purchaseLines) {
      incoming.set(
        line.variantId,
        (incoming.get(line.variantId) ?? ZERO).plus(
          positive(line.quantity.minus(line.receivedQty)),
        ),
      );
    }

    return variants
      .map((variant) => {
        const demand = demands.get(variant.id)!;
        const gross = demand.production.plus(demand.sales);
        const stock = onHand.get(variant.id) ?? ZERO;
        const purchaseIncoming = incoming.get(variant.id) ?? ZERO;
        const shortage = netRequirement({
          gross,
          onHand: stock,
          incoming: purchaseIncoming.plus(demand.productionIncoming),
        });
        const bom = boms.get(variant.id);
        return {
          ...variantFields(variant),
          productionDemand: qty(demand.production),
          salesDemand: qty(demand.sales),
          gross: qty(gross),
          onHand: qty(stock),
          purchaseIncoming: qty(purchaseIncoming),
          productionIncoming: qty(demand.productionIncoming),
          shortage: qty(shortage),
          neededBy: demand.neededBy ? toDateOnly(demand.neededBy) : null,
          made: Boolean(bom),
          defaultBomId: bom?.id ?? null,
          purchasePrice: variant.product.purchasePrice?.toFixed(2) ?? null,
          workOrders: demand.workOrders,
          salesOrders: demand.salesOrders,
          short: shortage.gt(0),
        };
      })
      .sort(
        (a, b) =>
          Number(b.short) - Number(a.short) ||
          (a.neededBy ?? '9999').localeCompare(b.neededBy ?? '9999') ||
          a.sku.localeCompare(b.sku),
      )
      .map(({ short: _short, ...row }) => row);
  }

  /** Turns shortages of bought items into one purchase request. */
  async createPurchaseRequest(
    user: AuthUser,
    dto: CreateRequirementRequestDto,
  ): Promise<CreatedDocumentDto> {
    const ids = dto.lines.map((l) => l.variantId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('An item can be listed only once');
    }
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: ids }, companyId: user.companyId },
      select: variantSelect,
    });
    if (variants.length !== ids.length) throw new BadRequestException('Item not found');
    const prices = new Map(variants.map((v) => [v.id, v.product.purchasePrice]));
    const request = await this.requests.create(user, {
      title: 'Üretim malzeme ihtiyacı (MRP)',
      neededBy: dto.neededBy,
      notes: 'Malzeme ihtiyaç planlamasındaki eksiklerden oluşturuldu.',
      lines: dto.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        estimatedPrice: prices.get(line.variantId)?.toNumber(),
      })),
    });
    return { id: request.id, number: request.number };
  }

  async summary(companyId: string): Promise<ProductionSummaryDto> {
    const today = productionToday();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const [statuses, late, completed, records, activeBoms, upcoming, requirements] =
      await Promise.all([
        this.prisma.workOrder.groupBy({
          by: ['status'],
          where: { companyId, status: { in: OPEN_STATUSES } },
          _count: true,
        }),
        this.prisma.workOrder.count({
          where: { companyId, status: { in: OPEN_STATUSES }, plannedEnd: { lt: today } },
        }),
        this.prisma.workOrder.count({
          where: {
            companyId,
            status: WorkOrderStatus.COMPLETED,
            completedAt: { gte: monthStart },
          },
        }),
        this.prisma.productionRecord.aggregate({
          where: { companyId, recordDate: { gte: monthStart } },
          _sum: { materialCost: true, laborCost: true, overheadCost: true },
        }),
        this.prisma.billOfMaterials.count({ where: { companyId, isActive: true } }),
        this.prisma.workOrder.findMany({
          where: { companyId, status: { in: OPEN_STATUSES } },
          include: workOrderInclude,
          orderBy: [{ plannedStart: 'asc' }, { number: 'asc' }],
          take: 5,
        }),
        this.requirements(companyId),
      ]);
    const count = (status: WorkOrderStatus) =>
      statuses.find((s) => s.status === status)?._count ?? 0;
    const value = [records._sum.materialCost, records._sum.laborCost, records._sum.overheadCost]
      .reduce<Dec>((sum, v) => sum.plus(v ?? ZERO), ZERO)
      .toFixed(2);
    return {
      activeBoms,
      draft: count(WorkOrderStatus.DRAFT),
      released: count(WorkOrderStatus.RELEASED),
      inProgress: count(WorkOrderStatus.IN_PROGRESS),
      late,
      completedThisMonth: completed,
      producedValueThisMonth: value,
      shortages: requirements.filter((r) => Number(r.shortage) > 0).length,
      upcoming: upcoming.map((row) => toWorkOrderDto(row, today)),
    };
  }
}
