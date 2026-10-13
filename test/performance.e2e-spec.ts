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

interface Cycle {
  id: string;
  status: string;
  reviewCount: number;
  completedCount: number;
  averageScore: string | null;
  statusCounts: Record<string, number>;
  distribution: number[];
  canLaunch: boolean;
}
interface ReviewItem {
  id: string;
  employeeId: string;
  status: string;
  overallScore: string | null;
}
interface Review extends ReviewItem {
  viewer: string;
  reviewerId: string | null;
  goalScore: string | null;
  competencyScore: string | null;
  selfComment: string | null;
  managerComment: string | null;
  goals: { id: string; weight: number; selfRating: number | null; managerRating: number | null }[];
  competencies: { id: string; selfRating: number | null; managerRating: number | null }[];
  canEditGoals: boolean;
  canSelfReview: boolean;
  canManagerReview: boolean;
  canReturn: boolean;
  canAcknowledge: boolean;
  canReopen: boolean;
  acknowledgedAt: string | null;
}

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('Performance (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  let companyId = '';
  let keremId = '';
  let denizId = '';

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
    await prisma.reviewCycle.deleteMany({ where: { companyId, name: { startsWith: 'E2E ' } } });
    await prisma.competency.deleteMany({ where: { companyId, name: { startsWith: 'E2E ' } } });
  };

  const review = async (role: keyof typeof tokens, id: string) =>
    (await api(role).get(`/performance-reviews/${id}`).expect(200)).body as Review;

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
    const deniz = await prisma.employee.findFirstOrThrow({
      where: { user: { email: USERS.manager.email } },
    });
    keremId = kerem.id;
    denizId = deniz.id;
    companyId = kerem.companyId;
    await cleanUp();
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('keeps cycles to HR and reviews to the people involved', async () => {
    await api('employee').get('/review-cycles').expect(403);
    await api('manager').get('/review-cycles').expect(403);
    await api('employee').get('/competencies').expect(403);
    await api('admin').get('/review-cycles').expect(200);

    const mine = (await api('employee').get('/performance-reviews/mine').expect(200))
      .body as ReviewItem[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.employeeId === keremId)).toBe(true);
    const team = (await api('manager').get('/performance-reviews/team').expect(200))
      .body as ReviewItem[];
    expect(team.some((r) => r.employeeId === keremId)).toBe(true);
    expect(team.every((r) => r.employeeId !== denizId)).toBe(true);

    const foreign = await prisma.performanceReview.findFirst({
      where: {
        companyId,
        employeeId: { not: keremId },
        cycle: { status: { not: 'DRAFT' } },
      },
    });
    await api('employee').get(`/performance-reviews/${foreign!.id}`).expect(404);
  });

  it('runs a review from goals to acknowledgement', async () => {
    const competency = (
      await api('admin')
        .post('/competencies', { name: 'E2E Yetkinlik', description: 'Test' })
        .expect(201)
    ).body as { id: string };
    await api('admin').post('/competencies', { name: 'E2E Yetkinlik' }).expect(409);
    const other = await prisma.competency.findFirstOrThrow({
      where: { companyId, isActive: true, name: { not: { startsWith: 'E2E ' } } },
    });

    const body = {
      name: 'E2E Dönem',
      periodStart: day(-90),
      periodEnd: day(-1),
      selfReviewDue: day(7),
      managerReviewDue: day(14),
      goalWeight: 60,
      competencyIds: [competency.id, other.id],
    };
    await api('admin')
      .post('/review-cycles', { ...body, selfReviewDue: day(20), managerReviewDue: day(10) })
      .expect(400);
    const draft = (await api('admin').post('/review-cycles', body).expect(201)).body as Cycle;
    expect(draft).toMatchObject({ status: 'DRAFT', canLaunch: true, reviewCount: 0 });
    await api('admin').delete(`/competencies/${competency.id}`).expect(409);

    const cycle = (await api('admin').post(`/review-cycles/${draft.id}/launch`).expect(201))
      .body as Cycle;
    expect(cycle.status).toBe('ACTIVE');
    expect(cycle.reviewCount).toBeGreaterThan(5);
    await api('admin').post(`/review-cycles/${draft.id}/launch`).expect(409);
    await api('admin').patch(`/review-cycles/${draft.id}`, { goalWeight: 50 }).expect(409);
    await api('admin').patch(`/review-cycles/${draft.id}`, { name: 'E2E Dönem 2' }).expect(200);
    await api('admin').delete(`/review-cycles/${draft.id}`).expect(409);

    const reviews = (await api('admin').get(`/review-cycles/${draft.id}/reviews`).expect(200))
      .body as ReviewItem[];
    const keremReview = reviews.find((r) => r.employeeId === keremId)!;
    const id = keremReview.id;

    let mine = await review('employee', id);
    expect(mine).toMatchObject({
      viewer: 'EMPLOYEE',
      reviewerId: denizId,
      status: 'SELF_REVIEW',
      canSelfReview: true,
      canEditGoals: true,
      canManagerReview: false,
    });
    expect(mine.competencies).toHaveLength(2);

    await api('employee')
      .post(`/performance-reviews/${id}/goals`, { title: 'E2E hedef 1', weight: 60 })
      .expect(201);
    mine = (
      await api('employee')
        .post(`/performance-reviews/${id}/goals`, { title: 'E2E hedef 2', weight: 30 })
        .expect(201)
    ).body as Review;
    const [g1, g2] = mine.goals;
    const [c1, c2] = mine.competencies;

    const selfBody = (submit: boolean) => ({
      selfComment: 'İyi bir dönemdi.',
      goals: [
        { id: g1.id, rating: 4, progress: 100 },
        { id: g2.id, rating: 5, progress: 80 },
      ],
      competencies: [
        { id: c1.id, rating: 4 },
        { id: c2.id, rating: submit ? 4 : null },
      ],
      submit,
    });
    await api('employee').put(`/performance-reviews/${id}/self`, selfBody(false)).expect(200);

    // The manager does not see the draft self ratings and cannot review yet.
    let asManager = await review('manager', id);
    expect(asManager.viewer).toBe('REVIEWER');
    expect(asManager.goals.map((g) => g.selfRating)).toEqual([null, null]);
    expect(asManager.selfComment).toBeNull();
    expect(asManager.canManagerReview).toBe(false);
    await api('manager')
      .put(`/performance-reviews/${id}/manager`, { goals: [], competencies: [] })
      .expect(403);

    // Weights add up to 90.
    await api('employee').put(`/performance-reviews/${id}/self`, selfBody(true)).expect(400);
    await api('employee').patch(`/performance-goals/${g2.id}`, { weight: 40 }).expect(200);
    await api('employee')
      .put(`/performance-reviews/${id}/self`, {
        ...selfBody(true),
        competencies: [{ id: c2.id, rating: null }],
      })
      .expect(400);
    mine = (
      await api('employee').put(`/performance-reviews/${id}/self`, selfBody(true)).expect(200)
    ).body as Review;
    expect(mine).toMatchObject({
      status: 'MANAGER_REVIEW',
      canSelfReview: false,
      canEditGoals: false,
    });
    await api('employee')
      .post(`/performance-reviews/${id}/goals`, { title: 'Geç hedef', weight: 10 })
      .expect(403);

    asManager = await review('manager', id);
    expect(asManager.goals.map((g) => g.selfRating)).toEqual([4, 5]);
    expect(asManager).toMatchObject({ canManagerReview: true, canReturn: true });

    // Sent back and handed over again.
    await api('manager').post(`/performance-reviews/${id}/return`).expect(201);
    expect((await review('employee', id)).status).toBe('SELF_REVIEW');
    await api('employee').put(`/performance-reviews/${id}/self`, selfBody(true)).expect(200);

    const managerBody = (submit: boolean) => ({
      managerComment: 'Hedeflerini aştı.',
      strengths: 'Sahiplenme',
      improvements: 'Dokümantasyon',
      goals: [
        { id: g1.id, rating: 4 },
        { id: g2.id, rating: 5 },
      ],
      competencies: [
        { id: c1.id, rating: 4, comment: 'Açık iletişim' },
        { id: c2.id, rating: 3 },
      ],
      submit,
    });
    await api('manager').put(`/performance-reviews/${id}/manager`, managerBody(false)).expect(200);
    mine = await review('employee', id);
    expect(mine.goals.map((g) => g.managerRating)).toEqual([null, null]);
    expect(mine.managerComment).toBeNull();
    expect(mine.overallScore).toBeNull();

    const done = (
      await api('manager').put(`/performance-reviews/${id}/manager`, managerBody(true)).expect(200)
    ).body as Review;
    // Goals 4×60% + 5×40% = 4.40, competencies (4+3)/2 = 3.50, overall 60/40 = 4.04.
    expect(done).toMatchObject({
      status: 'COMPLETED',
      goalScore: '4.40',
      competencyScore: '3.50',
      overallScore: '4.04',
    });

    mine = await review('employee', id);
    expect(mine).toMatchObject({ overallScore: '4.04', canAcknowledge: true });
    expect(mine.goals.map((g) => g.managerRating)).toEqual([4, 5]);
    await api('manager').post(`/performance-reviews/${id}/acknowledge`).expect(409);
    mine = (await api('employee').post(`/performance-reviews/${id}/acknowledge`).expect(201))
      .body as Review;
    expect(mine.acknowledgedAt).not.toBeNull();

    const stats = (await api('admin').get(`/review-cycles/${draft.id}`).expect(200)).body as Cycle;
    expect(stats.statusCounts.COMPLETED).toBe(1);
    expect(stats.distribution).toEqual([0, 0, 0, 1, 0]);
    expect(stats.averageScore).toBe('4.04');

    // HR reopens it; the manager can no longer act once the cycle is closed.
    await api('manager').post(`/performance-reviews/${id}/reopen`).expect(403);
    const reopened = (await api('admin').post(`/performance-reviews/${id}/reopen`).expect(201))
      .body as Review;
    expect(reopened).toMatchObject({ status: 'MANAGER_REVIEW', overallScore: null });
    await api('admin').post(`/review-cycles/${draft.id}/close`).expect(201);
    await api('manager').put(`/performance-reviews/${id}/manager`, managerBody(true)).expect(403);
    expect((await review('manager', id)).canManagerReview).toBe(false);
  });
});
