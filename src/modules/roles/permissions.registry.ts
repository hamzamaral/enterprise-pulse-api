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
  departments: ['read', 'create', 'update', 'delete'],
  positions: ['read', 'create', 'update', 'delete'],
  employees: ['read', 'create', 'update', 'delete'],
  /** read = all requests, create = on behalf of others, update = types, balances, holidays. */
  leave: ['read', 'create', 'update'],
  /** read = timesheets and shift plans; update = correct records, define and plan shifts. */
  attendance: ['read', 'update'],
  /**
   * update also covers categories, locations and maintenance; assign = hand over, return, transfer;
   * count = run asset counts (scan, complete).
   */
  assets: ['read', 'create', 'update', 'delete', 'assign', 'count'],
  /** create/update/delete = products, variants, categories, warehouses; move = post stock movements. */
  inventory: ['read', 'create', 'update', 'delete', 'move', 'count'],
  /** Customers and suppliers; partner lookups are also open to purchasing, sales and finance. */
  partners: ['read', 'create', 'update', 'delete'],
  /** approve = purchase orders; receive = post goods receipts into stock. */
  purchasing: ['read', 'create', 'update', 'approve', 'receive'],
  /** deliver = delivery notes and returns; invoice = issue and cancel sales invoices. */
  sales: ['read', 'create', 'update', 'approve', 'deliver', 'invoice'],
  /** create = collections, payments and cheques; approve = cancel postings. */
  finance: ['read', 'create', 'update', 'approve'],
} as const satisfies Record<string, readonly string[]>;

export type PermissionModule = keyof typeof PERMISSION_REGISTRY;

export const ALL_PERMISSION_CODES: string[] = Object.entries(PERMISSION_REGISTRY).flatMap(
  ([module, actions]) => actions.map((action) => `${module}:${action}`),
);
