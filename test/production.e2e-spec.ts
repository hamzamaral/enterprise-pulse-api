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

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
const uniqueCode = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

interface Bom {
  id: string;
  code: string;
  isDefault: boolean;
  unitCost: string;
  buildable: string;
  canDelete: boolean;
}

interface WorkOrder {
  id: string;
  number: string;
  status: string;
  quantity: string;
  producedQty: string;
  progress: number;
  buildable: string;
  actualUnitCost: string | null;
  standardUnitCost: string;
  canRecord: boolean;
  components: { sku: string; requiredQty: string; consumedQty: string; availability: string }[];
  records: {
    number: string;
    quantity: string;
    materialCost: string;
    totalCost: string;
    unitCost: string;
    issueMovementId: string | null;
    receiptMovementId: string;
  }[];
}

describe('Production (e2e)', () => {
  let app: NestExpressApplication;
  const tokens = { admin: '', manager: '', employee: '' };
  let unitId = '';
  let central = '';
  const items = { a: '', b: '', x: '', serial: '', service: '' };
  const skus = { a: '', x: '' };
  let bomId = '';

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

  const product = async (overrides: object = {}) => {
    const res = await api('admin')
      .post('/products', { code: uniqueCode('MRP'), name: 'mrp e2e', unitId, ...overrides })
      .expect(201);
    const body = res.body as { variants: { id: string; sku: string }[] };
    return body.variants[0];
  };

  const receive = (lines: object[]) =>
    api('admin')
      .post('/stock-movements', {
        type: 'RECEIPT',
        movementDate: TODAY,
        targetWarehouseId: central,
        lines,
      })
      .expect(201);

  const workOrder = async (quantity: number, body: object = {}) =>
    (
      await api('admin')
        .post('/production/work-orders', {
          bomId,
          quantity,
          plannedStart: TODAY,
          plannedEnd: TODAY,
          sourceWarehouseId: central,
          targetWarehouseId: central,
          ...body,
        })
        .expect(201)
    ).body as WorkOrder;

  /** On hand in the central warehouse. */
  const stockOf = async (sku: string) => {
    const res = await api('admin')
      .get(`/stock/levels?warehouseId=${central}&search=${sku}`)
      .expect(200);
    return (res.body as { data: { sku: string; quantity: string }[] }).data.find(
      (row) => row.sku === sku,
    )?.quantity;
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
      tokens[role] = res.body.accessToken as string;
    }
    const units = await api('admin').get('/settings/units').expect(200);
    unitId = (units.body as { id: string; code: string }[]).find((u) => u.code === 'ADET')!.id;
    const warehouses = await api('admin').get('/warehouses').expect(200);
    central = (warehouses.body as { id: string; code: string }[]).find((w) => w.code === 'MRK')!.id;

    const a = await product({ purchasePrice: 100 });
    const b = await product({ trackingType: 'LOT', purchasePrice: 50 });
    const x = await product({ salePrice: 500 });
    items.a = a.id;
    items.b = b.id;
    items.x = x.id;
    skus.a = a.sku;
    skus.x = x.sku;
    items.serial = (await product({ trackingType: 'SERIAL' })).id;
    items.service = (await product({ type: 'SERVICE' })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets managers read production but not change it', async () => {
    await api('manager').get('/production/summary').expect(200);
    await api('manager').get('/production/boms').expect(200);
    await api('manager').get('/production/requirements').expect(200);
    await api('manager')
      .post('/production/boms', { name: 'x', variantId: items.x, lines: [] })
      .expect(403);
    await api('employee').get('/production/work-orders').expect(403);
  });

  it('validates bills of materials and keeps one default per product', async () => {
    const lines = [
      { variantId: items.a, quantity: 2 },
      { variantId: items.b, quantity: 1, scrapRate: 10 },
    ];
    const base = { name: 'Montaj', variantId: items.x, laborCost: 30, overheadCost: 10 };
    for (const bad of [
      [{ variantId: items.service, quantity: 1 }],
      [{ variantId: items.serial, quantity: 1 }],
      [{ variantId: items.x, quantity: 1 }],
      [lines[0], lines[0]],
    ]) {
      await api('admin')
        .post('/production/boms', { ...base, lines: bad })
        .expect(400);
    }

    const first = (
      await api('admin')
        .post('/production/boms', { ...base, lines })
        .expect(201)
    ).body as Bom;
    bomId = first.id;
    expect(first).toMatchObject({ code: `${skus.x}-R1`, isDefault: true, unitCost: '295.0000' });

    // A is made from X, so X cannot be made from A.
    const loop = await api('admin')
      .post('/production/boms', {
        name: 'Loop',
        variantId: items.a,
        lines: [{ variantId: items.x, quantity: 1 }],
      })
      .expect(400);
    expect(loop.body.message).toMatch(/loop/);

    const second = (
      await api('admin')
        .post('/production/boms', { ...base, name: 'Alternatif', lines: [lines[0]] })
        .expect(201)
    ).body as Bom;
    expect(second).toMatchObject({ code: `${skus.x}-R2`, isDefault: false });
    await api('admin').patch(`/production/boms/${second.id}`, { isDefault: true }).expect(200);
    expect((await api('admin').get(`/production/boms/${bomId}`).expect(200)).body).toMatchObject({
      isDefault: false,
    });
    await api('admin').delete(`/production/boms/${second.id}`).expect(204);
    expect((await api('admin').get(`/production/boms/${bomId}`).expect(200)).body).toMatchObject({
      isDefault: true,
      canDelete: true,
    });
  });

  it('plans, releases and records production with FEFO lots and full cost', async () => {
    await receive([
      { variantId: items.a, quantity: 10, unitCost: 100 },
      { variantId: items.b, quantity: 3, unitCost: 50, lotNo: 'L-LATE', expiryDate: '2031-01-31' },
      { variantId: items.b, quantity: 5, unitCost: 50, lotNo: 'L-SOON', expiryDate: '2030-01-31' },
    ]);
    expect((await api('admin').get(`/production/boms/${bomId}`).expect(200)).body).toMatchObject({
      buildable: '5',
    });

    let order = await workOrder(4);
    expect(order).toMatchObject({ status: 'DRAFT', number: expect.stringMatching(/^ISE-\d{4}-/) });
    expect(order.components.map((c) => c.requiredQty)).toEqual(['8', '4.4']);
    expect(order.buildable).toBe('4');
    await api('admin')
      .post(`/production/work-orders/${order.id}/records`, { quantity: 1 })
      .expect(409);

    order = (
      await api('admin').patch(`/production/work-orders/${order.id}`, { quantity: 5 }).expect(200)
    ).body as WorkOrder;
    expect(order.components.map((c) => c.requiredQty)).toEqual(['10', '5.5']);
    await api('admin')
      .patch(`/production/work-orders/${order.id}`, { plannedEnd: '2000-01-01' })
      .expect(400);
    await api('admin').post(`/production/work-orders/${order.id}/release`).expect(200);
    await api('admin').patch(`/production/work-orders/${order.id}`, { quantity: 6 }).expect(409);

    order = (
      await api('admin')
        .post(`/production/work-orders/${order.id}/records`, { quantity: 2 })
        .expect(201)
    ).body as WorkOrder;
    expect(order).toMatchObject({ status: 'IN_PROGRESS', producedQty: '2', progress: 40 });
    expect(order.records[0]).toMatchObject({
      quantity: '2',
      materialCost: '510.00',
      totalCost: '590.00',
      unitCost: '295.0000',
    });
    const lots = await api('admin').get(`/stock/lots?variantId=${items.b}`).expect(200);
    const lotRows = lots.body as { lotNo: string; quantity: string }[];
    expect(lotRows.find((l) => l.lotNo === 'L-SOON')?.quantity).toBe('2.8');
    expect(lotRows.find((l) => l.lotNo === 'L-LATE')?.quantity).toBe('3');

    const tooMuch = await api('admin')
      .post(`/production/work-orders/${order.id}/records`, { quantity: 4 })
      .expect(400);
    expect(tooMuch.body.message).toMatch(/At most 3/);

    order = (
      await api('admin')
        .post(`/production/work-orders/${order.id}/records`, {
          quantity: 3,
          components: [{ variantId: items.a, quantity: 5 }],
        })
        .expect(201)
    ).body as WorkOrder;
    expect(order).toMatchObject({ status: 'COMPLETED', producedQty: '5', canRecord: false });
    expect(order.components.map((c) => c.consumedQty)).toEqual(['9', '5.5']);
    expect(order.records[0]).toMatchObject({ materialCost: '665.00', unitCost: '261.6667' });
    expect(order.actualUnitCost).toBe('275.0000');

    expect(await stockOf(skus.x)).toBe('5');
    expect(await stockOf(skus.a)).toBe('1');

    const pending = await api('admin').get('/accounting/pending').expect(200);
    const rows = pending.body as { source: string; sourceNumber: string; amount: string }[];
    const numbers = order.records.map((r) => r.number);
    expect(
      rows
        .filter((r) => r.source === 'PRODUCTION' && numbers.includes(r.sourceNumber))
        .map((r) => r.amount)
        .sort(),
    ).toEqual(['590.00', '785.00']);
    const movement = await api('admin')
      .get(`/stock-movements/${order.records[0].receiptMovementId}`)
      .expect(200);
    expect(rows.some((r) => r.sourceNumber === (movement.body as { number: string }).number)).toBe(
      false,
    );
  });

  it('cancels idle orders, closes orders short and keeps used BOMs', async () => {
    const idle = await workOrder(2);
    await api('admin').post(`/production/work-orders/${idle.id}/complete`).expect(409);
    const cancelled = await api('admin')
      .post(`/production/work-orders/${idle.id}/cancel`)
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED' });
    await api('admin').post(`/production/work-orders/${idle.id}/cancel`).expect(409);

    await receive([
      { variantId: items.a, quantity: 4, unitCost: 100 },
      { variantId: items.b, quantity: 2, unitCost: 50, lotNo: 'L-NEW' },
    ]);
    const short = await workOrder(3);
    await api('admin').post(`/production/work-orders/${short.id}/release`).expect(200);
    await api('admin')
      .post(`/production/work-orders/${short.id}/records`, { quantity: 1 })
      .expect(201);
    await api('admin').post(`/production/work-orders/${short.id}/cancel`).expect(409);
    const closed = await api('admin')
      .post(`/production/work-orders/${short.id}/complete`)
      .expect(200);
    expect(closed.body).toMatchObject({ status: 'COMPLETED', producedQty: '1' });
    await api('manager').post(`/production/work-orders/${short.id}/complete`).expect(403);

    const used = await api('admin').delete(`/production/boms/${bomId}`).expect(409);
    expect(used.body.message).toMatch(/deactivate/);
  });

  it('nets requirements and turns shortages into a purchase request', async () => {
    const order = await workOrder(10);
    await api('admin').post(`/production/work-orders/${order.id}/release`).expect(200);

    const plan = await api('admin').get(`/production/boms/${bomId}/plan?quantity=10`).expect(200);
    expect(plan.body).toMatchObject({ quantity: '10', laborCost: '300.00' });
    expect(
      (
        plan.body as { lines: { sku: string; required: string; availability: string }[] }
      ).lines.find((l) => l.sku === skus.a),
    ).toMatchObject({ required: '20', availability: 'PARTIAL' });

    const requirements = await api('admin').get('/production/requirements').expect(200);
    const row = (
      requirements.body as {
        variantId: string;
        productionDemand: string;
        onHand: string;
        shortage: string;
        made: boolean;
        workOrders: { number: string }[];
      }[]
    ).find((r) => r.variantId === items.a)!;
    expect(row).toMatchObject({ productionDemand: '20', made: false });
    expect(Number(row.shortage)).toBe(20 - Number(row.onHand));
    expect(row.workOrders.map((w) => w.number)).toEqual([order.number]);

    const created = await api('admin')
      .post('/production/requirements/purchase-request', {
        lines: [{ variantId: items.a, quantity: Number(row.shortage) }],
      })
      .expect(201);
    expect(created.body).toMatchObject({ number: expect.stringMatching(/^STA-/) });
    const requestDetail = await api('admin')
      .get(`/purchase-requests/${(created.body as { id: string }).id}`)
      .expect(200);
    expect(requestDetail.body).toMatchObject({ title: 'Üretim malzeme ihtiyacı (MRP)' });

    await api('admin').post(`/production/work-orders/${order.id}/cancel`).expect(200);
    const after = await api('admin').get('/production/requirements').expect(200);
    expect((after.body as { variantId: string }[]).some((r) => r.variantId === items.a)).toBe(
      false,
    );
  });
});
