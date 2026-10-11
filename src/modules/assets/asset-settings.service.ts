import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  AssetCategoryDto,
  AssetLocationDto,
  CreateAssetCategoryDto,
  CreateAssetLocationDto,
  UpdateAssetCategoryDto,
  UpdateAssetLocationDto,
} from './dto/asset.dto';

const activeAssets = { assets: { where: { deletedAt: null } } };

@Injectable()
export class AssetSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findCategories(companyId: string): Promise<AssetCategoryDto[]> {
    const rows = await this.prisma.assetCategory.findMany({
      where: { companyId },
      include: { _count: { select: activeAssets } },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({ ...pickCategory(row), assetCount: row._count.assets }));
  }

  async createCategory(companyId: string, dto: CreateAssetCategoryDto): Promise<AssetCategoryDto> {
    const row = await this.prisma.assetCategory.create({ data: { ...dto, companyId } });
    return { ...pickCategory(row), assetCount: 0 };
  }

  async updateCategory(
    companyId: string,
    id: string,
    dto: UpdateAssetCategoryDto,
  ): Promise<AssetCategoryDto> {
    await this.getCategory(companyId, id);
    await this.prisma.assetCategory.update({ where: { id }, data: dto });
    return (await this.findCategories(companyId)).find((c) => c.id === id)!;
  }

  async getCategory(companyId: string, id: string) {
    const row = await this.prisma.assetCategory.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Asset category not found');
    return row;
  }

  async findLocations(companyId: string): Promise<AssetLocationDto[]> {
    const rows = await this.prisma.assetLocation.findMany({
      where: { companyId },
      include: { branch: { select: { name: true } }, _count: { select: activeAssets } },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      branchId: row.branchId,
      branchName: row.branch?.name ?? null,
      isActive: row.isActive,
      assetCount: row._count.assets,
    }));
  }

  async createLocation(companyId: string, dto: CreateAssetLocationDto): Promise<AssetLocationDto> {
    await this.assertBranch(companyId, dto.branchId);
    const row = await this.prisma.assetLocation.create({ data: { ...dto, companyId } });
    return (await this.findLocations(companyId)).find((l) => l.id === row.id)!;
  }

  async updateLocation(
    companyId: string,
    id: string,
    dto: UpdateAssetLocationDto,
  ): Promise<AssetLocationDto> {
    await this.getLocation(companyId, id);
    await this.assertBranch(companyId, dto.branchId);
    await this.prisma.assetLocation.update({ where: { id }, data: dto });
    return (await this.findLocations(companyId)).find((l) => l.id === id)!;
  }

  async getLocation(companyId: string, id: string) {
    const row = await this.prisma.assetLocation.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Asset location not found');
    return row;
  }

  private async assertBranch(companyId: string, branchId?: string | null) {
    if (!branchId) return;
    const count = await this.prisma.branch.count({ where: { id: branchId, companyId } });
    if (!count) throw new BadRequestException('Branch not found');
  }
}

function pickCategory(row: {
  id: string;
  code: string;
  name: string;
  usefulLifeMonths: number;
  isActive: boolean;
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    usefulLifeMonths: row.usefulLifeMonths,
    isActive: row.isActive,
  };
}
