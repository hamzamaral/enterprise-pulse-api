import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const USERS = {
  admin: { email: 'admin@enterprisepulse.dev', password: 'Admin123!' },
  manager: { email: 'manager@enterprisepulse.dev', password: 'Manager123!' },
  employee: { email: 'employee@enterprisepulse.dev', password: 'Employee123!' },
};

interface Lead {
  id: string;
  number: string;
  status: string;
  partnerId: string | null;
  opportunities: { id: string; stage: string }[];
}
interface Opportunity {
  id: string;
  number: string;
  stage: string;
  probability: number;
  weightedAmount: string;
  partnerId: string;
  leadId: string | null;
  closedAt: string | null;
  lostReason: string | null;
  quotes: { id: string; status: string }[];
}
interface Activity {
  id: string;
  completedAt: string | null;
  partnerId: string | null;
  overdue: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);
const suffix = () => Date.now().toString(36).toUpperCase();

describe('CRM (e2e)', () => {
  let app: NestExpressApplication;
  const tokens = { admin: '', manager: '', employee: '' };
  const ids = { admin: '', manager: '' };
  let customerId = '';
  let otherCustomerId = '';
  let serviceVariantId = '';
  let warehouseId = '';

  const api = (role: keyof typeof tokens, companyId?: string) => {
    const auth = `Bearer ${tokens[role]}`;
    const server = () => request(app.getHttpServer());
    const scoped = (req: request.Test) => (companyId ? req.set('x-company-id', companyId) : req);
    return {
      get: (url: string) => scoped(server().get(`/api/v1${url}`).set('Authorization', auth)),
      post: (url: string, body: object = {}) =>
        scoped(server().post(`/api/v1${url}`).set('Authorization', auth).send(body)),
      put: (url: string, body: object) =>
        scoped(server().put(`/api/v1${url}`).set('Authorization', auth).send(body)),
      delete: (url: string) => scoped(server().delete(`/api/v1${url}`).set('Authorization', auth)),
    };
  };

  const newLead = async (extra: object = {}) =>
    (
      await api('admin')
        .post('/leads', { companyName: `E2E Lead ${suffix()}`, estimatedValue: 25000, ...extra })
        .expect(201)
    ).body as Lead;

  const newOpportunity = async (extra: object = {}) =>
    (
      await api('admin')
        .post('/opportunities', {
          title: `E2E Fırsat ${suffix()}`,
          partnerId: customerId,
          amount: 10000,
          ...extra,
        })
        .expect(201)
    ).body as Opportunity;

  const quoteFor = (partnerId: string, opportunityId?: string) =>
    api('admin').post('/sales-quotes', {
      partnerId,
      opportunityId,
      quoteDate: today(),
      lines: [{ variantId: serviceVariantId, quantity: 1, unitPrice: 1000, vatRate: 20 }],
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    for (const role of Object.keys(tokens) as (keyof typeof tokens)[]) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(USERS[role])
        .expect(200);
      tokens[role] = (res.body as { accessToken: string }).accessToken;
    }
    const members = (await api('admin').get('/crm/members').expect(200)).body as {
      id: string;
      email: string;
    }[];
    ids.admin = members.find((m) => m.email === USERS.admin.email)!.id;
    ids.manager = members.find((m) => m.email === USERS.manager.email)!.id;
    const partners = (await api('admin').get('/partners?type=CUSTOMER&pageSize=50').expect(200))
      .body as { data: { id: string; code: string }[] };
    customerId = partners.data.find((p) => p.code === 'MUS-003')!.id;
    otherCustomerId = partners.data.find((p) => p.code === 'MUS-002')!.id;
    const items = (
      await api('admin').get('/stock/items?includeServices=true&search=SRV-KURULUM').expect(200)
    ).body as { variantId: string; sku: string }[];
    serviceVariantId = items.find((i) => i.sku === 'SRV-KURULUM')!.variantId;
    const warehouses = (await api('admin').get('/warehouses').expect(200)).body as {
      id: string;
      code: string;
    }[];
    warehouseId = warehouses.find((w) => w.code === 'MRK')!.id;
  });

  afterAll(() => app.close());

  it('keeps CRM away from employees and deletes away from managers', async () => {
    await api('employee').get('/leads').expect(403);
    await api('employee').get('/opportunities/board').expect(403);
    await api('employee').get('/crm/summary').expect(403);
    await api('manager').get('/leads').expect(200);
    const lead = (
      await api('manager')
        .post('/leads', { companyName: `Manager Lead ${suffix()}` })
        .expect(201)
    ).body as Lead;
    await api('manager').delete(`/leads/${lead.id}`).expect(403);
    await api('admin').delete(`/leads/${lead.id}`).expect(204);
  });

  it('works a lead and converts it into a new customer with an opportunity', async () => {
    const lead = await newLead({ contactName: 'Ali Veli', city: 'Bursa', source: 'EVENT' });
    expect(lead.number).toMatch(/^ADY-\d{4}-\d{6}$/);
    expect(lead.status).toBe('NEW');

    await api('admin').put(`/leads/${lead.id}`, { status: 'CONVERTED' }).expect(400);
    await api('admin').put(`/leads/${lead.id}`, { status: 'QUALIFIED' }).expect(200);
    await api('admin').post(`/leads/${lead.id}/disqualify`, {}).expect(400);
    const disqualified = (
      await api('admin').post(`/leads/${lead.id}/disqualify`, { reason: 'Bütçe yok' }).expect(201)
    ).body as Lead;
    expect(disqualified.status).toBe('DISQUALIFIED');
    await api('admin').post(`/leads/${lead.id}/convert`, { createOpportunity: false }).expect(409);
    await api('admin').post(`/leads/${lead.id}/reopen`).expect(201);

    const note = (
      await api('admin')
        .post('/crm-activities', { type: 'NOTE', subject: 'Fuarda tanıştık', leadId: lead.id })
        .expect(201)
    ).body as Activity;
    expect(note.completedAt).not.toBeNull();

    // Managers may convert into an existing customer, but not create one.
    await api('manager')
      .post(`/leads/${lead.id}/convert`, { createOpportunity: false })
      .expect(403);

    const result = (
      await api('admin')
        .post(`/leads/${lead.id}/convert`, { createOpportunity: true, expectedCloseDate: today() })
        .expect(201)
    ).body as { partnerId: string; opportunityId: string };
    const partner = (await api('admin').get(`/partners/${result.partnerId}`).expect(200)).body as {
      title: string;
      type: string;
      city: string;
    };
    expect(partner).toMatchObject({ type: 'CUSTOMER', city: 'Bursa' });
    expect(partner.title).toMatch(/^E2E Lead/);

    const opportunity = (
      await api('admin').get(`/opportunities/${result.opportunityId}`).expect(200)
    ).body as Opportunity;
    expect(opportunity).toMatchObject({
      stage: 'QUALIFICATION',
      probability: 25,
      leadId: lead.id,
      partnerId: result.partnerId,
    });
    expect(opportunity.weightedAmount).toBe('6250.00');

    const converted = (await api('admin').get(`/leads/${lead.id}`).expect(200)).body as Lead;
    expect(converted.status).toBe('CONVERTED');
    expect(converted.opportunities).toHaveLength(1);
    const activities = (
      await api('admin').get(`/crm-activities?partnerId=${result.partnerId}`).expect(200)
    ).body as { data: Activity[] };
    expect(activities.data.map((a) => a.id)).toContain(note.id);

    await api('admin').post(`/leads/${lead.id}/convert`, { createOpportunity: false }).expect(409);
    await api('admin').put(`/leads/${lead.id}`, { notes: 'x' }).expect(409);
    await api('admin').delete(`/leads/${lead.id}`).expect(409);
  });

  it('converts a lead into an existing customer without an opportunity', async () => {
    const lead = await newLead();
    const result = (
      await api('manager')
        .post(`/leads/${lead.id}/convert`, { partnerId: customerId, createOpportunity: false })
        .expect(201)
    ).body as { partnerId: string; opportunityId: string | null };
    expect(result).toEqual({ partnerId: customerId, opportunityId: null });

    const noValue = await newLead({ estimatedValue: undefined });
    await api('admin')
      .post(`/leads/${noValue.id}/convert`, { partnerId: customerId, createOpportunity: true })
      .expect(400);
  });

  it('moves an opportunity through the pipeline with quotes', async () => {
    const opportunity = await newOpportunity();
    expect(opportunity).toMatchObject({ stage: 'PROSPECTING', probability: 10 });
    expect(opportunity.number).toMatch(/^FRS-\d{4}-\d{6}$/);

    await api('admin').post(`/opportunities/${opportunity.id}/stage`, { stage: 'WON' }).expect(400);
    const qualified = (
      await api('admin')
        .post(`/opportunities/${opportunity.id}/stage`, { stage: 'QUALIFICATION' })
        .expect(201)
    ).body as Opportunity;
    expect(qualified.probability).toBe(25);

    await quoteFor(otherCustomerId, opportunity.id).expect(409);
    const quote = (await quoteFor(customerId, opportunity.id).expect(201)).body as {
      id: string;
      opportunityNumber: string;
    };
    expect(quote.opportunityNumber).toBe(opportunity.number);
    let current = (await api('admin').get(`/opportunities/${opportunity.id}`).expect(200))
      .body as Opportunity;
    expect(current).toMatchObject({ stage: 'PROPOSAL', probability: 50 });
    expect(current.quotes.map((q) => q.id)).toEqual([quote.id]);
    await api('admin').delete(`/opportunities/${opportunity.id}`).expect(409);

    await api('admin').post(`/sales-quotes/${quote.id}/convert`, { warehouseId }).expect(201);
    current = (await api('admin').get(`/opportunities/${opportunity.id}`).expect(200))
      .body as Opportunity;
    expect(current).toMatchObject({ stage: 'WON', probability: 100 });
    expect(current.closedAt).not.toBeNull();

    await quoteFor(customerId, opportunity.id).expect(409);
    await api('admin').put(`/opportunities/${opportunity.id}`, { amount: 1 }).expect(409);
    await api('admin').post(`/opportunities/${opportunity.id}/win`).expect(409);

    const reopened = (
      await api('admin').post(`/opportunities/${opportunity.id}/reopen`).expect(201)
    ).body as Opportunity;
    expect(reopened).toMatchObject({ stage: 'NEGOTIATION', probability: 75, closedAt: null });
    await api('admin').post(`/opportunities/${opportunity.id}/lose`, {}).expect(400);
    const lost = (
      await api('admin')
        .post(`/opportunities/${opportunity.id}/lose`, { reason: 'Proje iptal edildi' })
        .expect(201)
    ).body as Opportunity;
    expect(lost).toMatchObject({ stage: 'LOST', probability: 0, lostReason: 'Proje iptal edildi' });
  });

  it('assigns activities, notifies the assignee and tracks completion', async () => {
    const opportunity = await newOpportunity();
    const before = (await api('manager').get('/notifications/unread-count').expect(200)).body as {
      count: number;
    };
    const task = (
      await api('admin')
        .post('/crm-activities', {
          type: 'TASK',
          subject: 'Teklif öncesi keşif',
          opportunityId: opportunity.id,
          ownerId: ids.manager,
          dueAt: new Date(Date.now() - 3_600_000).toISOString(),
        })
        .expect(201)
    ).body as Activity;
    expect(task).toMatchObject({ partnerId: customerId, overdue: true, completedAt: null });
    const after = (await api('manager').get('/notifications/unread-count').expect(200)).body as {
      count: number;
    };
    expect(after.count).toBe(before.count + 1);

    const overdue = (await api('manager').get('/crm-activities?mine=true&state=overdue')).body as {
      data: Activity[];
    };
    expect(overdue.data.map((a) => a.id)).toContain(task.id);

    const done = (await api('manager').post(`/crm-activities/${task.id}/complete`).expect(201))
      .body as Activity;
    expect(done.completedAt).not.toBeNull();
    await api('manager').post(`/crm-activities/${task.id}/complete`).expect(409);
    await api('manager').post(`/crm-activities/${task.id}/reopen`).expect(201);

    await api('manager').delete(`/crm-activities/${task.id}`).expect(403);
    await api('admin').delete(`/crm-activities/${task.id}`).expect(204);

    await api('admin')
      .post('/crm-activities', {
        type: 'CALL',
        subject: 'x',
        ownerId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(400);
  });

  it('summarises the pipeline in the company currency', async () => {
    const before = (await api('admin').get('/crm/summary').expect(200)).body as {
      currencyCode: string;
      openCount: number;
      stages: { stage: string; count: number }[];
    };
    expect(before.currencyCode).toBe('TRY');
    expect(before.stages.map((s) => s.stage)).toEqual([
      'PROSPECTING',
      'QUALIFICATION',
      'PROPOSAL',
      'NEGOTIATION',
    ]);
    await newOpportunity({ stage: 'NEGOTIATION', amount: 2000 });
    const after = (await api('admin').get('/crm/summary').expect(200)).body as typeof before;
    expect(after.openCount).toBe(before.openCount + 1);

    const board = (await api('admin').get('/opportunities/board').expect(200)).body as {
      columns: { stage: string; count: number; items: unknown[] }[];
    };
    expect(board.columns).toHaveLength(6);
    const negotiation = board.columns.find((c) => c.stage === 'NEGOTIATION')!;
    expect(negotiation.count).toBe(after.stages.find((s) => s.stage === 'NEGOTIATION')!.count);
  });

  it('keeps CRM records inside their company', async () => {
    const lead = await newLead();
    const companies = (await api('admin').get('/companies').expect(200)).body as
      { id: string; code: string }[] | { data: { id: string; code: string }[] };
    const list = Array.isArray(companies) ? companies : companies.data;
    const other = list.find((c) => c.code === 'PULSE-LOJ')!;
    await api('admin', other.id).get(`/leads/${lead.id}`).expect(404);
    await api('admin', other.id)
      .post('/opportunities', { title: 'Yanlış şirket', partnerId: customerId, amount: 1 })
      .expect(404);
  });
});
