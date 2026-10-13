import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CompetencyDto,
  CreateCompetencyDto,
  UpdateCompetencyDto,
} from './dto/performance.dto';
import { trimOrNull } from './performance-support';

/** Yetkinlik kataloğu. */
@Injectable()
export class CompetenciesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string): Promise<CompetencyDto[]> {
    const rows = await this.prisma.competency.findMany({
      where: { companyId },
      include: { _count: { select: { cycles: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(companyId: string, dto: CreateCompetencyDto): Promise<CompetencyDto> {
    try {
      const row = await this.prisma.competency.create({
        data: {
          companyId,
          name: dto.name.trim(),
          description: trimOrNull(dto.description),
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
        include: { _count: { select: { cycles: true } } },
      });
      return toDto(row);
    } catch (error) {
      throw duplicate(error);
    }
  }

  async update(companyId: string, id: string, dto: UpdateCompetencyDto): Promise<CompetencyDto> {
    await this.get(companyId, id);
    try {
      const row = await this.prisma.competency.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          description: trimOrNull(dto.description),
          isActive: dto.isActive,
          sortOrder: dto.sortOrder,
        },
        include: { _count: { select: { cycles: true } } },
      });
      return toDto(row);
    } catch (error) {
      throw duplicate(error);
    }
  }

  async remove(companyId: string, id: string): Promise<void> {
    const row = await this.get(companyId, id);
    if (row._count.cycles > 0) {
      throw new ConflictException(
        'The competency is used by a review cycle; deactivate it instead',
      );
    }
    await this.prisma.competency.delete({ where: { id } });
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.competency.findFirst({
      where: { id, companyId },
      include: { _count: { select: { cycles: true } } },
    });
    if (!row) throw new NotFoundException('Competency not found');
    return row;
  }
}

function duplicate(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException('A competency with this name already exists');
  }
  return error;
}

function toDto(
  row: Prisma.CompetencyGetPayload<{ include: { _count: { select: { cycles: true } } } }>,
): CompetencyDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    cycleCount: row._count.cycles,
  };
}
