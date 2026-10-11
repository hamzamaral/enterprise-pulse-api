import { AbilityFactory } from './ability.factory';

describe('AbilityFactory', () => {
  const factory = new AbilityFactory();

  it('grants exactly the listed permission codes', () => {
    const ability = factory.createForUser({
      isSuperAdmin: false,
      permissions: ['users:read', 'users:update'],
    });

    expect(factory.hasAll(ability, ['users:read'])).toBe(true);
    expect(factory.hasAll(ability, ['users:read', 'users:update'])).toBe(true);
    expect(factory.hasAll(ability, ['users:delete'])).toBe(false);
    expect(factory.hasAll(ability, ['roles:read'])).toBe(false);
  });

  it('requires every code when several are requested', () => {
    const ability = factory.createForUser({ isSuperAdmin: false, permissions: ['audit:read'] });
    expect(factory.hasAll(ability, ['audit:read', 'settings:read'])).toBe(false);
  });

  it('lets "module:manage" cover every action of that module only', () => {
    const ability = factory.createForUser({
      isSuperAdmin: false,
      permissions: ['workflow:manage'],
    });
    expect(factory.hasAll(ability, ['workflow:approve', 'workflow:start'])).toBe(true);
    expect(factory.hasAll(ability, ['users:read'])).toBe(false);
  });

  it('allows everything for super admins', () => {
    const ability = factory.createForUser({ isSuperAdmin: true, permissions: [] });
    expect(factory.hasAll(ability, ['roles:delete', 'companies:create'])).toBe(true);
  });

  it('ignores malformed codes', () => {
    const ability = factory.createForUser({ isSuperAdmin: false, permissions: ['broken', ''] });
    expect(factory.hasAll(ability, ['broken:read'])).toBe(false);
  });
});
