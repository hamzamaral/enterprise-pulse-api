import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { isValidVkn, withVknCheckDigit } from '../src/modules/einvoice/einvoice-rules';

const USERS = {
  admin: { email: 'admin@enterprisepulse.dev', password: 'Admin123!' },
  manager: { email: 'manager@enterprisepulse.dev', password: 'Manager123!' },
  employee: { email: 'employee@enterprisepulse.dev', password: 'Employee123!' },
};

interface EInvoice {
  id: string;
  direction: string;
  profile: string;
  status: string;
  number: string;
  uuid: string;
  statusCode: string | null;
  statusMessage: string | null;
  salesInvoiceId: string | null;
  purchaseInvoiceId: string | null;
  purchaseInvoiceNumber: string | null;
  payableAmount: string;
  canRespond: boolean;
  canResend: boolean;
  canRecord: boolean;
  responseDeadline: string | null;
  receiverAlias: string | null;
  lines: { description: string; unitCode: string; net: string; vat: string }[];
  events: { status: string; code: string | null; message: string }[];
  xml: string;
}

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
const suffix = () => Date.now().toString(36).toUpperCase();
/** A 10-digit number with a wrong VKN check digit. */
const invalidVkn = () => {
  const valid = withVknCheckDigit(`${Date.now()}`.slice(-9) + '0');
  return `${valid.slice(0, 9)}${(Number(valid[9]) + 1) % 10}`;
};

