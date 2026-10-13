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

interface Posting {
  id: string;
  number: string;
  status: string;
  hiredCount: number;
}
interface Application {
  id: string;
  stage: string;
  sortOrder: number;
}
interface ApplicationDetail extends Application {
  canHire: boolean;
  canReopen: boolean;
  employeeId: string | null;
  employeeNo: string | null;
  postingStatus: string;
  offers: { id: string; status: string }[];
  interviews: { id: string; status: string }[];
  activities: { type: string; toStage: string | null; body: string | null }[];
  feedback: { averageRating: number | null; recommendationScore: number; submitted: number };
}
interface MyInterview {
  id: string;
  status: string;
  candidateName: string;
  canGiveFeedback: boolean;
  mySubmittedAt: string | null;
}

const RUN = Date.now();
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('Recruitment (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  let companyId = '';
  let keremId = '';
  let denizId = '';
  let departmentId = '';
  let positionId = '';

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

  /** Removes postings, candidates and hired employees created by earlier runs. */
  const cleanUp = async () => {
    const postings = await prisma.jobPosting.findMany({
      where: { companyId, title: { startsWith: 'E2E ' } },
      include: { applications: { select: { employeeId: true } } },
    });
    const employeeIds = postings.flatMap((p) =>
      p.applications.map((a) => a.employeeId).filter((id): id is string => !!id),
    );
    const postingIds = postings.map((p) => p.id);
    await prisma.jobApplication.deleteMany({ where: { postingId: { in: postingIds } } });
    await prisma.jobPosting.deleteMany({ where: { id: { in: postingIds } } });
    await prisma.candidate.deleteMany({ where: { companyId, email: { endsWith: '@e2e.test' } } });
    await prisma.salaryRecord.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  };

  const createPosting = async (openings = 1) =>
    (
      await api('admin')
        .post('/job-postings', {
          title: `E2E Yazılım Geliştirici ${RUN}`,
          departmentId,
          positionId,
          hiringManagerId: denizId,
          openings,
          status: 'OPEN',
          salaryMin: 90_000,
          salaryMax: 120_000,
        })
        .expect(201)
    ).body as Posting;

  const createCandidate = async (name: string) =>
    (
      (
        await api('admin')
          .post('/candidates', {
            firstName: name,
            lastName: 'Test',
            email: `${name.toLowerCase()}.${RUN}@e2e.test`,
            source: 'LINKEDIN',
          })
          .expect(201)
      ).body as { id: string }
    ).id;

  const apply = async (postingId: string, candidateId: string) =>
    (
      await api('admin')
        .post('/job-applications', { postingId, candidateId, note: 'İlk görüşme olumlu.' })
        .expect(201)
    ).body as ApplicationDetail;

  const detail = async (id: string) =>
    (await api('admin').get(`/job-applications/${id}`).expect(200)).body as ApplicationDetail;

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
    departmentId = kerem.departmentId!;
    positionId = kerem.positionId!;
    await cleanUp();
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('limits the pipeline to recruiters and opens interviews to interviewers', async () => {
    await api('employee').get('/job-postings').expect(403);
    await api('employee').get('/candidates').expect(403);
    await api('manager').get('/job-postings').expect(200);
    await api('manager').get('/job-postings/summary').expect(200);
    await api('manager').post('/job-postings', { title: 'X' }).expect(403);
    await api('manager').post('/candidates', {}).expect(403);

    const mine = (await api('employee').get('/interviews/mine').expect(200)).body as MyInterview[];
    for (const interview of mine) {
      await api('employee').get(`/interviews/${interview.id}`).expect(200);
    }
    const foreign = await prisma.interview.findFirst({
      where: { companyId, participants: { none: { employeeId: keremId } } },
    });
    if (foreign) await api('employee').get(`/interviews/${foreign.id}`).expect(404);
  });

  it('runs a candidate from application to hire', async () => {
    const posting = await createPosting();
    expect(posting.number).toMatch(/^ILN-\d{4}-\d{6}$/);
    const candidateId = await createCandidate('Aday');
    await api('admin')
      .post('/candidates', { firstName: 'B', lastName: 'C', email: `aday.${RUN}@E2E.test` })
      .expect(409);

    let application = await apply(posting.id, candidateId);
    expect(application.stage).toBe('APPLIED');
    await api('admin')
      .post('/job-applications', { postingId: posting.id, candidateId })
      .expect(409);

    const moved = (
      await api('admin')
        .post(`/job-applications/${application.id}/move`, { stage: 'SCREENING', position: 0 })
        .expect(201)
    ).body as Application;
    expect(moved.stage).toBe('SCREENING');
    await api('admin')
      .post(`/job-applications/${application.id}/move`, { stage: 'HIRED', position: 0 })
      .expect(400);

    // Scheduling moves the application forward and invites the interviewer.
    const interview = (
      await api('admin')
        .post('/interviews', {
          applicationId: application.id,
          type: 'TECHNICAL',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          durationMinutes: 60,
          interviewerIds: [keremId],
        })
        .expect(201)
    ).body as { id: string; status: string };
    expect(interview.status).toBe('SCHEDULED');
    expect((await detail(application.id)).stage).toBe('INTERVIEW');

    const invited = (await api('employee').get('/interviews/mine?upcoming=true').expect(200))
      .body as MyInterview[];
    const mine = invited.find((i) => i.id === interview.id);
    expect(mine?.canGiveFeedback).toBe(true);
    expect(mine?.mySubmittedAt).toBeNull();
    await api('employee').get(`/interviews/${interview.id}/cv-url`).expect(404);
    await api('manager')
      .put(`/interviews/${interview.id}/feedback`, { rating: 5, recommendation: 'YES' })
      .expect(403);

    const answered = (
      await api('employee')
        .put(`/interviews/${interview.id}/feedback`, {
          rating: 5,
          recommendation: 'STRONG_YES',
          feedback: 'Güçlü aday.',
        })
        .expect(200)
    ).body as MyInterview;
    expect(answered.status).toBe('COMPLETED');
    application = await detail(application.id);
    expect(application.feedback).toMatchObject({
      averageRating: 5,
      recommendationScore: 2,
      submitted: 1,
    });

    // Hiring needs an accepted offer.
    await api('admin').post(`/job-applications/${application.id}/hire`, {}).expect(409);
    await api('admin')
      .post('/job-offers', {
        applicationId: application.id,
        grossSalary: 105_000,
        startDate: day(20),
        expiresAt: day(-1),
      })
      .expect(400);
    application = (
      await api('admin')
        .post('/job-offers', {
          applicationId: application.id,
          grossSalary: 105_000,
          startDate: day(20),
          expiresAt: day(5),
        })
        .expect(201)
    ).body as ApplicationDetail;
    expect(application.stage).toBe('OFFER');
    expect(application.canHire).toBe(false);
    await api('admin')
      .post('/job-offers', { applicationId: application.id, grossSalary: 1, startDate: day(20) })
      .expect(409);
    const offerId = application.offers[0].id;
    await api('manager').post(`/job-offers/${offerId}/accept`).expect(403);
    application = (await api('admin').post(`/job-offers/${offerId}/accept`).expect(201))
      .body as ApplicationDetail;
    expect(application.canHire).toBe(true);

    const hired = (
      await api('admin').post(`/job-applications/${application.id}/hire`, {}).expect(201)
    ).body as ApplicationDetail;
    expect(hired.stage).toBe('HIRED');
    expect(hired.employeeNo).toMatch(/^PRS-/);
    expect(hired.postingStatus).toBe('CLOSED');
    expect(hired.activities.some((a) => a.type === 'HIRED' && a.body === hired.employeeNo)).toBe(
      true,
    );

    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: hired.employeeId! },
      include: { salaryRecords: true },
    });
    expect(employee).toMatchObject({ departmentId, positionId, managerId: denizId });
    expect(employee.hireDate.toISOString().slice(0, 10)).toBe(day(20));
    expect(employee.salaryRecords.map((s) => s.grossSalary.toFixed(2))).toEqual(['105000.00']);

    await api('admin').post(`/job-applications/${application.id}/hire`, {}).expect(409);
    await api('admin').delete(`/job-applications/${application.id}`).expect(409);
    await api('admin').post(`/job-postings/${posting.id}/status`, { status: 'OPEN' }).expect(409);
  });

  it('rejects, reopens and withdraws applications', async () => {
    const posting = await createPosting(2);
    const application = await apply(posting.id, await createCandidate('Red'));
    await api('admin')
      .post(`/job-applications/${application.id}/move`, { stage: 'SCREENING', position: 0 })
      .expect(201);
    const interview = (
      await api('admin')
        .post('/interviews', {
          applicationId: application.id,
          type: 'PHONE',
          scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          interviewerIds: [keremId],
        })
        .expect(201)
    ).body as { id: string };

    await api('admin').post(`/job-applications/${application.id}/reject`, {}).expect(400);
    let rejected = (
      await api('admin')
        .post(`/job-applications/${application.id}/reject`, { reason: 'Deneyim yetersiz' })
        .expect(201)
    ).body as ApplicationDetail;
    expect(rejected.stage).toBe('REJECTED');
    expect(rejected.interviews.find((i) => i.id === interview.id)?.status).toBe('CANCELLED');
    await api('admin')
      .post(`/job-applications/${application.id}/move`, { stage: 'OFFER', position: 0 })
      .expect(409);

    const reopened = (
      await api('admin').post(`/job-applications/${application.id}/reopen`).expect(201)
    ).body as ApplicationDetail;
    expect(reopened.stage).toBe('INTERVIEW');

    rejected = (await api('admin').post(`/job-applications/${application.id}/withdraw`).expect(201))
      .body as ApplicationDetail;
    expect(rejected.stage).toBe('WITHDRAWN');
    expect(rejected.canReopen).toBe(true);

    const board = (await api('admin').get(`/job-postings/${posting.id}/applications`).expect(200))
      .body as Application[];
    expect(board.map((a) => a.id)).toContain(application.id);

    await api('admin').delete(`/job-postings/${posting.id}`).expect(409);
    await api('admin').delete(`/job-applications/${application.id}`).expect(204);
    await api('admin').delete(`/job-postings/${posting.id}`).expect(204);
  });
});
