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

interface Doc {
  id: string;
  number: string;
  status: string;
  [key: string]: unknown;
}

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const suffix = () => Date.now().toString(36).toUpperCase();

describe('Finance (e2e)', () => {
  let app: NestExpressApplication;
  const tokens = { admin: '', manager: '', employee: '' };
  let customerId = '';
  let supplierId = '';
  let cashId = '';
  let bankId = '';

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

  const partner = async (code: string) => {
    const res = await api('admin').get(`/partners?search=${code}`).expect(200);
    return (res.body as { data: { id: string; code: string }[] }).data.find((p) => p.code === code)!
      .id;
  };
  const partnerBalance = async (id: string) =>
    Number((await api('admin').get(`/partners/${id}`).expect(200)).body.balance);
  const accountBalance = async (id: string) =>
    Number((await api('admin').get(`/treasury-accounts/${id}`).expect(200)).body.balance);
  const invoice = async (id: string) =>
    (await api('admin').get(`/sales-invoices/${id}`).expect(200)).body as Doc & {
      paidAmount: string;
      paymentStatus: string;
    };

  /** A service-only sales invoice (no order needed) of 1,800.00 incl. VAT. */
  const serviceInvoice = async () => {
    const items = (
      await api('admin').get('/stock/items?includeServices=true&search=SRV-KURULUM').expect(200)
    ).body as { variantId: string; sku: string }[];
    const variantId = items.find((i) => i.sku === 'SRV-KURULUM')!.variantId;
    const res = await api('admin')
      .post('/sales-invoices', {
        partnerId: customerId,
        invoiceDate: today(),
        lines: [{ variantId, quantity: 1, unitPrice: 1500, vatRate: 20 }],
      })
      .expect(201);
    return res.body as Doc & { grandTotal: string };
  };

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
    customerId = await partner('MUS-003');
    supplierId = await partner('TED-002');

    const code = suffix();
    cashId = (
      await api('admin')
        .post('/treasury-accounts', {
          code: `K-${code}`,
          name: 'E2E Kasa',
          type: 'CASH',
          currencyCode: 'TRY',
          openingBalance: 1000,
        })
        .expect(201)
    ).body.id;
    bankId = (
      await api('admin')
        .post('/treasury-accounts', {
          code: `B-${code}`,
          name: 'E2E Banka',
          type: 'BANK',
          currencyCode: 'TRY',
          bankName: 'Test Bank',
        })
        .expect(201)
    ).body.id;
  });

  afterAll(() => app.close());

  it('guards finance by permission', async () => {
    await api('employee').get('/payments').expect(403);
    await api('employee').get('/cheques').expect(403);
    await api('employee').get('/treasury-accounts').expect(403);
    await api('manager').get('/payments').expect(200);
    await api('manager').get('/finance-reports/summary').expect(200);
    await api('manager')
      .post('/payments', {
        direction: 'IN',
        method: 'CASH',
        partnerId: customerId,
        paymentDate: today(),
        accountId: cashId,
        amount: 10,
      })
      .expect(403);
  });

  it('keeps account codes unique and posts the opening balance', async () => {
    const account = (await api('admin').get(`/treasury-accounts/${cashId}`).expect(200)).body;
    expect(account.balance).toBe('1000.00');
    await api('admin')
      .post('/treasury-accounts', {
        code: account.code,
        name: 'Dup',
        type: 'CASH',
        currencyCode: 'TRY',
      })
      .expect(409);
    const statement = (await api('admin').get(`/treasury-accounts/${cashId}/statement`).expect(200))
      .body;
    expect(statement.entries[0].documentType).toBe('OPENING');
    expect(statement.closingBalance).toBe('1000.00');
  });

  it('settles invoices, moves cash and reverses on cancel', async () => {
    const inv = await serviceInvoice();
    expect(inv.grandTotal).toBe('1800.00');
    const before = await partnerBalance(customerId);

    await api('admin')
      .post('/payments', {
        direction: 'IN',
        method: 'CASH',
        partnerId: customerId,
        paymentDate: today(),
        accountId: cashId,
        amount: 500,
        allocations: [{ invoiceId: inv.id, amount: 2000 }],
      })
      .expect(400);

    const first = (
      await api('admin')
        .post('/payments', {
          direction: 'IN',
          method: 'CASH',
          partnerId: customerId,
          paymentDate: today(),
          accountId: cashId,
          amount: 1000,
          allocations: [{ invoiceId: inv.id, amount: 1000 }],
        })
        .expect(201)
    ).body as Doc & { allocations: { invoiceId: string; amount: string }[] };
    expect(first.number).toMatch(/^TAH-\d{4}-\d{6}$/);
    expect(first.allocations).toEqual([
      expect.objectContaining({ invoiceId: inv.id, amount: '1000.00' }),
    ]);
    expect((await invoice(inv.id)).paymentStatus).toBe('PARTIALLY_PAID');
    expect(await partnerBalance(customerId)).toBeCloseTo(before - 1000, 2);
    expect(await accountBalance(cashId)).toBe(2000);

    const second = (
      await api('admin')
        .post('/payments', {
          direction: 'IN',
          method: 'BANK',
          partnerId: customerId,
          paymentDate: today(),
          accountId: bankId,
          amount: 800,
          allocations: [{ invoiceId: inv.id, amount: 800 }],
        })
        .expect(201)
    ).body as Doc;
    expect((await invoice(inv.id)).paymentStatus).toBe('PAID');
    const open = (
      await api('admin')
        .get(`/payments/open-invoices?partnerId=${customerId}&direction=IN`)
        .expect(200)
    ).body as { id: string }[];
    expect(open.map((o) => o.id)).not.toContain(inv.id);

    // Cash cannot go negative.
    await api('admin')
      .post('/payments', {
        direction: 'OUT',
        method: 'CASH',
        partnerId: supplierId,
        paymentDate: today(),
        accountId: cashId,
        amount: 999_999,
        allocations: [],
      })
      .expect(400);
    // Wrong account type for the method.
    await api('admin')
      .post('/payments', {
        direction: 'IN',
        method: 'CASH',
        partnerId: customerId,
        paymentDate: today(),
        accountId: bankId,
        amount: 10,
      })
      .expect(400);

    await api('manager').post(`/payments/${second.id}/cancel`, {}).expect(403);
    const cancelled = (
      await api('admin').post(`/payments/${second.id}/cancel`, { reason: 'e2e' }).expect(201)
    ).body as Doc;
    expect(cancelled.status).toBe('CANCELLED');
    await api('admin').post(`/payments/${second.id}/cancel`, {}).expect(409);
    const reopened = await invoice(inv.id);
    expect(reopened.paymentStatus).toBe('PARTIALLY_PAID');
    expect(reopened.paidAmount).toBe('1000.00');
    expect(await accountBalance(bankId)).toBe(0);
    expect(await partnerBalance(customerId)).toBeCloseTo(before - 1000, 2);
  });

  it('runs a received cheque through deposit and collection', async () => {
    const payment = (
      await api('admin')
        .post('/payments', {
          direction: 'IN',
          method: 'CHEQUE',
          partnerId: customerId,
          paymentDate: today(),
          amount: 500,
          cheque: { serialNo: `E2E-${suffix()}`, bankName: 'Akbank', dueDate: inDays(30) },
          allocations: [],
        })
        .expect(201)
    ).body as Doc & { chequeId: string };
    const chequeId = payment.chequeId;
    let cheque = (await api('admin').get(`/cheques/${chequeId}`).expect(200)).body as Doc;
    expect(cheque.status).toBe('PORTFOLIO');
    expect(cheque.number).toMatch(/^CEK-\d{4}-\d{6}$/);

    await api('admin')
      .post(`/cheques/${chequeId}/deposit`, { date: today(), accountId: cashId })
      .expect(400);
    await api('admin')
      .post(`/cheques/${chequeId}/deposit`, { date: today(), accountId: bankId })
      .expect(201);
    const bankBefore = await accountBalance(bankId);
    cheque = (
      await api('admin').post(`/cheques/${chequeId}/collect`, { date: today() }).expect(201)
    ).body as Doc & { events: { toStatus: string }[] };
    expect(cheque.status).toBe('COLLECTED');
    expect((cheque.events as { toStatus: string }[]).map((e) => e.toStatus)).toEqual([
      'PORTFOLIO',
      'DEPOSITED',
      'COLLECTED',
    ]);
    expect(await accountBalance(bankId)).toBe(bankBefore + 500);
    await api('admin').post(`/cheques/${chequeId}/bounce`, { date: today() }).expect(409);
    await api('admin').post(`/payments/${payment.id}/cancel`, {}).expect(409);
  });

  it('endorses a cheque to a supplier, takes it back and bounces it', async () => {
    const customerBefore = await partnerBalance(customerId);
    const supplierBefore = await partnerBalance(supplierId);
    const received = (
      await api('admin')
        .post('/payments', {
          direction: 'IN',
          method: 'CHEQUE',
          partnerId: customerId,
          paymentDate: today(),
          amount: 750,
          cheque: { serialNo: `E2E-${suffix()}`, dueDate: inDays(45) },
          allocations: [],
        })
        .expect(201)
    ).body as Doc & { chequeId: string };
    const chequeId = received.chequeId;
    expect(await partnerBalance(customerId)).toBeCloseTo(customerBefore - 750, 2);

    const endorsement = (
      await api('admin')
        .post('/payments', {
          direction: 'OUT',
          method: 'CHEQUE',
          partnerId: supplierId,
          paymentDate: today(),
          endorseChequeId: chequeId,
          allocations: [],
        })
        .expect(201)
    ).body as Doc & { amount: string };
    expect(endorsement.amount).toBe('750.00');
    expect(await partnerBalance(supplierId)).toBeCloseTo(supplierBefore + 750, 2);
    let cheque = (await api('admin').get(`/cheques/${chequeId}`).expect(200)).body;
    expect(cheque.status).toBe('ENDORSED');
    expect(cheque.endorsedToId).toBe(supplierId);
    await api('admin').post(`/cheques/${chequeId}/bounce`, { date: today() }).expect(409);

    await api('admin').post(`/payments/${endorsement.id}/cancel`, {}).expect(201);
    cheque = (await api('admin').get(`/cheques/${chequeId}`).expect(200)).body;
    expect(cheque.status).toBe('PORTFOLIO');
    expect(await partnerBalance(supplierId)).toBeCloseTo(supplierBefore, 2);

    cheque = (
      await api('admin')
        .post(`/cheques/${chequeId}/bounce`, { date: today(), note: 'Karşılıksız' })
        .expect(201)
    ).body;
    expect(cheque.status).toBe('BOUNCED');
    const origin = (await api('admin').get(`/payments/${received.id}`).expect(200)).body as Doc;
    expect(origin.status).toBe('CANCELLED');
    expect(await partnerBalance(customerId)).toBeCloseTo(customerBefore, 2);
  });

  it('pays an own cheque from the bank at maturity', async () => {
    await api('admin')
      .post('/payments', {
        direction: 'IN',
        method: 'BANK',
        partnerId: customerId,
        paymentDate: today(),
        accountId: bankId,
        amount: 400,
        allocations: [],
      })
      .expect(201);
    const issued = (
      await api('admin')
        .post('/payments', {
          direction: 'OUT',
          method: 'CHEQUE',
          partnerId: supplierId,
          paymentDate: today(),
          accountId: bankId,
          amount: 300,
          cheque: { serialNo: `OWN-${suffix()}`, dueDate: inDays(20) },
          allocations: [],
        })
        .expect(201)
    ).body as Doc & { chequeId: string };
    const bankBefore = await accountBalance(bankId);
    const cheque = (
      await api('admin').post(`/cheques/${issued.chequeId}/pay`, { date: today() }).expect(201)
    ).body as Doc;
    expect(cheque.status).toBe('PAID');
    expect(await accountBalance(bankId)).toBe(bankBefore - 300);
    await api('admin').post(`/cheques/${issued.chequeId}/collect`, { date: today() }).expect(409);
  });

  it('reports aging, cash position and the dashboard summary', async () => {
    const aging = (await api('admin').get('/finance-reports/aging?side=RECEIVABLE').expect(200))
      .body as { rows: { partnerId: string; total: string }[]; totals: { total: string } };
    const row = aging.rows.find((r) => r.partnerId === customerId)!;
    expect(Number(row.total)).toBeGreaterThan(0);
    expect(Number(aging.totals.total)).toBeGreaterThanOrEqual(Number(row.total));
    await api('admin').get('/finance-reports/aging?side=SIDEWAYS').expect(400);

    const position = (await api('admin').get('/treasury-accounts/position').expect(200)).body;
    expect(position.baseCurrency).toBe('TRY');
    const summary = (await api('admin').get('/finance-reports/summary').expect(200)).body;
    expect(Number(summary.receivables)).toBeGreaterThan(0);
    expect(summary.cashPosition).toBe(position.totalBase);
  });

  it('isolates finance data per company', async () => {
    const companies = (await api('admin').get('/companies').expect(200)).body as
      { id: string; code: string }[] | { data: { id: string; code: string }[] };
    const list = Array.isArray(companies) ? companies : companies.data;
    const other = list.find((c) => c.code === 'PULSE-LOJ')!;
    const payments = (await api('admin').get('/payments?pageSize=1').expect(200)).body as {
      data: Doc[];
    };
    const paymentId = payments.data[0].id;
    await api('admin', other.id).get(`/payments/${paymentId}`).expect(404);
    await api('admin', other.id).get(`/treasury-accounts/${cashId}`).expect(404);
    const otherAccounts = (await api('admin', other.id).get('/treasury-accounts').expect(200))
      .body as { id: string }[];
    expect(otherAccounts.map((a) => a.id)).not.toContain(cashId);
  });
});
