import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssetStatus, AssignmentStatus, MaintenanceStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { assigneeInclude, toHolder, toMaintenanceDto } from './asset-mappers';
import { AssetSettingsService } from './asset-settings.service';
import { calculateDepreciation } from './depreciation';
import type {
  AssetDetailDto,
  AssetDto,
  AssetQueryDto,
  CompleteMaintenanceDto,
  CreateAssetDto,
  CreateMaintenanceDto,
  MaintenanceDto,
  RetireAssetDto,
  UpdateAssetDto,
} from './dto/asset.dto';

const SORTABLE = ['assetTag', 'name', 'purchaseDate', 'createdAt'] as const;

const assetInclude = {
  category: { select: { name: true, usefulLifeMonths: true } },
  location: { select: { name: true } },
  assignments: {
    where: { status: AssignmentStatus.ACTIVE },
    include: assigneeInclude,
    take: 1,
  },
} satisfies Prisma.AssetInclude;

type AssetRow = Prisma.AssetGetPayload<{ include: typeof assetInclude }>;

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly settings: AssetSettingsService,
  ) {}

  async findAll(companyId: string, query: AssetQueryDto) {
    const where: Prisma.AssetWhereInput = {
      companyId,
      deletedAt: null,
      status: query.status,
      categoryId: query.categoryId,
      locationId: query.locationId,
      ...(query.search
        ? {
            OR: [
              { assetTag: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { serialNumber: { contains: query.search, mode: 'insensitive' } },
              { brand: { contains: query.search, mode: 'insensitive' } },
              { model: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        include: assetInclude,
        orderBy: toOrderBy(query, SORTABLE, 'assetTag'),
        ...toPageArgs(query),
      }),
      this.prisma.asset.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<AssetDetailDto> {
    return toDetailDto(await this.get(companyId, id));
  }

  async create(companyId: string, dto: CreateAssetDto): Promise<AssetDetailDto> {
    await this.assertReferences(companyId, dto);
    const id = await this.prisma.$transaction(async (tx) => {
      const assetTag = await this.numbering.next(companyId, 'ASSET', tx);
      const row = await tx.asset.create({
        data: { ...toData(dto), name: dto.name, categoryId: dto.categoryId, companyId, assetTag },
        select: { id: true },
      });
      return row.id;
    });
    return this.findOne(companyId, id);
  }

  async update(companyId: string, id: string, dto: UpdateAssetDto): Promise<AssetDetailDto> {
    await this.get(companyId, id);
    await this.assertReferences(companyId, dto);
    await this.prisma.asset.update({ where: { id }, data: toData(dto) });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.get(companyId, id);
    const history = await this.prisma.assetAssignment.count({ where: { assetId: id } });
    if (history) throw new ConflictException('Asset has assignment history; retire it instead');
    await this.prisma.asset.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async retire(companyId: string, id: string, dto: RetireAssetDto): Promise<AssetDetailDto> {
    const asset = await this.get(companyId, id);
    if (asset.status === AssetStatus.ASSIGNED) {
      throw new ConflictException('Return the asset before retiring it');
    }
    if (asset.status === AssetStatus.RETIRED || asset.status === AssetStatus.LOST) {
      throw new ConflictException('Asset is already out of service');
    }
    await this.prisma.asset.update({
      where: { id },
      data: { status: dto.status, retiredAt: new Date(), retireReason: dto.reason },
    });
    return this.findOne(companyId, id);
  }

  async findMaintenances(companyId: string, assetId: string): Promise<MaintenanceDto[]> {
    await this.get(companyId, assetId);
    const rows = await this.prisma.assetMaintenance.findMany({
      where: { assetId },
      orderBy: { startedAt: 'desc' },
    });
    return rows.map(toMaintenanceDto);
  }

  /** Opening a maintenance record takes an in-stock asset out of circulation until completed. */
  async createMaintenance(
    user: AuthUser,
    assetId: string,
    dto: CreateMaintenanceDto,
  ): Promise<MaintenanceDto> {
    const asset = await this.get(user.companyId, assetId);
    if (asset.status === AssetStatus.RETIRED || asset.status === AssetStatus.LOST) {
      throw new ConflictException('Asset is out of service');
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.assetMaintenance.create({
        data: {
          ...dto,
          companyId: user.companyId,
          assetId,
          startedAt: parseDateOnly(dto.startedAt),
          createdById: user.id,
        },
      });
      if (asset.status === AssetStatus.IN_STOCK) {
        await tx.asset.update({
          where: { id: assetId },
          data: { status: AssetStatus.IN_MAINTENANCE },
        });
      }
      return created;
    });
    return toMaintenanceDto(row);
  }

  async completeMaintenance(
    companyId: string,
    assetId: string,
    maintenanceId: string,
    dto: CompleteMaintenanceDto,
  ): Promise<MaintenanceDto> {
    const asset = await this.get(companyId, assetId);
    const maintenance = await this.prisma.assetMaintenance.findFirst({
      where: { id: maintenanceId, assetId, companyId },
    });
    if (!maintenance) throw new NotFoundException('Maintenance record not found');
    if (maintenance.status === MaintenanceStatus.COMPLETED) {
      throw new ConflictException('Maintenance is already completed');
    }
    const completedAt = parseDateOnly(dto.completedAt);
    if (completedAt < maintenance.startedAt) {
      throw new BadRequestException('Completion date cannot be before the start date');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.assetMaintenance.update({
        where: { id: maintenanceId },
        data: {
          status: MaintenanceStatus.COMPLETED,
          completedAt,
          cost: dto.cost ?? maintenance.cost,
          description: dto.description ?? maintenance.description,
        },
      });
      const stillOpen = await tx.assetMaintenance.count({
        where: { assetId, status: MaintenanceStatus.OPEN },
      });
      if (!stillOpen && asset.status === AssetStatus.IN_MAINTENANCE) {
        await tx.asset.update({ where: { id: assetId }, data: { status: AssetStatus.IN_STOCK } });
      }
      return updated;
    });
    return toMaintenanceDto(row);
  }

  async get(companyId: string, id: string): Promise<AssetRow> {
    const row = await this.prisma.asset.findFirst({
      where: { id, companyId, deletedAt: null },
      include: assetInclude,
    });
    if (!row) throw new NotFoundException('Asset not found');
    return row;
  }

  private async assertReferences(
    companyId: string,
    dto: { categoryId?: string; locationId?: string | null },
  ) {
    if (dto.categoryId) await this.settings.getCategory(companyId, dto.categoryId);
    if (dto.locationId) await this.settings.getLocation(companyId, dto.locationId);
  }
}

function toData(dto: UpdateAssetDto) {
  const { purchaseDate, warrantyEndDate, ...rest } = dto;
  const date = (value: string | null | undefined) =>
    value === undefined ? undefined : value ? parseDateOnly(value) : null;
  return {
    ...rest,
    purchaseDate: date(purchaseDate),
    warrantyEndDate: date(warrantyEndDate),
  };
}

function toDto(row: AssetRow): AssetDto {
  return {
    id: row.id,
    assetTag: row.assetTag,
    name: row.name,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serialNumber,
    status: row.status,
    condition: row.condition,
    locationId: row.locationId,
    locationName: row.location?.name ?? null,
    holder: toHolder(row.assignments[0]),
    purchaseDate: toDateOnly(row.purchaseDate),
    purchaseCost: row.purchaseCost?.toFixed(2) ?? null,
    currency: row.currency,
    warrantyEndDate: toDateOnly(row.warrantyEndDate),
  };
}

function toDetailDto(row: AssetRow): AssetDetailDto {
  const usefulLifeMonths = row.usefulLifeMonths ?? row.category.usefulLifeMonths;
  const depreciation =
    row.purchaseDate && row.purchaseCost
      ? {
          usefulLifeMonths,
          ...calculateDepreciation({
            cost: row.purchaseCost,
            salvageValue: row.salvageValue,
            usefulLifeMonths,
            purchaseDate: row.purchaseDate,
            asOf: new Date(),
          }),
        }
      : null;
  return {
    ...toDto(row),
    salvageValue: row.salvageValue.toFixed(2),
    usefulLifeMonths: row.usefulLifeMonths,
    supplier: row.supplier,
    invoiceNo: row.invoiceNo,
    notes: row.notes,
    retiredAt: row.retiredAt,
    retireReason: row.retireReason,
    depreciation,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
