import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { AuthContextService } from '../auth/auth-context.service';
import type { CreateUserDto, UpdateUserDto, UserDto, UserQueryDto } from './dto/user.dto';
import { USER_EVENTS, type UserInvitedEvent } from './users.events';

const SORTABLE = ['email', 'firstName', 'lastName', 'createdAt', 'lastLoginAt'] as const;

const userInclude = (companyId: string) =>
  ({
    roles: { where: { companyId }, include: { role: true } },
    memberships: { where: { companyId } },
  }) satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{ include: ReturnType<typeof userInclude> }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext: AuthContextService,
    private readonly events: EventEmitter2,
  ) {}

  async findAll(companyId: string, query: UserQueryDto) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      memberships: { some: { companyId } },
      ...(query.isActive ? { isActive: query.isActive === 'true' } : {}),
      ...(query.roleId ? { roles: { some: { roleId: query.roleId, companyId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: userInclude(companyId),
        orderBy: toOrderBy(query, SORTABLE, 'createdAt'),
        ...toPageArgs(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(rows.map(toUserDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<UserDto> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, memberships: { some: { companyId } } },
      include: userInclude(companyId),
    });
    if (!user) throw new NotFoundException('User not found');
    return toUserDto(user);
  }

  async create(companyId: string, dto: CreateUserDto): Promise<UserDto> {
    const { roleIds, defaultBranchId, password, ...profile } = dto;

    const user = await this.prisma.$transaction(async (tx) => {
      await this.assertRolesAssignable(tx, companyId, roleIds);
      await this.assertBranch(tx, companyId, defaultBranchId);

      return tx.user.create({
        data: {
          ...profile,
          passwordHash: await argon2.hash(password ?? randomBytes(24).toString('base64url')),
          memberships: { create: { companyId, isDefault: true, defaultBranchId } },
          roles: { create: roleIds.map((roleId) => ({ roleId, companyId })) },
        },
      });
    });

    if (!password) {
      this.events.emit(USER_EVENTS.INVITED, {
        userId: user.id,
        email: user.email,
      } satisfies UserInvitedEvent);
    }
    return this.findOne(companyId, user.id);
  }

  async update(companyId: string, id: string, dto: UpdateUserDto): Promise<UserDto> {
    await this.findOne(companyId, id);
    const { roleIds, defaultBranchId, ...profile } = dto;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: profile });

      if (defaultBranchId !== undefined) {
        await this.assertBranch(tx, companyId, defaultBranchId);
        await tx.userCompany.update({
          where: { userId_companyId: { userId: id, companyId } },
          data: { defaultBranchId },
        });
      }

      if (roleIds) {
        await this.assertRolesAssignable(tx, companyId, roleIds);
        await tx.userRole.deleteMany({ where: { userId: id, companyId } });
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({ userId: id, roleId, companyId })),
        });
      }
    });

    await this.authContext.invalidateUser(id);
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string, currentUserId: string): Promise<void> {
    if (id === currentUserId) throw new BadRequestException('You cannot delete your own account');
    await this.findOne(companyId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.authContext.invalidateUser(id);
  }

  private async assertRolesAssignable(tx: PrismaTx, companyId: string, roleIds: string[]) {
    if (!roleIds.length) return;
    const count = await tx.role.count({
      where: {
        id: { in: roleIds },
        deletedAt: null,
        OR: [{ companyId }, { companyId: null }],
        NOT: { code: 'super-admin' },
      },
    });
    if (count !== roleIds.length) throw new BadRequestException('One or more roles are invalid');
  }

  private async assertBranch(tx: PrismaTx, companyId: string, branchId?: string | null) {
    if (!branchId) return;
    const branch = await tx.branch.findFirst({
      where: { id: branchId, companyId, deletedAt: null },
    });
    if (!branch) throw new BadRequestException('Branch does not belong to the active company');
  }
}

function toUserDto(user: UserWithRelations): UserDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    isActive: user.isActive,
    isSuperAdmin: user.isSuperAdmin,
    twoFactorEnabled: user.twoFactorEnabled,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    defaultBranchId: user.memberships[0]?.defaultBranchId ?? null,
    roles: user.roles.map((r) => ({ id: r.role.id, code: r.role.code, name: r.role.name })),
  };
}
