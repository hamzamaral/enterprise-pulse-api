import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const ADMIN = { email: 'admin@enterprisepulse.dev', password: 'Admin123!' };
const MANAGER = { email: 'manager@enterprisepulse.dev', password: 'Manager123!' };
const EMPLOYEE = { email: 'employee@enterprisepulse.dev', password: 'Employee123!' };

const today = () => new Date().toISOString().slice(0, 10);

describe('Fixed assets (e2e)', () => {
  let app: NestExpressApplication;
  const tokens: Record<'admin' | 'manager' | 'employee', string> = {
    admin: '',
    manager: '',
    employee: '',
  };

  const api = (role: keyof typeof tokens) => ({
    get: (url: string) =>
      request(app.getHttpServer())
        .get(`/api/v1${url}`)
        .set('Authorization', `Bearer ${tokens[role]}`),
    post: (url: string, body: object = {}) =>
      request(app.getHttpServer())
        .post(`/api/v1${url}`)
        .set('Authorization', `Bearer ${tokens[role]}`)
        .send(body),
    patch: (url: string, body: object = {}) =>
      request(app.getHttpServer())
        .patch(`/api/v1${url}`)
        .set('Authorization', `Bearer ${tokens[role]}`)
        .send(body),
  });

  const login = async (credentials: { email: string; password: string }) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(credentials)
      .expect(200);
    return res.body.accessToken as string;
  };

  const createAsset = async (overrides: object = {}) => {
    const categories = await api('admin').get('/asset-categories').expect(200);
    const computers = (categories.body as { id: string; code: string }[]).find(
      (c) => c.code === 'BLG',
    )!;
    const res = await api('admin')
      .post('/assets', {
        name: 'e2e laptop',
        categoryId: computers.id,
        brand: 'Test',
        serialNumber: `E2E-${Date.now()}`,
        ...overrides,
      })
      .expect(201);
    return res.body as { id: string; assetTag: string; status: string };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    tokens.admin = await login(ADMIN);
    tokens.manager = await login(MANAGER);
    tokens.employee = await login(EMPLOYEE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists assets for asset managers only', async () => {
    const res = await api('manager').get('/assets?pageSize=5').expect(200);
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('assetTag');
    await api('employee').get('/assets').expect(403);
    await api('manager').post('/assets', { name: 'x' }).expect(403);
  });

  it('calculates straight-line depreciation in the asset detail', async () => {
    const asset = await createAsset({
      purchaseDate: '2020-01-01',
      purchaseCost: 36000,
      salvageValue: 0,
      usefulLifeMonths: 36,
    });
    expect(asset.assetTag).toMatch(/^DMB-\d{4}-\d{6}$/);
    const detail = await api('admin').get(`/assets/${asset.id}`).expect(200);
    expect(detail.body.depreciation).toMatchObject({
      usefulLifeMonths: 36,
      monthlyAmount: '1000.00',
      bookValue: '0.00',
      fullyDepreciated: true,
    });
    expect(detail.body.depreciation.schedule).toHaveLength(3);
  });

  it('assigns, acknowledges, transfers and returns an asset', async () => {
    const asset = await createAsset();
    const me = await api('employee').get('/employees/me').expect(200);

    const assigned = await api('admin')
      .post(`/assets/${asset.id}/assign`, {
        assigneeType: 'EMPLOYEE',
        employeeId: me.body.id,
        assignedAt: today(),
      })
      .expect(200);
    expect(assigned.body).toMatchObject({ status: 'ACTIVE', assigneeName: 'Kerem Polat' });
    expect(assigned.body.number).toMatch(/^ZMT-\d{4}-\d{6}$/);

    // An assigned asset cannot be handed over twice.
    await api('admin')
      .post(`/assets/${asset.id}/assign`, {
        assigneeType: 'EMPLOYEE',
        employeeId: me.body.id,
        assignedAt: today(),
      })
      .expect(409);

    const mine = await api('employee').get('/asset-assignments/mine').expect(200);
    expect((mine.body as { id: string }[]).some((a) => a.id === assigned.body.id)).toBe(true);

    // Only the holder signs the hand-over form.
    const document = await api('employee').get(`/asset-assignments/${assigned.body.id}`);
    expect(document.status).toBe(200);
    expect(document.body.canAcknowledge).toBe(true);
    await api('manager').post(`/asset-assignments/${assigned.body.id}/acknowledge`).expect(403);
    const signed = await api('employee')
      .post(`/asset-assignments/${assigned.body.id}/acknowledge`)
      .expect(200);
    expect(signed.body.acknowledgedAt).toEqual(expect.any(String));
    expect(signed.body.canAcknowledge).toBe(false);

    const departments = await api('admin').get('/departments').expect(200);
    const itDepartment = (departments.body as { id: string; code: string }[]).find(
      (d) => d.code === 'BT',
    )!;
    const transferred = await api('admin')
      .post(`/assets/${asset.id}/transfer`, {
        assigneeType: 'DEPARTMENT',
        departmentId: itDepartment.id,
        assignedAt: today(),
      })
      .expect(200);
    expect(transferred.body).toMatchObject({ assigneeType: 'DEPARTMENT', status: 'ACTIVE' });

    const history = await api('admin')
      .get(`/asset-assignments?assetId=${asset.id}&pageSize=10`)
      .expect(200);
    expect(history.body.meta.total).toBe(2);
    const previous = (history.body.data as { id: string; status: string }[]).find(
      (a) => a.id === assigned.body.id,
    )!;
    expect(previous.status).toBe('RETURNED');

    const returned = await api('admin')
      .post(`/assets/${asset.id}/return`, { returnedAt: today(), conditionIn: 'GOOD' })
      .expect(200);
    expect(returned.body.status).toBe('RETURNED');
    const detail = await api('admin').get(`/assets/${asset.id}`).expect(200);
    expect(detail.body).toMatchObject({ status: 'IN_STOCK', holder: null });
  });

  it('blocks terminating an employee who still holds assets', async () => {
    const employee = await api('admin')
      .post('/employees', {
        firstName: 'Zimmet',
        lastName: `Test ${Date.now()}`,
        hireDate: '2024-01-01',
      })
      .expect(201);
    const asset = await createAsset();
    await api('admin')
      .post(`/assets/${asset.id}/assign`, {
        assigneeType: 'EMPLOYEE',
        employeeId: employee.body.id,
        assignedAt: today(),
      })
      .expect(200);

    const terminate = { terminationDate: today(), reason: 'e2e' };
    const blocked = await api('admin')
      .post(`/employees/${employee.body.id}/terminate`, terminate)
      .expect(409);
    expect(blocked.body.message).toMatch(/still holds 1 asset/);

    await api('admin')
      .post(`/assets/${asset.id}/return`, { returnedAt: today(), conditionIn: 'GOOD' })
      .expect(200);
    await api('admin').post(`/employees/${employee.body.id}/terminate`, terminate).expect(200);
  });

  it('puts an asset into maintenance and back into stock', async () => {
    const asset = await createAsset();
    const opened = await api('admin')
      .post(`/assets/${asset.id}/maintenances`, {
        type: 'REPAIR',
        title: 'Klavye değişimi',
        startedAt: today(),
      })
      .expect(201);
    let detail = await api('admin').get(`/assets/${asset.id}`).expect(200);
    expect(detail.body.status).toBe('IN_MAINTENANCE');

    await api('admin')
      .post(`/assets/${asset.id}/maintenances/${opened.body.id}/complete`, {
        completedAt: today(),
        cost: 1500,
      })
      .expect(200);
    detail = await api('admin').get(`/assets/${asset.id}`).expect(200);
    expect(detail.body.status).toBe('IN_STOCK');
  });

  it('counts assets by QR label, tag and serial number', async () => {
    const category = await api('admin')
      .post('/asset-categories', {
        code: `E2E${Date.now().toString(36).toUpperCase()}`,
        name: 'e2e count',
        usefulLifeMonths: 36,
      })
      .expect(201);
    const categoryId = (category.body as { id: string }).id;
    const first = await createAsset({ categoryId });
    const second = await createAsset({ categoryId, serialNumber: `E2E-SN-${Date.now()}` });
    const outsider = await createAsset();

    await api('manager').post('/asset-counts', { countDate: today(), categoryId }).expect(403);
    const created = await api('admin')
      .post('/asset-counts', { countDate: today(), categoryId })
      .expect(201);
    const count = created.body as { id: string; number: string; expectedCount: number };
    expect(count.number).toMatch(/^DSY-\d{4}-\d{6}$/);
    expect(count.expectedCount).toBe(2);
    await api('admin').post('/asset-counts', { countDate: today(), categoryId }).expect(409);

    const scan = (code: string, status = 200) =>
      api('admin').post(`/asset-counts/${count.id}/scan`, { code }).expect(status);
    expect((await scan(first.assetTag.toLowerCase())).body.result).toBe('FOUND');
    expect((await scan(`http://localhost:5173/assets/${second.id}`)).body.result).toBe('FOUND');
    expect((await scan(first.assetTag)).body.result).toBe('ALREADY_FOUND');
    const unexpected = await scan(outsider.assetTag);
    expect(unexpected.body.result).toBe('UNEXPECTED');
    await scan('DMB-0000-999999', 404);

    const firstLine = (await scan(first.assetTag)).body.line as { id: string };
    await api('admin')
      .patch(`/asset-counts/${count.id}/lines/${firstLine.id}`, { condition: 'DAMAGED' })
      .expect(200);

    const done = await api('admin')
      .post(`/asset-counts/${count.id}/complete`, { applyConditions: true })
      .expect(200);
    expect(done.body).toMatchObject({
      status: 'COMPLETED',
      expectedCount: 2,
      foundCount: 2,
      missingCount: 0,
      unexpectedCount: 1,
    });
    const asset = await api('admin').get(`/assets/${first.id}`).expect(200);
    expect(asset.body.condition).toBe('DAMAGED');
    await scan(first.assetTag, 409);
  });
});
