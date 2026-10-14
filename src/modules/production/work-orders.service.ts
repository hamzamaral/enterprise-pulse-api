import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovementType, TrackingType, WorkOrderStatus } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { MovementLineInputDto } from '../inventory/dto/stock.dto';
import { money, qty, unitCost } from '../inventory/stock-math';
import { StockMovementsService, type LowStockItem } from '../inventory/stock-movements.service';
import { NumberingService } from '../numbering/numbering.service';
import { CostBook } from './boms.service';
import type {
  CreateProductionRecordDto,
  CreateWorkOrderDto,
  ProductionRecordDto,
  UpdateWorkOrderDto,
  WorkOrderDetailDto,
  WorkOrderQueryDto,
} from './dto/production.dto';
import {
  fullName,
  onHandByVariant,
  productionToday,
  toWorkOrderDto,
  trimOrNull,
  variantFields,
  variantSelect,
  workOrderInclude,
  type VariantRow,
} from './production-helpers';
import {
  availability,
  buildable,
  canCancel,
  canComplete,
  canEdit,
  canRecord,
  canRelease,
  costPerUnit,
  OPEN_STATUSES,
  perUnit,
  required,
  standardConsumption,
  ZERO,
} from './production-math';

type Dec = Prisma.Decimal;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const SORTABLE = ['number', 'plannedStart', 'plannedEnd', 'createdAt'] as const;

