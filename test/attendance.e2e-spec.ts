import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const ADMIN = { email: 'admin@enterprisepulse.dev', password: 'Admin123!' };
const MANAGER = { email: 'manager@enterprisepulse.dev', password: 'Manager123!' };
const EMPLOYEE = { email: 'employee@enterprisepulse.dev', password: 'Employee123!' };

interface Day {
  date: string;
  status: string;
  shiftCode: string | null;
  checkIn: string | null;
  checkOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
}

describe('Attendance and shifts (e2e)', () => {
  let app: NestExpressApplication;
  let employeeId: string;
  const tokens: Record<'admin' | 'manager' | 'employee', string> = {
    admin: '',
    manager: '',
    employee: '',
  };

  const api = (role: keyof typeof tokens) => {
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${tokens[role]}`);
    const server = () => request(app.getHttpServer());
    return {
      get: (url: string) => auth(server().get(`/api/v1${url}`)),
      post: (url: string, body: object = {}) => auth(server().post(`/api/v1${url}`)).send(body),
      put: (url: string, body: object) => auth(server().put(`/api/v1${url}`)).send(body),
    };
  };

  const login = async (credentials: { email: string; password: string }) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(credentials)
      .expect(200);
    return res.body.accessToken as string;
  };

  /** A past default-schedule working day of the employee (no leave, holiday or plan entry). */
  const pastWorkday = async (): Promise<string> => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - 1);
    const month = date.toISOString().slice(0, 7);
    const res = await api('admin').get(`/attendance/timesheet?month=${month}`).expect(200);
    const row = (res.body.rows as { employeeId: string; days: Day[] }[]).find(
      (r) => r.employeeId === employeeId,
    )!;
    const day = row.days.find(
      (d) => ['PRESENT', 'LATE', 'ABSENT'].includes(d.status) && d.shiftCode === null,
    );
    if (!day) throw new Error('No working day found in the previous month');
    return day.date;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    tokens.admin = await login(ADMIN);
    tokens.manager = await login(MANAGER);
    tokens.employee = await login(EMPLOYEE);
    const me = await api('employee').get('/employees/me').expect(200);
    employeeId = me.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('restricts the timesheet to HR and lets managers only read it', async () => {
    const month = new Date().toISOString().slice(0, 7);
    await api('employee').get(`/attendance/timesheet?month=${month}`).expect(403);
    const res = await api('manager').get(`/attendance/timesheet?month=${month}`).expect(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    const body = res.body as { days: string[]; rows: { days: Day[] }[] };
    expect(body.rows[0].days).toHaveLength(body.days.length);
    await api('manager')
      .put('/attendance/records', { employeeId, date: res.body.today, checkIn: '09:00' })
      .expect(403);
    await api('employee').get('/shifts').expect(403);
  });

  it('lets employees check in and out once per day', async () => {
    const before = await api('employee').get('/attendance/me').expect(200);
    const today = before.body.today.date as string;
    // Start from a clean day so the test can be repeated against the same database.
    await api('admin')
      .put('/attendance/records', { employeeId, date: today, checkIn: null, checkOut: null })
      .expect(200);

    const checkedIn = await api('employee').post('/attendance/check-in').expect(200);
    expect(checkedIn.body.today.checkIn).toMatch(/^\d{2}:\d{2}$/);
    expect(checkedIn.body).toMatchObject({ canCheckIn: false, canCheckOut: true });
    await api('employee').post('/attendance/check-in').expect(409);

    const checkedOut = await api('employee').post('/attendance/check-out').expect(200);
    expect(checkedOut.body.today.checkOut).toMatch(/^\d{2}:\d{2}$/);
    expect(checkedOut.body.canCheckOut).toBe(false);
    await api('employee').post('/attendance/check-out').expect(409);

    await api('admin').get('/employees/me').expect(404);
    await api('admin').post('/attendance/check-in').expect(404);
  });

  it('calculates lateness from manual corrections', async () => {
    const date = await pastWorkday();
    const late = await api('admin')
      .put('/attendance/records', { employeeId, date, checkIn: '09:30', checkOut: '18:00' })
      .expect(200);
    expect(late.body).toMatchObject({
      status: 'LATE',
      lateMinutes: 30,
      workedMinutes: 450,
      source: 'MANUAL',
    });

    await api('admin')
      .put('/attendance/records', { employeeId, date, checkOut: '18:00' })
      .expect(400);
    const cleared = await api('admin')
      .put('/attendance/records', { employeeId, date, checkIn: null, checkOut: null })
      .expect(200);
    expect(cleared.body.status).toBe('ABSENT');
  });

  it('plans shifts, including night shifts that end the next day', async () => {
    const code = `E2E-${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    const shift = await api('admin')
      .post('/shifts', {
        code,
        name: 'E2E gece',
        startTime: '23:00',
        endTime: '07:00',
        breakMinutes: 30,
      })
      .expect(201);
    expect(shift.body.plannedMinutes).toBe(450);
    await api('admin')
      .post('/shifts', {
        code,
        name: 'Kopya',
        startTime: '08:00',
        endTime: '16:00',
        breakMinutes: 30,
      })
      .expect(409);
    await api('admin')
      .post('/shifts', {
        code: `${code}X`.slice(0, 20),
        name: 'Hatalı',
        startTime: '08:00',
        endTime: '08:00',
        breakMinutes: 0,
      })
      .expect(400);

    const date = await pastWorkday();
    await api('admin')
      .put('/shift-plan', { entries: [{ employeeId, date, shiftId: shift.body.id }] })
      .expect(200);
    const plan = await api('admin').get(`/shift-plan?from=${date}&to=${date}`).expect(200);
    expect(plan.body.entries).toContainEqual({ employeeId, date, shiftId: shift.body.id });

    const night = await api('admin')
      .put('/attendance/records', { employeeId, date, checkIn: '22:55', checkOut: '07:40' })
      .expect(200);
    expect(night.body).toMatchObject({
      status: 'PRESENT',
      shiftCode: code,
      workedMinutes: 495,
      overtimeMinutes: 45,
    });

    await api('admin')
      .put('/shift-plan', { entries: [{ employeeId, date, shiftId: null }] })
      .expect(200);
    const off = await api('admin')
      .put('/attendance/records', { employeeId, date, checkIn: null, checkOut: null })
      .expect(200);
    expect(off.body.status).toBe('OFF');

    await api('admin')
      .put('/shift-plan', { entries: [{ employeeId, date, useDefault: true }] })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/shifts/${shift.body.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ isActive: false })
      .expect(200);
    await api('admin')
      .put('/shift-plan', { entries: [{ employeeId, date, shiftId: shift.body.id }] })
      .expect(404);
  });
});
