import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import type { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

const SORTABLE = ['code', 'name', 'createdAt'] as const;

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthUser, query: PaginationQueryDto) {
    const where: Prisma.CompanyWhereInput = {
      deletedAt: null,
      ...(user.isSuperAdmin ? {} : { memberships: { some: { userId: user.id } } }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              { taxNumber: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        orderBy: toOrderBy(query, SORTABLE, 'name'),
        ...toPageArgs(query),
      }),
      this.prisma.company.count({ where }),
    ]);
    return paginated(data, total, query);
  }

  async findOne(id: string) {
    const company = await this.prisma.company.findFirst({ where: { id, deletedAt: null } });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  /** The creator becomes a member of the new company so they can switch to it immediately. */
  async create(user: AuthUser, dto: CreateCompanyDto) {
    return this.prisma.company.create({
      data: { ...dto, memberships: { create: { userId: user.id } } },
    });
  }

  async update(id: string, dto: UpdateCompanyDto) {
    await this.findOne(id);
    return this.prisma.company.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.company.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }
}
