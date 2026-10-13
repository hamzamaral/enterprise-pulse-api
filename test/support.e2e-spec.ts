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

interface Ticket {
  id: string;
  number: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  requesterId: string;
  createdAt: string;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  pausedAt: string | null;
  pausedMinutes: number;
  responseSla: string;
  resolutionSla: string;
  satisfactionRating: number | null;
  comments: { body: string; isInternal: boolean; fromRequester: boolean }[];
  events: { type: string; toValue: string | null }[];
  attachments: { id: string; originalName: string; canDelete: boolean }[];
  canManage: boolean;
  canComment: boolean;
  canClose: boolean;
  canReopen: boolean;
  canRate: boolean;
  nextStatuses: string[];
}
interface SlaPolicy {
  priority: string;
  firstResponseHours: number;
  resolutionHours: number;
}

const HOUR_MS = 3_600_000;

describe('Support (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  const ids = { admin: '', manager: '', employee: '' };
  let companyId = '';
  let categoryId = '';

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
      upload: (url: string, name: string, content: string) =>
        server()
          .post(`/api/v1${url}`)
          .set('Authorization', auth)
          .attach('file', Buffer.from(content), { filename: name, contentType: 'text/plain' }),
    };
  };

  const cleanUp = async () => {
    const tickets = await prisma.ticket.findMany({
      where: { companyId, subject: { startsWith: 'E2E ' } },
      select: { id: true },
    });
    await prisma.fileObject.deleteMany({
      where: { entityType: 'Ticket', entityId: { in: tickets.map((t) => t.id) } },
    });
    await prisma.ticket.deleteMany({ where: { id: { in: tickets.map((t) => t.id) } } });
    await prisma.ticketCategory.deleteMany({ where: { companyId, name: { startsWith: 'E2E ' } } });
  };

  const create = async (role: keyof typeof tokens, body: object) =>
    (await api(role).post('/tickets', body).expect(201)).body as Ticket;

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
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('keeps the queue to support staff', async () => {
    await api('employee').get('/tickets').expect(403);
    await api('employee').get('/tickets/summary').expect(403);
    await api('employee').get('/tickets/agents').expect(403);
    await api('employee').get('/ticket-sla-policies').expect(403);
    await api('employee').post('/ticket-categories', { name: 'E2E Yasak' }).expect(403);
    await api('employee').get('/tickets/mine').expect(200);
    await api('employee').get('/ticket-categories').expect(200);
    await api('manager').get('/tickets').expect(200);

    const agents = (await api('manager').get('/tickets/agents').expect(200)).body as {
      id: string;
    }[];
    expect(agents.map((a) => a.id)).toEqual(expect.arrayContaining([ids.admin, ids.manager]));
    expect(agents.map((a) => a.id)).not.toContain(ids.employee);
  });

  it('runs a ticket through the SLA lifecycle', async () => {
    await api('admin')
      .post('/ticket-categories', { name: 'E2E Destek', defaultAssigneeId: ids.employee })
      .expect(400);
    const category = (
      await api('admin')
        .post('/ticket-categories', { name: 'E2E Destek', defaultAssigneeId: ids.manager })
        .expect(201)
    ).body as { id: string; defaultAssigneeName: string };
    categoryId = category.id;
    expect(category.defaultAssigneeName).toBe('Deniz Aksoy');
    await api('admin').post('/ticket-categories', { name: 'E2E Destek' }).expect(409);

    let ticket = await create('employee', {
      subject: 'E2E Yazıcı çalışmıyor',
      description: 'Kâğıt sıkışması uyarısı veriyor.',
      categoryId,
      priority: 'HIGH',
    });
    const createdAt = new Date(ticket.createdAt).getTime();
    expect(ticket).toMatchObject({
      status: 'OPEN',
      assigneeId: ids.manager,
      requesterId: ids.employee,
      responseSla: 'ON_TRACK',
      canManage: false,
      canClose: true,
      nextStatuses: [],
    });
    expect(ticket.number).toMatch(/^TKT-\d{4}-\d{6}$/);
    expect(new Date(ticket.firstResponseDueAt).getTime() - createdAt).toBe(4 * HOUR_MS);
    expect(new Date(ticket.resolutionDueAt).getTime() - createdAt).toBe(24 * HOUR_MS);
    const mine = (await api('employee').get('/tickets/mine?active=true').expect(200))
      .body as Ticket[];
    expect(mine.some((t) => t.id === ticket.id)).toBe(true);

    // Internal notes stay with the support team.
    await api('employee')
      .post(`/tickets/${ticket.id}/comments`, { body: 'Gizli', isInternal: true })
      .expect(403);
    await api('employee').patch(`/tickets/${ticket.id}`, { priority: 'LOW' }).expect(403);
    await api('manager')
      .post(`/tickets/${ticket.id}/comments`, { body: 'Toner bitmiş olabilir.', isInternal: true })
      .expect(201);
    ticket = (await api('employee').get(`/tickets/${ticket.id}`).expect(200)).body as Ticket;
    expect(ticket.comments).toHaveLength(0);
    expect(ticket.firstRespondedAt).toBeNull();

    ticket = (
      await api('manager')
        .post(`/tickets/${ticket.id}/status`, {
          status: 'WAITING',
          comment: 'Yazıcının seri numarasını paylaşır mısınız?',
        })
        .expect(201)
    ).body as Ticket;
    expect(ticket).toMatchObject({ status: 'WAITING', resolutionSla: 'PAUSED', canManage: true });
    expect(ticket.firstRespondedAt).not.toBeNull();
    expect(ticket.pausedAt).not.toBeNull();
    expect(ticket.comments.map((c) => c.isInternal)).toEqual([true, false]);

    // Pretend the ticket waited two hours; the reply resumes the clock.
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { pausedAt: new Date(Date.now() - 2 * HOUR_MS) },
    });
    ticket = (
      await api('employee')
        .post(`/tickets/${ticket.id}/comments`, { body: 'Seri no: PRN-4411' })
        .expect(201)
    ).body as Ticket;
    expect(ticket).toMatchObject({ status: 'IN_PROGRESS', pausedAt: null, pausedMinutes: 120 });
    expect(new Date(ticket.resolutionDueAt).getTime() - createdAt).toBe(26 * HOUR_MS);

    ticket = (
      await api('manager').patch(`/tickets/${ticket.id}`, { priority: 'URGENT' }).expect(200)
    ).body as Ticket;
    expect(new Date(ticket.firstResponseDueAt).getTime() - createdAt).toBe(HOUR_MS);
    expect(new Date(ticket.resolutionDueAt).getTime() - createdAt).toBe(6 * HOUR_MS);
    await api('manager').patch(`/tickets/${ticket.id}`, { assigneeId: ids.employee }).expect(400);

    ticket = (
      await api('manager')
        .post(`/tickets/${ticket.id}/status`, { status: 'RESOLVED', comment: 'Toner değişti.' })
        .expect(201)
    ).body as Ticket;
    expect(ticket.resolvedAt).not.toBeNull();
    expect(ticket.resolutionSla).toBe('MET');
    await api('manager').post(`/tickets/${ticket.id}/status`, { status: 'WAITING' }).expect(409);
    await api('employee')
      .post(`/tickets/${ticket.id}/comments`, { body: 'Hâlâ sorun var' })
      .expect(409);

    const employeeView = (await api('employee').get(`/tickets/${ticket.id}`).expect(200))
      .body as Ticket;
    expect(employeeView).toMatchObject({ canReopen: true, canComment: false, canRate: false });
    ticket = (
      await api('employee')
        .post(`/tickets/${ticket.id}/reopen`, { comment: 'Hâlâ kâğıt sıkıştırıyor.' })
        .expect(200)
    ).body as Ticket;
    expect(ticket).toMatchObject({ status: 'IN_PROGRESS', resolvedAt: null });

    await api('manager').post(`/tickets/${ticket.id}/status`, { status: 'RESOLVED' }).expect(201);
    ticket = (
      await api('employee')
        .post(`/tickets/${ticket.id}/close`, { rating: 5, comment: 'Teşekkürler' })
        .expect(200)
    ).body as Ticket;
    expect(ticket).toMatchObject({ status: 'CLOSED', satisfactionRating: 5, canClose: false });
    await api('employee').post(`/tickets/${ticket.id}/rating`, { rating: 4 }).expect(409);
    await api('manager').post(`/tickets/${ticket.id}/status`, { status: 'OPEN' }).expect(409);
    await api('manager').post(`/tickets/${ticket.id}/comments`, { body: 'Kapalı' }).expect(409);
    expect(ticket.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['CREATED', 'ASSIGNED', 'PRIORITY_CHANGED', 'REOPENED', 'RATED']),
    );

    await api('admin').delete(`/ticket-categories/${categoryId}`).expect(409);
  });

  it('limits visibility and filing on behalf of others', async () => {
    const adminTicket = await create('admin', {
      subject: 'E2E Yönetici talebi',
      description: 'Sadece destek ekibi görür.',
    });
    expect(adminTicket.assigneeId).toBeNull();
    await api('employee').get(`/tickets/${adminTicket.id}`).expect(404);
    await api('employee')
      .post(`/tickets/${adminTicket.id}/comments`, { body: 'Merhaba' })
      .expect(404);
    await api('manager').get(`/tickets/${adminTicket.id}`).expect(200);

    await api('employee')
      .post('/tickets', { subject: 'E2E Başkası', description: 'Deneme', requesterId: ids.admin })
      .expect(403);
    const filed = await create('admin', {
      subject: 'E2E Adına açılan talep',
      description: 'Telefonla iletildi.',
      requesterId: ids.employee,
    });
    expect(filed.requesterId).toBe(ids.employee);
    const view = (await api('employee').get(`/tickets/${filed.id}`).expect(200)).body as Ticket;
    expect(view.canClose).toBe(true);

    // Taking an unassigned ticket assigns it to the agent.
    const taken = (
      await api('manager')
        .post(`/tickets/${filed.id}/status`, { status: 'IN_PROGRESS' })
        .expect(201)
    ).body as Ticket;
    expect(taken.assigneeId).toBe(ids.manager);

    await api('employee').post(`/tickets/${adminTicket.id}/close`, {}).expect(404);
    await api('manager').post(`/tickets/${adminTicket.id}/close`, {}).expect(403);

    // Withdrawn by the requester: no response or resolution is recorded.
    const closed = (await api('employee').post(`/tickets/${filed.id}/close`, {}).expect(200))
      .body as Ticket;
    expect(closed).toMatchObject({ status: 'CLOSED', firstRespondedAt: null, resolvedAt: null });
    expect(closed.canRate).toBe(true);
    const rated = (
      await api('employee').post(`/tickets/${filed.id}/rating`, { rating: 3 }).expect(200)
    ).body as Ticket;
    expect(rated.satisfactionRating).toBe(3);

    await api('employee').delete(`/tickets/${adminTicket.id}`).expect(403);
    await api('admin').delete(`/tickets/${adminTicket.id}`).expect(204);
  });

  it('finds overdue tickets and reports the queue', async () => {
    const ticket = await create('employee', {
      subject: 'E2E Gecikmiş talep',
      description: 'SLA aşıldı.',
      priority: 'URGENT',
    });
    const past = Date.now() - 10 * HOUR_MS;
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        createdAt: new Date(past),
        firstResponseDueAt: new Date(past + HOUR_MS),
        resolutionDueAt: new Date(past + 4 * HOUR_MS),
      },
    });
    const overdue = (await api('manager').get('/tickets?overdue=true&pageSize=100').expect(200))
      .body as { data: Ticket[] };
    const row = overdue.data.find((t) => t.id === ticket.id);
    expect(row).toMatchObject({ responseSla: 'BREACHED', resolutionSla: 'BREACHED' });

    const unassigned = (await api('manager').get('/tickets?assignee=unassigned&active=true'))
      .body as { data: Ticket[] };
    expect(unassigned.data.every((t) => t.assigneeId === null)).toBe(true);

    const summary = (await api('manager').get('/tickets/summary').expect(200)).body as {
      overdueCount: number;
      unassignedCount: number;
      byPriority: { priority: string; overdue: number }[];
      trend: unknown[];
    };
    expect(summary.overdueCount).toBeGreaterThanOrEqual(1);
    expect(summary.unassignedCount).toBeGreaterThanOrEqual(1);
    expect(summary.byPriority.find((p) => p.priority === 'URGENT')?.overdue).toBeGreaterThan(0);
    expect(summary.trend).toHaveLength(14);
  });

  it('keeps attachments with the ticket', async () => {
    const ticket = await create('employee', {
      subject: 'E2E Ekli talep',
      description: 'Ekran görüntüsü ekte.',
    });
    const withFile = (
      await api('employee')
        .upload(`/tickets/${ticket.id}/attachments`, 'hata.txt', 'hata kaydı')
        .expect(201)
    ).body as Ticket;
    expect(withFile.attachments).toHaveLength(1);
    const [file] = withFile.attachments;
    expect(file).toMatchObject({ originalName: 'hata.txt', canDelete: true });
    await api('employee').get(`/tickets/${ticket.id}/attachments/${file.id}/url`).expect(200);
    await api('manager').get(`/tickets/${ticket.id}/attachments/${file.id}/url`).expect(200);
    const without = (
      await api('manager').delete(`/tickets/${ticket.id}/attachments/${file.id}`).expect(200)
    ).body as Ticket;
    expect(without.attachments).toHaveLength(0);
  });

  it('validates SLA policies', async () => {
    const original = (await api('manager').get('/ticket-sla-policies').expect(200))
      .body as SlaPolicy[];
    expect(original.map((p) => p.priority)).toEqual(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
    await api('manager')
      .put('/ticket-sla-policies', {
        policies: [{ priority: 'LOW', firstResponseHours: 48, resolutionHours: 24 }],
      })
      .expect(400);
    await api('manager')
      .put('/ticket-sla-policies', {
        policies: [
          { priority: 'LOW', firstResponseHours: 8, resolutionHours: 80 },
          { priority: 'LOW', firstResponseHours: 8, resolutionHours: 80 },
        ],
      })
      .expect(400);
    const updated = (
      await api('manager')
        .put('/ticket-sla-policies', {
          policies: [{ priority: 'LOW', firstResponseHours: 12, resolutionHours: 96 }],
        })
        .expect(200)
    ).body as SlaPolicy[];
    expect(updated.find((p) => p.priority === 'LOW')).toMatchObject({
      firstResponseHours: 12,
      resolutionHours: 96,
    });
    await api('manager').put('/ticket-sla-policies', { policies: original }).expect(200);
  });
});
