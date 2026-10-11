import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CreatePositionDto,
  PositionDto,
  PositionQueryDto,
  UpdatePositionDto,
} from './dto/organization.dto';

const SORTABLE = ['code', 'name', 'createdAt'] as const;

const positionInclude = {
  department: { select: { name: true } },
  _count: { select: { employees: { where: { status: EmployeeStatus.ACTIVE, deletedAt: null } } } },
} satisfies Prisma.PositionInclude;

type PositionRow = Prisma.PositionGetPayload<{ include: typeof positionInclude }>;

@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string, query: PositionQueryDto) {
    const where: Prisma.PositionWhereInput = {
      companyId,
      deletedAt: null,
      departmentId: query.departmentId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.position.findMany({
        where,
        include: positionInclude,
        orderBy: toOrderBy(query, SORTABLE, 'name'),
        ...toPageArgs(query),
      }),
      this.prisma.position.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<PositionDto> {
    return toDto(await this.get(companyId, id));
  }

  async create(companyId: string, dto: CreatePositionDto): Promise<PositionDto> {
    await this.assertDepartment(companyId, dto.departmentId);
    const row = await this.prisma.position.create({
      data: { ...dto, companyId },
      include: positionInclude,
    });
    return toDto(row);
  }

  async update(companyId: string, id: string, dto: UpdatePositionDto): Promise<PositionDto> {
    await this.get(companyId, id);
    await this.assertDepartment(companyId, dto.departmentId);
    const row = await this.prisma.position.update({
      where: { id },
      data: dto,
      include: positionInclude,
    });
    return toDto(row);
  }

  async remove(companyId: string, id: string): Promise<void> {
    const position = await this.get(companyId, id);
    if (position._count.employees) throw new ConflictException('Position is assigned to employees');
    await this.prisma.position.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  private async get(companyId: string, id: string): Promise<PositionRow> {
    const row = await this.prisma.position.findFirst({
      where: { id, companyId, deletedAt: null },
      include: positionInclude,
    });
    if (!row) throw new NotFoundException('Position not found');
    return row;
  }

  private async assertDepartment(companyId: string, departmentId?: string | null) {
    if (!departmentId) return;
    const count = await this.prisma.department.count({
      where: { id: departmentId, companyId, deletedAt: null },
    });
    if (!count) throw new BadRequestException('Department not found');
  }
}

function toDto(row: PositionRow): PositionDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    employeeCount: row._count.employees,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}
