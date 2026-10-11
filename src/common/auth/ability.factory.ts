import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability';
import { Injectable } from '@nestjs/common';
import type { AuthUser } from './auth-user';

export type AppAbility = MongoAbility<[string, string]>;

/**
 * Converts "module:action" permission codes into a CASL ability.
 * "module:manage" grants every action of the module; super admins can do everything.
 */
@Injectable()
export class AbilityFactory {
  createForUser(user: Pick<AuthUser, 'isSuperAdmin' | 'permissions'>): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    if (user.isSuperAdmin) {
      can('manage', 'all');
    } else {
      for (const code of user.permissions) {
        const [subject, action] = code.split(':');
        if (subject && action) can(action, subject);
      }
    }

    return build();
  }

  /** True when the user has every given permission code. */
  hasAll(ability: AppAbility, codes: string[]): boolean {
    return codes.every((code) => {
      const [subject, action] = code.split(':');
      return ability.can(action, subject);
    });
  }
}
