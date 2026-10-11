import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const ADMIN = { email: 'admin@enterprisepulse.dev', password: 'Admin123!' };
const MANAGER = { email: 'manager@enterprisepulse.dev', password: 'Manager123!' };
const EMPLOYEE = { email: 'employee@enterprisepulse.dev', password: 'Employee123!' };

const today = () => new Date().toISOString().slice(0, 10);
const uniqueCode = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

interface Variant {
  id: string;
  sku: string;
  averageCost: string;
  onHand: string;
}

describe('Inventory (e2e)', () => {
  let app: NestExpressApplication;
  const tokens: Record<'admin' | 'manager' | 'employee', string> = {
    admin: '',
    manager: '',
    employee: '',
  };
  let unitId: string;
  let central: string;
  let ankara: string;

  const api = (role: keyof typeof tokens) => {
    const server = () => request(app.getHttpServer());
    const auth = `Bearer ${tokens[role]}`;
    return {
      get: (url: string) => server().get(`/api/v1${url}`).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        server().post(`/api/v1${url}`).set('Authorization', auth).send(body),
      patch: (url: string, body: object = {}) =>
        server().patch(`/api/v1${url}`).set('Authorization', auth).send(body),
    };
  };

  const login = async (credentials: { email: string; password: string }) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(credentials)
      .expect(200);
    return res.body.accessToken as string;
  };

  const createProduct = async (overrides: object = {}) => {
    const res = await api('admin')
      .post('/products', { code: uniqueCode('E2E'), name: 'e2e item', unitId, ...overrides })
      .expect(201);
    return res.body as { id: string; variants: Variant[] };
  };

  const move = (body: object, status = 201) =>
    api('admin')
      .post('/stock-movements', { movementDate: today(), ...body })
      .expect(status);

  const variantOf = async (productId: string) => {
    const res = await api('admin').get(`/products/${productId}`).expect(200);
    return (res.body as { variants: Variant[] }).variants[0];
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    tokens.admin = await login(ADMIN);
    tokens.manager = await login(MANAGER);
    tokens.employee = await login(EMPLOYEE);

    const units = await api('admin').get('/settings/units').expect(200);
    unitId = (units.body as { id: string; code: string }[]).find((u) => u.code === 'ADET')!.id;
    const warehouses = await api('admin').get('/warehouses').expect(200);
    const byCode = (code: string) =>
      (warehouses.body as { id: string; code: string }[]).find((w) => w.code === code)!.id;
    central = byCode('MRK');
    ankara = byCode('ANK');
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets managers read stock but not move it', async () => {
    const levels = await api('manager').get('/stock/levels?pageSize=5').expect(200);
    expect(levels.body.meta.total).toBeGreaterThan(0);
    const low = await api('manager').get('/stock/levels?lowStock=true').expect(200);
    const lowRows = (low.body as { data: { lowStock: boolean }[] }).data;
    expect(lowRows.every((row) => row.lowStock)).toBe(true);
    await api('manager').post('/stock-movements', {}).expect(403);
    await api('employee').get('/products').expect(403);
  });

  it('keeps a moving average cost and never lets stock go negative', async () => {
    const product = await createProduct({ purchasePrice: 100 });
    const variantId = product.variants[0].id;
    const line = (quantity: number, unitCost?: number) => ({ variantId, quantity, unitCost });

    await move({ type: 'RECEIPT', targetWarehouseId: central, lines: [line(10, 100)] });
    await move({ type: 'RECEIPT', targetWarehouseId: central, lines: [line(10, 200)] });
    expect(await variantOf(product.id)).toMatchObject({ averageCost: '150.0000', onHand: '20' });

    const short = await move({ type: 'ISSUE', sourceWarehouseId: central, lines: [line(25)] }, 400);
    expect(short.body.message).toMatch(/Insufficient stock/);
    await move({ type: 'ISSUE', sourceWarehouseId: ankara, lines: [line(1)] }, 400);

    const issue = await move({ type: 'ISSUE', sourceWarehouseId: central, lines: [line(5)] });
    expect(issue.body).toMatchObject({ number: expect.stringMatching(/^STH-\d{4}-\d{6}$/) });
    expect(issue.body.lines[0]).toMatchObject({ quantity: '5', unitCost: '150.0000' });

    await move({
      type: 'TRANSFER',
      sourceWarehouseId: central,
      targetWarehouseId: ankara,
      lines: [line(4)],
    });
    const ledger = await api('admin').get(`/stock/ledger?variantId=${variantId}`).expect(200);
    expect(ledger.body.meta.total).toBe(5);
    // Newest first: the transfer wrote an exit from central and an entry into Ankara.
    expect(
      (ledger.body as { data: { quantity: string; balanceAfter: string }[] }).data
        .slice(0, 2)
        .map((e) => [e.quantity, e.balanceAfter]),
    ).toEqual([
      ['4', '4'],
      ['-4', '11'],
    ]);
    expect(await variantOf(product.id)).toMatchObject({ averageCost: '150.0000', onHand: '15' });
  });

  it('validates warehouses per movement type', async () => {
    const product = await createProduct();
    const lines = [{ variantId: product.variants[0].id, quantity: 1 }];
    await move({ type: 'RECEIPT', lines }, 400);
    await move(
      { type: 'RECEIPT', sourceWarehouseId: central, targetWarehouseId: ankara, lines },
      400,
    );
    await move(
      { type: 'TRANSFER', sourceWarehouseId: central, targetWarehouseId: central, lines },
      400,
    );
    await move(
      { type: 'ADJUSTMENT', targetWarehouseId: central, lines: [{ ...lines[0], quantity: 0 }] },
      400,
    );
  });

  it('tracks lots per warehouse', async () => {
    const product = await createProduct({ trackingType: 'LOT' });
    const variantId = product.variants[0].id;
    await move(
      { type: 'RECEIPT', targetWarehouseId: central, lines: [{ variantId, quantity: 5 }] },
      400,
    );
    await move({
      type: 'RECEIPT',
      targetWarehouseId: central,
      lines: [{ variantId, quantity: 5, unitCost: 10, lotNo: 'L-1', expiryDate: '2030-01-31' }],
    });
    await move(
      {
        type: 'ISSUE',
        sourceWarehouseId: central,
        lines: [{ variantId, quantity: 6, lotNo: 'L-1' }],
      },
      400,
    );
    const lots = await api('admin').get(`/stock/lots?variantId=${variantId}`).expect(200);
    const lotId = lots.body[0].lotId as string;
    await move({
      type: 'TRANSFER',
      sourceWarehouseId: central,
      targetWarehouseId: ankara,
      lines: [{ variantId, quantity: 3, lotId }],
    });
    const after = await api('admin').get(`/stock/lots?variantId=${variantId}`).expect(200);
    expect(
      (after.body as { warehouseId: string; quantity: string; expiryDate: string }[])
        .map((l) => [l.warehouseId === central ? 'MRK' : 'ANK', l.quantity, l.expiryDate])
        .sort(),
    ).toEqual([
      ['ANK', '3', '2030-01-31'],
      ['MRK', '2', '2030-01-31'],
    ]);
  });

  it('tracks serial numbers through receipt and issue', async () => {
    const product = await createProduct({ trackingType: 'SERIAL' });
    const variantId = product.variants[0].id;
    const serialNos = [uniqueCode('SN'), uniqueCode('SN')];
    await move(
      {
        type: 'RECEIPT',
        targetWarehouseId: central,
        lines: [{ variantId, quantity: 2, serialNos: serialNos.slice(0, 1) }],
      },
      400,
    );
    await move({
      type: 'RECEIPT',
      targetWarehouseId: central,
      lines: [{ variantId, quantity: 2, serialNos }],
    });
    await move(
      {
        type: 'RECEIPT',
        targetWarehouseId: central,
        lines: [{ variantId, quantity: 1, serialNos: serialNos.slice(0, 1) }],
      },
      409,
    );

    const serials = await api('admin').get(`/stock/serials?variantId=${variantId}`).expect(200);
    const [first] = serials.body as { id: string; serialNo: string }[];
    await move(
      {
        type: 'ISSUE',
        sourceWarehouseId: ankara,
        lines: [{ variantId, quantity: 1, serialIds: [first.id] }],
      },
      400,
    );
    const issue = await move({
      type: 'ISSUE',
      sourceWarehouseId: central,
      lines: [{ variantId, quantity: 1, serialIds: [first.id] }],
    });
    expect(issue.body.lines[0].serialNos).toEqual([first.serialNo]);
    const inStock = await api('admin')
      .get(`/stock/serials?variantId=${variantId}&status=IN_STOCK`)
      .expect(200);
    expect(inStock.body).toHaveLength(1);
  });

  it('posts counted differences as an adjustment when a count is completed', async () => {
    const code = uniqueCode('E2E').slice(0, 20);
    const warehouse = await api('admin')
      .post('/warehouses', { code, name: `e2e ${code}` })
      .expect(201);
    const product = await createProduct();
    const variantId = product.variants[0].id;
    await move({
      type: 'RECEIPT',
      targetWarehouseId: warehouse.body.id,
      lines: [{ variantId, quantity: 10, unitCost: 5 }],
    });

    const count = await api('admin')
      .post('/stock-counts', { warehouseId: warehouse.body.id, countDate: today() })
      .expect(201);
    expect(count.body).toMatchObject({ status: 'DRAFT', lineCount: 1 });
    await api('admin')
      .post('/stock-counts', { warehouseId: warehouse.body.id, countDate: today() })
      .expect(409);

    const lineId = count.body.lines[0].id as string;
    const counted = await api('admin')
      .patch(`/stock-counts/${count.body.id}/lines`, { lines: [{ id: lineId, countedQty: 8 }] })
      .expect(200);
    expect(counted.body.lines[0]).toMatchObject({
      expectedQty: '10',
      countedQty: '8',
      difference: '-2',
    });

    await api('manager').post(`/stock-counts/${count.body.id}/complete`).expect(403);
    const done = await api('admin').post(`/stock-counts/${count.body.id}/complete`).expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', differenceCount: 1 });
    const adjustment = await api('admin')
      .get(`/stock-movements/${done.body.adjustmentId}`)
      .expect(200);
    expect(adjustment.body).toMatchObject({ type: 'ADJUSTMENT', stockCountId: count.body.id });
    expect(adjustment.body.lines[0].quantity).toBe('-2');
    expect(await variantOf(product.id)).toMatchObject({ onHand: '8' });
    await api('admin').post(`/stock-counts/${count.body.id}/complete`).expect(409);
  });

  it('notifies stock managers when an item falls below its reorder point', async () => {
    const product = await createProduct({ minStock: 5 });
    const variantId = product.variants[0].id;
    await move({
      type: 'RECEIPT',
      targetWarehouseId: central,
      lines: [{ variantId, quantity: 6, unitCost: 1 }],
    });
    await move({ type: 'ISSUE', sourceWarehouseId: central, lines: [{ variantId, quantity: 2 }] });

    const res = await api('admin').get('/notifications?pageSize=5').expect(200);
    const sku = product.variants[0].sku;
    expect(
      (res.body as { data: { type: string; title: string }[] }).data.some(
        (n) => n.type === 'inventory.low_stock' && n.title.includes(sku),
      ),
    ).toBe(true);
  });
});
