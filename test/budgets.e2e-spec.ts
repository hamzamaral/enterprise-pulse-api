import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

const USERS = {
  admin: { email: 'admin@enterprisepulse.dev', password: 'Admin123!' },
  manager: { email: 'manager@enterprisepulse.dev', password: 'Manager123!' },
  employee: { email: 'employee@enterprisepulse.dev', password: 'Employee123!' },
};

interface Row {
  itemId: string;
  planned: string[];
  actual: string[];
  plannedYtd: string;
  actualYtd: string;
  variance: string;
  state: string;
}

interface Budget {
  id: string;
  name: string;
  status: string;
  revision: number;
  ownerId: string | null;
  rows: Row[];
  events: { type: string; note: string | null }[];
  canEdit: boolean;
  canApprove: boolean;
  canReopen: boolean;
}

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
const YEAR = Number(TODAY.slice(0, 4));
const MONTH = Number(TODAY.slice(5, 7));
const twelve = (amount: number) => Array.from({ length: 12 }, () => amount);

describe('Budgets (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  const ids = { admin: '', manager: '', employee: '' };
  let companyId = '';
  let departmentId = '';
  let childDepartmentId = '';
  let itemId = '';

  const api = (role: keyof typeof tokens) => {
    const auth = `Bearer ${tokens[role]}`;
    const server = () => request(app.getHttpServer());
    return {
      get: (url: string) => server().get(`/api/v1${url}`).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        server().post(`/api/v1${url}`).set('Authorization', auth).send(body),
      put: (url: string, body: object) =>
        server().put(`/api/v1${url}`).set('Authorization', auth).send(body),
      patch: (url: string, body: object) =>
        server().patch(`/api/v1${url}`).set('Authorization', auth).send(body),
      delete: (url: string) => server().delete(`/api/v1${url}`).set('Authorization', auth),
    };
  };

  const cleanUp = async () => {
    const budgets = await prisma.budget.findMany({
      where: { companyId, name: { startsWith: 'E2E ' } },
      select: { id: true },
    });
    await prisma.notification.deleteMany({
      where: { link: { in: budgets.map((b) => `/budgets/${b.id}`) } },
    });
    await prisma.budget.deleteMany({ where: { id: { in: budgets.map((b) => b.id) } } });
    await prisma.budgetEntry.deleteMany({
      where: { companyId, description: { startsWith: 'E2E ' } },
    });
    const items = await prisma.budgetItem.findMany({
      where: { companyId, code: { startsWith: 'E2E' } },
      select: { id: true },
    });
    await prisma.budgetAlert.deleteMany({ where: { itemId: { in: items.map((i) => i.id) } } });
    await prisma.budgetLine.deleteMany({ where: { itemId: { in: items.map((i) => i.id) } } });
    await prisma.budgetItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
    await prisma.department.deleteMany({
      where: { companyId, code: { startsWith: 'E2E-' }, parentId: { not: null } },
    });
    await prisma.department.deleteMany({ where: { companyId, code: { startsWith: 'E2E-' } } });
  };

  const entry = (amount: number, department: string | null = departmentId) =>
    api('admin')
      .post('/budget-entries', {
        itemId,
        departmentId: department,
        entryDate: `${YEAR}-${String(MONTH).padStart(2, '0')}-01`,
        amount,
        description: 'E2E gerçekleşen',
      })
      .expect(201);

  const createBudget = async (body: object = {}) =>
    (
      await api('admin')
        .post('/budgets', {
          year: YEAR,
          departmentId,
          name: 'E2E Bütçe',
          ownerId: ids.employee,
          ...body,
        })
        .expect(201)
    ).body as Budget;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    for (const role of Object.keys(tokens) as (keyof typeof tokens)[]) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(USERS[role])
        .expect(200);
      tokens[role] = (res.body as { accessToken: string }).accessToken;
      const user = await prisma.user.findUniqueOrThrow({ where: { email: USERS[role].email } });
      ids[role] = user.id;
    }
    const membership = await prisma.userCompany.findFirstOrThrow({
      where: { userId: ids.employee, isDefault: true },
    });
    companyId = membership.companyId;
    await cleanUp();

    const parent = await prisma.department.create({
      data: { companyId, code: 'E2E-BTC', name: 'E2E Bütçe Birimi' },
    });
    const child = await prisma.department.create({
      data: { companyId, code: 'E2E-BTC-ALT', name: 'E2E Alt Birim', parentId: parent.id },
    });
    departmentId = parent.id;
    childDepartmentId = child.id;
    const item = await api('admin')
      .post('/budget-items', { code: 'E2E-K', name: 'E2E Kira', kind: 'EXPENSE' })
      .expect(201);
    itemId = (item.body as { id: string }).id;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('keeps budgets to permission holders and owners', async () => {
    const own = await api('employee').get(`/budgets?year=${YEAR}`).expect(200);
    expect((own.body as { budgets: unknown[] }).budgets).toHaveLength(0);
    await api('employee').get('/budget-items').expect(403);
    await api('employee').get('/budget-entries').expect(403);
    await api('employee').post('/budgets', { year: YEAR }).expect(403);
    await api('manager').post('/budgets', { year: YEAR }).expect(403);
    const all = await api('manager').get(`/budgets?year=${YEAR}`).expect(200);
    expect((all.body as { budgets: unknown[] }).budgets.length).toBeGreaterThan(0);
    await api('admin').get('/budgets?year=1999').expect(400);
  });

  it('keeps every actual mapped to a single item', async () => {
    const taxi = await prisma.expenseCategory.findFirstOrThrow({
      where: { companyId, code: 'TAKSI' },
    });
    await api('admin')
      .post('/budget-items', {
        code: 'E2E-T',
        name: 'E2E Taksi',
        kind: 'EXPENSE',
        source: 'EXPENSES',
        categoryIds: [taxi.id],
      })
      .expect(409);
    await api('admin')
      .post('/budget-items', { code: 'E2E-S', name: 'E2E Satış', kind: 'EXPENSE', source: 'SALES' })
      .expect(400);
    await api('admin')
      .post('/budget-items', {
        code: 'E2E-P',
        name: 'E2E Personel',
        kind: 'EXPENSE',
        source: 'PAYROLL',
      })
      .expect(409);
    await api('admin')
      .post('/budget-items', {
        code: 'E2E-M',
        name: 'E2E Manuel',
        kind: 'EXPENSE',
        categoryIds: [taxi.id],
      })
      .expect(400);
    await api('admin')
      .post('/budget-items', { code: 'E2E-K', name: 'E2E Kopya', kind: 'EXPENSE' })
      .expect(409);
    // An inactive item does not claim its categories.
    const idle = await api('admin')
      .post('/budget-items', {
        code: 'E2E-T',
        name: 'E2E Taksi',
        kind: 'EXPENSE',
        source: 'EXPENSES',
        categoryIds: [taxi.id],
        isActive: false,
      })
      .expect(201);
    const idleId = (idle.body as { id: string }).id;
    await api('admin').patch(`/budget-items/${idleId}`, { isActive: true }).expect(409);
    await api('admin').delete(`/budget-items/${idleId}`).expect(204);
  });

  it('plans, approves and reopens a department budget', async () => {
    const budget = await createBudget();
    expect(budget).toMatchObject({ status: 'DRAFT', ownerId: ids.employee, canEdit: true });
    await api('admin').post('/budgets', { year: YEAR, departmentId }).expect(409);
    await api('admin').post(`/budgets/${budget.id}/approve`).expect(400);
    await api('admin')
      .put(`/budgets/${budget.id}/plan`, { lines: [{ itemId, amounts: [1, 2, 3] }] })
      .expect(400);
    await api('admin')
      .put(`/budgets/${budget.id}/plan`, {
        lines: [
          { itemId, amounts: twelve(1000) },
          { itemId, amounts: twelve(5) },
        ],
      })
      .expect(400);

    const planned = (
      await api('admin')
        .put(`/budgets/${budget.id}/plan`, { lines: [{ itemId, amounts: twelve(1000) }] })
        .expect(200)
    ).body as Budget;
    expect(planned.rows[0]).toMatchObject({ itemId, plannedYtd: `${1000 * MONTH}.00` });

    await api('manager').post(`/budgets/${budget.id}/approve`).expect(403);
    const approved = (await api('admin').post(`/budgets/${budget.id}/approve`).expect(200))
      .body as Budget;
    expect(approved).toMatchObject({ status: 'APPROVED', canEdit: false, canReopen: true });
    await api('admin')
      .put(`/budgets/${budget.id}/plan`, { lines: [{ itemId, amounts: twelve(1) }] })
      .expect(409);
    await api('admin').delete(`/budgets/${budget.id}`).expect(409);

    // The owner follows the budget without `budgets:read`.
    const own = await api('employee').get(`/budgets?year=${YEAR}`).expect(200);
    expect((own.body as { budgets: { id: string }[] }).budgets.map((b) => b.id)).toEqual([
      budget.id,
    ]);
    await api('employee').get(`/budgets/${budget.id}`).expect(200);
    const note = await prisma.notification.findFirst({
      where: { userId: ids.employee, link: `/budgets/${budget.id}` },
      orderBy: { createdAt: 'desc' },
    });
    expect(note?.title).toContain('Bütçe onaylandı');

    await api('admin').post(`/budgets/${budget.id}/reopen`, { reason: 'x' }).expect(400);
    const reopened = (
      await api('admin').post(`/budgets/${budget.id}/reopen`, { reason: 'Kira artışı' }).expect(200)
    ).body as Budget;
    expect(reopened).toMatchObject({ status: 'DRAFT', revision: 1 });
    expect(reopened.events.map((e) => e.type)).toEqual([
      'CREATED',
      'PLAN_UPDATED',
      'APPROVED',
      'REOPENED',
    ]);
    await api('admin').delete(`/budgets/${budget.id}`).expect(204);
  });

  it('compares the plan with actuals of the department and its sub-departments', async () => {
    const budget = await createBudget();
    await api('admin')
      .put(`/budgets/${budget.id}/plan`, { lines: [{ itemId, amounts: twelve(1000) }] })
      .expect(200);
    const row = async () =>
      ((await api('admin').get(`/budgets/${budget.id}`).expect(200)).body as Budget).rows.find(
        (r) => r.itemId === itemId,
      )!;

    await api('admin')
      .post('/budget-entries', {
        itemId,
        entryDate: TODAY,
        amount: 0,
        description: 'E2E sıfır',
      })
      .expect(400);
    await entry(1000 * MONTH);
    expect(await row()).toMatchObject({ actualYtd: `${1000 * MONTH}.00`, state: 'ON_TRACK' });
    await entry(50, childDepartmentId);
    expect(await row()).toMatchObject({ variance: '50.00', state: 'WARNING' });
    // Company-wide entries do not count in a department budget.
    await entry(500, null);
    expect((await row()).state).toBe('WARNING');
    await entry(200 * MONTH);
    expect((await row()).state).toBe('OVER');

    const drill = await api('admin')
      .get(`/budgets/${budget.id}/actuals?itemId=${itemId}&month=${MONTH}`)
      .expect(200);
    const documents = drill.body as { documentType: string; departmentName: string | null }[];
    expect(documents).toHaveLength(3);
    expect(documents.every((d) => d.documentType === 'MANUAL_ENTRY')).toBe(true);
    expect(documents.map((d) => d.departmentName).sort()).toEqual([
      'E2E Alt Birim',
      'E2E Bütçe Birimi',
      'E2E Bütçe Birimi',
    ]);

    const entries = await api('admin').get(`/budget-entries?year=${YEAR}&itemId=${itemId}`);
    expect((entries.body as { meta: { total: number } }).meta.total).toBe(4);

    // Next year's draft from this year's actuals, +10%.
    const next = await createBudget({ year: YEAR + 1, basis: 'ACTUALS', adjustPercent: 10 });
    const nextRow = next.rows.find((r) => r.itemId === itemId)!;
    expect(nextRow.planned[MONTH - 1]).toBe(`${Math.round((1200 * MONTH + 50) * 1.1)}.00`);
    // A copy of another budget.
    const copy = await createBudget({ year: YEAR + 2, basis: 'BUDGET', sourceBudgetId: budget.id });
    expect(copy.rows.find((r) => r.itemId === itemId)!.planned).toEqual(
      twelve(1000).map((v) => `${v}.00`),
    );
  });

  it('alerts the owner once per level when the yearly plan runs out', async () => {
    const budget = (await prisma.budget.findFirstOrThrow({
      where: { companyId, year: YEAR, departmentId },
    })) as { id: string };
    await api('admin').post(`/budgets/${budget.id}/approve`).expect(200);
    const alerts = () =>
      prisma.budgetAlert.findMany({ where: { budgetId: budget.id }, orderBy: { level: 'asc' } });

    // Actuals so far: 1200 × month + 50; take them to 95% of the yearly 12 000.
    const spent = 1200 * MONTH + 50;
    if (spent < 11_400) await entry(11_400 - spent);
    else await entry(-(spent - 11_400));
    await api('employee').post('/budgets/run').expect(403);
    await api('admin').post('/budgets/run').expect(200);
    expect((await alerts()).map((a) => a.level)).toEqual(['WARNING']);
    await api('admin').post('/budgets/run').expect(200);
    expect(await alerts()).toHaveLength(1);

    await entry(1000);
    await api('admin').post('/budgets/run').expect(200);
    expect((await alerts()).map((a) => a.level)).toEqual(['WARNING', 'OVER']);
    const notes = await prisma.notification.findMany({
      where: { userId: ids.employee, link: `/budgets/${budget.id}` },
      orderBy: { createdAt: 'asc' },
    });
    expect(notes.map((n) => n.title).slice(-2)).toEqual([
      "Bütçenin %90'ı kullanıldı: E2E Kira",
      'Bütçe aşıldı: E2E Kira',
    ]);
    const detail = (await api('admin').get(`/budgets/${budget.id}`).expect(200)).body as Budget;
    expect(detail.events.filter((e) => e.type === 'ALERT_SENT')).toHaveLength(2);

    await api('admin').post(`/budgets/${budget.id}/reopen`, { reason: 'Revizyon' }).expect(200);
    expect(await alerts()).toHaveLength(0);
    await api('admin').delete(`/budget-items/${itemId}`).expect(409);
  });
});
