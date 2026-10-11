import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CreateDepartmentDto,
  DepartmentDto,
  UpdateDepartmentDto,
} from './dto/organization.dto';

const departmentInclude = {
  parent: { select: { name: true } },
  manager: { select: { firstName: true, lastName: true } },
  _count: { select: { employees: { where: { status: EmployeeStatus.ACTIVE, deletedAt: null } } } },
} satisfies Prisma.DepartmentInclude;

type DepartmentRow = Prisma.DepartmentGetPayload<{ include: typeof departmentInclude }>;

/** Departments form a tree; lists are small, so they are returned without pagination. */
@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string): Promise<DepartmentDto[]> {
    const rows = await this.prisma.department.findMany({
      where: { companyId, deletedAt: null },
      include: departmentInclude,
      orderBy: { name: 'asc' },
    });
    return rows.map(toDto);
  }

  async findOne(companyId: string, id: string): Promise<DepartmentDto> {
    return toDto(await this.get(companyId, id));
  }

  async create(companyId: string, dto: CreateDepartmentDto): Promise<DepartmentDto> {
    await this.assertReferences(companyId, dto);
    const row = await this.prisma.department.create({
      data: { ...dto, companyId },
      include: departmentInclude,
    });
    return toDto(row);
  }

  async update(companyId: string, id: string, dto: UpdateDepartmentDto): Promise<DepartmentDto> {
    await this.get(companyId, id);
    await this.assertReferences(companyId, dto, id);
    const row = await this.prisma.department.update({
      where: { id },
      data: dto,
      include: departmentInclude,
    });
    return toDto(row);
  }

  async remove(companyId: string, id: string): Promise<void> {
    const department = await this.get(companyId, id);
    const children = await this.prisma.department.count({
      where: { companyId, parentId: id, deletedAt: null },
    });
    if (children || department._count.employees) {
      throw new ConflictException('Department still has sub-departments or employees');
    }
    await this.prisma.department.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  private async get(companyId: string, id: string): Promise<DepartmentRow> {
    const row = await this.prisma.department.findFirst({
      where: { id, companyId, deletedAt: null },
      include: departmentInclude,
    });
    if (!row) throw new NotFoundException('Department not found');
    return row;
  }

  private async assertReferences(
    companyId: string,
    dto: { parentId?: string | null; managerId?: string | null },
    selfId?: string,
  ): Promise<void> {
    if (dto.parentId) {
      if (dto.parentId === selfId)
        throw new BadRequestException('A department cannot be its own parent');
      const parents = await this.prisma.department.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, parentId: true },
      });
      const byId = new Map(parents.map((p) => [p.id, p.parentId]));
      if (!byId.has(dto.parentId)) throw new BadRequestException('Parent department not found');
      // Walking up from the new parent must never reach this department, otherwise the tree loops.
      for (
        let cursor: string | null | undefined = dto.parentId;
        cursor;
        cursor = byId.get(cursor)
      ) {
        if (cursor === selfId)
          throw new BadRequestException('Department hierarchy cannot be circular');
      }
    }
    if (dto.managerId) {
      const manager = await this.prisma.employee.count({
        where: { id: dto.managerId, companyId, deletedAt: null },
      });
      if (!manager) throw new BadRequestException('Manager employee not found');
    }
  }
}

function toDto(row: DepartmentRow): DepartmentDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    parentId: row.parentId,
    parentName: row.parent?.name ?? null,
    managerId: row.managerId,
    managerName: row.manager ? `${row.manager.firstName} ${row.manager.lastName}` : null,
    employeeCount: row._count.employees,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}
