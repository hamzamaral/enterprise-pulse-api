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

interface Partner {
  id: string;
  code: string;
  type: string;
  balance: string;
}

describe('Partners (e2e)', () => {
  let app: NestExpressApplication;
  const tokens = { admin: '', manager: '', employee: '' };

  const api = (role: keyof typeof tokens) => {
    const auth = `Bearer ${tokens[role]}`;
    const server = () => request(app.getHttpServer());
    return {
      get: (url: string) => server().get(`/api/v1${url}`).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        server().post(`/api/v1${url}`).set('Authorization', auth).send(body),
      patch: (url: string, body: object = {}) =>
        server().patch(`/api/v1${url}`).set('Authorization', auth).send(body),
      delete: (url: string) => server().delete(`/api/v1${url}`).set('Authorization', auth),
    };
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
  });

  afterAll(() => app.close());

  it('creates partners with generated codes and filters by side', async () => {
    const supplier = (
      await api('admin')
        .post('/partners', { title: 'E2E Tedarikçi', type: 'SUPPLIER', taxNumber: '1234567890' })
        .expect(201)
    ).body as Partner;
    expect(supplier.code).toMatch(/^CAR-\d{6}$/);
    expect(supplier.balance).toBe('0.00');

    const both = (
      await api('admin')
        .post('/partners', { title: 'E2E Karma', type: 'BOTH', creditLimit: 1000 })
        .expect(201)
    ).body as Partner;

    const customers = await api('admin').get('/partners?type=CUSTOMER&pageSize=100').expect(200);
    const ids = (customers.body as { data: Partner[] }).data.map((p) => p.id);
    expect(ids).toContain(both.id);
    expect(ids).not.toContain(supplier.id);

    await api('admin')
      .post('/partners', { code: supplier.code, title: 'Kopya', type: 'CUSTOMER' })
      .expect(409);
    await api('admin')
      .post('/partners', { title: 'Hatalı', type: 'CUSTOMER', taxNumber: '12' })
      .expect(400);

    const statement = await api('admin').get(`/partners/${supplier.id}/statement`).expect(200);
    expect(statement.body).toMatchObject({ openingBalance: '0.00', entries: [] });

    await api('admin').delete(`/partners/${both.id}`).expect(204);
    await api('admin').get(`/partners/${both.id}`).expect(404);
  });

  it('lets managers read but not change partners; employees see nothing', async () => {
    await api('manager').get('/partners').expect(200);
    await api('manager').post('/partners', { title: 'Yetkisiz', type: 'CUSTOMER' }).expect(403);
    await api('employee').get('/partners').expect(403);
  });

  it('offers services with prices in the item lookup', async () => {
    const res = await api('manager').get('/stock/items?includeServices=true').expect(200);
    const items = res.body as { productType: string; vatRate: string | null }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('salePrice');
  });
});
