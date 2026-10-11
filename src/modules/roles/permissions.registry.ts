/**
 * Single source of truth for permission codes. Seeded into the `permissions` table.
 * Add new modules here when a new business module is introduced.
 * Do not use "manage" as an action: CASL treats it as a wildcard.
 */
export const PERMISSION_REGISTRY = {
  companies: ['read', 'create', 'update', 'delete'],
  branches: ['read', 'create', 'update', 'delete'],
  users: ['read', 'create', 'update', 'delete'],
  roles: ['read', 'create', 'update', 'delete'],
  audit: ['read'],
  files: ['read', 'create', 'delete'],
  numbering: ['read', 'update'],
  settings: ['read', 'update'],
  workflow: ['read', 'create', 'update', 'delete', 'start'],
  notifications: ['send'],
} as const satisfies Record<string, readonly string[]>;

export type PermissionModule = keyof typeof PERMISSION_REGISTRY;

export const ALL_PERMISSION_CODES: string[] = Object.entries(PERMISSION_REGISTRY).flatMap(
  ([module, actions]) => actions.map((action) => `${module}:${action}`),
);
