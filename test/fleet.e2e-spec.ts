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

interface Vehicle {
  id: string;
  plate: string;
  status: string;
  odometer: number;
  nextServiceKm: number | null;
  nextServiceDate: string | null;
  serviceState: string | null;
  driver: { employeeId: string; name: string; since: string } | null;
  documents: { type: string; state: string; daysLeft: number | null }[];
  alertCount: number;
  warningCount: number;
  retiredOn: string | null;
  assignments: { employeeId: string; endDate: string | null; startOdometer: number }[];
  readings: { id: string; source: string; odometer: number }[];
  canManage: boolean;
  isDriver: boolean;
  canDelete: boolean;
}

interface FuelEntry {
  id: string;
  odometer: number;
  employeeId: string | null;
  distance: number | null;
  consumption: string | null;
  unitPrice: string;
}

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
const day = (offset: number) => {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const PREFIX = '81 ';

describe('Fleet (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens = { admin: '', manager: '', employee: '' };
  const ids = { admin: '', manager: '', employee: '' };
  let companyId = '';
  let keremId = '';
  let elifId = '';
  let vehicleId = '';

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

  const cleanUp = async () => {
    const vehicles = await prisma.vehicle.findMany({
      where: { companyId, plate: { startsWith: PREFIX } },
      select: { id: true },
    });
    await prisma.notification.deleteMany({
      where: { link: { in: vehicles.map((v) => `/fleet/${v.id}`) } },
    });
    await prisma.vehicle.deleteMany({ where: { id: { in: vehicles.map((v) => v.id) } } });
  };

  const detail = async (role: keyof typeof tokens = 'admin') =>
    (await api(role).get(`/vehicles/${vehicleId}`).expect(200)).body as Vehicle;
  const fuel = async () =>
    (
      await api('admin')
        .get(`/vehicles/${vehicleId}/fuel?year=${TODAY.slice(0, 4)}`)
        .expect(200)
    ).body as FuelEntry[];
  const notifications = (userId: string) =>
    prisma.notification.count({ where: { userId, link: `/fleet/${vehicleId}` } });

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
      const user = await prisma.user.findUniqueOrThrow({ where: { email: USERS[role].email } });
      ids[role] = user.id;
    }
    const membership = await prisma.userCompany.findFirstOrThrow({
      where: { userId: ids.employee, isDefault: true },
    });
    companyId = membership.companyId;
    keremId = (await prisma.employee.findFirstOrThrow({ where: { userId: ids.employee } })).id;
    elifId = (
      await prisma.employee.findFirstOrThrow({ where: { companyId, employeeNo: 'PRS-000008' } })
    ).id;
    await cleanUp();
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('guards the fleet by permission', async () => {
    await api('employee').get('/vehicles').expect(403);
    await api('employee').get('/vehicles/summary').expect(403);
    await api('employee').get('/fuel-entries').expect(403);
    await api('manager').get('/vehicles').expect(200);
    await api('manager').get('/vehicles/options').expect(403);
    await api('manager')
      .post('/vehicles', { plate: '81 ZZ 99', brand: 'X', model: 'Y', fuelType: 'DIESEL' })
      .expect(403);
  });

  it('normalises plates and rejects invalid or duplicate ones', async () => {
    await api('admin')
      .post('/vehicles', { plate: 'ABC 123', brand: 'Fiat', model: 'Doblo', fuelType: 'DIESEL' })
      .expect(400);
    const created = await api('admin')
      .post('/vehicles', {
        plate: '81-efl-901',
        brand: 'Fiat',
        model: 'Doblo',
        fuelType: 'DIESEL',
        serviceIntervalKm: 10000,
        serviceIntervalMonths: 12,
        ownership: 'OWNED',
        contractEndsOn: day(10),
      })
      .expect(201);
    const vehicle = created.body as Vehicle & { contractEndsOn: string | null };
    vehicleId = vehicle.id;
    expect(vehicle.plate).toBe('81 EFL 901');
    expect(vehicle.contractEndsOn).toBeNull();
    expect(vehicle.odometer).toBe(0);
    expect(vehicle.nextServiceKm).toBe(10000);
    expect(vehicle.serviceState).toBe('OK');
    expect(vehicle.canDelete).toBe(true);
    await api('admin')
      .post('/vehicles', { plate: '81 EFL 901', brand: 'Fiat', model: 'X', fuelType: 'DIESEL' })
      .expect(409);
    // Required documents are missing until recorded.
    expect(vehicle.documents.find((d) => d.type === 'INSPECTION')?.state).toBe('MISSING');
    expect(vehicle.alertCount).toBe(2);
  });

  it('hands the vehicle over and lets the driver see it', async () => {
    await api('admin')
      .post(`/vehicles/${vehicleId}/readings`, { readingDate: day(-60), odometer: 10000 })
      .expect(201);
    await api('employee').get(`/vehicles/${vehicleId}`).expect(404);
    await api('admin')
      .post(`/vehicles/${vehicleId}/assign`, { employeeId: keremId, startDate: day(1) })
      .expect(400);
    const assigned = await api('admin')
      .post(`/vehicles/${vehicleId}/assign`, { employeeId: keremId, startDate: day(-50) })
      .expect(200);
    const vehicle = assigned.body as Vehicle;
    expect(vehicle.driver?.employeeId).toBe(keremId);
    expect(vehicle.assignments[0].startOdometer).toBe(10000);
    expect(await notifications(ids.employee)).toBe(1);

    const mine = (await api('employee').get('/vehicles/my').expect(200)).body as Vehicle[];
    expect(mine.map((v) => v.id)).toContain(vehicleId);
    const seen = await detail('employee');
    expect(seen.isDriver).toBe(true);
    expect(seen.canManage).toBe(false);
    const read = await detail('manager');
    expect(read.isDriver).toBe(false);
    expect(read.canManage).toBe(false);
    await api('admin')
      .post(`/vehicles/${vehicleId}/assign`, { employeeId: keremId, startDate: day(-40) })
      .expect(409);
  });

  it('records fuel with full-tank consumption and keeps the odometer monotonic', async () => {
    const add = (role: keyof typeof tokens, body: object) =>
      api(role).post(`/vehicles/${vehicleId}/fuel`, { liters: 30, amount: 1440, ...body });
    await add('employee', { entryDate: day(-55), odometer: 10200 }).expect(400);
    await add('employee', { entryDate: day(1), odometer: 10200 }).expect(400);
    const first = await add('employee', { entryDate: day(-40), odometer: 10500 }).expect(201);
    expect((first.body as FuelEntry).employeeId).toBe(keremId);
    expect((first.body as FuelEntry).unitPrice).toBe('48.00');
    await add('employee', {
      entryDate: day(-30),
      odometer: 11000,
      liters: 20,
      amount: 960,
      fullTank: false,
    }).expect(201);
    await add('employee', { entryDate: day(-20), odometer: 11500, liters: 35 }).expect(201);
    // Lower than a reading before the date, higher than one after it.
    await add('employee', { entryDate: day(-10), odometer: 11400 }).expect(400);
    await add('employee', { entryDate: day(-35), odometer: 11200 }).expect(400);

    let entries = await fuel();
    expect(entries.map((e) => [e.odometer, e.distance, e.consumption])).toEqual([
      [11500, 500, '5.50'],
      [11000, 500, null],
      [10500, null, null],
    ]);
    expect((await detail()).odometer).toBe(11500);

    await api('employee').delete(`/vehicles/${vehicleId}/fuel/${entries[1].id}`).expect(403);
    await api('admin').delete(`/vehicles/${vehicleId}/fuel/${entries[1].id}`).expect(204);
    entries = await fuel();
    expect(entries.map((e) => [e.distance, e.consumption])).toEqual([
      [1000, '3.50'],
      [null, null],
    ]);

    const log = await api('manager').get('/fuel-entries?search=81%20efl').expect(200);
    expect((log.body as { meta: { total: number } }).meta.total).toBe(2);
  });

  it('accepts driver readings but only deletes manual ones', async () => {
    await api('employee')
      .post(`/vehicles/${vehicleId}/readings`, { readingDate: day(-15), odometer: 11800 })
      .expect(201);
    const vehicle = await detail();
    expect(vehicle.odometer).toBe(11800);
    const fuelReading = vehicle.readings.find((r) => r.source === 'FUEL');
    await api('admin').delete(`/vehicles/${vehicleId}/readings/${fuelReading?.id}`).expect(409);
    await api('employee')
      .delete(`/vehicles/${vehicleId}/readings/${vehicle.readings[0].id}`)
      .expect(403);
  });

  it('schedules the next service from a periodic service', async () => {
    await api('admin')
      .post(`/vehicles/${vehicleId}/services`, {
        type: 'REPAIR',
        serviceDate: day(-5),
        odometer: 11700,
        description: 'E2E fren balatası',
        cost: 2500,
      })
      .expect(400);
    const res = await api('admin')
      .post(`/vehicles/${vehicleId}/services`, {
        type: 'PERIODIC',
        serviceDate: day(-10),
        odometer: 12000,
        description: 'E2E periyodik bakım',
        cost: 5000,
      })
      .expect(201);
    const vehicle = res.body as Vehicle;
    expect(vehicle.odometer).toBe(12000);
    expect(vehicle.nextServiceKm).toBe(22000);
    const next = new Date(`${day(-10)}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 12);
    expect(vehicle.nextServiceDate).toBe(next.toISOString().slice(0, 10));
    expect(vehicle.serviceState).toBe('OK');
  });

  it('tracks document states and reminds once per state', async () => {
    await api('admin')
      .post(`/vehicles/${vehicleId}/documents`, {
        type: 'INSPECTION',
        startDate: day(10),
        endDate: day(5),
      })
      .expect(400);
    await api('admin')
      .post(`/vehicles/${vehicleId}/documents`, {
        type: 'INSPECTION',
        startDate: day(-720),
        endDate: day(10),
        cost: 2950,
      })
      .expect(201);
    const res = await api('admin')
      .post(`/vehicles/${vehicleId}/documents`, {
        type: 'TRAFFIC_INSURANCE',
        startDate: day(-366),
        endDate: day(-1),
        provider: 'E2E Sigorta',
      })
      .expect(201);
    const vehicle = res.body as Vehicle;
    const state = (type: string) => vehicle.documents.find((d) => d.type === type)?.state;
    expect(state('INSPECTION')).toBe('EXPIRING');
    expect(state('TRAFFIC_INSURANCE')).toBe('EXPIRED');
    expect(state('CASCO')).toBe('MISSING');
    expect(vehicle.alertCount).toBe(1);
    expect(vehicle.warningCount).toBe(1);

    const summary = (await api('manager').get('/vehicles/summary').expect(200)).body as {
      alerts: { vehicleId: string; kind: string; state: string }[];
    };
    const mine = summary.alerts.filter((a) => a.vehicleId === vehicleId);
    expect(mine.map((a) => `${a.kind}:${a.state}`).sort()).toEqual([
      'INSPECTION:EXPIRING',
      'TRAFFIC_INSURANCE:EXPIRED',
    ]);

    await api('manager').post('/vehicles/run').expect(403);
    await api('admin').post('/vehicles/run').expect(200);
    expect(await notifications(ids.employee)).toBe(3);
    expect(await notifications(ids.admin)).toBe(2);
    await api('admin').post('/vehicles/run').expect(200);
    expect(await notifications(ids.employee)).toBe(3);

    await api('admin').patch(`/vehicles/${vehicleId}`, { nextServiceKm: 12500 }).expect(200);
    expect((await detail()).serviceState).toBe('DUE_SOON');
    await api('admin').post('/vehicles/run').expect(200);
    await api('admin').post('/vehicles/run').expect(200);
    expect(await notifications(ids.employee)).toBe(4);
  });

  it('closes the previous assignment on handover and on return', async () => {
    await api('admin')
      .post(`/vehicles/${vehicleId}/assign`, { employeeId: elifId, startDate: day(-60) })
      .expect(400);
    const res = await api('admin')
      .post(`/vehicles/${vehicleId}/assign`, { employeeId: elifId, startDate: day(-3) })
      .expect(200);
    const vehicle = res.body as Vehicle;
    expect(vehicle.driver?.employeeId).toBe(elifId);
    const kerem = vehicle.assignments.find((a) => a.employeeId === keremId);
    expect(kerem?.endDate).toBe(day(-3));
    await api('employee').get(`/vehicles/${vehicleId}`).expect(404);
    await api('employee')
      .post(`/vehicles/${vehicleId}/fuel`, {
        entryDate: TODAY,
        odometer: 12100,
        liters: 10,
        amount: 480,
      })
      .expect(404);

    await api('admin')
      .post(`/vehicles/${vehicleId}/return`, { endDate: TODAY, odometer: 11900 })
      .expect(400);
    const returned = (
      await api('admin')
        .post(`/vehicles/${vehicleId}/return`, { endDate: TODAY, odometer: 12150 })
        .expect(200)
    ).body as Vehicle;
    expect(returned.driver).toBeNull();
    expect(returned.odometer).toBe(12150);
    await api('admin').post(`/vehicles/${vehicleId}/return`, { endDate: TODAY }).expect(409);
  });

  it('retires vehicles with history instead of deleting them', async () => {
    expect((await detail()).canDelete).toBe(false);
    await api('admin').delete(`/vehicles/${vehicleId}`).expect(409);
    await api('admin')
      .post(`/vehicles/${vehicleId}/assign`, { employeeId: keremId, startDate: TODAY })
      .expect(200);
    const retired = (
      await api('admin').patch(`/vehicles/${vehicleId}`, { status: 'RETIRED' }).expect(200)
    ).body as Vehicle;
    expect(retired.retiredOn).toBe(TODAY);
    expect(retired.driver).toBeNull();
    expect(retired.alertCount).toBe(0);
    await api('admin')
      .post(`/vehicles/${vehicleId}/assign`, { employeeId: keremId, startDate: TODAY })
      .expect(409);
    await api('admin')
      .post(`/vehicles/${vehicleId}/fuel`, {
        entryDate: TODAY,
        odometer: 12200,
        liters: 10,
        amount: 480,
      })
      .expect(409);
    const active = (
      await api('admin').patch(`/vehicles/${vehicleId}`, { status: 'ACTIVE' }).expect(200)
    ).body as Vehicle;
    expect(active.retiredOn).toBeNull();

    const bare = await api('admin')
      .post('/vehicles', { plate: '81 EFL 902', brand: 'Fiat', model: 'Egea', fuelType: 'LPG' })
      .expect(201);
    await api('admin')
      .delete(`/vehicles/${(bare.body as Vehicle).id}`)
      .expect(204);
  });

  it('offers drivers with their current vehicle', async () => {
    await api('admin')
      .post(`/vehicles/${vehicleId}/assign`, { employeeId: elifId, startDate: TODAY })
      .expect(200);
    const options = (await api('admin').get('/vehicles/options').expect(200)).body as {
      drivers: { id: string; currentPlate: string | null }[];
      partners: { id: string }[];
    };
    expect(options.drivers.find((d) => d.id === elifId)?.currentPlate).toBe('81 EFL 901');
    expect(options.partners.length).toBeGreaterThan(0);
  });
});
