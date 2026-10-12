import { randomUUID } from 'node:crypto';
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

interface Category {
  id: string;
  code: string;
  kind: string;
}
interface Report {
  id: string;
  number: string;
  status: string;
  totalAmount: string;
  workflowInstanceId: string | null;
  missingReceiptCount: number;
  overLimitCount: number;
  canSubmit: boolean;
  canPay: boolean;
  lines: { id: string; amount: string; amountBase: string; quantity: string; overLimit: boolean }[];
}
interface Account {
  id: string;
  code: string;
  balance: string;
}

const today = () => new Date().toISOString().slice(0, 10);

describe('Expenses (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  const categories: Record<string, string> = {};
  let companyId = '';
  let employeeUserId = '';

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

  /** Stands in for `POST /expense-reports/receipts`; object storage is not part of the suite. */
  const receipt = async (uploadedById = employeeUserId) =>
    (
      await prisma.fileObject.create({
        data: {
          companyId,
          storageKey: `e2e/${randomUUID()}.pdf`,
          originalName: 'fis.pdf',
          mimeType: 'application/pdf',
          size: 10,
          entityType: 'ExpenseReceipt',
          uploadedById,
        },
      })
    ).id;

  const meal = (extra: object = {}) => ({
    categoryId: categories.YEMEK,
    expenseDate: today(),
    description: 'Müşteri yemeği',
    amount: 500,
    vatAmount: 45,
    ...extra,
  });

  const newReport = async (lines: object[], role: keyof typeof tokens = 'employee') =>
    (
      await api(role)
        .post('/expense-reports', { title: `E2E masraf ${Date.now()}`, lines })
        .expect(201)
    ).body as Report;

  const approve = async (report: Report) => {
    await api('manager')
      .post(`/workflow/instances/${report.workflowInstanceId}/approve`, {})
      .expect(200);
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
    const me = await prisma.user.findUniqueOrThrow({ where: { email: USERS.employee.email } });
    employeeUserId = me.id;
    const employee = await prisma.employee.findFirstOrThrow({ where: { userId: me.id } });
    companyId = employee.companyId;
    const list = (await api('employee').get('/expense-categories').expect(200)).body as Category[];
    for (const category of list) categories[category.code] = category.id;
  });

  afterAll(() => app.close());

  it('lets employees file their own reports and keeps others private', async () => {
    const report = await newReport([
      meal({ receiptFileId: await receipt() }),
      { categoryId: categories.HARCIRAH, expenseDate: today(), description: '2 gün', quantity: 2 },
      { categoryId: categories.KM, expenseDate: today(), description: 'Araç', quantity: 100.5 },
      meal({ amount: 20, vatAmount: 0, currencyCode: 'EUR', exchangeRate: 50 }),
    ]);
    expect(report.status).toBe('DRAFT');
    expect(report.lines.map((l) => l.amountBase)).toEqual([
      '500.00',
      '2100.00',
      '854.25',
      '1000.00',
    ]);
    expect(report.totalAmount).toBe('4454.25');
    expect(report.overLimitCount).toBe(1);
    expect(report.missingReceiptCount).toBe(1);
    expect(report.canSubmit).toBe(false);

    const mine = (await api('employee').get('/expense-reports?pageSize=100').expect(200)).body as {
      data: { id: string; employeeName: string }[];
    };
    expect(mine.data.every((r) => r.employeeName === 'Kerem Polat')).toBe(true);
    const others = await prisma.expenseReport.findFirstOrThrow({
      where: { companyId, employee: { userId: { not: employeeUserId } } },
    });
    await api('employee').get(`/expense-reports/${others.id}`).expect(404);
    await api('manager').get(`/expense-reports/${report.id}`).expect(200);
    await api('manager')
      .put(`/expense-reports/${report.id}`, { title: 'Değişiklik', lines: [meal()] })
      .expect(403);

    const otherEmployee = await prisma.employee.findFirstOrThrow({
      where: { companyId, userId: { not: employeeUserId } },
    });
    await api('employee')
      .post('/expense-reports', { title: 'Başkası', employeeId: otherEmployee.id, lines: [meal()] })
      .expect(403);
    await api('employee')
      .post('/expense-reports', {
        title: 'Yabancı fiş',
        lines: [meal({ receiptFileId: await receipt(otherEmployee.userId!) })],
      })
      .expect(400);
    await api('employee')
      .post('/expense-reports', {
        title: 'Gelecek',
        lines: [meal({ expenseDate: '2099-01-01' })],
      })
      .expect(400);
    await api('employee')
      .post('/expense-reports', {
        title: 'Km eksik',
        lines: [{ categoryId: categories.KM, expenseDate: today(), description: 'Araç' }],
      })
      .expect(400);
    await api('employee').delete(`/expense-reports/${report.id}`).expect(204);
  });

  it('approves through the workflow, pays from the bank and reverses the payment', async () => {
    const report = await newReport([meal({ amount: 300, vatAmount: 27 })]);
    await api('employee').post(`/expense-reports/${report.id}/submit`).expect(400);
    const fixed = (
      await api('employee')
        .put(`/expense-reports/${report.id}`, {
          title: 'İstanbul toplantısı',
          lines: [meal({ amount: 300, vatAmount: 27, receiptFileId: await receipt() })],
        })
        .expect(200)
    ).body as Report;
    expect(fixed.canSubmit).toBe(true);

    const pending = (await api('employee').post(`/expense-reports/${report.id}/submit`).expect(201))
      .body as Report;
    expect(pending.status).toBe('PENDING');
    expect(pending.workflowInstanceId).toBeTruthy();
    await api('employee')
      .put(`/expense-reports/${report.id}`, { title: 'Değişiklik', lines: [meal()] })
      .expect(409);
    await api('admin')
      .post(`/expense-reports/${report.id}/pay`, { accountId: randomUUID() })
      .expect(409);

    await approve(pending);
    const approved = (await api('admin').get(`/expense-reports/${report.id}`).expect(200))
      .body as Report;
    expect(approved.status).toBe('APPROVED');
    expect(approved.canPay).toBe(true);
    const adminNotes = (await api('admin').get('/notifications?pageSize=20').expect(200)).body as {
      data: { type: string; link: string | null }[];
    };
    expect(
      adminNotes.data.some(
        (n) => n.type === 'expenses.approved' && n.link === `/expenses/${report.id}`,
      ),
    ).toBe(true);

    await api('employee')
      .post(`/expense-reports/${report.id}/pay`, { accountId: randomUUID() })
      .expect(403);
    const accounts = (await api('admin').get('/treasury-accounts').expect(200)).body as Account[];
    const usd = accounts.find((a) => a.code === 'BNK-USD')!;
    const bank = accounts.find((a) => a.code === 'BNK-TL')!;
    await api('admin').post(`/expense-reports/${report.id}/pay`, { accountId: usd.id }).expect(400);
    const paid = (
      await api('admin')
        .post(`/expense-reports/${report.id}/pay`, { accountId: bank.id, paymentDate: today() })
        .expect(201)
    ).body as Report;
    expect(paid.status).toBe('PAID');
    const afterPay = (await api('admin').get(`/treasury-accounts/${bank.id}`).expect(200))
      .body as Account;
    expect(Number(afterPay.balance)).toBeCloseTo(Number(bank.balance) - 300, 2);
    const employeeNotes = (await api('employee').get('/notifications?pageSize=20').expect(200))
      .body as { data: { type: string }[] };
    expect(employeeNotes.data.some((n) => n.type === 'expenses.paid')).toBe(true);
    await api('employee').post(`/expense-reports/${report.id}/cancel`, {}).expect(403);

    const reversed = (
      await api('admin').post(`/expense-reports/${report.id}/reverse-payment`).expect(201)
    ).body as Report;
    expect(reversed.status).toBe('APPROVED');
    const afterReverse = (await api('admin').get(`/treasury-accounts/${bank.id}`).expect(200))
      .body as Account;
    expect(afterReverse.balance).toBe(bank.balance);

    const cancelled = (
      await api('employee').post(`/expense-reports/${report.id}/cancel`, {}).expect(201)
    ).body as Report;
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('sends rejected and withdrawn reports back for editing', async () => {
    const report = await newReport([meal({ receiptFileId: await receipt() })]);
    const pending = (await api('employee').post(`/expense-reports/${report.id}/submit`).expect(201))
      .body as Report;
    await api('manager')
      .post(`/workflow/instances/${pending.workflowInstanceId}/reject`, {
        comment: 'Fiş okunmuyor',
      })
      .expect(200);
    expect(
      ((await api('employee').get(`/expense-reports/${report.id}`).expect(200)).body as Report)
        .status,
    ).toBe('REJECTED');

    const edited = (
      await api('employee')
        .put(`/expense-reports/${report.id}`, {
          title: 'Düzeltildi',
          lines: [meal({ amount: 450, receiptFileId: await receipt() })],
        })
        .expect(200)
    ).body as Report;
    expect(edited.status).toBe('DRAFT');
    await api('employee').post(`/expense-reports/${report.id}/submit`).expect(201);
    const withdrawn = (
      await api('employee').post(`/expense-reports/${report.id}/withdraw`).expect(201)
    ).body as Report;
    expect(withdrawn.status).toBe('DRAFT');
    await api('employee').delete(`/expense-reports/${report.id}`).expect(409);
    await api('employee').post(`/expense-reports/${report.id}/cancel`, {}).expect(201);
  });

  it('manages categories with expenses:update only', async () => {
    const code = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    await api('manager').post('/expense-categories', { code, name: 'Test' }).expect(403);
    await api('admin')
      .post('/expense-categories', { code, name: 'Harcırah', kind: 'PER_DIEM' })
      .expect(400);
    const created = (
      await api('admin')
        .post('/expense-categories', { code, name: 'Test harcırah', kind: 'PER_DIEM', rate: 500 })
        .expect(201)
    ).body as Category & { requiresReceipt: boolean };
    expect(created.requiresReceipt).toBe(false);
    await api('admin').post('/expense-categories', { code, name: 'Tekrar' }).expect(409);
    await api('admin').patch(`/expense-categories/${created.id}`, { isActive: false }).expect(200);
    await api('employee')
      .post('/expense-reports', {
        title: 'Pasif kategori',
        lines: [{ categoryId: created.id, expenseDate: today(), description: 'x', quantity: 1 }],
      })
      .expect(400);
  });

  it('summarises company-wide for finance and own reports for employees', async () => {
    const admin = (await api('admin').get('/expense-reports/summary').expect(200)).body as {
      pendingCount: number;
      toPayCount: number;
      byCategory: { name: string }[];
      byMonth: { month: string }[];
    };
    const employee = (await api('employee').get('/expense-reports/summary').expect(200)).body as {
      pendingCount: number;
      myPendingCount: number;
    };
    expect(admin.pendingCount).toBeGreaterThanOrEqual(2);
    expect(admin.toPayCount).toBeGreaterThanOrEqual(2);
    expect(admin.byCategory.length).toBeGreaterThan(0);
    expect(admin.byMonth).toHaveLength(6);
    expect(employee.pendingCount).toBe(employee.myPendingCount);
    expect(employee.pendingCount).toBeLessThan(admin.pendingCount);
  });

  it('keeps expense reports inside their company', async () => {
    const report = await prisma.expenseReport.findFirstOrThrow({ where: { companyId } });
    const other = await prisma.company.findFirstOrThrow({ where: { code: 'PULSE-LOJ' } });
    await api('admin', other.id).get(`/expense-reports/${report.id}`).expect(404);
  });
});
