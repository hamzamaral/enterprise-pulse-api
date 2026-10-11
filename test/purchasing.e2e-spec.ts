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

interface Item {
  variantId: string;
  sku: string;
  onHand: string;
}

interface Doc {
  id: string;
  number: string;
  status: string;
  [key: string]: unknown;
}

const today = () => new Date().toISOString().slice(0, 10);

describe('Purchasing (e2e)', () => {
  let app: NestExpressApplication;
  const tokens = { admin: '', manager: '', employee: '' };

  const api = (role: keyof typeof tokens) => {
    const auth = `Bearer ${tokens[role]}`;
    const server = () => request(app.getHttpServer());
    return {
      get: (url: string) => server().get(`/api/v1${url}`).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        server().post(`/api/v1${url}`).set('Authorization', auth).send(body),
      put: (url: string, body: object = {}) =>
        server().put(`/api/v1${url}`).set('Authorization', auth).send(body),
    };
  };

  const approveRequest = async (instanceId: string) => {
    await api('manager').post(`/workflow/instances/${instanceId}/approve`).expect(200);
    await api('admin').post(`/workflow/instances/${instanceId}/approve`).expect(200);
  };

  const item = async (sku: string) => {
    const res = await api('admin').get(`/stock/items?includeServices=true&search=${sku}`);
    return (res.body as Item[]).find((i) => i.sku === sku)!;
  };

  const supplier = async (code: string) => {
    const res = await api('admin').get(`/partners?search=${code}`).expect(200);
    return (res.body as { data: { id: string; code: string }[] }).data.find((p) => p.code === code)!
      .id;
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

  it('lets employees request through the workflow and see only their own requests', async () => {
    const created = await api('employee')
      .post('/purchase-requests', {
        title: 'E2E sandalye talebi',
        lines: [{ description: 'Ergonomik sandalye', quantity: 2, estimatedPrice: 4500 }],
      })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'PENDING', estimatedTotal: '9000.00' });
    expect(created.body.number).toMatch(/^STA-\d{4}-\d{6}$/);

    const mine = await api('employee').get('/purchase-requests?pageSize=100').expect(200);
    const requesters = new Set(
      (mine.body.data as { requestedById: string }[]).map((r) => r.requestedById),
    );
    expect(requesters.size).toBe(1);
    await api('employee').get('/supplier-quotes').expect(403);

    await approveRequest(created.body.workflowInstanceId as string);
    const approved = await api('employee').get(`/purchase-requests/${created.body.id}`).expect(200);
    expect(approved.body.status).toBe('APPROVED');

    await api('employee').post(`/purchase-requests/${created.body.id}/cancel`).expect(201);
    const cancelled = await api('employee').get(`/purchase-requests/${created.body.id}`);
    expect(cancelled.body.status).toBe('CANCELLED');
  });

  it('runs request → quotes → order → receipt → invoice with three-way matching', async () => {
    const monitor = await item('PRD-MONITOR');
    const setup = await item('SRV-KURULUM');
    const warehouses = (await api('admin').get('/warehouses').expect(200)).body as {
      id: string;
      code: string;
    }[];
    const warehouseId = warehouses.find((w) => w.code === 'MRK')!.id;
    const [cheap, pricey] = [await supplier('TED-001'), await supplier('CAR-001')];

    const req = await api('admin')
      .post('/purchase-requests', {
        title: 'E2E monitör talebi',
        lines: [
          { variantId: monitor.variantId, quantity: 5 },
          { variantId: setup.variantId, quantity: 2 },
        ],
      })
      .expect(201);
    await approveRequest(req.body.workflowInstanceId as string);
    const [monitorLine, setupLine] = req.body.lines as { id: string }[];

    const quote = (partnerId: string, price: number) =>
      api('admin')
        .post('/supplier-quotes', {
          requestId: req.body.id,
          partnerId,
          quoteDate: today(),
          lines: [
            {
              variantId: monitor.variantId,
              requestLineId: monitorLine.id,
              quantity: 5,
              unitPrice: price,
              vatRate: 20,
            },
            {
              variantId: setup.variantId,
              requestLineId: setupLine.id,
              quantity: 2,
              unitPrice: 500,
              vatRate: 20,
            },
          ],
        })
        .expect(201);
    const good = (await quote(cheap, 6000)).body as Doc;
    const bad = (await quote(pricey, 6400)).body as Doc;
    expect(good.grandTotal).toBe('37200.00');

    const comparison = await api('manager')
      .get(`/purchase-requests/${req.body.id}/comparison`)
      .expect(200);
    expect(comparison.body.bestQuoteId).toBe(good.id);
    expect(comparison.body.quotes).toHaveLength(2);

    const order = (
      await api('admin').post(`/supplier-quotes/${good.id}/accept`, { warehouseId }).expect(201)
    ).body as Doc & { lines: { id: string; variantId: string }[] };
    expect(order.status).toBe('DRAFT');
    expect((await api('admin').get(`/supplier-quotes/${bad.id}`)).body.status).toBe('REJECTED');
    expect((await api('admin').get(`/purchase-requests/${req.body.id}`)).body.status).toBe(
      'ORDERED',
    );

    const monitorOrderLine = order.lines.find((l) => l.variantId === monitor.variantId)!;
    const setupOrderLine = order.lines.find((l) => l.variantId === setup.variantId)!;
    const receipt = { orderId: order.id, receiptDate: today() };
    await api('admin')
      .post('/goods-receipts', {
        ...receipt,
        lines: [{ orderLineId: monitorOrderLine.id, quantity: 1 }],
      })
      .expect(409);

    await api('employee').post(`/purchase-orders/${order.id}/approve`).expect(403);
    await api('manager').post(`/purchase-orders/${order.id}/approve`).expect(201);

    await api('admin')
      .post('/goods-receipts', {
        ...receipt,
        lines: [{ orderLineId: monitorOrderLine.id, quantity: 6 }],
      })
      .expect(400);
    const received = await api('admin')
      .post('/goods-receipts', {
        ...receipt,
        deliveryNoteNo: 'E2E-IRS-1',
        lines: [
          { orderLineId: monitorOrderLine.id, quantity: 3 },
          { orderLineId: setupOrderLine.id, quantity: 2 },
        ],
      })
      .expect(201);
    expect(received.body.number).toMatch(/^MKB-/);
    expect(received.body.stockMovementNumber).toMatch(/^STH-/);
    expect(Number((await item('PRD-MONITOR')).onHand)).toBe(Number(monitor.onHand) + 3);

    const afterReceipt = await api('admin').get(`/purchase-orders/${order.id}`).expect(200);
    expect(afterReceipt.body.status).toBe('PARTIALLY_RECEIVED');
    await api('admin').post(`/purchase-orders/${order.id}/cancel`).expect(409);

    const invoice = (quantity: number, supplierInvoiceNo: string) =>
      api('admin').post('/purchase-invoices', {
        partnerId: cheap,
        orderId: order.id,
        supplierInvoiceNo,
        invoiceDate: today(),
        lines: [
          {
            orderLineId: monitorOrderLine.id,
            quantity,
            unitPrice: 6000,
            vatRate: 20,
          },
        ],
      });
    await invoice(4, 'E2E-F-1').expect(400);
    const balanceBefore = (await api('admin').get(`/partners/${cheap}`)).body.balance as string;
    const issued = (await invoice(3, 'E2E-F-1').expect(201)).body as Doc;
    expect(issued).toMatchObject({ grandTotal: '21600.00', paymentStatus: 'UNPAID' });
    await invoice(1, 'E2E-F-1').expect(409);

    const balanceAfter = (await api('admin').get(`/partners/${cheap}`)).body.balance as string;
    expect(Number(balanceAfter)).toBeCloseTo(Number(balanceBefore) - 21600, 2);

    await api('admin')
      .post(`/purchase-invoices/${issued.id}/cancel`, { reason: 'E2E' })
      .expect(201);
    const reverted = (await api('admin').get(`/partners/${cheap}`)).body.balance as string;
    expect(Number(reverted)).toBeCloseTo(Number(balanceBefore), 2);
    const reopened = await api('admin').get(`/purchase-orders/${order.id}`);
    const line = (reopened.body.lines as { id: string; invoicedQty: string }[]).find(
      (l) => l.id === monitorOrderLine.id,
    )!;
    expect(line.invoicedQty).toBe('0');
  });

  it('keeps draft orders editable and approved orders locked', async () => {
    const monitor = await item('PRD-MONITOR');
    const warehouses = (await api('admin').get('/warehouses')).body as { id: string }[];
    const partnerId = await supplier('TED-004');
    const body = {
      partnerId,
      orderDate: today(),
      warehouseId: warehouses[0].id,
      lines: [{ variantId: monitor.variantId, quantity: 1, unitPrice: 100, vatRate: 20 }],
    };
    const order = (await api('admin').post('/purchase-orders', body).expect(201)).body as Doc;
    const { partnerId: _omit, ...update } = body;
    const edited = await api('admin')
      .put(`/purchase-orders/${order.id}`, {
        ...update,
        lines: [{ variantId: monitor.variantId, quantity: 2, unitPrice: 100, vatRate: 20 }],
      })
      .expect(200);
    expect(edited.body.grandTotal).toBe('240.00');

    await api('admin').post(`/purchase-orders/${order.id}/approve`).expect(201);
    await api('admin').put(`/purchase-orders/${order.id}`, update).expect(409);
    await api('admin').post(`/purchase-orders/${order.id}/cancel`).expect(201);
  });
});
