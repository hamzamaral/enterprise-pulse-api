import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AbilityFactory } from '../auth/ability.factory';
import type { AuthUser } from '../auth/auth-user';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    const any = this.reflector.getAllAndOverride<string[] | undefined>(
      ANY_PERMISSIONS_KEY,
      targets,
    );
    if (!required?.length && !any?.length) return true;

    const { user } = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!user) throw new ForbiddenException();

    const ability = this.abilityFactory.createForUser(user);
    if (required?.length && !this.abilityFactory.hasAll(ability, required)) {
      throw new ForbiddenException(`Missing permission: ${required.join(', ')}`);
    }
    if (any?.length && !this.abilityFactory.hasAny(ability, any)) {
      throw new ForbiddenException(`Missing permission: one of ${any.join(', ')}`);
    }
    return true;
  }
}
