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
  reserved: string;
  available: string;
}

interface Doc {
  id: string;
  number: string;
  status: string;
  [key: string]: unknown;
}

interface OrderLine {
  id: string;
  variantId: string;
  deliveredQty: string;
  invoicedQty: string;
  reservedQty: string;
}

const today = () => new Date().toISOString().slice(0, 10);

describe('Sales (e2e)', () => {
  let app: NestExpressApplication;
  const tokens = { admin: '', manager: '', employee: '' };
  let warehouseId = '';

  const api = (role: keyof typeof tokens) => {
    const auth = `Bearer ${tokens[role]}`;
    const server = () => request(app.getHttpServer());
    return {
      get: (url: string) => server().get(`/api/v1${url}`).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        server().post(`/api/v1${url}`).set('Authorization', auth).send(body),
    };
  };

  const item = async (sku: string) => {
    const res = await api('admin').get(
      `/stock/items?includeServices=true&warehouseId=${warehouseId}&search=${sku}`,
    );
    return (res.body as Item[]).find((i) => i.sku === sku)!;
  };

  const customer = async (code: string) => {
    const res = await api('admin').get(`/partners?search=${code}`).expect(200);
    return (res.body as { data: { id: string; code: string }[] }).data.find((p) => p.code === code)!
      .id;
  };

  const balance = async (partnerId: string) =>
    Number((await api('admin').get(`/partners/${partnerId}`)).body.balance);

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
    const warehouses = (await api('admin').get('/warehouses').expect(200)).body as {
      id: string;
      code: string;
    }[];
    warehouseId = warehouses.find((w) => w.code === 'MRK')!.id;
  });

  afterAll(() => app.close());

  it('keeps sales documents away from employees', async () => {
    await api('employee').get('/sales-orders').expect(403);
    await api('employee').get('/sales-invoices').expect(403);
  });

  it('runs quote → order → reservation → delivery → invoice → return', async () => {
    // Each run leaves one keyboard reserved on its partially delivered order.
    const stocked = await item('PRD-KLAVYE-F');
    if (Number(stocked.available) < 2) {
      await api('admin')
        .post('/stock-movements', {
          type: 'RECEIPT',
          movementDate: today(),
          targetWarehouseId: warehouseId,
          lines: [{ variantId: stocked.variantId, quantity: 10, unitCost: 900 }],
        })
        .expect(201);
    }
    const keyboard = await item('PRD-KLAVYE-F');
    const setup = await item('SRV-KURULUM');
    const partnerId = await customer('MUS-003');

    const quote = (
      await api('admin')
        .post('/sales-quotes', {
          partnerId,
          quoteDate: today(),
          lines: [
            { variantId: keyboard.variantId, quantity: 2, unitPrice: 1800, vatRate: 20 },
            { variantId: setup.variantId, quantity: 1, unitPrice: 1500, vatRate: 20 },
          ],
        })
        .expect(201)
    ).body as Doc;
    expect(quote.number).toMatch(/^STK-\d{4}-\d{6}$/);
    expect(quote.grandTotal).toBe('6120.00');

    const order = (
      await api('admin').post(`/sales-quotes/${quote.id}/convert`, { warehouseId }).expect(201)
    ).body as Doc & { lines: OrderLine[] };
    expect(order.status).toBe('DRAFT');
    await api('admin').post(`/sales-quotes/${quote.id}/convert`, { warehouseId }).expect(409);

    await api('employee').post(`/sales-orders/${order.id}/approve`).expect(403);
    const approved = (await api('manager').post(`/sales-orders/${order.id}/approve`).expect(201))
      .body as Doc & { lines: OrderLine[] };
    expect(approved.status).toBe('APPROVED');
    const keyboardLine = approved.lines.find((l) => l.variantId === keyboard.variantId)!;
    const setupLine = approved.lines.find((l) => l.variantId === setup.variantId)!;
    expect(keyboardLine.reservedQty).toBe('2');
    expect(setupLine.reservedQty).toBe('0');

    const reserved = await item('PRD-KLAVYE-F');
    expect(Number(reserved.available)).toBe(Number(keyboard.available) - 2);

    // An ordinary issue may not dip into the reservation.
    await api('admin')
      .post('/stock-movements', {
        type: 'ISSUE',
        movementDate: today(),
        sourceWarehouseId: warehouseId,
        lines: [{ variantId: keyboard.variantId, quantity: Number(reserved.available) + 1 }],
      })
      .expect(400);

    await api('admin')
      .post('/delivery-notes', {
        orderId: order.id,
        deliveryDate: today(),
        lines: [{ orderLineId: keyboardLine.id, quantity: 3 }],
      })
      .expect(400);
    const delivery = (
      await api('admin')
        .post('/delivery-notes', {
          orderId: order.id,
          deliveryDate: today(),
          carrier: 'E2E Kargo',
          lines: [
            { orderLineId: keyboardLine.id, quantity: 1 },
            { orderLineId: setupLine.id, quantity: 1 },
          ],
        })
        .expect(201)
    ).body as Doc;
    expect(delivery.number).toMatch(/^IRS-/);
    expect(delivery.stockMovementNumber).toMatch(/^STH-/);
    const afterDelivery = await item('PRD-KLAVYE-F');
    expect(Number(afterDelivery.onHand)).toBe(Number(keyboard.onHand) - 1);
    expect(Number(afterDelivery.reserved)).toBe(Number(keyboard.reserved) + 1);

    const partial = (await api('admin').get(`/sales-orders/${order.id}`)).body as Doc & {
      lines: OrderLine[];
    };
    expect(partial.status).toBe('PARTIALLY_DELIVERED');
    await api('admin').post(`/sales-orders/${order.id}/cancel`).expect(409);

    const invoiceBody = (quantity: number) => ({
      partnerId,
      orderId: order.id,
      invoiceDate: today(),
      lines: [
        { orderLineId: keyboardLine.id, quantity, unitPrice: 1800, vatRate: 20 },
        { orderLineId: setupLine.id, quantity: 1, unitPrice: 1500, vatRate: 20 },
      ],
    });
    await api('admin').post('/sales-invoices', invoiceBody(2)).expect(400);
    await api('admin')
      .post('/sales-invoices', {
        partnerId,
        invoiceDate: today(),
        lines: [{ variantId: keyboard.variantId, quantity: 1, unitPrice: 1800 }],
      })
      .expect(400);

    const before = await balance(partnerId);
    const invoice = (await api('admin').post('/sales-invoices', invoiceBody(1)).expect(201))
      .body as Doc & { lines: { id: string; variantId: string }[] };
    expect(invoice).toMatchObject({ grandTotal: '3960.00', paymentStatus: 'UNPAID' });
    expect(invoice.number).toMatch(/^FTR-/);
    expect(await balance(partnerId)).toBeCloseTo(before + 3960, 2);

    const invoiceLine = invoice.lines.find((l) => l.variantId === keyboard.variantId)!;
    await api('admin')
      .post('/sales-returns', {
        invoiceId: invoice.id,
        returnDate: today(),
        reason: 'E2E iade',
        lines: [{ invoiceLineId: invoiceLine.id, quantity: 2 }],
      })
      .expect(400);
    const returned = (
      await api('admin')
        .post('/sales-returns', {
          invoiceId: invoice.id,
          returnDate: today(),
          reason: 'E2E iade',
          lines: [{ invoiceLineId: invoiceLine.id, quantity: 1 }],
        })
        .expect(201)
    ).body as Doc;
    expect(returned).toMatchObject({ grandTotal: '2160.00' });
    expect(returned.number).toMatch(/^IAD-/);
    expect(Number((await item('PRD-KLAVYE-F')).onHand)).toBe(Number(keyboard.onHand));
    expect(await balance(partnerId)).toBeCloseTo(before + 3960 - 2160, 2);

    const settled = (await api('admin').get(`/sales-invoices/${invoice.id}`)).body as Doc;
    expect(settled).toMatchObject({ paidAmount: '2160.00', paymentStatus: 'PARTIALLY_PAID' });
    await api('admin').post(`/sales-invoices/${invoice.id}/cancel`).expect(409);
  });

  it('blocks approval above the customer credit limit', async () => {
    const monitor = await item('PRD-MONITOR');
    const partnerId = await customer('MUS-002');
    const order = (
      await api('admin')
        .post('/sales-orders', {
          partnerId,
          orderDate: today(),
          warehouseId,
          lines: [{ variantId: monitor.variantId, quantity: 20, unitPrice: 9000, vatRate: 20 }],
        })
        .expect(201)
    ).body as Doc & { credit: { exceeded: boolean; creditLimit: string } };
    expect(order.credit).toMatchObject({ exceeded: true, creditLimit: '150000.00' });

    await api('manager').post(`/sales-orders/${order.id}/approve`).expect(409);
    const cancelled = await api('admin')
      .post(`/sales-orders/${order.id}/cancel`, { reason: 'E2E' })
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
  });
});
