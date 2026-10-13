import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { StorageService } from '../src/infrastructure/storage/storage.service';

const USERS = {
  admin: { email: 'admin@enterprisepulse.dev', password: 'Admin123!' },
  manager: { email: 'manager@enterprisepulse.dev', password: 'Manager123!' },
  employee: { email: 'employee@enterprisepulse.dev', password: 'Employee123!' },
};

interface Contract {
  id: string;
  number: string;
  status: string;
  state: string;
  endDate: string | null;
  noticeDeadline: string | null;
  annualValue: string | null;
  renewalCount: number;
  terminatedOn: string | null;
  suggestedRenewalEnd: string | null;
  events: { type: string; fromValue: string | null; toValue: string | null }[];
  attachments: { id: string; originalName: string }[];
  canActivate: boolean;
  canRenew: boolean;
  canTerminate: boolean;
  canCancelTermination: boolean;
  canDelete: boolean;
}

interface ContractType {
  id: string;
  name: string;
  party: string;
}

const DAY_MS = 86_400_000;
const day = (offset: number) =>
  new Date(
    Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })) +
      offset * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);

describe('Contracts (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  const ids = { admin: '', manager: '', employee: '' };
  let companyId = '';
  let partnerId = '';
  let employeeId = '';
  const types = { service: '', employment: '' };
  /** In-memory object storage; the suite does not depend on a running S3 endpoint. */
  const objects = new Map<string, Buffer>();

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
      upload: (url: string, name: string, content: string) =>
        server()
          .post(`/api/v1${url}`)
          .set('Authorization', auth)
          .attach('file', Buffer.from(content), { filename: name, contentType: 'text/plain' }),
    };
  };

  const cleanUp = async () => {
    const contracts = await prisma.contract.findMany({
      where: { companyId, title: { startsWith: 'E2E ' } },
      select: { id: true },
    });
    const contractIds = contracts.map((c) => c.id);
    await prisma.fileObject.deleteMany({
      where: { entityType: 'Contract', entityId: { in: contractIds } },
    });
    await prisma.notification.deleteMany({
      where: { link: { in: contractIds.map((id) => `/contracts/${id}`) } },
    });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.contractType.deleteMany({ where: { companyId, name: { startsWith: 'E2E ' } } });
  };

  const draft = async (body: object = {}) =>
    (
      await api('admin')
        .post('/contracts', {
          title: 'E2E Hizmet',
          typeId: types.service,
          partnerId,
          startDate: day(-30),
          endDate: day(334),
          amount: 1000,
          billingCycle: 'MONTHLY',
          ...body,
        })
        .expect(201)
    ).body as Contract;

  const activate = async (id: string) =>
    (await api('admin').post(`/contracts/${id}/activate`).expect(200)).body as Contract;

  beforeAll(async () => {
    const storage: Partial<StorageService> = {
      onModuleInit: () => Promise.resolve(),
      upload: (key, body) => Promise.resolve(void objects.set(key, body)),
      getDownloadUrl: (key) => Promise.resolve(`https://storage.test/${key}`),
      delete: (key) => Promise.resolve(void objects.delete(key)),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
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

    partnerId = (
      await prisma.businessPartner.findFirstOrThrow({ where: { companyId, deletedAt: null } })
    ).id;
    employeeId = (
      await prisma.employee.findFirstOrThrow({ where: { companyId, userId: ids.employee } })
    ).id;
    const service = (
      await api('admin')
        .post('/contract-types', {
          name: 'E2E Hizmet',
          party: 'PARTNER',
          flow: 'INCOME',
          defaultTermMonths: 12,
          defaultNoticeDays: 30,
        })
        .expect(201)
    ).body as ContractType;
    const employment = (
      await api('admin').post('/contract-types', { name: 'E2E İş', party: 'EMPLOYEE' }).expect(201)
    ).body as ContractType;
    types.service = service.id;
    types.employment = employment.id;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('keeps contracts to permission holders and owners', async () => {
    await api('employee').get('/contracts').expect(403);
    await api('employee').get('/contracts/summary').expect(403);
    await api('employee').get('/contract-types').expect(403);
    await api('employee')
      .post('/contracts', { title: 'E2E Yasak', typeId: types.service, startDate: day(0) })
      .expect(403);
    await api('manager').get('/contracts').expect(200);
    await api('manager').get('/contracts/summary').expect(200);
    await api('manager')
      .post('/contracts', { title: 'E2E Yasak', typeId: types.service, startDate: day(0) })
      .expect(403);
    await api('manager').post('/contracts/run').expect(403);

    const owners = (await api('admin').get('/contracts/owners').expect(200)).body as {
      id: string;
    }[];
    expect(owners.map((o) => o.id)).toEqual(expect.arrayContaining([ids.admin, ids.manager]));
    expect(owners.map((o) => o.id)).not.toContain(ids.employee);
    await api('admin')
      .post('/contracts', {
        title: 'E2E Sahip',
        typeId: types.service,
        partnerId,
        startDate: day(0),
        ownerId: ids.employee,
      })
      .expect(400);

    const contract = await draft({ ownerId: ids.manager });
    await api('employee').get(`/contracts/${contract.id}`).expect(404);
    await api('manager').get(`/contracts/${contract.id}`).expect(200);
    const notice = await prisma.notification.findFirst({
      where: { userId: ids.manager, link: `/contracts/${contract.id}` },
    });
    expect(notice?.title).toContain(contract.number);
  });

  it('validates the party and the terms', async () => {
    await api('admin')
      .post('/contracts', { title: 'E2E Eksik', typeId: types.service, startDate: day(0) })
      .expect(400);
    await api('admin')
      .post('/contracts', {
        title: 'E2E Yanlış taraf',
        typeId: types.employment,
        partnerId,
        startDate: day(0),
      })
      .expect(400);
    await api('admin')
      .post('/contracts', {
        title: 'E2E Ters tarih',
        typeId: types.service,
        partnerId,
        startDate: day(10),
        endDate: day(5),
      })
      .expect(400);
    await api('admin')
      .post('/contracts', {
        title: 'E2E Süresiz yenileme',
        typeId: types.service,
        partnerId,
        startDate: day(0),
        autoRenew: true,
      })
      .expect(400);

    const employment = (
      await api('admin')
        .post('/contracts', {
          title: 'E2E İş sözleşmesi',
          typeId: types.employment,
          employeeId,
          partnerId,
          startDate: day(0),
        })
        .expect(201)
    ).body as Contract & { partnerId: string | null; employeeId: string; partyName: string };
    expect(employment).toMatchObject({ partnerId: null, employeeId, endDate: null });
    expect(employment.partyName).toBeTruthy();
  });

  it('runs the lifecycle: activate, renew, terminate and cancel', async () => {
    const contract = await draft({ autoRenew: true });
    expect(contract).toMatchObject({ status: 'DRAFT', state: 'DRAFT', canActivate: true });
    expect(contract.number).toMatch(/^SZL-/);
    expect(contract.annualValue).toBe('12000.00');
    expect(contract.noticeDeadline).toBe(day(304));

    await api('admin')
      .patch(`/contracts/${contract.id}`, { endDate: day(365) })
      .expect(200);
    const active = await activate(contract.id);
    expect(active).toMatchObject({ status: 'ACTIVE', state: 'ACTIVE', canRenew: true });
    await api('admin').post(`/contracts/${contract.id}/activate`).expect(409);
    await api('admin')
      .patch(`/contracts/${contract.id}`, { endDate: day(400) })
      .expect(409);
    await api('admin').patch(`/contracts/${contract.id}`, { amount: 1200 }).expect(200);
    await api('admin').delete(`/contracts/${contract.id}`).expect(409);

    await api('admin')
      .post(`/contracts/${contract.id}/renew`, { endDate: day(300) })
      .expect(400);
    const renewed = (
      await api('admin')
        .post(`/contracts/${contract.id}/renew`, { endDate: day(730), amount: 1500, note: 'Zam' })
        .expect(200)
    ).body as Contract;
    expect(renewed).toMatchObject({ endDate: day(730), renewalCount: 1 });
    expect(renewed.events.at(-1)).toMatchObject({
      type: 'RENEWED',
      fromValue: day(365),
      toValue: day(730),
    });

    const scheduled = (
      await api('admin')
        .post(`/contracts/${contract.id}/terminate`, { terminatedOn: day(30), reason: 'Kapsam' })
        .expect(200)
    ).body as Contract;
    expect(scheduled).toMatchObject({
      status: 'ACTIVE',
      state: 'TERMINATING',
      canCancelTermination: true,
      canRenew: false,
    });
    await api('admin')
      .post(`/contracts/${contract.id}/terminate`, { terminatedOn: day(20), reason: 'Tekrar' })
      .expect(409);
    const cancelled = (
      await api('admin').post(`/contracts/${contract.id}/cancel-termination`).expect(200)
    ).body as Contract;
    expect(cancelled).toMatchObject({ state: 'ACTIVE', terminatedOn: null });

    await api('admin')
      .post(`/contracts/${contract.id}/terminate`, { terminatedOn: day(800), reason: 'Geç' })
      .expect(400);
    const ended = (
      await api('admin')
        .post(`/contracts/${contract.id}/terminate`, { terminatedOn: day(-1), reason: 'Bitti' })
        .expect(200)
    ).body as Contract;
    expect(ended).toMatchObject({ status: 'TERMINATED', canRenew: false, canTerminate: false });
    await api('admin')
      .post(`/contracts/${contract.id}/renew`, { endDate: day(900) })
      .expect(409);

    const disposable = await draft({ title: 'E2E Silinecek' });
    expect(disposable.canDelete).toBe(true);
    await api('admin').delete(`/contracts/${disposable.id}`).expect(204);
  });

  it('renews, expires, terminates and reminds in the daily job', async () => {
    const renewing = await draft({
      title: 'E2E Otomatik yenilenen',
      startDate: day(-400),
      endDate: day(-35),
      autoRenew: true,
      renewalMonths: 12,
    });
    const renewed = await activate(renewing.id);
    expect(renewed.status).toBe('ACTIVE');
    expect(renewed.renewalCount).toBe(1);
    expect(renewed.endDate! > day(300)).toBe(true);
    expect(renewed.events.map((e) => e.type)).toContain('AUTO_RENEWED');

    const lapsed = await draft({
      title: 'E2E Süresi dolan',
      startDate: day(-365),
      endDate: day(-1),
    });
    expect((await activate(lapsed.id)).status).toBe('EXPIRED');
    const revived = (
      await api('admin')
        .post(`/contracts/${lapsed.id}/renew`, { endDate: day(60) })
        .expect(200)
    ).body as Contract;
    expect(revived.status).toBe('ACTIVE');

    const ending = await draft({
      title: 'E2E Bitiyor',
      startDate: day(-355),
      endDate: day(10),
      ownerId: ids.manager,
    });
    const reminded = await activate(ending.id);
    expect(reminded.state).toBe('EXPIRING');
    expect(reminded.events.at(-1)?.type).toBe('REMINDER_SENT');
    const reminders = await prisma.notification.count({
      where: {
        userId: ids.manager,
        link: `/contracts/${ending.id}`,
        title: { contains: 'bitiyor' },
      },
    });
    expect(reminders).toBe(1);

    const terminating = await draft({ title: 'E2E Feshedilen' });
    await activate(terminating.id);
    await api('admin')
      .post(`/contracts/${terminating.id}/terminate`, { terminatedOn: day(0), reason: 'Fesih' })
      .expect(200);
    await prisma.contract.update({
      where: { id: terminating.id },
      data: { terminatedOn: new Date(`${day(-1)}T00:00:00.000Z`) },
    });

    const result = (await api('admin').post('/contracts/run').expect(200)).body as {
      terminated: number;
      reminded: number;
    };
    expect(result.terminated).toBeGreaterThanOrEqual(1);
    const after = (await api('admin').get(`/contracts/${terminating.id}`).expect(200))
      .body as Contract;
    expect(after.status).toBe('TERMINATED');
    await api('admin').post('/contracts/run').expect(200);
    expect(
      await prisma.notification.count({
        where: {
          userId: ids.manager,
          link: `/contracts/${ending.id}`,
          title: { contains: 'bitiyor' },
        },
      }),
    ).toBe(1);

    const expiring = (
      await api('admin').get('/contracts?expiring=true&search=E2E&pageSize=100').expect(200)
    ).body as { data: Contract[] };
    expect(expiring.data.map((c) => c.id)).toContain(ending.id);
    expect(expiring.data.map((c) => c.id)).not.toContain(renewing.id);

    const summary = (await api('manager').get('/contracts/summary').expect(200)).body as {
      expiringCount: number;
      upcoming: unknown[];
      values: { currencyCode: string; income: string }[];
      nextActions: { id: string }[];
    };
    expect(summary.expiringCount).toBeGreaterThanOrEqual(1);
    expect(summary.upcoming).toHaveLength(12);
    expect(Number(summary.values.find((v) => v.currencyCode === 'TRY')?.income)).toBeGreaterThan(0);
  });

  it('keeps attachments with the contract', async () => {
    const contract = await draft({ title: 'E2E Ekli' });
    const withFile = (
      await api('admin')
        .upload(`/contracts/${contract.id}/attachments`, 'imzali.txt', 'imzalı sözleşme')
        .expect(201)
    ).body as Contract;
    expect(withFile.attachments).toHaveLength(1);
    expect(objects.size).toBe(1);
    const [file] = withFile.attachments;
    await api('manager').get(`/contracts/${contract.id}/attachments/${file.id}/url`).expect(200);
    await api('manager').delete(`/contracts/${contract.id}/attachments/${file.id}`).expect(403);
    const without = (
      await api('admin').delete(`/contracts/${contract.id}/attachments/${file.id}`).expect(200)
    ).body as Contract;
    expect(without.attachments).toHaveLength(0);
    expect(objects.size).toBe(0);
  });

  it('guards contract types in use', async () => {
    await api('admin')
      .post('/contract-types', { name: 'E2E Hizmet', party: 'PARTNER' })
      .expect(409);
    await api('admin').patch(`/contract-types/${types.service}`, { party: 'EMPLOYEE' }).expect(409);
    await api('admin').delete(`/contract-types/${types.service}`).expect(409);
    const unused = (
      await api('admin').post('/contract-types', { name: 'E2E Boş', party: 'PARTNER' }).expect(201)
    ).body as ContractType;
    await api('admin').patch(`/contract-types/${unused.id}`, { party: 'EMPLOYEE' }).expect(200);
    await api('admin').delete(`/contract-types/${unused.id}`).expect(204);
  });
});
