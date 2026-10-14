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
  /** Leads, opportunities and activities; update also covers stage changes and conversions. */
  crm: ['read', 'create', 'update', 'delete'],
  /**
   * Own reports need no permission. read = every report, create = file for others,
   * update = categories and closing others' reports, pay = reimburse and reverse payments.
   */
  expenses: ['read', 'create', 'update', 'pay'],
  /**
   * Members work on their own projects without a permission and leads / managers run them.
   * read = every project and the time report, create = new projects, update = run any project,
   * delete = remove projects that have no logged time.
   */
  projects: ['read', 'create', 'update', 'delete'],
  /**
   * Own payslips need no permission. read = periods, payslips and salaries; create = open,
   * recalculate and edit draft periods; update = salaries and yearly parameters;
   * approve = approve and reopen periods; pay = pay and reverse net salaries.
   */
  payroll: ['read', 'create', 'update', 'approve', 'pay'],
  /**
   * Interviewers see and rate their own interviews without a permission. read = postings,
   * candidates and pipelines; create = postings, candidates, applications, interviews, offers and
   * pipeline moves; update = edit postings, candidates and interviews; delete = remove them;
   * hire = turn a candidate with an accepted offer into an employee.
   */
  recruitment: ['read', 'create', 'update', 'delete', 'hire'],
  /**
   * Employees fill in their own reviews and managers review their direct reports without a
   * permission. read = cycles, competencies and every review; create / update / delete = cycles and
   * competencies; update also lets HR act as the reviewer and reopen completed reviews.
   */
  performance: ['read', 'create', 'update', 'delete'],
  /**
   * Employees see their own trainings, enroll in open sessions and rate them without a permission.
   * read = catalog, sessions and compliance; create / update / delete = courses, sessions and
   * enrollments; update also records attendance.
   */
  training: ['read', 'create', 'update', 'delete'],
  /**
   * Everyone opens tickets and follows their own requests without a permission. read = the queue,
   * every ticket and internal notes; create = open tickets on behalf of others; update = work
   * tickets (assign, status, priority, internal notes), categories and SLA targets; delete = remove
   * tickets.
   */
  support: ['read', 'create', 'update', 'delete'],
  /**
   * read = every contract, the dashboard and owning contracts; create = new drafts; update = edit,
   * activate, renew, terminate, attachments, contract types and running the reminder job;
   * delete = remove drafts.
   */
  contracts: ['read', 'create', 'update', 'delete'],
  /**
   * Owners see their own budgets without a permission. read = every budget, its actuals and the
   * manual entries; update = create budgets, edit drafts and plans, items, manual entries and run
   * the overspend check; approve = approve and reopen budgets.
   */
  budgets: ['read', 'update', 'approve'],
  /**
   * Drivers see the vehicles assigned to them and add fuel and odometer readings without a
   * permission. read = every vehicle, the fuel log and the dashboard; update = vehicles, handovers,
   * services, documents, deleting entries and running the reminder job.
   */
  fleet: ['read', 'update'],
  /**
   * read = journal, ledgers, trial balance and financial statements; update = chart of accounts and
   * draft entries; approve = post and reverse entries and run automatic posting; close = lock periods.
   */
  accounting: ['read', 'update', 'approve', 'close'],
} as const satisfies Record<string, readonly string[]>;

export type PermissionModule = keyof typeof PERMISSION_REGISTRY;

export const ALL_PERMISSION_CODES: string[] = Object.entries(PERMISSION_REGISTRY).flatMap(
  ([module, actions]) => actions.map((action) => `${module}:${action}`),
);