describe('e-Invoice (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  let companyId = '';
  let serviceVariantId = '';
  const partners = new Map<string, string>();
  const createdPartners: string[] = [];

  const api = (role: keyof typeof tokens) => {
    const auth = `Bearer ${tokens[role]}`;
    const server = () => request(app.getHttpServer());
    return {
      get: (url: string) => server().get(`/api/v1${url}`).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        server().post(`/api/v1${url}`).set('Authorization', auth).send(body),
      patch: (url: string, body: object) =>
        server().patch(`/api/v1${url}`).set('Authorization', auth).send(body),
    };
  };

  const sync = async () =>
    (await api('admin').post('/e-invoices/sync').expect(200)).body as { processed: number };
  const get = async (id: string) =>
    (await api('admin').get(`/e-invoices/${id}`).expect(200)).body as EInvoice;
  const invoiceFor = async (partnerId: string, unitPrice = 1000) =>
    (
      await api('admin')
        .post('/sales-invoices', {
          partnerId,
          invoiceDate: TODAY,
          lines: [{ variantId: serviceVariantId, quantity: 2, unitPrice, vatRate: 20 }],
        })
        .expect(201)
    ).body as { id: string; number: string; eInvoice: { status: string } | null };
  const send = async (salesInvoiceId: string, body: object = {}) =>
    (
      await api('admin')
        .post('/e-invoices', { salesInvoiceId, ...body })
        .expect(201)
    ).body as EInvoice;

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
    await prisma.setting.deleteMany({ where: { companyId, key: 'einvoice' } });
    for (const code of ['MUS-002', 'MUS-003', 'TED-001']) {
      const res = await api('admin').get(`/partners?search=${code}`).expect(200);
      const list = (res.body as { data: { id: string; code: string }[] }).data;
      partners.set(code, list.find((p) => p.code === code)!.id);
    }
    const items = (
      await api('admin').get('/stock/items?includeServices=true&search=SRV-KURULUM').expect(200)
    ).body as { variantId: string; sku: string }[];
    serviceVariantId = items.find((i) => i.sku === 'SRV-KURULUM')!.variantId;
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { companyId, key: 'einvoice' } });
    await prisma.businessPartner.updateMany({
      where: { id: { in: createdPartners } },
      data: { isActive: false },
    });
    await app.close();
  });

  it('guards e-invoices by permission', async () => {
    await api('employee').get('/e-invoices').expect(403);
    await api('manager').get('/e-invoices').expect(200);
    await api('manager').get('/e-invoices/summary').expect(200);
    await api('manager')
      .post('/e-invoices', { salesInvoiceId: partners.get('MUS-002') })
      .expect(403);
    await api('manager').post('/e-invoices/sync').expect(403);
    await api('manager').post('/e-invoices/simulate-incoming').expect(403);
    await api('manager').patch('/e-invoices/settings', { autoSend: true }).expect(403);
  });

  it('sends a ticari fatura through GİB and handles the receiver response', async () => {
    const invoice = await invoiceFor(partners.get('MUS-003')!);
    const unsent = (await api('admin').get('/e-invoices/unsent').expect(200)).body as {
      id: string;
      profile: string;
    }[];
    expect(unsent.find((u) => u.id === invoice.id)?.profile).toBe('TICARIFATURA');

    await api('admin')
      .post('/e-invoices', { salesInvoiceId: invoice.id, profile: 'EARSIVFATURA' })
      .expect(400);
    const sent = await send(invoice.id);
    expect(sent).toMatchObject({
      direction: 'OUTGOING',
      profile: 'TICARIFATURA',
      status: 'QUEUED',
    });
    expect(sent.number).toMatch(/^EPF\d{13}$/);
    expect(sent.payableAmount).toBe('2400.00');
    expect(sent.receiverAlias).toMatch(/^urn:mail:/);
    expect(sent.xml).toContain('<cbc:ProfileID>TICARIFATURA</cbc:ProfileID>');
    expect(sent.xml).toContain(`<cbc:Note>Fatura no: ${invoice.number}</cbc:Note>`);
    expect(sent.xml).toContain('<cbc:InvoicedQuantity unitCode="HUR">2</cbc:InvoicedQuantity>');
    await api('admin').post('/e-invoices', { salesInvoiceId: invoice.id }).expect(409);
    await api('admin').post(`/sales-invoices/${invoice.id}/cancel`, {}).expect(409);

    const detail = (await api('admin').get(`/sales-invoices/${invoice.id}`).expect(200)).body as {
      eInvoice: { id: string; status: string };
    };
    expect(detail.eInvoice).toMatchObject({ id: sent.id, status: 'QUEUED' });

    await sync();
    expect((await get(sent.id)).status).toBe('SENT');
    await sync();
    const delivered = await get(sent.id);
    expect(delivered).toMatchObject({ status: 'DELIVERED', statusCode: '1300', canRespond: true });
    expect(delivered.responseDeadline).not.toBeNull();
    expect(delivered.events.map((e) => e.status)).toEqual(['QUEUED', 'SENT', 'DELIVERED']);
    await api('admin').post(`/sales-invoices/${invoice.id}/cancel`, {}).expect(409);
    await api('admin').post(`/e-invoices/${sent.id}/respond`, { action: 'ACCEPT' }).expect(409);

    await api('admin')
      .post(`/e-invoices/${sent.id}/simulate-response`, { action: 'REJECT' })
      .expect(400);
    const rejected = (
      await api('admin')
        .post(`/e-invoices/${sent.id}/simulate-response`, {
          action: 'REJECT',
          note: 'Fiyat farkı',
        })
        .expect(200)
    ).body as EInvoice;
    expect(rejected).toMatchObject({ status: 'REJECTED', statusCode: 'RED', canRespond: false });
    await api('admin')
      .post(`/e-invoices/${sent.id}/simulate-response`, { action: 'ACCEPT' })
      .expect(409);

    await api('admin').post(`/sales-invoices/${invoice.id}/cancel`, {}).expect(201);
    expect((await get(sent.id)).status).toBe('REJECTED');
  });

  it('sends e-Arşiv to unregistered customers and cancels it with the invoice', async () => {
    const invoice = await invoiceFor(partners.get('MUS-002')!);
    await api('admin')
      .post('/e-invoices', { salesInvoiceId: invoice.id, profile: 'TICARIFATURA' })
      .expect(400);
    const sent = await send(invoice.id);
    expect(sent).toMatchObject({ profile: 'EARSIVFATURA', receiverAlias: null });
    expect(sent.number).toMatch(/^EPA\d{13}$/);
    expect(sent.xml).toContain('<cbc:DocumentTypeCode>EREPSENDT</cbc:DocumentTypeCode>');

    await sync();
    await sync();
    expect(await get(sent.id)).toMatchObject({ status: 'DELIVERED', canRespond: false });

    await api('admin').post(`/sales-invoices/${invoice.id}/cancel`, {}).expect(201);
    const cancelled = await get(sent.id);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', statusCode: 'IPTAL' });
    expect(cancelled.events.at(-1)?.status).toBe('CANCELLED');
  });

  it('reports GİB errors and resends after the data is fixed', async () => {
    const taxNumber = invalidVkn();
    expect(isValidVkn(taxNumber)).toBe(false);
    await api('admin')
      .post('/partners', { title: 'E2E e-Fatura', type: 'CUSTOMER', eInvoiceAlias: 'bad' })
      .expect(400);
    const partner = (
      await api('admin')
        .post('/partners', {
          code: `EF-${suffix()}`,
          title: 'E2E e-Fatura Müşteri',
          type: 'CUSTOMER',
          taxNumber,
          eInvoiceAlias: 'urn:mail:defaultpk@e2e-efatura.com.tr',
        })
        .expect(201)
    ).body as { id: string; eInvoiceAlias: string };
    createdPartners.push(partner.id);
    expect(partner.eInvoiceAlias).toBe('urn:mail:defaultpk@e2e-efatura.com.tr');

    const invoice = await invoiceFor(partner.id, 500);
    const sent = await send(invoice.id, { profile: 'TEMELFATURA' });
    await sync();
    const failed = await get(sent.id);
    expect(failed).toMatchObject({ status: 'ERROR', statusCode: '1150', canResend: true });
    expect(failed.statusMessage).toContain(`Alıcı VKN/TCKN geçersiz: ${taxNumber}`);
    await api('admin').post('/e-invoices', { salesInvoiceId: invoice.id }).expect(409);

    await api('admin')
      .patch(`/partners/${partner.id}`, { taxNumber: withVknCheckDigit(taxNumber) })
      .expect(200);
    const resent = (await api('admin').post(`/e-invoices/${sent.id}/resend`).expect(200))
      .body as EInvoice;
    expect(resent).toMatchObject({ status: 'QUEUED', number: sent.number, profile: 'TEMELFATURA' });
    expect(resent.uuid).not.toBe(sent.uuid);
    await api('admin').post(`/e-invoices/${sent.id}/resend`).expect(409);
    await sync();
    await sync();
    expect((await get(sent.id)).status).toBe('DELIVERED');
  });

  it('receives supplier invoices, answers them and records purchase invoices', async () => {
    const supplierId = partners.get('TED-001')!;
    await api('admin')
      .post('/e-invoices/simulate-incoming', { partnerId: partners.get('MUS-002') })
      .expect(400);

    const basic = (
      await api('admin')
        .post('/e-invoices/simulate-incoming', { partnerId: supplierId, profile: 'TEMELFATURA' })
        .expect(201)
    ).body as EInvoice;
    expect(basic).toMatchObject({
      direction: 'INCOMING',
      status: 'DELIVERED',
      canRespond: false,
      canRecord: true,
    });
    expect(basic.lines.length).toBeGreaterThan(0);
    expect(basic.xml).toContain('<cbc:ProfileID>TEMELFATURA</cbc:ProfileID>');
    await api('admin').post(`/e-invoices/${basic.id}/respond`, { action: 'ACCEPT' }).expect(409);

    const recorded = (await api('admin').post(`/e-invoices/${basic.id}/record`).expect(200))
      .body as EInvoice;
    expect(recorded.purchaseInvoiceNumber).toMatch(/^ALF-/);
    expect(recorded.canRecord).toBe(false);
    await api('admin').post(`/e-invoices/${basic.id}/record`).expect(409);
    const purchase = (
      await api('admin').get(`/purchase-invoices/${recorded.purchaseInvoiceId}`).expect(200)
    ).body as { supplierInvoiceNo: string; grandTotal: string; partnerId: string };
    expect(purchase).toMatchObject({
      supplierInvoiceNo: basic.number,
      grandTotal: basic.payableAmount,
      partnerId: supplierId,
    });

    const ticari = (
      await api('admin')
        .post('/e-invoices/simulate-incoming', { partnerId: supplierId })
        .expect(201)
    ).body as EInvoice;
    expect(ticari).toMatchObject({ profile: 'TICARIFATURA', canRespond: true, canRecord: false });
    await api('admin').post(`/e-invoices/${ticari.id}/record`).expect(409);
    await api('admin')
      .post(`/e-invoices/${ticari.id}/simulate-response`, { action: 'ACCEPT' })
      .expect(409);
    await api('manager').post(`/e-invoices/${ticari.id}/respond`, { action: 'ACCEPT' }).expect(403);
    const rejected = (
      await api('admin')
        .post(`/e-invoices/${ticari.id}/respond`, { action: 'REJECT', note: 'Sipariş dışı' })
        .expect(200)
    ).body as EInvoice;
    expect(rejected).toMatchObject({ status: 'REJECTED', canRespond: false, canRecord: false });
    await api('admin').post(`/e-invoices/${ticari.id}/record`).expect(409);

    const list = (
      await api('admin').get('/e-invoices?direction=INCOMING&status=REJECTED').expect(200)
    ).body as { data: EInvoice[] };
    expect(list.data.map((e) => e.id)).toContain(ticari.id);
  });

  it('sends new invoices automatically when enabled', async () => {
    const defaults = (await api('admin').get('/e-invoices/settings').expect(200)).body;
    expect(defaults).toMatchObject({ defaultProfile: 'TICARIFATURA', autoSend: false });
    await api('admin').patch('/e-invoices/settings', { senderAlias: 'not-an-alias' }).expect(400);
    await api('admin')
      .patch('/e-invoices/settings', { defaultProfile: 'EARSIVFATURA' })
      .expect(400);
    await api('admin')
      .patch('/e-invoices/settings', { autoSend: true, defaultProfile: 'TEMELFATURA' })
      .expect(200);

    const invoice = await invoiceFor(partners.get('MUS-003')!);
    expect(invoice.eInvoice).toMatchObject({ status: 'QUEUED', profile: 'TEMELFATURA' });

    const summary = (await api('admin').get('/e-invoices/summary').expect(200)).body as Record<
      string,
      number
    >;
    expect(summary.inProgress).toBeGreaterThan(0);
    expect(summary.outgoingThisMonth).toBeGreaterThan(0);
  });
});