const detailInclude = {
  ...workOrderInclude,
  createdBy: { select: { firstName: true, lastName: true } },
  components: { include: { variant: { select: variantSelect } }, orderBy: { lineNo: 'asc' } },
  records: {
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      issueMovement: { select: { number: true } },
      receiptMovement: {
        select: { number: true, lines: { select: { lot: { select: { lotNo: true } } } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.WorkOrderInclude;

type DetailRow = Prisma.WorkOrderGetPayload<{ include: typeof detailInclude }>;

/**
 * Work orders (iş emirleri). The material list is copied from the BOM when the order is planned;
 * production records issue the materials from the source warehouse and receive the product into
 * the target warehouse at material + labour + overhead cost.
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly stock: StockMovementsService,
  ) {}

  async findAll(companyId: string, query: WorkOrderQueryDto) {
    const search = query.search?.trim();
    const today = productionToday();
    const where: Prisma.WorkOrderWhereInput = {
      companyId,
      variantId: query.variantId,
      bomId: query.bomId,
      AND: [
        query.status ? { status: query.status } : {},
        query.open || query.late ? { status: { in: OPEN_STATUSES } } : {},
        query.late ? { plannedEnd: { lt: today } } : {},
      ],
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { reference: { contains: search, mode: 'insensitive' } },
          { variant: { sku: { contains: search, mode: 'insensitive' } } },
          { variant: { product: { name: { contains: search, mode: 'insensitive' } } } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        include: workOrderInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.workOrder.count({ where }),
    ]);
    return paginated(
      rows.map((row) => toWorkOrderDto(row, today)),
      total,
      query,
    );
  }

  async findOne(companyId: string, id: string): Promise<WorkOrderDetailDto> {
    const row = await this.prisma.workOrder.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Work order not found');
    return this.toDetail(row);
  }

  async create(user: AuthUser, dto: CreateWorkOrderDto): Promise<WorkOrderDetailDto> {
    const { companyId } = user;
    const id = await this.prisma.$transaction(async (tx) => {
      const bom = await tx.billOfMaterials.findFirst({
        where: { id: dto.bomId, companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } }, variant: { select: variantSelect } },
      });
      if (!bom) throw new BadRequestException('Bill of materials not found');
      if (!bom.isActive) throw new BadRequestException('The bill of materials is inactive');
      assertActive(bom.variant);
      await this.checkPlan(tx, companyId, dto);
      const quantity = dec(dto.quantity);
      const number = await this.numbering.next(companyId, 'WORK_ORDER', tx);
      const order = await tx.workOrder.create({
        data: {
          companyId,
          number,
          bomId: bom.id,
          variantId: bom.variantId,
          quantity,
          plannedStart: parseDateOnly(dto.plannedStart),
          plannedEnd: parseDateOnly(dto.plannedEnd),
          sourceWarehouseId: dto.sourceWarehouseId,
          targetWarehouseId: dto.targetWarehouseId,
          laborPerUnit: costPerUnit(bom.laborCost, bom.quantity),
          overheadPerUnit: costPerUnit(bom.overheadCost, bom.quantity),
          reference: trimOrNull(dto.reference) ?? null,
          notes: trimOrNull(dto.notes) ?? null,
          createdById: user.id,
          components: {
            create: bom.lines.map((line) => {
              const quantityPer = perUnit(line, bom.quantity);
              return {
                lineNo: line.lineNo,
                variantId: line.variantId,
                quantityPer,
                requiredQty: required(quantityPer, quantity),
              };
            }),
          },
        },
      });
      return order.id;
    });
    return this.findOne(companyId, id);
  }

  /** Drafts only: quantity, dates, warehouses and notes. */
  async update(user: AuthUser, id: string, dto: UpdateWorkOrderDto): Promise<WorkOrderDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lock(tx, companyId, id);
      if (!canEdit(order.status))
        throw new ConflictException('Only draft work orders can be changed');
      await this.checkPlan(tx, companyId, {
        plannedStart: dto.plannedStart ?? toDateOnly(order.plannedStart),
        plannedEnd: dto.plannedEnd ?? toDateOnly(order.plannedEnd),
        sourceWarehouseId: dto.sourceWarehouseId ?? order.sourceWarehouseId,
        targetWarehouseId: dto.targetWarehouseId ?? order.targetWarehouseId,
      });
      await tx.workOrder.update({
        where: { id },
        data: {
          quantity: dto.quantity,
          plannedStart: dto.plannedStart ? parseDateOnly(dto.plannedStart) : undefined,
          plannedEnd: dto.plannedEnd ? parseDateOnly(dto.plannedEnd) : undefined,
          sourceWarehouseId: dto.sourceWarehouseId,
          targetWarehouseId: dto.targetWarehouseId,
          reference: trimOrNull(dto.reference),
          notes: trimOrNull(dto.notes),
        },
      });
      if (dto.quantity !== undefined) {
        const components = await tx.workOrderComponent.findMany({ where: { workOrderId: id } });
        for (const c of components) {
          await tx.workOrderComponent.update({
            where: { id: c.id },
            data: { requiredQty: required(c.quantityPer, dto.quantity) },
          });
        }
      }
    });
    return this.findOne(companyId, id);
  }

  /** Hands a draft to the shop floor; production can be recorded from now on. */
  release(user: AuthUser, id: string) {
    return this.transition(user, id, canRelease, 'Only draft work orders can be released', {
      status: WorkOrderStatus.RELEASED,
      releasedAt: new Date(),
    });
  }

  /** Drafts and released orders without output. */
  cancel(user: AuthUser, id: string) {
    return this.transition(
      user,
      id,
      (status, produced) => canCancel(status, produced),
      'Only draft or released work orders without production can be cancelled',
      { status: WorkOrderStatus.CANCELLED, cancelledAt: new Date() },
    );
  }

  /** Closes an order in progress short of its planned quantity. */
  complete(user: AuthUser, id: string) {
    return this.transition(user, id, canComplete, 'Only work orders in progress can be completed', {
      status: WorkOrderStatus.COMPLETED,
      completedAt: new Date(),
    });
  }

  /**
   * Üretim fişi: issues the materials (FEFO lots for lot-tracked components) and receives the
   * output at material + labour + overhead cost, in one transaction.
   */
  async record(
    user: AuthUser,
    id: string,
    dto: CreateProductionRecordDto,
  ): Promise<WorkOrderDetailDto> {
    const { companyId } = user;
    const lowStock = await this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, companyId, id);
        const order = await tx.workOrder.findUniqueOrThrow({
          where: { id },
          include: {
            variant: { select: variantSelect },
            components: {
              include: { variant: { select: variantSelect } },
              orderBy: { lineNo: 'asc' },
            },
          },
        });
        if (!canRecord(order.status)) {
          throw new ConflictException('Production can only be recorded on released work orders');
        }
        const output = dec(dto.quantity);
        const remaining = order.quantity.minus(order.producedQty);
        if (output.gt(remaining)) {
          throw new BadRequestException(`At most ${qty(remaining)} can still be produced`);
        }
        const lotTracked = order.variant.product.trackingType === TrackingType.LOT;
        if (!lotTracked && (dto.lotNo || dto.expiryDate)) {
          throw new BadRequestException('The product is not lot tracked');
        }
        const overrides = new Map(
          (dto.components ?? []).map((c) => [c.variantId, dec(c.quantity)]),
        );
        for (const variantId of overrides.keys()) {
          if (!order.components.some((c) => c.variantId === variantId)) {
            throw new BadRequestException('A component is not part of this work order');
          }
        }
        const finishes = output.eq(remaining) || dto.finish === true;
        const uses = order.components.map((component) => ({
          component,
          quantity:
            overrides.get(component.variantId) ??
            standardConsumption({
              quantityPer: component.quantityPer,
              requiredQty: component.requiredQty,
              consumedQty: component.consumedQty,
              output,
              finishes,
            }),
        }));

        const recordDate = dto.recordDate ?? toDateOnly(productionToday());
        const number = await this.numbering.next(companyId, 'PRODUCTION', tx);
        const notes = `İş emri ${order.number} — üretim fişi ${number}`;

        const issueLines: MovementLineInputDto[] = [];
        for (const use of uses.filter((u) => u.quantity.gt(0))) {
          issueLines.push(
            ...(use.component.variant.product.trackingType === TrackingType.LOT
              ? await this.allocateLots(
                  tx,
                  order.sourceWarehouseId,
                  use.component.variant,
                  use.quantity,
                )
              : [{ variantId: use.component.variantId, quantity: use.quantity.toNumber() }]),
          );
        }
        let issue: { movementId: string; lowStock: LowStockItem[] } | null = null;
        let materialCost = ZERO;
        if (issueLines.length) {
          issue = await this.stock.post(tx, user, {
            type: StockMovementType.ISSUE,
            movementDate: recordDate,
            sourceWarehouseId: order.sourceWarehouseId,
            reference: order.number,
            notes,
            lines: issueLines,
          });
          const lines = await tx.stockMovementLine.findMany({
            where: { movementId: issue.movementId },
            select: { quantity: true, unitCost: true },
          });
          materialCost = lines
            .reduce((sum, l) => sum.plus(l.quantity.times(l.unitCost ?? 0)), ZERO)
            .toDecimalPlaces(2);
        }
        const laborCost = order.laborPerUnit.times(output).toDecimalPlaces(2);
        const overheadCost = order.overheadPerUnit.times(output).toDecimalPlaces(2);
        const total = materialCost.plus(laborCost).plus(overheadCost);
        const cost = total.dividedBy(output).toDecimalPlaces(4);

        const receipt = await this.stock.post(tx, user, {
          type: StockMovementType.RECEIPT,
          movementDate: recordDate,
          targetWarehouseId: order.targetWarehouseId,
          reference: order.number,
          notes,
          lines: [
            {
              variantId: order.variantId,
              quantity: output.toNumber(),
              unitCost: cost.toNumber(),
              ...(lotTracked && {
                lotNo: dto.lotNo?.trim() || order.number,
                expiryDate: dto.expiryDate,
              }),
            },
          ],
        });

        await tx.productionRecord.create({
          data: {
            companyId,
            workOrderId: id,
            number,
            recordDate: parseDateOnly(recordDate),
            quantity: output,
            materialCost,
            laborCost,
            overheadCost,
            unitCost: cost,
            issueMovementId: issue?.movementId ?? null,
            receiptMovementId: receipt.movementId,
            notes: trimOrNull(dto.notes) ?? null,
            createdById: user.id,
          },
        });
        for (const use of uses) {
          if (use.quantity.isZero()) continue;
          await tx.workOrderComponent.update({
            where: { id: use.component.id },
            data: { consumedQty: { increment: use.quantity } },
          });
        }
        await tx.workOrder.update({
          where: { id },
          data: {
            producedQty: { increment: output },
            status: finishes ? WorkOrderStatus.COMPLETED : WorkOrderStatus.IN_PROGRESS,
            startedAt: order.startedAt ?? new Date(),
            ...(finishes && { completedAt: new Date() }),
          },
        });
        return [...(issue?.lowStock ?? []), ...receipt.lowStock];
      },
      { timeout: 30_000 },
    );
    await this.stock.notifyLowStock(companyId, lowStock);
    return this.findOne(companyId, id);
  }

  // ---------- helpers ----------

  private async lock(tx: PrismaTx, companyId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`;
    const order = await tx.workOrder.findFirst({ where: { id, companyId } });
    if (!order) throw new NotFoundException('Work order not found');
    return order;
  }

  private async transition(
    user: AuthUser,
    id: string,
    allowed: (status: WorkOrderStatus, produced: Dec) => boolean,
    message: string,
    data: Prisma.WorkOrderUpdateInput,
  ): Promise<WorkOrderDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lock(tx, user.companyId, id);
      if (!allowed(order.status, order.producedQty)) throw new ConflictException(message);
      await tx.workOrder.update({ where: { id }, data });
    });
    return this.findOne(user.companyId, id);
  }

  private async checkPlan(
    tx: PrismaTx,
    companyId: string,
    plan: {
      plannedStart: string;
      plannedEnd: string;
      sourceWarehouseId: string;
      targetWarehouseId: string;
    },
  ) {
    if (plan.plannedEnd < plan.plannedStart) {
      throw new BadRequestException('The planned end cannot be before the start');
    }
    const ids = [...new Set([plan.sourceWarehouseId, plan.targetWarehouseId])];
    const warehouses = await tx.warehouse.findMany({ where: { id: { in: ids }, companyId } });
    if (warehouses.length !== ids.length) throw new BadRequestException('Warehouse not found');
    const inactive = warehouses.find((w) => !w.isActive);
    if (inactive) throw new BadRequestException(`Warehouse ${inactive.name} is inactive`);
  }

  /** First expiring lots first (FEFO), then by lot number. */
  private async allocateLots(
    tx: PrismaTx,
    warehouseId: string,
    variant: VariantRow,
    quantity: Dec,
  ): Promise<MovementLineInputDto[]> {
    const balances = await tx.lotBalance.findMany({
      where: { warehouseId, quantity: { gt: 0 }, lot: { variantId: variant.id } },
      include: { lot: { select: { lotNo: true, expiryDate: true } } },
    });
    balances.sort(
      (a, b) =>
        (a.lot.expiryDate?.getTime() ?? Infinity) - (b.lot.expiryDate?.getTime() ?? Infinity) ||
        a.lot.lotNo.localeCompare(b.lot.lotNo),
    );
    const lines: MovementLineInputDto[] = [];
    let left = quantity;
    for (const balance of balances) {
      if (left.lte(0)) break;
      const take = Prisma.Decimal.min(balance.quantity, left);
      lines.push({ variantId: variant.id, quantity: take.toNumber(), lotId: balance.lotId });
      left = left.minus(take);
    }
    if (left.gt(0)) {
      throw new BadRequestException(`Insufficient stock of ${variant.sku} in the source warehouse`);
    }
    return lines;
  }

  private async toDetail(row: DetailRow): Promise<WorkOrderDetailDto> {
    const componentIds = row.components.map((c) => c.variantId);
    const [onHand, { book }] = await Promise.all([
      onHandByVariant(this.prisma, row.companyId, componentIds, row.sourceWarehouseId),
      CostBook.load(this.prisma, row.companyId, componentIds),
    ]);
    const open = OPEN_STATUSES.includes(row.status);
    const components = row.components.map((c) => {
      const remaining = Prisma.Decimal.max(c.requiredQty.minus(c.consumedQty), ZERO);
      const stock = onHand.get(c.variantId) ?? ZERO;
      return {
        id: c.id,
        lineNo: c.lineNo,
        ...variantFields(c.variant),
        quantityPer: c.quantityPer.toFixed(),
        requiredQty: qty(c.requiredQty),
        consumedQty: qty(c.consumedQty),
        remainingQty: qty(remaining),
        onHand: qty(stock),
        availability: open ? availability(remaining, stock) : ('OK' as const),
        lotTracked: c.variant.product.trackingType === TrackingType.LOT,
      };
    });
    const material = row.components.reduce(
      (sum, c) => sum.plus(c.quantityPer.times(book.cost(c.variantId))),
      ZERO,
    );
    const produced = row.records.reduce((sum, r) => sum.plus(r.quantity), ZERO);
    const totalCost = row.records.reduce(
      (sum, r) => sum.plus(r.materialCost).plus(r.laborCost).plus(r.overheadCost),
      ZERO,
    );
    const left = row.quantity.minus(row.producedQty);
    const units = buildable(
      row.components.map((c) => ({
        quantityPer: c.quantityPer,
        available: onHand.get(c.variantId) ?? ZERO,
      })),
    );
    return {
      ...toWorkOrderDto(row),
      notes: row.notes,
      laborPerUnit: unitCost(row.laborPerUnit),
      overheadPerUnit: unitCost(row.overheadPerUnit),
      standardUnitCost: unitCost(material.plus(row.laborPerUnit).plus(row.overheadPerUnit)),
      actualUnitCost: produced.gt(0) ? unitCost(totalCost.dividedBy(produced)) : null,
      lotTracked: row.variant.product.trackingType === TrackingType.LOT,
      createdByName: fullName(row.createdBy),
      releasedAt: row.releasedAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      cancelledAt: row.cancelledAt,
      components,
      records: row.records.map(toRecordDto),
      buildable: (open
        ? Prisma.Decimal.min(units, Prisma.Decimal.max(left, ZERO))
        : ZERO
      ).toFixed(),
      canEdit: canEdit(row.status),
      canRelease: canRelease(row.status),
      canRecord: canRecord(row.status),
      canCancel: canCancel(row.status, row.producedQty),
      canComplete: canComplete(row.status),
    };
  }
}

function assertActive(variant: VariantRow) {
  if (!variant.isActive || !variant.product.isActive || variant.product.deletedAt) {
    throw new BadRequestException(`${variant.sku}: item is inactive`);
  }
}

function toRecordDto(row: DetailRow['records'][number]): ProductionRecordDto {
  const total = row.materialCost.plus(row.laborCost).plus(row.overheadCost);
  return {
    id: row.id,
    number: row.number,
    recordDate: toDateOnly(row.recordDate),
    quantity: qty(row.quantity),
    materialCost: money(row.materialCost),
    laborCost: money(row.laborCost),
    overheadCost: money(row.overheadCost),
    totalCost: money(total),
    unitCost: unitCost(row.unitCost),
    issueMovementId: row.issueMovementId,
    issueMovementNumber: row.issueMovement?.number ?? null,
    receiptMovementId: row.receiptMovementId,
    receiptMovementNumber: row.receiptMovement.number,
    lotNo: row.receiptMovement.lines[0]?.lot?.lotNo ?? null,
    notes: row.notes,
    createdByName: fullName(row.createdBy),
    createdAt: row.createdAt,
  };
}
