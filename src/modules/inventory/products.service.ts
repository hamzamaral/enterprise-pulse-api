import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CreateProductDto,
  CreateVariantDto,
  ProductDetailDto,
  ProductDto,
  ProductQueryDto,
  UpdateProductDto,
  UpdateVariantDto,
  VariantDto,
} from './dto/catalog.dto';
import type { StockItemDto, StockItemQueryDto } from './dto/stock.dto';
import { money, qty, unitCost } from './stock-math';

const SORTABLE = ['code', 'name', 'createdAt'] as const;

const productInclude = {
  category: { select: { name: true } },
  unit: { select: { code: true } },
  vatRate: { select: { name: true } },
  variants: { orderBy: [{ isDefault: 'desc' }, { sku: 'asc' }] },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
type VariantRow = ProductRow['variants'][number];

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string, query: ProductQueryDto) {
    const where: Prisma.ProductWhereInput = {
      companyId,
      deletedAt: null,
      categoryId: query.categoryId,
      type: query.type,
      isActive: query.isActive,
      ...(query.search && {
        OR: [
          { code: { contains: query.search, mode: 'insensitive' } },
          { name: { contains: query.search, mode: 'insensitive' } },
          {
            variants: {
              some: {
                OR: [
                  { sku: { contains: query.search, mode: 'insensitive' } },
                  { barcode: query.search },
                ],
              },
            },
          },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: toOrderBy(query, SORTABLE, 'code'),
        ...toPageArgs(query),
      }),
      this.prisma.product.count({ where }),
    ]);
    const onHand = await this.onHandByVariant(rows.flatMap((p) => p.variants.map((v) => v.id)));
    return paginated(
      rows.map((row) => toProductDto(row, onHand)),
      total,
      query,
    );
  }

  async findOne(companyId: string, id: string): Promise<ProductDetailDto> {
    const row = await this.get(companyId, id);
    const variantIds = row.variants.map((v) => v.id);
    const [onHand, balances, transactions] = await Promise.all([
      this.onHandByVariant(variantIds),
      this.prisma.stockBalance.findMany({
        where: { variantId: { in: variantIds }, quantity: { not: 0 } },
        include: { warehouse: { select: { name: true } } },
        orderBy: { warehouse: { name: 'asc' } },
      }),
      this.prisma.stockTransaction.count({ where: { variantId: { in: variantIds } } }),
    ]);
    return {
      ...toProductDto(row, onHand),
      description: row.description,
      vatRateId: row.vatRateId,
      vatRateName: row.vatRate?.name ?? null,
      hasTransactions: transactions > 0,
      variants: row.variants.map((v) => toVariantDto(v, onHand)),
      stock: balances.map((b) => ({
        warehouseId: b.warehouseId,
        warehouseName: b.warehouse.name,
        variantId: b.variantId,
        quantity: qty(b.quantity),
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(companyId: string, dto: CreateProductDto): Promise<ProductDetailDto> {
    await this.assertReferences(companyId, dto);
    if (dto.type === ProductType.SERVICE && dto.trackingType && dto.trackingType !== 'NONE') {
      throw new BadRequestException('Services cannot be lot or serial tracked');
    }
    const { barcode, minStock, ...product } = dto;
    const row = await this.prisma.product.create({
      data: {
        ...product,
        companyId,
        variants: {
          create: {
            companyId,
            sku: dto.code,
            barcode: barcode || null,
            minStock: minStock ?? 0,
            isDefault: true,
          },
        },
      },
    });
    return this.findOne(companyId, row.id);
  }

  async update(companyId: string, id: string, dto: UpdateProductDto): Promise<ProductDetailDto> {
    const product = await this.get(companyId, id);
    await this.assertReferences(companyId, dto);
    const lockedChange =
      (dto.type !== undefined && dto.type !== product.type) ||
      (dto.trackingType !== undefined && dto.trackingType !== product.trackingType);
    if (lockedChange && (await this.hasHistory(product.variants.map((v) => v.id)))) {
      throw new ConflictException('Product type and tracking cannot change after stock movements');
    }
    if (dto.type === ProductType.SERVICE && dto.trackingType && dto.trackingType !== 'NONE') {
      throw new BadRequestException('Services cannot be lot or serial tracked');
    }
    await this.prisma.product.update({ where: { id }, data: dto });
    return this.findOne(companyId, id);
  }

  /** Products without any stock history are deleted for good, which also frees their SKUs. */
  async remove(companyId: string, id: string): Promise<void> {
    const product = await this.get(companyId, id);
    const variantIds = product.variants.map((v) => v.id);
    if (await this.hasHistory(variantIds)) {
      throw new ConflictException('Product has stock history; deactivate it instead');
    }
    await this.prisma.$transaction([
      this.prisma.stockBalance.deleteMany({ where: { variantId: { in: variantIds } } }),
      this.prisma.productVariant.deleteMany({ where: { productId: id } }),
      this.prisma.product.delete({ where: { id } }),
    ]);
  }

  async addVariant(
    companyId: string,
    productId: string,
    dto: CreateVariantDto,
  ): Promise<ProductDetailDto> {
    const product = await this.get(companyId, productId);
    if (product.type === ProductType.SERVICE) {
      throw new BadRequestException('Services cannot have variants');
    }
    await this.prisma.productVariant.create({
      data: {
        ...dto,
        attributes: dto.attributes ?? undefined,
        barcode: dto.barcode || null,
        companyId,
        productId,
      },
    });
    return this.findOne(companyId, productId);
  }

  async updateVariant(
    companyId: string,
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
  ): Promise<ProductDetailDto> {
    const variant = await this.getVariant(companyId, productId, variantId);
    if (dto.sku && dto.sku !== variant.sku && (await this.hasHistory([variantId]))) {
      throw new ConflictException('SKU cannot change after stock movements');
    }
    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...dto,
        attributes: dto.attributes === null ? Prisma.DbNull : dto.attributes,
        barcode: dto.barcode === undefined ? undefined : dto.barcode || null,
      },
    });
    return this.findOne(companyId, productId);
  }

  async removeVariant(
    companyId: string,
    productId: string,
    variantId: string,
  ): Promise<ProductDetailDto> {
    const product = await this.get(companyId, productId);
    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant) throw new NotFoundException('Variant not found');
    if (product.variants.length === 1) {
      throw new ConflictException('A product needs at least one variant');
    }
    if (await this.hasHistory([variantId])) {
      throw new ConflictException('Variant has stock history; deactivate it instead');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.stockBalance.deleteMany({ where: { variantId } });
      await tx.productVariant.delete({ where: { id: variantId } });
      if (variant.isDefault) {
        const next = product.variants.find((v) => v.id !== variantId)!;
        await tx.productVariant.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
    return this.findOne(companyId, productId);
  }

  /** Variants for item pickers (max. 20, active goods; services on request). */
  async findItems(companyId: string, query: StockItemQueryDto): Promise<StockItemDto[]> {
    const search = query.search?.trim();
    const rows = await this.prisma.productVariant.findMany({
      where: {
        companyId,
        isActive: true,
        product: {
          deletedAt: null,
          isActive: true,
          ...(!query.includeServices && { type: ProductType.GOODS }),
        },
        ...(search && {
          OR: [
            { sku: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
            { barcode: search },
            { product: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }),
        ...(query.inStock &&
          query.warehouseId && {
            balances: { some: { warehouseId: query.warehouseId, quantity: { gt: 0 } } },
          }),
      },
      include: {
        product: {
          select: {
            name: true,
            type: true,
            trackingType: true,
            purchasePrice: true,
            salePrice: true,
            currency: true,
            unit: { select: { code: true } },
            vatRate: { select: { rate: true } },
          },
        },
        balances: {
          where: query.warehouseId ? { warehouseId: query.warehouseId } : undefined,
          select: { quantity: true },
        },
      },
      orderBy: { sku: 'asc' },
      take: 20,
    });
    return rows.map((row) => ({
      variantId: row.id,
      productId: row.productId,
      sku: row.sku,
      productName: row.product.name,
      variantName: row.name,
      unitCode: row.product.unit.code,
      productType: row.product.type,
      trackingType: row.product.trackingType,
      averageCost: unitCost(row.averageCost),
      onHand: qty(row.balances.reduce((sum, b) => sum.plus(b.quantity), new Prisma.Decimal(0))),
      purchasePrice: row.product.purchasePrice?.toFixed(2) ?? null,
      salePrice: row.product.salePrice?.toFixed(2) ?? null,
      priceCurrency: row.product.currency,
      vatRate: row.product.vatRate?.rate.toFixed(2) ?? null,
    }));
  }

  private async get(companyId: string, id: string): Promise<ProductRow> {
    const row = await this.prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      include: productInclude,
    });
    if (!row) throw new NotFoundException('Product not found');
    return row;
  }

  private async getVariant(companyId: string, productId: string, variantId: string) {
    const row = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, companyId },
    });
    if (!row) throw new NotFoundException('Variant not found');
    return row;
  }

  private async onHandByVariant(variantIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (!variantIds.length) return new Map();
    const sums = await this.prisma.stockBalance.groupBy({
      by: ['variantId'],
      where: { variantId: { in: variantIds } },
      _sum: { quantity: true },
    });
    return new Map(sums.map((s) => [s.variantId, s._sum.quantity ?? new Prisma.Decimal(0)]));
  }

  private async hasHistory(variantIds: string[]): Promise<boolean> {
    const [transactions, countLines] = await Promise.all([
      this.prisma.stockTransaction.count({ where: { variantId: { in: variantIds } } }),
      this.prisma.stockCountLine.count({ where: { variantId: { in: variantIds } } }),
    ]);
    return transactions + countLines > 0;
  }

  private async assertReferences(
    companyId: string,
    dto: { unitId?: string; categoryId?: string | null; vatRateId?: string | null },
  ) {
    const [unit, category, vatRate] = await Promise.all([
      dto.unitId ? this.prisma.unit.findFirst({ where: { id: dto.unitId, companyId } }) : true,
      dto.categoryId
        ? this.prisma.productCategory.findFirst({ where: { id: dto.categoryId, companyId } })
        : true,
      dto.vatRateId
        ? this.prisma.taxRate.findFirst({ where: { id: dto.vatRateId, companyId } })
        : true,
    ]);
    if (!unit) throw new NotFoundException('Unit not found');
    if (!category) throw new NotFoundException('Product category not found');
    if (!vatRate) throw new NotFoundException('VAT rate not found');
  }
}

