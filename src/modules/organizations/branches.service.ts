import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import type { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

const SORTABLE = ['code', 'name', 'createdAt'] as const;

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.BranchWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              { city: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        orderBy: toOrderBy(query, SORTABLE, 'name'),
        ...toPageArgs(query),
      }),
      this.prisma.branch.count({ where }),
    ]);
    return paginated(data, total, query);
  }

  async findOne(companyId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  create(companyId: string, dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: { ...dto, companyId } });
  }

  async update(companyId: string, id: string, dto: UpdateBranchDto) {
    await this.findOne(companyId, id);
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }
}
