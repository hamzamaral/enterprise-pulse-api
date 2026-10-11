import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import Redis from 'ioredis';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { ALL_PERMISSION_CODES } from '../roles/permissions.registry';

const CACHE_TTL_SECONDS = 60;

/**
 * Resolves the authenticated principal for a request: user, active company / branch and
 * the permission codes granted in that company. Results are cached briefly in Redis.
 */
@Injectable()
export class AuthContextService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async resolve(userId: string, companyId?: string, branchId?: string): Promise<AuthUser> {
    const cacheKey = `auth:ctx:${userId}:${companyId ?? '-'}:${branchId ?? '-'}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as AuthUser;

    const authUser = await this.load(userId, companyId, branchId);
    await this.redis.set(cacheKey, JSON.stringify(authUser), 'EX', CACHE_TTL_SECONDS);
    return authUser;
  }

  /** Call after changing a user's roles, memberships or status. */
  async invalidateUser(userId: string): Promise<void> {
    await this.deleteByPattern(`auth:ctx:${userId}:*`);
  }

  /** Call after changing a role's permissions. */
  async invalidateAll(): Promise<void> {
    await this.deleteByPattern('auth:ctx:*');
  }

  private async deleteByPattern(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      if (keys.length) await this.redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  }

  private async load(userId: string, companyId?: string, branchId?: string): Promise<AuthUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      include: { memberships: { where: { company: { isActive: true, deletedAt: null } } } },
    });
    if (!user) throw new UnauthorizedException('User is inactive or does not exist');

    let membership = companyId
      ? user.memberships.find((m) => m.companyId === companyId)
      : (user.memberships.find((m) => m.isDefault) ?? user.memberships[0]);

    let activeCompanyId = membership?.companyId;
    if (!activeCompanyId && user.isSuperAdmin) {
      const company = await this.prisma.company.findFirst({
        where: { deletedAt: null, ...(companyId ? { id: companyId } : {}) },
        orderBy: { createdAt: 'asc' },
      });
      activeCompanyId = company?.id;
      membership = undefined;
    }
    if (!activeCompanyId) throw new ForbiddenException('No access to the requested company');

    let activeBranchId: string | null = membership?.defaultBranchId ?? null;
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, companyId: activeCompanyId, deletedAt: null },
      });
      if (!branch) throw new ForbiddenException('Branch does not belong to the active company');
      activeBranchId = branch.id;
    }

    const roles = await this.prisma.userRole.findMany({
      where: { userId, companyId: activeCompanyId, role: { deletedAt: null } },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const permissions = user.isSuperAdmin
      ? ALL_PERMISSION_CODES
      : [...new Set(roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)))].sort();

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isSuperAdmin: user.isSuperAdmin,
      companyId: activeCompanyId,
      branchId: activeBranchId,
      permissions,
    };
  }
}
