import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CreateProductCategoryDto,
  CreateWarehouseDto,
  ProductCategoryDto,
  UpdateProductCategoryDto,
  UpdateWarehouseDto,
  WarehouseDto,
} from './dto/catalog.dto';
import { money } from './stock-math';

/** Product categories (a small tree) and warehouses; both lists are returned without pagination. */
@Injectable()
export class InventorySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findCategories(companyId: string): Promise<ProductCategoryDto[]> {
    const rows = await this.prisma.productCategory.findMany({
      where: { companyId },
      include: {
        parent: { select: { name: true } },
        _count: { select: { products: { where: { deletedAt: null } } } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      parentId: row.parentId,
      parentName: row.parent?.name ?? null,
      isActive: row.isActive,
      productCount: row._count.products,
    }));
  }

  async createCategory(
    companyId: string,
    dto: CreateProductCategoryDto,
  ): Promise<ProductCategoryDto> {
    if (dto.parentId) await this.getCategory(companyId, dto.parentId);
    const row = await this.prisma.productCategory.create({ data: { ...dto, companyId } });
    return this.findCategory(companyId, row.id);
  }

  async updateCategory(
    companyId: string,
    id: string,
    dto: UpdateProductCategoryDto,
  ): Promise<ProductCategoryDto> {
    await this.getCategory(companyId, id);
    if (dto.parentId) await this.assertNoCycle(companyId, id, dto.parentId);
    await this.prisma.productCategory.update({ where: { id }, data: dto });
    return this.findCategory(companyId, id);
  }

  async getCategory(companyId: string, id: string) {
    const row = await this.prisma.productCategory.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Product category not found');
    return row;
  }

  async findWarehouses(companyId: string): Promise<WarehouseDto[]> {
    const [rows, totals] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { companyId },
        include: { branch: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.$queryRaw<{ warehouseId: string; items: bigint; value: Prisma.Decimal | null }[]>`
        SELECT b."warehouseId",
               COUNT(*) FILTER (WHERE b.quantity > 0) AS items,
               SUM(b.quantity * v."averageCost") AS value
        FROM stock_balances b
        JOIN product_variants v ON v.id = b."variantId"
        WHERE b."companyId" = ${companyId}::uuid
        GROUP BY b."warehouseId"`,
    ]);
    const byWarehouse = new Map(totals.map((t) => [t.warehouseId, t]));
    return rows.map((row) => {
      const total = byWarehouse.get(row.id);
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        branchId: row.branchId,
        branchName: row.branch?.name ?? null,
        address: row.address,
        isActive: row.isActive,
        itemCount: Number(total?.items ?? 0),
        stockValue: money(total?.value),
      };
    });
  }

  async createWarehouse(companyId: string, dto: CreateWarehouseDto): Promise<WarehouseDto> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);
    const row = await this.prisma.warehouse.create({ data: { ...dto, companyId } });
    return (await this.findWarehouses(companyId)).find((w) => w.id === row.id)!;
  }

  async updateWarehouse(
    companyId: string,
    id: string,
    dto: UpdateWarehouseDto,
  ): Promise<WarehouseDto> {
    await this.getWarehouse(companyId, id);
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);
    if (dto.isActive === false) {
      const stocked = await this.prisma.stockBalance.count({
        where: { warehouseId: id, quantity: { not: 0 } },
      });
      if (stocked) throw new ConflictException('Warehouse still has stock; transfer it first');
    }
    await this.prisma.warehouse.update({ where: { id }, data: dto });
    return (await this.findWarehouses(companyId)).find((w) => w.id === id)!;
  }

  /** Active warehouse of the company, used when posting movements. */
  async getWarehouse(companyId: string, id: string, { activeOnly = false } = {}) {
    const row = await this.prisma.warehouse.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Warehouse not found');
    if (activeOnly && !row.isActive) {
      throw new BadRequestException(`Warehouse ${row.code} is inactive`);
    }
    return row;
  }

  private async findCategory(companyId: string, id: string): Promise<ProductCategoryDto> {
    return (await this.findCategories(companyId)).find((c) => c.id === id)!;
  }

  private async assertNoCycle(companyId: string, id: string, parentId: string) {
    const rows = await this.prisma.productCategory.findMany({
      where: { companyId },
      select: { id: true, parentId: true },
    });
    const parents = new Map(rows.map((r) => [r.id, r.parentId]));
    if (!parents.has(parentId)) throw new NotFoundException('Parent category not found');
    for (let cursor: string | null | undefined = parentId; cursor; cursor = parents.get(cursor)) {
      if (cursor === id) throw new BadRequestException('A category cannot be its own ancestor');
    }
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, companyId } });
    if (!branch) throw new NotFoundException('Branch not found');
  }
}