function isLow(variant: VariantRow, onHand: Prisma.Decimal): boolean {
  return variant.isActive && variant.minStock.gt(0) && onHand.lt(variant.minStock);
}

function toVariantDto(row: VariantRow, onHand: Map<string, Prisma.Decimal>): VariantDto {
  const quantity = onHand.get(row.id) ?? new Prisma.Decimal(0);
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    attributes: (row.attributes as Record<string, string> | null) ?? null,
    barcode: row.barcode,
    minStock: qty(row.minStock),
    averageCost: unitCost(row.averageCost),
    isDefault: row.isDefault,
    isActive: row.isActive,
    onHand: qty(quantity),
    lowStock: isLow(row, quantity),
  };
}

function toProductDto(row: ProductRow, onHand: Map<string, Prisma.Decimal>): ProductDto {
  const zero = new Prisma.Decimal(0);
  const total = row.variants.reduce((sum, v) => sum.plus(onHand.get(v.id) ?? zero), zero);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    unitId: row.unitId,
    unitCode: row.unit.code,
    type: row.type,
    trackingType: row.trackingType,
    purchasePrice: row.purchasePrice ? money(row.purchasePrice) : null,
    salePrice: row.salePrice ? money(row.salePrice) : null,
    currency: row.currency,
    isActive: row.isActive,
    variantCount: row.variants.length,
    onHand: qty(total),
    lowStock: row.variants.some((v) => isLow(v, onHand.get(v.id) ?? zero)),
  };
}
