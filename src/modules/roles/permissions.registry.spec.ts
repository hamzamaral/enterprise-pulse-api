import { ALL_PERMISSION_CODES, PERMISSION_REGISTRY } from './permissions.registry';

describe('permission registry', () => {
  it('produces unique "module:action" codes', () => {
    expect(new Set(ALL_PERMISSION_CODES).size).toBe(ALL_PERMISSION_CODES.length);
    for (const code of ALL_PERMISSION_CODES) {
      expect(code).toMatch(/^[a-z-]+:[a-z]+$/);
    }
  });

  it('never uses the CASL wildcard action "manage"', () => {
    const actions = Object.values(PERMISSION_REGISTRY).flat() as string[];
    expect(actions).not.toContain('manage');
  });
});
