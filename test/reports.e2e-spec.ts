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

interface Row {
  key: string;
  code: string | null;
  documentCount: number;
  quantity: string | null;
  net: string;
  vat: string;
  returns: string;
  netTotal: string;
}
interface TradeReport {
  currencyCode: string;
  totals: { documentCount: number; net: string; vat: string; netTotal: string };
  rows: Row[];
}
interface CashFlow {
  currencyCode: string;
  opening: string;
  amountIn: string;
  amountOut: string;
  closing: string;
  months: { period: string }[];
  byType: { documentType: string; amountIn: string }[];
}

const today = () => new Date().toISOString().slice(0, 10);
const suffix = () => Date.now().toString(36).toUpperCase();

describe('Reports (e2e)', () => {
  let app: NestExpressApplication;
  const tokens = { admin: '', manager: '', employee: '' };
  let customerId = '';
  let serviceVariantId = '';

  const api = (role: keyof typeof tokens, companyId?: string) => {
    const auth = `Bearer ${tokens[role]}`;
    const server = () => request(app.getHttpServer());
    const scoped = (req: request.Test) => (companyId ? req.set('x-company-id', companyId) : req);
    return {
      get: (url: string) => scoped(server().get(`/api/v1${url}`).set('Authorization', auth)),
      post: (url: string, body: object = {}) =>
        scoped(server().post(`/api/v1${url}`).set('Authorization', auth).send(body)),
    };
  };

  const salesReport = async (query: string, companyId?: string) =>
    (
      await api('admin', companyId)
        .get(`/reports/sales?from=${today()}&to=${today()}&${query}`)
        .expect(200)
    ).body as TradeReport;

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
    const partners = (await api('admin').get('/partners?search=MUS-003').expect(200)).body as {
      data: { id: string; code: string }[];
    };
    customerId = partners.data.find((p) => p.code === 'MUS-003')!.id;
    const items = (
      await api('admin').get('/stock/items?includeServices=true&search=SRV-KURULUM').expect(200)
    ).body as { variantId: string; sku: string }[];
    serviceVariantId = items.find((i) => i.sku === 'SRV-KURULUM')!.variantId;
  });

  afterAll(() => app.close());

  it('guards reports by the permission of each module', async () => {
    const range = `from=${today()}&to=${today()}`;
    for (const path of ['sales', 'purchases', 'cash-flow']) {
      await api('employee').get(`/reports/${path}?${range}`).expect(403);
      await api('manager').get(`/reports/${path}?${range}`).expect(200);
    }
  });

  it('validates the date range and grouping', async () => {
    await api('admin').get('/reports/sales?from=2026-03-01&to=2026-01-01').expect(400);
    await api('admin').get('/reports/sales?from=2022-01-01&to=2026-01-01').expect(400);
    await api('admin').get('/reports/sales?from=2026-01-01').expect(400);
    await api('admin').get('/reports/sales?from=2026-01-01&to=2026-02-01&groupBy=DAY').expect(400);
  });

  it('lists every month of the range, empty months included', async () => {
    const report = (
      await api('admin').get('/reports/purchases?from=2025-11-15&to=2026-02-10').expect(200)
    ).body as TradeReport;
    expect(report.rows.map((r) => r.key)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(report.currencyCode).toBe('TRY');
  });

  it('adds issued invoices by product and drops them again on cancel', async () => {
    const query = `groupBy=PRODUCT&partnerId=${customerId}`;
    const before = await salesReport(query);
    const serviceRow = (report: TradeReport) => report.rows.find((r) => r.code === 'SRV-KURULUM');

    const invoice = (
      await api('admin')
        .post('/sales-invoices', {
          partnerId: customerId,
          invoiceDate: today(),
          lines: [{ variantId: serviceVariantId, quantity: 2, unitPrice: 750, vatRate: 20 }],
        })
        .expect(201)
    ).body as { id: string };

    const after = await salesReport(query);
    expect(Number(after.totals.net) - Number(before.totals.net)).toBeCloseTo(1500, 2);
    expect(Number(after.totals.vat) - Number(before.totals.vat)).toBeCloseTo(300, 2);
    expect(after.totals.documentCount).toBe(before.totals.documentCount + 1);
    const row = serviceRow(after)!;
    expect(Number(row.quantity) - Number(serviceRow(before)?.quantity ?? 0)).toBe(2);

    const byPartner = await salesReport('groupBy=PARTNER');
    const partnerRow = byPartner.rows.find((r) => r.key === customerId)!;
    expect(partnerRow.net).toBe(after.totals.net);

    await api('admin').post(`/sales-invoices/${invoice.id}/cancel`, { reason: 'e2e' }).expect(201);
    const cancelled = await salesReport(query);
    expect(cancelled.totals.net).toBe(before.totals.net);
  });

  it('reports cash flow with opening balance and drops reversed entries', async () => {
    const account = (
      await api('admin')
        .post('/treasury-accounts', {
          code: `RK-${suffix()}`,
          name: 'Report Kasa',
          type: 'CASH',
          currencyCode: 'TRY',
          openingBalance: 1000,
        })
        .expect(201)
    ).body as { id: string };
    const flow = async () =>
      (
        await api('admin')
          .get(`/reports/cash-flow?from=${today()}&to=${today()}&accountId=${account.id}`)
          .expect(200)
      ).body as CashFlow;

    const initial = await flow();
    expect(initial.opening).toBe('1000.00');
    expect(initial.amountIn).toBe('0.00');
    expect(initial.closing).toBe('1000.00');
    expect(initial.months).toHaveLength(1);

    const payment = (
      await api('admin')
        .post('/payments', {
          direction: 'IN',
          method: 'CASH',
          partnerId: customerId,
          paymentDate: today(),
          accountId: account.id,
          amount: 250,
          allocations: [],
        })
        .expect(201)
    ).body as { id: string };
    const collected = await flow();
    expect(collected.amountIn).toBe('250.00');
    expect(collected.closing).toBe('1250.00');
    expect(collected.byType).toEqual([
      expect.objectContaining({ documentType: 'COLLECTION', amountIn: '250.00' }),
    ]);

    await api('admin').post(`/payments/${payment.id}/cancel`, { reason: 'e2e' }).expect(201);
    const reversed = await flow();
    expect(reversed.amountIn).toBe('0.00');
    expect(reversed.amountOut).toBe('0.00');
    expect(reversed.closing).toBe('1000.00');

    const unknown = '00000000-0000-4000-8000-000000000000';
    await api('admin')
      .get(`/reports/cash-flow?from=${today()}&to=${today()}&accountId=${unknown}`)
      .expect(404);
  });

  it('isolates report data per company', async () => {
    const companies = (await api('admin').get('/companies').expect(200)).body as
      { id: string; code: string }[] | { data: { id: string; code: string }[] };
    const list = Array.isArray(companies) ? companies : companies.data;
    const other = list.find((c) => c.code === 'PULSE-LOJ')!;
    const report = await salesReport('groupBy=PARTNER', other.id);
    expect(report.rows.map((r) => r.key)).not.toContain(customerId);
  });
});
