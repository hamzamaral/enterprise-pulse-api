import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductType, TrackingType } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { money, qty, unitCost } from '../inventory/stock-math';
import type {
  BomDetailDto,
  BomDto,
  BomLineInputDto,
  BomPlanDto,
  BomPlanQueryDto,
  BomQueryDto,
  CreateBomDto,
  UpdateBomDto,
} from './dto/production.dto';
import {
  defaultBoms,
  fullName,
  onHandByVariant,
  trimOrNull,
  variantFields,
  variantLabel,
  variantSelect,
  type VariantRow,
} from './production-helpers';
import {
  availability,
  buildable,
  createsCycle,
  explode,
  perUnit,
  rollUpCost,
  ZERO,
  type BomShape,
} from './production-math';

type Dec = Prisma.Decimal;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const SORTABLE = ['code', 'name', 'updatedAt', 'createdAt'] as const;

const listInclude = {
  variant: { select: variantSelect },
  lines: { select: { variantId: true, quantity: true, scrapRate: true } },
  _count: { select: { workOrders: true } },
} satisfies Prisma.BillOfMaterialsInclude;

const detailInclude = {
  ...listInclude,
  lines: { include: { variant: { select: variantSelect } }, orderBy: { lineNo: 'asc' } },
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.BillOfMaterialsInclude;

type ListRow = Prisma.BillOfMaterialsGetPayload<{ include: typeof listInclude }>;

/**
 * Unit costs for planning: the moving average cost, else the rolled-up cost of the default BOM,
 * else the purchase price.
 */
export class CostBook {
  private readonly memo = new Map<string, Dec>();

  constructor(
    private readonly variants: Map<string, { averageCost: Dec; purchasePrice: Dec | null }>,
    private readonly boms: Map<string, BomShape>,
  ) {}

  /** Loads the default BOMs and the costs of their variants plus `extra` ones. */
  static async load(client: PrismaService | PrismaTx, companyId: string, extra: string[] = []) {
    const boms = await defaultBoms(client, companyId);
    const ids = new Set(extra);
    for (const bom of boms.values()) {
      ids.add(bom.variantId);
      for (const line of bom.lines) ids.add(line.variantId);
    }
    const rows = await client.productVariant.findMany({
      where: { companyId, id: { in: [...ids] } },
      select: { id: true, averageCost: true, product: { select: { purchasePrice: true } } },
    });
    const variants = new Map(
      rows.map((r) => [
        r.id,
        { averageCost: r.averageCost, purchasePrice: r.product.purchasePrice },
      ]),
    );
    return { boms, book: new CostBook(variants, boms) };
  }

  cost = (variantId: string, trail = new Set<string>()): Dec => {
    const known = this.memo.get(variantId);
    if (known) return known;
    const variant = this.variants.get(variantId);
    let value = variant?.averageCost ?? ZERO;
    const bom = this.boms.get(variantId);
    if (value.isZero() && bom && !trail.has(variantId)) {
      trail.add(variantId);
      value = rollUpCost(bom, (id) => this.cost(id, trail)).unitCost;
      trail.delete(variantId);
    }
    if (value.isZero()) value = variant?.purchasePrice ?? ZERO;
    this.memo.set(variantId, value);
    return value;
  };
}

/** Bills of materials (ürün ağaçları / reçeteler). */
@Injectable()
export class BomsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string, query: BomQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.BillOfMaterialsWhereInput = {
      companyId,
      variantId: query.variantId,
      isActive: query.isActive,
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { variant: { sku: { contains: search, mode: 'insensitive' } } },
          { variant: { product: { name: { contains: search, mode: 'insensitive' } } } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.billOfMaterials.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'code'), { code: 'asc' }],
        ...toPageArgs(query),
      }),
      this.prisma.billOfMaterials.count({ where }),
    ]);
    const { book } = await CostBook.load(
      this.prisma,
      companyId,
      rows.flatMap((r) => r.lines.map((l) => l.variantId)),
    );
    return paginated(
      rows.map((row) => toDto(row, book)),
      total,
      query,
    );
  }

  async findOne(companyId: string, id: string): Promise<BomDetailDto> {
    const row = await this.prisma.billOfMaterials.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Bill of materials not found');
    const componentIds = row.lines.map((l) => l.variantId);
    const [{ boms, book }, onHand] = await Promise.all([
      CostBook.load(this.prisma, companyId, componentIds),
      onHandByVariant(this.prisma, companyId, componentIds),
    ]);
    const cost = rollUpCost(shapeOf(row), book.cost);
    const lines = row.lines.map((line) => {
      const per = perUnit(line, row.quantity);
      const lineUnitCost = book.cost(line.variantId);
      const made = boms.get(line.variantId);
      return {
        id: line.id,
        lineNo: line.lineNo,
        ...variantFields(line.variant),
        quantity: qty(line.quantity),
        scrapRate: line.scrapRate.toFixed(2),
        quantityPer: per.toFixed(),
        unitCost: unitCost(lineUnitCost),
        lineCost: money(
          line.quantity.times(dec(1).plus(line.scrapRate.dividedBy(100))).times(lineUnitCost),
        ),
        onHand: qty(onHand.get(line.variantId)),
        made: Boolean(made),
        madeBomId: made?.id ?? null,
        notes: line.notes,
        per,
      };
    });
    return {
      ...toDto(row, book),
      notes: row.notes,
      materialCost: money(cost.material),
      createdByName: fullName(row.createdBy),
      createdAt: row.createdAt,
      lines: lines.map(({ per: _per, ...line }) => line),
      buildable: buildable(
        lines.map((l) => ({ quantityPer: l.per, available: onHand.get(l.variantId) ?? ZERO })),
      ).toFixed(),
      canDelete: row._count.workOrders === 0,
    };
  }

  /** Net multi-level material plan for making `quantity` with this BOM. */
  async plan(companyId: string, id: string, query: BomPlanQueryDto): Promise<BomPlanDto> {
    const row = await this.prisma.billOfMaterials.findFirst({
      where: { id, companyId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Bill of materials not found');
    if (query.warehouseId) {
      const warehouse = await this.prisma.warehouse.count({
        where: { id: query.warehouseId, companyId },
      });
      if (!warehouse) throw new BadRequestException('Warehouse not found');
    }
    const { boms, book } = await CostBook.load(
      this.prisma,
      companyId,
      row.lines.map((l) => l.variantId),
    );
    const root = shapeOf(row);
    const bomOf = (variantId: string) => (variantId === row.variantId ? root : boms.get(variantId));

    const ids = new Set<string>();
    const collect = (variantId: string, trail: Set<string>) => {
      const bom = bomOf(variantId);
      if (!bom || trail.has(variantId)) return;
      trail.add(variantId);
      for (const line of bom.lines) {
        ids.add(line.variantId);
        collect(line.variantId, trail);
      }
      trail.delete(variantId);
    };
    collect(row.variantId, new Set());
    const variantIds = [...ids];
    const [stock, variants] = await Promise.all([
      onHandByVariant(this.prisma, companyId, variantIds, query.warehouseId),
      this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: variantSelect,
      }),
    ]);
    const byId = new Map(variants.map((v) => [v.id, v]));
    const lines = explode(row.variantId, query.quantity, bomOf, stock);

    const output = dec(query.quantity);
    const batches = output.dividedBy(row.quantity);
    const material = rollUpCost(root, book.cost).material.times(batches);
    const labor = row.laborCost.times(batches);
    const overhead = row.overheadCost.times(batches);
    return {
      quantity: qty(output),
      materialCost: money(material),
      laborCost: money(labor),
      overheadCost: money(overhead),
      totalCost: money(material.plus(labor).plus(overhead)),
      lines: lines.map((line) => {
        const variant = byId.get(line.variantId)!;
        return {
          level: line.level,
          variantId: line.variantId,
          parentId: line.parentId,
          sku: variant.sku,
          name: variantLabel(variant),
          unitCode: variant.product.unit.code,
          required: qty(line.quantity),
          onHand: qty(stock.get(line.variantId)),
          shortage: qty(line.shortage),
          made: line.made,
          availability: availability(line.quantity, line.allocated),
        };
      }),
    };
  }

  async create(user: AuthUser, dto: CreateBomDto): Promise<BomDetailDto> {
    const { companyId } = user;
    const id = await this.prisma.$transaction(async (tx) => {
      const output = await this.loadOutput(tx, companyId, dto.variantId);
      await this.validateLines(tx, companyId, output.id, dto.lines);
      const code = dto.code?.trim().toUpperCase() || (await this.nextCode(tx, companyId, output));
      await this.assertCodeFree(tx, companyId, code);
      const hasDefault = await tx.billOfMaterials.count({
        where: { companyId, variantId: output.id, isDefault: true, isActive: true },
      });
      const isDefault = !hasDefault || dto.isDefault === true;
      if (isDefault) await this.clearDefault(tx, companyId, output.id);
      const bom = await tx.billOfMaterials.create({
        data: {
          companyId,
          code,
          name: dto.name.trim(),
          variantId: output.id,
          quantity: dto.quantity ?? 1,
          laborCost: dto.laborCost ?? 0,
          overheadCost: dto.overheadCost ?? 0,
          isDefault,
          notes: trimOrNull(dto.notes) ?? null,
          createdById: user.id,
          lines: { create: lineData(dto.lines) },
        },
      });
      return bom.id;
    });
    return this.findOne(companyId, id);
  }

  async update(user: AuthUser, id: string, dto: UpdateBomDto): Promise<BomDetailDto> {
    const { companyId } = user;
    await this.prisma.$transaction(async (tx) => {
      const bom = await tx.billOfMaterials.findFirst({ where: { id, companyId } });
      if (!bom) throw new NotFoundException('Bill of materials not found');
      if (dto.lines) await this.validateLines(tx, companyId, bom.variantId, dto.lines, bom.id);
      const code = dto.code?.trim().toUpperCase();
      if (code && code !== bom.code) await this.assertCodeFree(tx, companyId, code);

      const isActive = dto.isActive ?? bom.isActive;
      if (dto.isDefault && !isActive) {
        throw new BadRequestException('An inactive bill of materials cannot be the default');
      }
      let isDefault = isActive && (dto.isDefault ?? bom.isDefault);
      if (isDefault && !bom.isDefault) await this.clearDefault(tx, companyId, bom.variantId);
      if (!isDefault && isActive && dto.isDefault === undefined) isDefault = bom.isDefault;

      await tx.billOfMaterials.update({
        where: { id },
        data: {
          code,
          name: dto.name?.trim(),
          quantity: dto.quantity,
          laborCost: dto.laborCost,
          overheadCost: dto.overheadCost,
          notes: trimOrNull(dto.notes),
          isActive,
          isDefault,
          ...(dto.lines && { lines: { deleteMany: {}, create: lineData(dto.lines) } }),
        },
      });
      if (bom.isDefault && !isDefault) await this.promoteDefault(tx, companyId, bom.variantId, id);
    });
    return this.findOne(companyId, id);
  }

  /** BOMs that work orders used are kept; deactivate them instead. */
  async remove(companyId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const bom = await tx.billOfMaterials.findFirst({
        where: { id, companyId },
        include: { _count: { select: { workOrders: true } } },
      });
      if (!bom) throw new NotFoundException('Bill of materials not found');
      if (bom._count.workOrders) {
        throw new ConflictException(
          'Work orders use this bill of materials; deactivate it instead',
        );
      }
      await tx.billOfMaterials.delete({ where: { id } });
      if (bom.isDefault) await this.promoteDefault(tx, companyId, bom.variantId, id);
    });
  }

  // ---------- helpers ----------

  private async loadOutput(tx: PrismaTx, companyId: string, variantId: string) {
    const variant = await tx.productVariant.findFirst({
      where: { id: variantId, companyId },
      select: variantSelect,
    });
    if (!variant) throw new BadRequestException('Product not found');
    assertProducible(variant, 'The product');
    return variant;
  }

  private async validateLines(
    tx: PrismaTx,
    companyId: string,
    outputId: string,
    lines: BomLineInputDto[],
    bomId?: string,
  ) {
    const ids = lines.map((l) => l.variantId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('A component can be listed only once');
    }
    if (ids.includes(outputId)) {
      throw new BadRequestException('A product cannot be its own component');
    }
    const variants = await tx.productVariant.findMany({
      where: { id: { in: ids }, companyId },
      select: variantSelect,
    });
    if (variants.length !== ids.length) throw new BadRequestException('Component not found');
    for (const variant of variants) assertProducible(variant, variant.sku);

    const others = await tx.billOfMaterials.findMany({
      where: { companyId, isActive: true, ...(bomId && { id: { not: bomId } }) },
      select: { variantId: true, lines: { select: { variantId: true } } },
    });
    const graph = new Map<string, string[]>();
    for (const other of others) {
      graph.set(other.variantId, [
        ...(graph.get(other.variantId) ?? []),
        ...other.lines.map((l) => l.variantId),
      ]);
    }
    if (createsCycle(outputId, ids, (v) => graph.get(v) ?? [])) {
      throw new BadRequestException(
        'A component is made from this product; the bill of materials would loop',
      );
    }
  }

  private async nextCode(tx: PrismaTx, companyId: string, output: VariantRow) {
    for (let n = 1; ; n++) {
      const code = `${output.sku}-R${n}`.toUpperCase();
      const taken = await tx.billOfMaterials.count({ where: { companyId, code } });
      if (!taken) return code;
    }
  }

  private async assertCodeFree(tx: PrismaTx, companyId: string, code: string) {
    const taken = await tx.billOfMaterials.count({ where: { companyId, code } });
    if (taken) throw new ConflictException(`Bill of materials code ${code} is already used`);
  }

  private clearDefault(tx: PrismaTx, companyId: string, variantId: string) {
    return tx.billOfMaterials.updateMany({
      where: { companyId, variantId, isDefault: true },
      data: { isDefault: false },
    });
  }

  /** Makes the latest other active BOM of the variant the default. */
  private async promoteDefault(tx: PrismaTx, companyId: string, variantId: string, except: string) {
    const next = await tx.billOfMaterials.findFirst({
      where: { companyId, variantId, isActive: true, id: { not: except } },
      orderBy: { updatedAt: 'desc' },
    });
    if (next)
      await tx.billOfMaterials.update({ where: { id: next.id }, data: { isDefault: true } });
  }
}

