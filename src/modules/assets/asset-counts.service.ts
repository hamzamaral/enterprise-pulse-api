import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssetCountStatus, AssetStatus, AssignmentStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { assigneeInclude, assigneeOf } from './asset-mappers';
import type {
  AssetCountDetailDto,
  AssetCountDto,
  AssetCountLineDto,
  AssetCountQueryDto,
  AssetScanResultDto,
  CompleteAssetCountDto,
  CreateAssetCountDto,
  ScanAssetDto,
  UpdateAssetCountLineDto,
} from './dto/asset-count.dto';

const SORTABLE = ['number', 'countDate', 'createdAt'] as const;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const OUT_OF_SERVICE = [AssetStatus.RETIRED, AssetStatus.LOST];

const listInclude = {
  location: { select: { name: true } },
  category: { select: { name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  lines: { select: { expected: true, foundAt: true } },
} satisfies Prisma.AssetCountInclude;

const lineInclude = {
  asset: {
    select: {
      assetTag: true,
      name: true,
      serialNumber: true,
      condition: true,
      category: { select: { name: true } },
    },
  },
  foundBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AssetCountLineInclude;

const detailInclude = {
  ...listInclude,
  lines: { include: lineInclude },
} satisfies Prisma.AssetCountInclude;

type ListRow = Prisma.AssetCountGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.AssetCountGetPayload<{ include: typeof detailInclude }>;
type LineRow = Prisma.AssetCountLineGetPayload<{ include: typeof lineInclude }>;

/**
 * Asset verification (demirbaş sayımı). Starting a count snapshots every in-service asset in scope
 * with its current holder; assets are then marked found by scanning their QR label, asset tag or
 * serial number. Scanned assets outside the scope are recorded as unexpected.
 */
@Injectable()
export class AssetCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async findAll(companyId: string, query: AssetCountQueryDto) {
    const where: Prisma.AssetCountWhereInput = {
      companyId,
      status: query.status,
      ...(query.search && { number: { contains: query.search, mode: 'insensitive' } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.assetCount.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.assetCount.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<AssetCountDetailDto> {
    const row = await this.prisma.assetCount.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Asset count not found');
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreateAssetCountDto): Promise<AssetCountDetailDto> {
    const { companyId } = user;
    if (dto.locationId) {
      const location = await this.prisma.assetLocation.findFirst({
        where: { id: dto.locationId, companyId },
      });
      if (!location) throw new BadRequestException('Location not found');
    }
    if (dto.categoryId) {
      const category = await this.prisma.assetCategory.findFirst({
        where: { id: dto.categoryId, companyId },
      });
      if (!category) throw new BadRequestException('Asset category not found');
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const open = await tx.assetCount.findFirst({
        where: {
          companyId,
          status: AssetCountStatus.DRAFT,
          locationId: dto.locationId ?? null,
          categoryId: dto.categoryId ?? null,
        },
        select: { number: true },
      });
      if (open) throw new ConflictException(`Count ${open.number} is still open for this scope`);

      const assets = await tx.asset.findMany({
        where: {
          companyId,
          deletedAt: null,
          status: { notIn: OUT_OF_SERVICE },
          categoryId: dto.categoryId,
          ...(dto.locationId && {
            OR: [
              { locationId: dto.locationId },
              {
                assignments: {
                  some: { status: AssignmentStatus.ACTIVE, locationId: dto.locationId },
                },
              },
            ],
          }),
        },
        include: holderInclude,
        orderBy: { assetTag: 'asc' },
      });
      if (!assets.length) throw new BadRequestException('No assets in this scope');

      const count = await tx.assetCount.create({
        data: {
          companyId,
          number: await this.numbering.next(companyId, 'ASSET_COUNT', tx),
          countDate: parseDateOnly(dto.countDate),
          locationId: dto.locationId ?? null,
          categoryId: dto.categoryId ?? null,
          notes: dto.notes?.trim() || null,
          createdById: user.id,
        },
      });
      await tx.assetCountLine.createMany({
        data: assets.map((asset) => ({
          countId: count.id,
          assetId: asset.id,
          expectedHolder: holderName(asset),
        })),
      });
      return count.id;
    });
    return this.findOne(companyId, id);
  }

  async scan(user: AuthUser, id: string, dto: ScanAssetDto): Promise<AssetScanResultDto> {
    const { companyId } = user;
    return this.prisma.$transaction(async (tx) => {
      await this.getDraft(tx, companyId, id);
      const code = dto.code.trim();
      const assetId = UUID.exec(code)?.[0];
      const asset = await tx.asset.findFirst({
        where: {
          companyId,
          deletedAt: null,
          OR: assetId
            ? [{ id: assetId }]
            : [
                { assetTag: { equals: code, mode: 'insensitive' } },
                { serialNumber: { equals: code, mode: 'insensitive' } },
              ],
        },
        include: holderInclude,
      });
      if (!asset) throw new NotFoundException(`No asset matches "${code}"`);

      const existing = await tx.assetCountLine.findUnique({
        where: { countId_assetId: { countId: id, assetId: asset.id } },
      });
      if (existing?.foundAt) {
        return { result: 'ALREADY_FOUND', line: await this.loadLine(tx, existing.id) };
      }
      const found = { foundAt: new Date(), foundById: user.id };
      if (existing) {
        await tx.assetCountLine.update({ where: { id: existing.id }, data: found });
        return { result: 'FOUND', line: await this.loadLine(tx, existing.id) };
      }
      const line = await tx.assetCountLine.create({
        data: {
          countId: id,
          assetId: asset.id,
          expected: false,
          expectedHolder: holderName(asset),
          ...found,
        },
      });
      return { result: 'UNEXPECTED', line: await this.loadLine(tx, line.id) };
    });
  }

  async updateLine(
    user: AuthUser,
    id: string,
    lineId: string,
    dto: UpdateAssetCountLineDto,
  ): Promise<AssetCountLineDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.getDraft(tx, user.companyId, id);
      const line = await tx.assetCountLine.findFirst({ where: { id: lineId, countId: id } });
      if (!line) throw new NotFoundException('Count line not found');
      if (dto.found === false && !line.expected) {
        throw new BadRequestException('Remove the unexpected asset from the count instead');
      }
      const data: Prisma.AssetCountLineUncheckedUpdateInput = {
        condition: dto.condition,
        note: dto.note === undefined ? undefined : dto.note?.trim() || null,
      };
      if (dto.found === true && !line.foundAt)
        Object.assign(data, { foundAt: new Date(), foundById: user.id });
      if (dto.found === false)
        Object.assign(data, { foundAt: null, foundById: null, condition: null });
      await tx.assetCountLine.update({ where: { id: lineId }, data });
      return this.loadLine(tx, lineId);
    });
  }

  async removeLine(companyId: string, id: string, lineId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.getDraft(tx, companyId, id);
      const line = await tx.assetCountLine.findFirst({ where: { id: lineId, countId: id } });
      if (!line) throw new NotFoundException('Count line not found');
      if (line.expected) throw new BadRequestException('Expected assets cannot be removed');
      await tx.assetCountLine.delete({ where: { id: lineId } });
    });
  }

  async complete(
    companyId: string,
    id: string,
    dto: CompleteAssetCountDto,
  ): Promise<AssetCountDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.getDraft(tx, companyId, id);
      const lines = await tx.assetCountLine.findMany({
        where: { countId: id, foundAt: { not: null }, condition: { not: null } },
        include: { asset: { select: { condition: true } } },
      });
      if (dto.applyConditions) {
        for (const line of lines) {
          if (line.condition && line.condition !== line.asset.condition) {
            await tx.asset.update({
              where: { id: line.assetId },
              data: { condition: line.condition },
            });
          }
        }
      }
      await tx.assetCount.update({
        where: { id },
        data: { status: AssetCountStatus.COMPLETED, completedAt: new Date() },
      });
    });
    return this.findOne(companyId, id);
  }

  async cancel(companyId: string, id: string): Promise<AssetCountDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.getDraft(tx, companyId, id);
      await tx.assetCount.update({ where: { id }, data: { status: AssetCountStatus.CANCELLED } });
    });
    return this.findOne(companyId, id);
  }

  private async loadLine(tx: PrismaTx, lineId: string): Promise<AssetCountLineDto> {
    return toLineDto(
      await tx.assetCountLine.findUniqueOrThrow({ where: { id: lineId }, include: lineInclude }),
    );
  }

  /** Loads a count and locks it, so concurrent scans and completion cannot interleave. */
  private async getDraft(tx: PrismaTx, companyId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM asset_counts WHERE id = ${id}::uuid FOR UPDATE`;
    const count = await tx.assetCount.findFirst({ where: { id, companyId } });
    if (!count) throw new NotFoundException('Asset count not found');
    if (count.status !== AssetCountStatus.DRAFT) {
      throw new ConflictException('Only open counts can be changed');
    }
    return count;
  }
}

const holderInclude = {
  location: { select: { name: true } },
  assignments: { where: { status: AssignmentStatus.ACTIVE }, include: assigneeInclude, take: 1 },
} satisfies Prisma.AssetInclude;

function holderName(
  asset: Prisma.AssetGetPayload<{ include: typeof holderInclude }>,
): string | null {
  const assignment = asset.assignments[0];
  if (assignment) return assigneeOf(assignment).name;
  return asset.location?.name ?? null;
}

function toDto(row: ListRow): AssetCountDto {
  const expected = row.lines.filter((line) => line.expected);
  const found = expected.filter((line) => line.foundAt).length;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    countDate: toDateOnly(row.countDate),
    locationId: row.locationId,
    locationName: row.location?.name ?? null,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    expectedCount: expected.length,
    foundCount: found,
    missingCount: expected.length - found,
    unexpectedCount: row.lines.length - expected.length,
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

function toLineDto(line: LineRow): AssetCountLineDto {
  return {
    id: line.id,
    assetId: line.assetId,
    assetTag: line.asset.assetTag,
    assetName: line.asset.name,
    categoryName: line.asset.category.name,
    serialNumber: line.asset.serialNumber,
    expected: line.expected,
    expectedHolder: line.expectedHolder,
    found: !!line.foundAt,
    foundAt: line.foundAt,
    foundByName: line.foundBy ? `${line.foundBy.firstName} ${line.foundBy.lastName}` : null,
    condition: line.condition,
    currentCondition: line.asset.condition,
    note: line.note,
  };
}

function toDetailDto(row: DetailRow): AssetCountDetailDto {
  return {
    ...toDto(row),
    notes: row.notes,
    lines: row.lines.map(toLineDto).sort((a, b) => a.assetTag.localeCompare(b.assetTag)),
  };
}
