import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { computePayslip, DEFAULT_RATES } from '../src/modules/payroll/payroll-math';

const USERS = {
  admin: { email: 'admin@enterprisepulse.dev', password: 'Admin123!' },
  manager: { email: 'manager@enterprisepulse.dev', password: 'Manager123!' },
  employee: { email: 'employee@enterprisepulse.dev', password: 'Employee123!' },
};

interface SlipRow {
  id: string;
  employeeId: string;
  employeeName: string;
  netPay: string;
  grossPay: string;
  missingDays: number;
}
interface Period {
  id: string;
  status: string;
  netTotal: string;
  grossTotal: string;
  employeeCount: number;
  payslips: SlipRow[];
  canApprove: boolean;
  canReopen: boolean;
  canPay: boolean;
}
interface Slip extends SlipRow {
  month: number;
  monthlySalary: string;
  employedDays: number;
  overtimeHours: string;
  extraEarnings: string;
  otherDeductions: string;
  incomeTaxBase: string;
  cumulativeTaxBase: string;
}

const now = new Date();
const YEAR = now.getUTCFullYear();
const MONTH = now.getUTCMonth() + 1;
const sum = (values: string[]) =>
  values.reduce((total, v) => total + Math.round(Number(v) * 100), 0) / 100;

describe('Payroll (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  let companyId = '';
  let keremId = '';
  let employeeUserId = '';

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

  /** Removes the current month's payroll of earlier runs, including its bank entries. */
  const cleanUp = async () => {
    const periods = await prisma.payrollPeriod.findMany({
      where: { companyId, year: YEAR, month: MONTH },
    });
    for (const period of periods) {
      await prisma.treasuryTransaction.deleteMany({
        where: { documentId: period.id, reversesId: { not: null } },
      });
      await prisma.treasuryTransaction.deleteMany({ where: { documentId: period.id } });
      await prisma.payrollPeriod.delete({ where: { id: period.id } });
    }
    await prisma.payrollParameter.deleteMany({ where: { companyId, year: YEAR + 1 } });
  };

  const createPeriod = async () =>
    (await api('admin').post('/payroll-periods', { year: YEAR, month: MONTH }).expect(201))
      .body as Period;

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
    const kerem = await prisma.employee.findFirstOrThrow({ where: { userId: me.id } });
    keremId = kerem.id;
    companyId = kerem.companyId;
    await cleanUp();
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('keeps salaries and other payslips private', async () => {
    await api('employee').get('/payroll-periods').expect(403);
    await api('employee').get('/salaries').expect(403);
    await api('manager').get('/payroll-periods/summary').expect(403);
    await api('manager').post('/salaries', {}).expect(403);

    const mine = (await api('employee').get('/payslips/mine').expect(200)).body as Slip[];
    const others = await prisma.payslip.findFirst({
      where: { companyId, employeeId: { not: keremId } },
    });
    if (others) await api('employee').get(`/payslips/${others.id}`).expect(404);
    for (const slip of mine) {
      await api('employee').get(`/payslips/${slip.id}`).expect(200);
    }
  });

  it('computes a draft from salaries and continues the cumulative tax base', async () => {
    const period = await createPeriod();
    expect(period.status).toBe('DRAFT');
    expect(period.employeeCount).toBeGreaterThan(0);
    expect(period.netTotal).toBe(sum(period.payslips.map((s) => s.netPay)).toFixed(2));
    await api('admin').post('/payroll-periods', { year: YEAR, month: MONTH }).expect(409);

    const row = period.payslips.find((s) => s.employeeId === keremId)!;
    const slip = (await api('admin').get(`/payslips/${row.id}`).expect(200)).body as Slip;
    const before = Number(slip.cumulativeTaxBase) - Number(slip.incomeTaxBase);
    const previous = await prisma.payslip.findFirst({
      where: { employeeId: keremId, period: { year: YEAR, month: { lt: MONTH } } },
      orderBy: { period: { month: 'desc' } },
    });
    expect(before.toFixed(2)).toBe(previous ? previous.cumulativeTaxBase.toFixed(2) : '0.00');
    const expected = computePayslip(DEFAULT_RATES, {
      month: MONTH,
      monthlySalary: slip.monthlySalary,
      employedDays: slip.employedDays,
      missingDays: slip.missingDays,
      overtimeHours: slip.overtimeHours,
      extraEarnings: 0,
      otherDeductions: 0,
      cumulativeTaxBase: before,
    });
    expect(slip.netPay).toBe(expected.netPay.toFixed(2));

    // Drafts stay hidden from the employee.
    await api('employee').get(`/payslips/${row.id}`).expect(404);
    const mine = (await api('employee').get('/payslips/mine').expect(200)).body as Slip[];
    expect(mine.some((s) => s.id === row.id)).toBe(false);

    const edited = (
      await api('admin')
        .patch(`/payslips/${row.id}`, {
          missingDays: 2,
          overtimeHours: 10,
          items: [
            { kind: 'EARNING', description: 'Proje primi', amount: 5000 },
            { kind: 'DEDUCTION', description: 'Maaş avansı', amount: 1000 },
          ],
        })
        .expect(200)
    ).body as Slip;
    expect(edited.missingDays).toBe(2);
    expect(edited.extraEarnings).toBe('5000.00');
    expect(edited.otherDeductions).toBe('1000.00');
    await api('admin')
      .patch(`/payslips/${row.id}`, { missingDays: 31, overtimeHours: 0, items: [] })
      .expect(400);

    const updated = (await api('admin').get(`/payroll-periods/${period.id}`).expect(200))
      .body as Period;
    expect(updated.netTotal).toBe(sum(updated.payslips.map((s) => s.netPay)).toFixed(2));

    // Recalculating reads attendance again but keeps the extra items.
    const recalculated = (
      await api('admin').post(`/payroll-periods/${period.id}/recalculate`).expect(200)
    ).body as Period;
    const again = recalculated.payslips.find((s) => s.employeeId === keremId)!;
    const detail = (await api('admin').get(`/payslips/${again.id}`).expect(200)).body as Slip;
    expect(detail.extraEarnings).toBe('5000.00');
    expect(detail.missingDays).toBe(slip.missingDays);
  });

  it('approves, pays from the bank and reverses the payment', async () => {
    const draft = (
      await prisma.payrollPeriod.findFirstOrThrow({
        where: { companyId, year: YEAR, month: MONTH },
      })
    ).id;
    const approved = (await api('admin').post(`/payroll-periods/${draft}/approve`).expect(200))
      .body as Period;
    expect(approved.status).toBe('APPROVED');
    expect(approved.canPay).toBe(true);
    expect(
      await prisma.notification.count({
        where: { userId: employeeUserId, type: 'payroll.approved', createdAt: { gte: now } },
      }),
    ).toBeGreaterThan(0);

    const own = approved.payslips.find((s) => s.employeeId === keremId)!;
    await api('employee').get(`/payslips/${own.id}`).expect(200);
    await api('admin')
      .patch(`/payslips/${own.id}`, { missingDays: 0, overtimeHours: 0, items: [] })
      .expect(409);

    const reopened = (await api('admin').post(`/payroll-periods/${draft}/reopen`).expect(200))
      .body as Period;
    expect(reopened.status).toBe('DRAFT');
    await api('admin').post(`/payroll-periods/${draft}/approve`).expect(200);

    const accounts = (await api('admin').get('/treasury-accounts').expect(200)).body as {
      id: string;
      code: string;
      balance: string;
    }[];
    const bank = accounts.find((a) => a.code === 'BNK-TL')!;
    const usd = accounts.find((a) => a.code === 'BNK-USD')!;
    await api('admin').post(`/payroll-periods/${draft}/pay`, { accountId: usd.id }).expect(400);
    const paid = (
      await api('admin').post(`/payroll-periods/${draft}/pay`, { accountId: bank.id }).expect(200)
    ).body as Period;
    expect(paid.status).toBe('PAID');
    const afterPay = (await api('admin').get(`/treasury-accounts/${bank.id}`).expect(200)).body as {
      balance: string;
    };
    expect(Number(afterPay.balance)).toBeCloseTo(Number(bank.balance) - Number(paid.netTotal), 2);
    await api('admin').post(`/payroll-periods/${draft}/reopen`).expect(409);
    await api('manager').post(`/payroll-periods/${draft}/reverse-payment`).expect(403);

    const reversed = (
      await api('admin').post(`/payroll-periods/${draft}/reverse-payment`).expect(200)
    ).body as Period;
    expect(reversed.status).toBe('APPROVED');
    const afterReverse = (await api('admin').get(`/treasury-accounts/${bank.id}`).expect(200))
      .body as { balance: string };
    expect(afterReverse.balance).toBe(bank.balance);

    await api('admin').post(`/payroll-periods/${draft}/reopen`).expect(200);
    await api('admin').delete(`/payroll-periods/${draft}`).expect(204);
  });

  it('keeps salary history and closes approved months', async () => {
    const future = `${YEAR + 1}-01-01`;
    const history = (
      await api('admin')
        .post('/salaries', { employeeId: keremId, effectiveFrom: future, grossSalary: 150000 })
        .expect(201)
    ).body as { id: string; effectiveFrom: string; changePercent: string | null }[];
    expect(history[0].effectiveFrom).toBe(future);
    expect(history[0].changePercent).not.toBeNull();
    const list = (await api('admin').get('/salaries?pageSize=100').expect(200)).body as {
      data: { employeeId: string; upcomingSalary: string | null }[];
    };
    expect(list.data.find((r) => r.employeeId === keremId)?.upcomingSalary).toBe('150000.00');
    await api('admin').delete(`/salaries/${history[0].id}`).expect(204);

    if (MONTH > 1) {
      // January is approved in the demo data.
      await api('admin')
        .post('/salaries', { employeeId: keremId, effectiveFrom: `${YEAR}-01-15`, grossSalary: 1 })
        .expect(409);
    }
  });

  it('validates yearly parameters', async () => {
    const current = (
      await api('admin')
        .get(`/payroll-parameters/${YEAR + 1}`)
        .expect(200)
    ).body as Record<string, unknown> & { saved: boolean };
    expect(current.saved).toBe(false);
    const body = {
      minimumWage: 40000,
      sgkCeiling: 360000,
      sgkEmployeeRate: 14,
      unemploymentEmployeeRate: 1,
      sgkEmployerRate: 15.75,
      unemploymentEmployerRate: 2,
      stampTaxRate: 0.759,
      overtimeRate: 1.5,
      monthlyHours: 225,
      taxBrackets: [
        { upTo: 230000, rate: 15 },
        { upTo: null, rate: 20 },
      ],
    };
    await api('admin')
      .put(`/payroll-parameters/${YEAR + 1}`, {
        ...body,
        taxBrackets: [
          { upTo: null, rate: 15 },
          { upTo: 100, rate: 20 },
        ],
      })
      .expect(400);
    await api('manager')
      .put(`/payroll-parameters/${YEAR + 1}`, body)
      .expect(403);
    const saved = (
      await api('admin')
        .put(`/payroll-parameters/${YEAR + 1}`, body)
        .expect(200)
    ).body as { saved: boolean; stampTaxRate: string; taxBrackets: { rate: string }[] };
    expect(saved.saved).toBe(true);
    expect(saved.stampTaxRate).toBe('0.759');
    expect(saved.taxBrackets.map((b) => b.rate)).toEqual(['15', '20']);
  });
});
