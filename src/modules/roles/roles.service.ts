import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import type { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { PrismaService, PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { AuthContextService } from '../auth/auth-context.service';
import type { CreateRoleDto, RoleDto, UpdateRoleDto } from './dto/role.dto';

const SORTABLE = ['code', 'name', 'createdAt'] as const;

const roleInclude = (companyId: string) =>
  ({
    permissions: { include: { permission: true } },
    _count: { select: { userRoles: { where: { companyId } } } },
  }) satisfies Prisma.RoleInclude;

type RoleWithRelations = Prisma.RoleGetPayload<{ include: ReturnType<typeof roleInclude> }>;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext: AuthContextService,
  ) {}

  /** Company roles plus shared system roles. */
  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.RoleWhereInput = {
      deletedAt: null,
      OR: [{ companyId }, { companyId: null }],
      ...(query.search
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { code: { contains: query.search, mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.role.findMany({
        where,
        include: roleInclude(companyId),
        orderBy: toOrderBy(query, SORTABLE, 'name'),
        ...toPageArgs(query),
      }),
      this.prisma.role.count({ where }),
    ]);
    return paginated(rows.map(toRoleDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<RoleDto> {
    return toRoleDto(await this.getRole(companyId, id));
  }

  async create(companyId: string, dto: CreateRoleDto): Promise<RoleDto> {
    const { permissionCodes, ...data } = dto;
    const role = await this.prisma.$transaction(async (tx) => {
      const permissionIds = await this.resolvePermissionIds(tx, permissionCodes);
      return tx.role.create({
        data: {
          ...data,
          companyId,
          permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
        },
      });
    });
    return this.findOne(companyId, role.id);
  }

  async update(companyId: string, id: string, dto: UpdateRoleDto): Promise<RoleDto> {
    const role = await this.getRole(companyId, id);
    if (role.isSystem) throw new ForbiddenException('System roles cannot be modified');

    const { permissionCodes, ...data } = dto;
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data });
      if (permissionCodes) {
        const permissionIds = await this.resolvePermissionIds(tx, permissionCodes);
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        });
      }
    });

    await this.authContext.invalidateAll();
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    const role = await this.getRole(companyId, id);
    if (role.isSystem) throw new ForbiddenException('System roles cannot be deleted');
    if (role._count.userRoles > 0) {
      throw new ConflictException('Role is assigned to users; unassign it first');
    }
    await this.prisma.role.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  findPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
  }

  private async getRole(companyId: string, id: string): Promise<RoleWithRelations> {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null, OR: [{ companyId }, { companyId: null }] },
      include: roleInclude(companyId),
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private async resolvePermissionIds(tx: PrismaTx, codes: string[]): Promise<string[]> {
    const permissions = await tx.permission.findMany({ where: { code: { in: codes } } });
    if (permissions.length !== codes.length) {
      const known = new Set(permissions.map((p) => p.code));
      throw new BadRequestException(
        `Unknown permissions: ${codes.filter((c) => !known.has(c)).join(', ')}`,
      );
    }
    return permissions.map((p) => p.id);
  }
}

function toRoleDto(role: RoleWithRelations): RoleDto {
  return {
    id: role.id,
    companyId: role.companyId,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionCodes: role.permissions.map((p) => p.permission.code).sort(),
    userCount: role._count.userRoles,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