function assertProducible(variant: VariantRow, label: string) {
  if (variant.product.type !== ProductType.GOODS) {
    throw new BadRequestException(`${label}: services cannot be produced or consumed`);
  }
  if (variant.product.trackingType === TrackingType.SERIAL) {
    throw new BadRequestException(`${label}: serial-tracked items are not supported in production`);
  }
  if (!variant.isActive || !variant.product.isActive || variant.product.deletedAt) {
    throw new BadRequestException(`${label}: item is inactive`);
  }
}

function lineData(lines: BomLineInputDto[]) {
  return lines.map((line, index) => ({
    lineNo: index + 1,
    variantId: line.variantId,
    quantity: line.quantity,
    scrapRate: line.scrapRate ?? 0,
    notes: trimOrNull(line.notes) ?? null,
  }));
}

function shapeOf(row: {
  quantity: Dec;
  laborCost: Dec;
  overheadCost: Dec;
  lines: { variantId: string; quantity: Dec; scrapRate: Dec }[];
}): BomShape {
  return {
    quantity: row.quantity,
    laborCost: row.laborCost,
    overheadCost: row.overheadCost,
    lines: row.lines.map((l) => ({
      variantId: l.variantId,
      quantity: l.quantity,
      scrapRate: l.scrapRate,
    })),
  };
}

function toDto(row: ListRow, book: CostBook): BomDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    ...variantFields(row.variant),
    quantity: qty(row.quantity),
    laborCost: money(row.laborCost),
    overheadCost: money(row.overheadCost),
    isDefault: row.isDefault,
    isActive: row.isActive,
    lineCount: row.lines.length,
    unitCost: unitCost(rollUpCost(shapeOf(row), book.cost).unitCost),
    workOrderCount: row._count.workOrders,
    updatedAt: row.updatedAt,
  };
}
