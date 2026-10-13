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

interface Session {
  id: string;
  status: string;
  enrolledCount: number;
  seatsLeft: number | null;
  canComplete: boolean;
  enrollments: {
    id: string;
    employeeId: string;
    status: string;
    score: number | null;
    certificateExpiresAt: string | null;
  }[];
}
interface MyTraining {
  id: string;
  sessionId: string;
  status: string;
  canCancel: boolean;
  canGiveFeedback: boolean;
  feedbackRating: number | null;
}
interface Compliance {
  courses: { courseId: string; valid: number; missing: number }[];
  employees: { employeeId: string; items: { courseId: string; status: string }[] }[];
  rate: number | null;
}

const hours = (offset: number) => new Date(Date.now() + offset * 3_600_000).toISOString();

describe('Training (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  let companyId = '';
  let keremId = '';
  let elifId = '';
  let ahmetId = '';

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
    const courses = await prisma.trainingCourse.findMany({
      where: { companyId, code: { startsWith: 'E2E-' } },
      select: { id: true },
    });
    const ids = courses.map((c) => c.id);
    await prisma.trainingSession.deleteMany({ where: { courseId: { in: ids } } });
    await prisma.trainingCourse.deleteMany({ where: { id: { in: ids } } });
  };

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
    }
    const kerem = await prisma.employee.findFirstOrThrow({
      where: { user: { email: USERS.employee.email } },
    });
    keremId = kerem.id;
    companyId = kerem.companyId;
    const others = await prisma.employee.findMany({
      where: { companyId, employeeNo: { in: ['PRS-000008', 'PRS-000009'] } },
      orderBy: { employeeNo: 'asc' },
    });
    [elifId, ahmetId] = others.map((e) => e.id);
    await cleanUp();
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('keeps the catalog to HR and history to the employee', async () => {
    await api('employee').get('/training-courses').expect(403);
    await api('employee').get('/training-sessions').expect(403);
    await api('employee').get('/trainings/compliance').expect(403);
    await api('manager').get('/training-sessions').expect(200);
    await api('manager').post('/training-courses', {}).expect(403);

    const mine = (await api('employee').get('/trainings/mine').expect(200)).body as {
      trainings: MyTraining[];
      mandatory: { status: string }[];
      courses: unknown[];
    };
    expect(mine.mandatory.length).toBe(mine.courses.length);
    expect(mine.mandatory.length).toBeGreaterThan(0);
    await api('employee').get(`/trainings/employees/${keremId}`).expect(403);
  });

  it('enrolls, records attendance and issues certificates', async () => {
    const course = (
      await api('admin')
        .post('/training-courses', {
          code: 'e2e-ilk',
          title: 'E2E İlk Yardım',
          category: 'OCCUPATIONAL_SAFETY',
          durationHours: 4,
          isMandatory: true,
          validityMonths: 24,
        })
        .expect(201)
    ).body as { id: string; code: string };
    expect(course.code).toBe('E2E-ILK');
    await api('admin')
      .post('/training-courses', {
        code: 'E2E-ILK',
        title: 'Kopya',
        category: 'TECHNICAL',
        durationHours: 1,
      })
      .expect(409);

    await api('admin')
      .post('/training-sessions', {
        courseId: course.id,
        startsAt: hours(-1),
        endsAt: hours(-2),
      })
      .expect(400);
    const endsAt = hours(-1);
    let past = (
      await api('admin')
        .post('/training-sessions', {
          courseId: course.id,
          startsAt: hours(-3),
          endsAt,
          capacity: 2,
          cost: 2500,
          employeeIds: [keremId, elifId],
        })
        .expect(201)
    ).body as Session;
    expect(past).toMatchObject({ enrolledCount: 2, seatsLeft: 0, canComplete: true });
    await api('admin')
      .post(`/training-sessions/${past.id}/enrollments`, { employeeIds: [ahmetId] })
      .expect(409);

    // Self-enrollment into a future session with one seat.
    const future = (
      await api('admin')
        .post('/training-sessions', {
          courseId: course.id,
          startsAt: hours(48),
          endsAt: hours(52),
          capacity: 1,
          selfEnrollment: true,
        })
        .expect(201)
    ).body as Session;
    const open = (await api('employee').get('/training-sessions/open').expect(200)).body as {
      id: string;
      enrolled: boolean;
    }[];
    expect(open.find((s) => s.id === future.id)?.enrolled).toBe(false);
    const seat = (
      await api('employee').post(`/training-sessions/${future.id}/enroll-me`).expect(201)
    ).body as MyTraining;
    expect(seat).toMatchObject({ status: 'ENROLLED', canCancel: true });
    await api('employee').post(`/training-sessions/${future.id}/enroll-me`).expect(409);
    await api('manager').post(`/training-sessions/${future.id}/enroll-me`).expect(409);
    await api('employee').delete(`/training-sessions/${future.id}/enroll-me`).expect(200);
    await api('manager').post(`/training-sessions/${future.id}/enroll-me`).expect(201);
    await api('admin')
      .post(`/training-sessions/${future.id}/complete`, { attendance: [] })
      .expect(409);

    // Attendance: Kerem attended, Elif is left out and becomes a no-show.
    const keremSeat = past.enrollments.find((e) => e.employeeId === keremId)!;
    const elifSeat = past.enrollments.find((e) => e.employeeId === elifId)!;
    await api('employee')
      .put(`/training-enrollments/${keremSeat.id}/feedback`, { rating: 5 })
      .expect(409);
    past = (
      await api('admin')
        .post(`/training-sessions/${past.id}/complete`, {
          attendance: [{ enrollmentId: keremSeat.id, attended: true, score: 90 }],
        })
        .expect(201)
    ).body as Session;
    expect(past.status).toBe('COMPLETED');
    const expected = new Date(endsAt);
    expected.setUTCFullYear(expected.getUTCFullYear() + 2);
    expect(past.enrollments.find((e) => e.id === keremSeat.id)).toMatchObject({
      status: 'ATTENDED',
      score: 90,
      certificateExpiresAt: expected.toISOString().slice(0, 10),
    });
    expect(past.enrollments.find((e) => e.id === elifSeat.id)?.status).toBe('NO_SHOW');
    await api('admin')
      .post(`/training-sessions/${past.id}/complete`, { attendance: [] })
      .expect(409);
    await api('admin').delete(`/training-enrollments/${keremSeat.id}`).expect(409);
    await api('admin').delete(`/training-sessions/${past.id}`).expect(409);

    // Only the participant rates an attended training.
    const rated = (
      await api('employee')
        .put(`/training-enrollments/${keremSeat.id}/feedback`, { rating: 4, comment: 'Faydalı' })
        .expect(200)
    ).body as MyTraining;
    expect(rated.feedbackRating).toBe(4);
    await api('employee')
      .put(`/training-enrollments/${elifSeat.id}/feedback`, { rating: 1 })
      .expect(403);

    const compliance = (await api('admin').get('/trainings/compliance').expect(200))
      .body as Compliance;
    const status = (employeeId: string) =>
      compliance.employees
        .find((e) => e.employeeId === employeeId)!
        .items.find((i) => i.courseId === course.id)!.status;
    expect(status(keremId)).toBe('VALID');
    expect(status(elifId)).toBe('MISSING');
    expect(compliance.courses.find((c) => c.courseId === course.id)?.valid).toBe(1);

    const mine = (await api('employee').get('/trainings/mine').expect(200)).body as {
      trainings: MyTraining[];
    };
    expect(mine.trainings.find((t) => t.id === keremSeat.id)?.canGiveFeedback).toBe(true);
    const summary = (await api('admin').get('/trainings/summary').expect(200)).body as {
      upcomingSessions: number;
      hoursThisYear: string;
    };
    expect(summary.upcomingSessions).toBeGreaterThan(0);
    expect(Number(summary.hoursThisYear)).toBeGreaterThanOrEqual(4);

    // Cancelling frees the seats and the course keeps its history.
    const cancelled = (
      await api('admin').post(`/training-sessions/${future.id}/cancel`).expect(201)
    ).body as Session;
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.enrollments.every((e) => e.status === 'CANCELLED')).toBe(true);
    await api('admin').delete(`/training-courses/${course.id}`).expect(409);
  });
});
