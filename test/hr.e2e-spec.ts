import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const ADMIN = { email: 'admin@enterprisepulse.dev', password: 'Admin123!' };
const MANAGER = { email: 'manager@enterprisepulse.dev', password: 'Manager123!' };
const EMPLOYEE = { email: 'employee@enterprisepulse.dev', password: 'Employee123!' };

/** First weekday at least `offset` days from today, as "YYYY-MM-DD". */
function futureWeekday(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

describe('Human resources (e2e)', () => {
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
  });

  const login = async (credentials: { email: string; password: string }) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(credentials)
      .expect(200);
    return res.body.accessToken as string;
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

  it('lists employees for HR and hides them from regular employees', async () => {
    const res = await api('admin').get('/employees?pageSize=5').expect(200);
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('fullName');
    await api('employee').get('/employees').expect(403);
  });

  it('returns the org chart and the caller’s own record to everyone', async () => {
    const chart = await api('employee').get('/employees/org-chart').expect(200);
    expect(chart.body.length).toBeGreaterThan(0);
    expect(chart.body[0].children.length).toBeGreaterThan(0);

    const me = await api('employee').get('/employees/me').expect(200);
    expect(me.body.fullName).toBe('Kerem Polat');
    expect(me.body.hireDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects a circular department hierarchy', async () => {
    const departments = await api('admin').get('/departments').expect(200);
    const list = departments.body as { id: string; code: string; parentId: string | null }[];
    const root = list.find((d) => d.code === 'YON')!;
    const child = list.find((d) => d.parentId === root.id)!;
    await request(app.getHttpServer())
      .patch(`/api/v1/departments/${root.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ parentId: child.id })
      .expect(400);
  });

  it('calculates working days excluding holidays', async () => {
    const year = new Date().getFullYear();
    // Republic Day (Oct 29) is seeded as a holiday every year.
    const res = await api('employee')
      .get(`/leave-requests/working-days?startDate=${year}-10-29&endDate=${year}-10-29`)
      .expect(200);
    expect(res.body.days).toBe(0);
  });

  it('rejects requests exceeding the annual leave balance', async () => {
    const types = await api('employee').get('/leave-types').expect(200);
    const annual = (types.body as { id: string; code: string }[]).find((t) => t.code === 'YILLIK')!;
    const year = new Date().getFullYear();
    // 19 working days in January against a 14-day entitlement.
    const res = await api('employee')
      .post('/leave-requests', {
        leaveTypeId: annual.id,
        startDate: `${year}-01-05`,
        endDate: `${year}-01-30`,
      })
      .expect(400);
    expect(res.body.message).toMatch(/Insufficient balance/);
  });

  it('runs a leave request through the approval workflow and cancels it', async () => {
    const types = await api('employee').get('/leave-types').expect(200);
    const sick = (types.body as { id: string; code: string }[]).find((t) => t.code === 'HASTALIK')!;
    const day = futureWeekday(40);

    const created = await api('employee')
      .post('/leave-requests', {
        leaveTypeId: sick.id,
        startDate: day,
        endDate: day,
        reason: 'e2e',
      })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'PENDING', days: 1 });
    const instanceId = created.body.workflowInstanceId as string;
    expect(instanceId).toEqual(expect.any(String));

    // Overlapping requests are refused while the first one is open.
    await api('employee')
      .post('/leave-requests', { leaveTypeId: sick.id, startDate: day, endDate: day })
      .expect(409);

    await api('employee').post(`/workflow/instances/${instanceId}/approve`).expect(403);
    await api('manager').post(`/workflow/instances/${instanceId}/approve`).expect(200);
    await api('admin').post(`/workflow/instances/${instanceId}/approve`).expect(200);

    const approved = await api('employee').get(`/leave-requests/${created.body.id}`).expect(200);
    expect(approved.body.status).toBe('APPROVED');

    // Approved leave can only be cancelled by HR.
    await api('employee').post(`/leave-requests/${created.body.id}/cancel`).expect(403);
    const cancelled = await api('admin')
      .post(`/leave-requests/${created.body.id}/cancel`)
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
  });

  it('lets the requester withdraw a pending request', async () => {
    const types = await api('employee').get('/leave-types').expect(200);
    const unpaid = (types.body as { id: string; code: string }[]).find(
      (t) => t.code === 'UCRETSIZ',
    )!;
    const day = futureWeekday(45);

    const created = await api('employee')
      .post('/leave-requests', { leaveTypeId: unpaid.id, startDate: day, endDate: day })
      .expect(201);
    const withdrawn = await api('employee')
      .post(`/leave-requests/${created.body.id}/cancel`, { comment: 'Plan değişti' })
      .expect(200);
    expect(withdrawn.body.status).toBe('CANCELLED');

    const instance = await api('employee')
      .get(`/workflow/instances/${created.body.workflowInstanceId}`)
      .expect(200);
    expect(instance.body.status).toBe('CANCELLED');
  });
});
