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

interface Project {
  id: string;
  number: string;
  status: string;
  budgetAmount: string | null;
  laborCost: string | null;
  expenseCost: string | null;
  totalCost: string | null;
  budgetUsage: number | null;
  loggedHours: string;
  canManage: boolean;
  canSeeCosts: boolean;
  canLogTime: boolean;
  members: { id: string; employeeId: string; role: string; hourlyCost: string | null }[];
}
interface Task {
  id: string;
  taskNo: number;
  status: string;
  sortOrder: number;
  completedAt: string | null;
}
interface Week {
  weekStart: string;
  rows: { projectId: string; taskId: string | null; hours: string[]; locked: boolean }[];
  dayTotals: string[];
  total: string;
}

/** A Monday far from the seeded time entries. */
const WEEK = '2025-01-06';

describe('Projects (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  let keremId = '';
  let denizId = '';
  let project: Project;

  const api = (role: keyof typeof tokens, company?: string) => {
    const auth = `Bearer ${tokens[role]}`;
    const server = () => request(app.getHttpServer());
    const scoped = (req: request.Test) => (company ? req.set('x-company-id', company) : req);
    return {
      get: (url: string) => scoped(server().get(`/api/v1${url}`).set('Authorization', auth)),
      post: (url: string, body: object = {}) =>
        scoped(server().post(`/api/v1${url}`).set('Authorization', auth).send(body)),
      put: (url: string, body: object) =>
        scoped(server().put(`/api/v1${url}`).set('Authorization', auth).send(body)),
      patch: (url: string, body: object) =>
        scoped(server().patch(`/api/v1${url}`).set('Authorization', auth).send(body)),
      delete: (url: string) => scoped(server().delete(`/api/v1${url}`).set('Authorization', auth)),
    };
  };

  const tasksOf = async (id = project.id) =>
    (await api('employee').get(`/projects/${id}/tasks`).expect(200)).body as Task[];

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
    const employee = async (email: string) =>
      prisma.employee.findFirstOrThrow({ where: { user: { email } } });
    keremId = (await employee(USERS.employee.email)).id;
    denizId = (await employee(USERS.manager.email)).id;
  });

  afterAll(() => app.close());

  it('shows members their projects without budgets or costs', async () => {
    const list = (await api('employee').get('/projects?pageSize=100').expect(200)).body as {
      data: Project[];
    };
    const memberOf = await prisma.project.count({
      where: { members: { some: { employeeId: keremId } } },
    });
    expect(list.data).toHaveLength(memberOf);
    expect(list.data.every((p) => p.budgetAmount === null && p.totalCost === null)).toBe(true);

    const foreign = await prisma.project.findFirstOrThrow({
      where: { members: { none: { employeeId: keremId } } },
    });
    await api('employee').get(`/projects/${foreign.id}`).expect(404);

    const own = list.data[0];
    const detail = (await api('employee').get(`/projects/${own.id}`).expect(200)).body as Project;
    expect(detail.canManage).toBe(false);
    expect(detail.canSeeCosts).toBe(false);
    expect(detail.members.every((m) => m.hourlyCost === null)).toBe(true);
    await api('employee').get(`/projects/${own.id}/expenses`).expect(403);
    await api('employee').patch(`/projects/${own.id}`, { name: 'Yeni ad' }).expect(403);
    await api('employee').post('/projects', { name: 'Yetkisiz', managerId: keremId }).expect(403);

    const seen = (await api('manager').get(`/projects/${own.id}`).expect(200)).body as Project;
    expect(seen.totalCost).not.toBeNull();
  });

  it('lets the manager run a project and add members', async () => {
    await api('manager')
      .post('/projects', {
        name: 'E2E proje',
        managerId: denizId,
        startDate: '2025-01-01',
        dueDate: '2024-12-01',
      })
      .expect(400);
    project = (
      await api('manager')
        .post('/projects', {
          name: 'E2E proje',
          managerId: denizId,
          status: 'ACTIVE',
          budgetAmount: 10000,
        })
        .expect(201)
    ).body as Project;
    expect(project.number).toMatch(/^PRJ-\d{4}-\d{6}$/);
    expect(project.members).toEqual([
      expect.objectContaining({ employeeId: denizId, role: 'LEAD' }),
    ]);
    expect(project.canManage).toBe(true);

    project = (
      await api('manager')
        .post(`/projects/${project.id}/members`, { employeeId: keremId, hourlyCost: 500 })
        .expect(201)
    ).body as Project;
    await api('manager')
      .post(`/projects/${project.id}/members`, { employeeId: keremId })
      .expect(409);
    const lead = project.members.find((m) => m.employeeId === denizId)!;
    await api('manager')
      .patch(`/projects/${project.id}/members/${lead.id}`, { role: 'MEMBER' })
      .expect(400);
    await api('manager').delete(`/projects/${project.id}/members/${lead.id}`).expect(400);

    const kerem = await prisma.user.findUniqueOrThrow({ where: { email: USERS.employee.email } });
    const note = await prisma.notification.findFirst({
      where: { userId: kerem.id, type: 'projects.member', link: `/projects/${project.id}` },
    });
    expect(note).not.toBeNull();
  });

  it('numbers tasks, assigns members only and moves cards on the board', async () => {
    const create = (title: string, extra: object = {}) =>
      api('employee').post(`/projects/${project.id}/tasks`, { title, ...extra });
    const first = (await create('Analiz', { assigneeId: keremId }).expect(201)).body as Task;
    const second = (await create('Geliştirme').expect(201)).body as Task;
    const third = (await create('Test').expect(201)).body as Task;
    expect([first.taskNo, second.taskNo, third.taskNo]).toEqual([1, 2, 3]);
    expect([first.sortOrder, second.sortOrder, third.sortOrder]).toEqual([0, 1, 2]);

    const kerem = await prisma.employee.findUniqueOrThrow({ where: { id: keremId } });
    const outsider = await prisma.employee.findFirstOrThrow({
      where: { companyId: kerem.companyId, id: { notIn: [keremId, denizId] } },
    });
    await create('Dışarıdan', { assigneeId: outsider.id }).expect(400);

    const moved = (
      await api('employee')
        .post(`/project-tasks/${third.id}/move`, { status: 'DONE', position: 0 })
        .expect(201)
    ).body as Task;
    expect(moved.status).toBe('DONE');
    expect(moved.completedAt).not.toBeNull();
    await api('employee')
      .post(`/project-tasks/${second.id}/move`, { status: 'TODO', position: 0 })
      .expect(201);
    const todo = (await tasksOf()).filter((t) => t.status === 'TODO');
    expect(todo.map((t) => t.id)).toEqual([second.id, first.id]);

    const reopened = (
      await api('employee')
        .patch(`/project-tasks/${third.id}`, { status: 'IN_PROGRESS' })
        .expect(200)
    ).body as Task;
    expect(reopened.completedAt).toBeNull();

    await api('employee').delete(`/project-tasks/${second.id}`).expect(403);
    await api('manager').delete(`/project-tasks/${second.id}`).expect(204);

    const mine = (await api('employee').get('/project-tasks/mine').expect(200)).body as Task[];
    expect(mine.some((t) => t.id === first.id)).toBe(true);
  });

  it('saves weekly timesheets, costs them and locks closed projects', async () => {
    const [task] = await tasksOf();
    const save = (rows: object[], weekStart = WEEK) =>
      api('employee').put('/time-entries/week', { weekStart, rows });
    const row = (hours: number[], taskId: string | null = task.id) => ({
      projectId: project.id,
      taskId,
      hours,
    });

    await save([row([8, 0, 0, 0, 0, 0, 0])], '2025-01-07').expect(400);
    await save([row([8, 0, 0, 0, 0, 0, 0]), row([1, 0, 0, 0, 0, 0, 0])]).expect(400);
    await save([row([20, 0, 0, 0, 0, 0, 0]), row([5, 0, 0, 0, 0, 0, 0], null)]).expect(400);

    let week = (
      await save([row([8, 4, 0, 0, 0, 0, 0]), row([0, 2, 0, 0, 0, 0, 0], null)]).expect(200)
    ).body as Week;
    expect(week.total).toBe('14.00');
    expect(week.dayTotals.slice(0, 2)).toEqual(['8.00', '6.00']);
    week = (await save([row([8, 3, 0, 0, 0, 0, 0])]).expect(200)).body as Week;
    expect(week.rows).toHaveLength(1);
    expect(week.total).toBe('11.00');

    const costed = (await api('manager').get(`/projects/${project.id}`).expect(200))
      .body as Project;
    expect(costed.loggedHours).toBe('11.00');
    expect(costed.laborCost).toBe('5500.00');
    expect(costed.budgetUsage).toBe(55);

    await api('manager').patch(`/projects/${project.id}`, { status: 'ON_HOLD' }).expect(200);
    week = (await api('employee').get(`/time-entries/week?date=2025-01-08`).expect(200))
      .body as Week;
    expect(week.weekStart).toBe(WEEK);
    expect(week.rows[0].locked).toBe(true);
    await save([row([8, 3, 0, 0, 0, 0, 0])]).expect(200);
    await save([row([8, 3, 1, 0, 0, 0, 0])]).expect(409);
    await save([]).expect(409);
    await api('manager').patch(`/projects/${project.id}`, { status: 'ACTIVE' }).expect(200);

    const list = (await api('manager').get(`/time-entries?projectId=${project.id}`).expect(200))
      .body as { data: { costAmount: string | null }[]; totalHours: string };
    expect(list.totalHours).toBe('11.00');
    expect(list.data.every((e) => e.costAmount !== null)).toBe(true);
    const own = (await api('employee').get(`/time-entries?projectId=${project.id}`).expect(200))
      .body as { data: { costAmount: string | null }[] };
    expect(own.data.every((e) => e.costAmount === null)).toBe(true);

    await api('admin').delete(`/projects/${project.id}`).expect(409);
  });

  it('charges approved expense reports to the project', async () => {
    const categories = (await api('employee').get('/expense-categories').expect(200)).body as {
      id: string;
      code: string;
    }[];
    const perDiem = categories.find((c) => c.code === 'HARCIRAH')!.id;
    const line = {
      categoryId: perDiem,
      expenseDate: new Date().toISOString().slice(0, 10),
      description: 'Proje ziyareti',
      quantity: 1,
    };
    const foreign = await prisma.project.findFirstOrThrow({
      where: { status: 'ACTIVE', members: { none: { employeeId: keremId } } },
    });
    await api('employee')
      .post('/expense-reports', { title: 'Yabancı proje', projectId: foreign.id, lines: [line] })
      .expect(400);

    const report = (
      await api('employee')
        .post('/expense-reports', { title: 'Proje masrafı', projectId: project.id, lines: [line] })
        .expect(201)
    ).body as { id: string; totalAmount: string; projectName: string };
    expect(report.projectName).toBe('E2E proje');
    const submitted = (
      await api('employee').post(`/expense-reports/${report.id}/submit`).expect(201)
    ).body as { workflowInstanceId: string };
    const cost = async () =>
      ((await api('manager').get(`/projects/${project.id}`).expect(200)).body as Project)
        .expenseCost;
    expect(await cost()).toBe('0.00');

    await api('manager')
      .post(`/workflow/instances/${submitted.workflowInstanceId}/approve`, {})
      .expect(200);
    expect(await cost()).toBe(report.totalAmount);
    const charged = (await api('manager').get(`/projects/${project.id}/expenses`).expect(200))
      .body as { id: string; counted: boolean }[];
    expect(charged).toEqual([expect.objectContaining({ id: report.id, counted: true })]);

    await api('employee').post(`/expense-reports/${report.id}/cancel`, {}).expect(201);
    expect(await cost()).toBe('0.00');
  });

  it('keeps projects inside their company', async () => {
    const other = await prisma.company.findFirstOrThrow({ where: { code: 'PULSE-LOJ' } });
    await api('admin', other.id).get(`/projects/${project.id}`).expect(404);
    await api('admin', other.id)
      .put('/time-entries/week', {
        weekStart: WEEK,
        rows: [{ projectId: project.id, hours: [1, 0, 0, 0, 0, 0, 0] }],
      })
      .expect((res) => expect([400, 404]).toContain(res.status));
  });
});
