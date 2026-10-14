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

interface Line {
  accountCode: string;
  partnerId: string | null;
  debit: string;
  credit: string;
}

interface Entry {
  id: string;
  number: string;
  entryDate: string;
  status: string;
  source: string;
  sourceId: string | null;
  documentId: string | null;
  sourceNumber: string | null;
  total: string;
  isReversal: boolean;
  isReversed: boolean;
  lines: Line[];
  reverses: { id: string } | null;
  reversal: { id: string } | null;
  canPost: boolean;
  canReverse: boolean;
}

interface Pending {
  sourceId: string;
  action: string;
}

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
const day = (offset: number) => {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const suffix = () => Date.now().toString(36).toUpperCase();
const MARK = 'E2E muhasebe';

/** "code D/C amount" of each line. */
const view = (lines: Line[]) =>
  lines.map((l) =>
    Number(l.debit) > 0 ? `${l.accountCode} D ${l.debit}` : `${l.accountCode} C ${l.credit}`,
  );

describe('Accounting (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  let companyId = '';
  let customerId = '';
  let cashId = '';
  const accounts = new Map<string, string>();

  const api = (role: keyof typeof tokens) => {
    const auth = `Bearer ${tokens[role]}`;
    const server = () => request(app.getHttpServer());
    return {
      get: (url: string) => server().get(`/api/v1${url}`).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        server().post(`/api/v1${url}`).set('Authorization', auth).send(body),
      patch: (url: string, body: object) =>
        server().patch(`/api/v1${url}`).set('Authorization', auth).send(body),
      delete: (url: string) => server().delete(`/api/v1${url}`).set('Authorization', auth),
    };
  };

  const run = async () =>
    (await api('admin').post('/accounting/run').expect(200)).body as {
      posted: number;
      reversed: number;
      skipped: number;
    };
  const pending = async () =>
    (await api('admin').get('/accounting/pending').expect(200)).body as Pending[];
  const entry = async (id: string) =>
    (await api('admin').get(`/journal-entries/${id}`).expect(200)).body as Entry;
  /** Entries written for a source document, oldest first. */
  const entriesFor = async (sourceNumber: string) => {
    const res = await api('admin')
      .get(`/journal-entries?search=${encodeURIComponent(sourceNumber)}&sortOrder=asc`)
      .expect(200);
    const list = (res.body as { data: Entry[] }).data.filter(
      (e) => e.sourceNumber === sourceNumber,
    );
    return Promise.all(list.map((e) => entry(e.id)));
  };

  const cleanUp = async () => {
    await prisma.setting.deleteMany({ where: { companyId, key: 'accounting' } });
    const manual = await prisma.journalEntry.findMany({
      where: { companyId, description: { startsWith: MARK } },
      select: { id: true },
    });
    const ids = manual.map((e) => e.id);
    await prisma.journalEntry.deleteMany({ where: { reversesId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
    await prisma.ledgerAccount.deleteMany({ where: { companyId, code: { startsWith: '102.9' } } });
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
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'PULSE' } })).id;
    await cleanUp();
    const partners = await api('admin').get('/partners?search=MUS-003').expect(200);
    customerId = (partners.body as { data: { id: string; code: string }[] }).data.find(
      (p) => p.code === 'MUS-003',
    )!.id;
    cashId = (
      await api('admin')
        .post('/treasury-accounts', {
          code: `AK-${suffix()}`,
          name: 'E2E Muhasebe Kasa',
          type: 'CASH',
          currencyCode: 'TRY',
          openingBalance: 2500,
        })
        .expect(201)
    ).body.id;
    await run();
    const chart = (await api('admin').get('/ledger-accounts').expect(200)).body as {
      id: string;
      code: string;
    }[];
    for (const a of chart) accounts.set(a.code, a.id);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('guards accounting by permission', async () => {
    await api('employee').get('/accounting/summary').expect(403);
    await api('employee').get('/journal-entries').expect(403);
    await api('manager').get('/accounting/summary').expect(200);
    await api('manager').get('/accounting/trial-balance').expect(200);
    await api('manager').get('/ledger-accounts').expect(200);
    await api('manager').post('/accounting/run').expect(403);
    await api('manager')
      .post('/journal-entries', { entryDate: TODAY, description: 'x', lines: [] })
      .expect(403);
    await api('manager').patch('/accounting/settings', { lockedUntil: null }).expect(403);
  });

  it('posts documents once, reverses cancelled ones and stays idempotent', async () => {
    const opening = await entriesFor(
      (await api('admin').get(`/treasury-accounts/${cashId}`).expect(200)).body.code,
    );
    expect(opening.map((e) => [e.source, view(e.lines)])).toEqual([
      ['TREASURY_OPENING', ['100 D 2500.00', '500 C 2500.00']],
    ]);
    expect(opening[0].documentId).toBe(cashId);

    const items = (
      await api('admin').get('/stock/items?includeServices=true&search=SRV-KURULUM').expect(200)
    ).body as { variantId: string; sku: string }[];
    const invoice = (
      await api('admin')
        .post('/sales-invoices', {
          partnerId: customerId,
          invoiceDate: TODAY,
          lines: [
            {
              variantId: items.find((i) => i.sku === 'SRV-KURULUM')!.variantId,
              quantity: 1,
              unitPrice: 1500,
              vatRate: 20,
            },
          ],
        })
        .expect(201)
    ).body as { id: string; number: string };
    const payment = (
      await api('admin')
        .post('/payments', {
          direction: 'IN',
          method: 'CASH',
          partnerId: customerId,
          paymentDate: TODAY,
          accountId: cashId,
          amount: 1000,
          allocations: [{ invoiceId: invoice.id, amount: 1000 }],
        })
        .expect(201)
    ).body as { id: string; number: string };

    const waiting = await pending();
    expect(waiting).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: invoice.id, action: 'POST' }),
        expect.objectContaining({ sourceId: payment.id, action: 'POST' }),
      ]),
    );
    expect(await run()).toEqual(expect.objectContaining({ posted: 2, reversed: 0 }));

    const [sale] = await entriesFor(invoice.number);
    expect(sale.source).toBe('SALES_INVOICE');
    expect(sale.documentId).toBe(invoice.id);
    expect(sale.status).toBe('POSTED');
    expect(sale.entryDate).toBe(TODAY);
    expect(view(sale.lines)).toEqual(['120 D 1800.00', '600 C 1500.00', '391 C 300.00']);
    expect(sale.lines[0].partnerId).toBe(customerId);
    expect(sale.canReverse).toBe(false);
    await api('admin').post(`/journal-entries/${sale.id}/reverse`, { date: TODAY }).expect(409);

    const [collection] = await entriesFor(payment.number);
    expect(view(collection.lines)).toEqual(['100 D 1000.00', '120 C 1000.00']);

    await api('admin').post(`/payments/${payment.id}/cancel`, { reason: 'e2e' }).expect(201);
    expect((await pending()).filter((p) => p.sourceId === payment.id)).toEqual([
      expect.objectContaining({ action: 'REVERSE' }),
    ]);
    expect(await run()).toEqual(expect.objectContaining({ posted: 0, reversed: 1 }));
    const [original, reversal] = await entriesFor(payment.number);
    expect(original.isReversed).toBe(true);
    expect(reversal.reverses?.id).toBe(original.id);
    expect(view(reversal.lines)).toEqual(['120 D 1000.00', '100 C 1000.00']);

    expect(await run()).toEqual(expect.objectContaining({ posted: 0, reversed: 0 }));
    expect(await entriesFor(invoice.number)).toHaveLength(1);
  });

  it('keeps manual entries balanced, posts them and reverses them', async () => {
    await api('admin')
      .post('/journal-entries', {
        entryDate: TODAY,
        description: `${MARK} bad`,
        lines: [
          { accountId: accounts.get('770'), debit: 100, credit: 100 },
          { accountId: accounts.get('102'), debit: 0, credit: 100 },
        ],
      })
      .expect(400);

    const draft = (
      await api('admin')
        .post('/journal-entries', {
          entryDate: day(-1),
          description: `${MARK} kira`,
          lines: [
            { accountId: accounts.get('770'), debit: 1000, credit: 0, description: 'Kira' },
            { accountId: accounts.get('102'), debit: 0, credit: 900 },
          ],
        })
        .expect(201)
    ).body as Entry;
    expect(draft.status).toBe('DRAFT');
    expect(draft.number).toMatch(/^YEV-\d{4}-\d{6}$/);
    expect(draft.canPost).toBe(false);
    await api('admin').post(`/journal-entries/${draft.id}/post`).expect(400);

    const fixed = (
      await api('admin')
        .patch(`/journal-entries/${draft.id}`, {
          entryDate: day(-1),
          description: `${MARK} kira`,
          lines: [
            { accountId: accounts.get('770'), debit: 1000, credit: 0 },
            { accountId: accounts.get('360'), debit: 0, credit: 200 },
            { accountId: accounts.get('102'), debit: 0, credit: 800 },
          ],
        })
        .expect(200)
    ).body as Entry;
    expect(fixed.total).toBe('1000.00');
    expect(fixed.canPost).toBe(true);

    const posted = (await api('admin').post(`/journal-entries/${draft.id}/post`).expect(200))
      .body as Entry;
    expect(posted.status).toBe('POSTED');
    await api('admin')
      .patch(`/journal-entries/${draft.id}`, {
        entryDate: TODAY,
        description: `${MARK} kira`,
        lines: [
          { accountId: accounts.get('770'), debit: 10, credit: 0 },
          { accountId: accounts.get('102'), debit: 0, credit: 10 },
        ],
      })
      .expect(409);
    await api('admin').delete(`/journal-entries/${draft.id}`).expect(409);

    await api('admin')
      .post(`/journal-entries/${draft.id}/reverse`, { date: day(-2) })
      .expect(400);
    const reversal = (
      await api('admin')
        .post(`/journal-entries/${draft.id}/reverse`, { date: TODAY, note: 'hatalı' })
        .expect(200)
    ).body as Entry;
    expect(reversal.isReversal).toBe(true);
    expect(view(reversal.lines)).toEqual(['360 D 200.00', '102 D 800.00', '770 C 1000.00']);
    await api('admin').post(`/journal-entries/${draft.id}/reverse`, { date: TODAY }).expect(409);
    await api('admin').post(`/journal-entries/${reversal.id}/reverse`, { date: TODAY }).expect(409);
  });

  it('locks closed periods', async () => {
    await api('admin')
      .patch('/accounting/settings', { lockedUntil: day(1) })
      .expect(400);
    await api('admin')
      .patch('/accounting/settings', { lockedUntil: day(-1) })
      .expect(200);
    const draft = (
      await api('admin')
        .post('/journal-entries', {
          entryDate: day(-1),
          description: `${MARK} kilitli`,
          lines: [
            { accountId: accounts.get('770'), debit: 50, credit: 0 },
            { accountId: accounts.get('100'), debit: 0, credit: 50 },
          ],
        })
        .expect(201)
    ).body as Entry;
    expect(draft.canPost).toBe(false);
    await api('admin').post(`/journal-entries/${draft.id}/post`).expect(400);
    await api('admin')
      .patch(`/journal-entries/${draft.id}`, {
        entryDate: TODAY,
        description: `${MARK} kilitli`,
        lines: [
          { accountId: accounts.get('770'), debit: 50, credit: 0 },
          { accountId: accounts.get('100'), debit: 0, credit: 50 },
        ],
      })
      .expect(200);
    await api('admin').post(`/journal-entries/${draft.id}/post`).expect(200);
    expect((await api('admin').get('/accounting/settings').expect(200)).body.lockedUntil).toBe(
      day(-1),
    );
    await api('admin').patch('/accounting/settings', { lockedUntil: null }).expect(200);
  });

  it('builds a balanced trial balance, balance sheet and income statement', async () => {
    const trial = (await api('admin').get('/accounting/trial-balance?detailed=true').expect(200))
      .body as { totals: Record<string, string>; rows: { code: string; accountId: string }[] };
    expect(trial.totals.totalDebit).toBe(trial.totals.totalCredit);
    expect(trial.totals.balanceDebit).toBe(trial.totals.balanceCredit);
    expect(trial.rows.find((r) => r.code === '120')?.accountId).toBe(accounts.get('120'));

    const sheet = (await api('admin').get('/accounting/balance-sheet').expect(200)).body as {
      totalAssets: string;
      totalLiabilities: string;
      liabilities: { code: string; groups: { code: string; total: string }[] }[];
    };
    expect(sheet.totalAssets).toBe(sheet.totalLiabilities);

    const income = (await api('admin').get('/accounting/income-statement').expect(200)).body as {
      netProfit: string;
      sections: { key: string; total: string }[];
    };
    const result = sheet.liabilities
      .find((c) => c.code === '5')
      ?.groups.find((g) => g.code === '59');
    expect(Number(result?.total ?? 0)).toBeCloseTo(Number(income.netProfit), 2);
    await api('admin')
      .get(`/accounting/income-statement?from=${TODAY}&to=${day(-1)}`)
      .expect(400);

    const ledger = (
      await api('admin')
        .get(`/ledger-accounts/${accounts.get('120')}/ledger?partnerId=${customerId}`)
        .expect(200)
    ).body as { opening: string; closing: string; rows: { debit: string; credit: string }[] };
    const moved = ledger.rows.reduce((sum, r) => sum + Number(r.debit) - Number(r.credit), 0);
    expect(Number(ledger.closing)).toBeCloseTo(Number(ledger.opening) + moved, 2);

    const summary = (await api('admin').get('/accounting/summary').expect(200)).body as {
      months: unknown[];
      chartInstalled: boolean;
    };
    expect(summary.months).toHaveLength(12);
    expect(summary.chartInstalled).toBe(true);
  });

  it('manages sub-accounts and protects system accounts', async () => {
    const sub = (
      await api('admin').post('/ledger-accounts', { code: '102.91', name: 'E2E Banka' }).expect(201)
    ).body as { id: string; type: string; parentId: string; level: number };
    expect(sub).toEqual(
      expect.objectContaining({ type: 'ASSET', parentId: accounts.get('102'), level: 1 }),
    );
    await api('admin').post('/ledger-accounts', { code: '102.91', name: 'Dup' }).expect(409);
    await api('admin').post('/ledger-accounts', { code: '109.01', name: 'Yok' }).expect(400);
    await api('admin').post('/ledger-accounts', { code: 'abc', name: 'Yok' }).expect(400);
    await api('admin')
      .patch(`/ledger-accounts/${accounts.get('100')}`, { isActive: false })
      .expect(409);
    await api('admin')
      .delete(`/ledger-accounts/${accounts.get('100')}`)
      .expect(409);
    await api('admin')
      .delete(`/ledger-accounts/${accounts.get('102')}`)
      .expect(409);
    await api('admin').delete(`/ledger-accounts/${sub.id}`).expect(204);
  });
});
