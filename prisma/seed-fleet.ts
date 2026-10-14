import {
  Prisma,
  VehicleDocumentType,
  VehicleFuelType,
  VehicleOdometerSource,
  VehicleOwnership,
  VehicleServiceType,
  VehicleStatus,
  type PrismaClient,
} from '@prisma/client';
import { parseDateOnly } from '../src/common/dates/date-only';
import { addMonths, fuelFigures } from '../src/modules/fleet/fleet-math';

interface FleetSeedContext {
  companyId: string;
  adminId: string;
}

const PARTNERS = [
  ['SRV-001', 'Boğaziçi Oto Servis A.Ş.', 'İstanbul', '1212343456'],
  ['SRV-002', 'Anadolu Lastik ve Rot Ltd. Şti.', 'İstanbul', '2323454567'],
] as const;

const STATIONS = [
  'Shell Maslak',
  'Opet Kozyatağı',
  'BP Ataşehir',
  'Petrol Ofisi Mecidiyeköy',
  'Total Ümraniye',
];

/** Window of generated history. */
const WEEKS = 36;

interface VehicleSeed {
  plate: string;
  brand: string;
  model: string;
  modelYear: number;
  color: string;
  fuelType: VehicleFuelType;
  ownership: VehicleOwnership;
  /** Lease or rental end, days from today. */
  contractDays?: number;
  department: string;
  odometer: number;
  weeklyKm: number;
  consumption: number;
  /** Weeks between fuel stops. */
  every?: number;
  intervalKm: number;
  intervalMonths: number;
  status?: VehicleStatus;
  /** Weeks ago the vehicle left the fleet. */
  retiredWeeksAgo?: number;
  drivers: { employeeNo: string; from: number; to?: number }[];
  /** Weeks ago of the last periodic service. */
  periodicWeeksAgo: number;
  /** Overrides the next service: km past the current odometer and days from today. */
  next?: { km?: number; days?: number };
  repairs?: { type: VehicleServiceType; weeksAgo: number; cost: number; description: string }[];
  /** Document end dates, days from today; omitted types are missing. */
  documents: Partial<Record<VehicleDocumentType, number>>;
  notes?: string;
}

const VEHICLES: VehicleSeed[] = [
  {
    plate: '34 EPS 101',
    brand: 'Renault',
    model: 'Megane Sedan 1.5 dCi',
    modelYear: 2022,
    color: 'Beyaz',
    fuelType: VehicleFuelType.DIESEL,
    ownership: VehicleOwnership.OWNED,
    department: 'OPS',
    odometer: 42000,
    weeklyKm: 450,
    consumption: 5.2,
    intervalKm: 15000,
    intervalMonths: 12,
    drivers: [{ employeeNo: 'PRS-000006', from: WEEKS }],
    periodicWeeksAgo: 20,
    repairs: [
      {
        type: VehicleServiceType.TIRE,
        weeksAgo: 30,
        cost: 14800,
        description: 'Dört adet kış lastiği, rot-balans',
      },
    ],
    documents: { INSPECTION: 410, TRAFFIC_INSURANCE: 160, CASCO: 160, EMISSION: 410 },
  },
  {
    plate: '34 EPS 102',
    brand: 'Fiat',
    model: 'Egea Cross 1.6 Multijet',
    modelYear: 2023,
    color: 'Gri',
    fuelType: VehicleFuelType.DIESEL,
    ownership: VehicleOwnership.LEASED,
    contractDays: 20,
    department: 'SAT',
    odometer: 28000,
    weeklyKm: 600,
    consumption: 4.8,
    intervalKm: 15000,
    intervalMonths: 12,
    drivers: [{ employeeNo: 'PRS-000005', from: WEEKS }],
    periodicWeeksAgo: 14,
    documents: { INSPECTION: 520, TRAFFIC_INSURANCE: 95, CASCO: 95 },
    notes: 'Kiralama şirketi: Garenta Filo. Sözleşme yenileme teklifi bekleniyor.',
  },
  {
    plate: '34 EPS 103',
    brand: 'Volkswagen',
    model: 'Passat 1.5 TSI Business',
    modelYear: 2021,
    color: 'Siyah',
    fuelType: VehicleFuelType.GASOLINE,
    ownership: VehicleOwnership.OWNED,
    department: 'YON',
    odometer: 76000,
    weeklyKm: 350,
    consumption: 6.9,
    intervalKm: 15000,
    intervalMonths: 12,
    drivers: [{ employeeNo: 'PRS-000001', from: WEEKS }],
    periodicWeeksAgo: 26,
    documents: { INSPECTION: 12, TRAFFIC_INSURANCE: 220, CASCO: 220, EMISSION: 12 },
  },
  {
    plate: '34 EPS 104',
    brand: 'Toyota',
    model: 'Corolla 1.8 Hybrid',
    modelYear: 2023,
    color: 'Lacivert',
    fuelType: VehicleFuelType.HYBRID,
    ownership: VehicleOwnership.LEASED,
    contractDays: 200,
    department: 'BT',
    odometer: 18000,
    weeklyKm: 300,
    consumption: 4.3,
    intervalKm: 15000,
    intervalMonths: 12,
    drivers: [
      { employeeNo: 'PRS-000008', from: WEEKS, to: 16 },
      { employeeNo: 'PRS-000007', from: 16 },
    ],
    periodicWeeksAgo: 34,
    next: { km: 600 },
    documents: { INSPECTION: 640, TRAFFIC_INSURANCE: 75, CASCO: 75 },
  },
  {
    plate: '06 EPS 105',
    brand: 'Ford',
    model: 'Transit Custom 320L',
    modelYear: 2020,
    color: 'Beyaz',
    fuelType: VehicleFuelType.DIESEL,
    ownership: VehicleOwnership.OWNED,
    department: 'OPS',
    odometer: 128000,
    weeklyKm: 700,
    consumption: 8.4,
    intervalKm: 20000,
    intervalMonths: 12,
    drivers: [{ employeeNo: 'PRS-000015', from: WEEKS }],
    periodicWeeksAgo: 10,
    repairs: [
      {
        type: VehicleServiceType.REPAIR,
        weeksAgo: 22,
        cost: 18650,
        description: 'Debriyaj seti ve volan değişimi',
      },
    ],
    documents: { INSPECTION: 150, TRAFFIC_INSURANCE: -5, EMISSION: 150 },
  },
  {
    plate: '35 EPS 106',
    brand: 'Renault',
    model: 'Clio 1.0 TCe',
    modelYear: 2019,
    color: 'Kırmızı',
    fuelType: VehicleFuelType.GASOLINE,
    ownership: VehicleOwnership.OWNED,
    department: 'SAT',
    odometer: 91000,
    weeklyKm: 220,
    consumption: 6.2,
    every: 3,
    intervalKm: 15000,
    intervalMonths: 12,
    status: VehicleStatus.IN_SERVICE,
    drivers: [],
    periodicWeeksAgo: 50,
    repairs: [
      {
        type: VehicleServiceType.ACCIDENT,
        weeksAgo: 0,
        cost: 0,
        description: 'Ön tampon ve far hasarı; ekspertiz bekleniyor',
      },
    ],
    documents: { INSPECTION: 300, TRAFFIC_INSURANCE: 130 },
    notes: 'Havuz aracı; satış ekibi rezervasyonla kullanır.',
  },
  {
    plate: '34 EPS 107',
    brand: 'Peugeot',
    model: '3008 1.5 BlueHDi',
    modelYear: 2024,
    color: 'Gri',
    fuelType: VehicleFuelType.DIESEL,
    ownership: VehicleOwnership.RENTED,
    contractDays: 45,
    department: 'FIN',
    odometer: 9000,
    weeklyKm: 400,
    consumption: 6.1,
    intervalKm: 20000,
    intervalMonths: 12,
    drivers: [{ employeeNo: 'PRS-000004', from: 30 }],
    periodicWeeksAgo: 8,
    documents: { INSPECTION: 900, TRAFFIC_INSURANCE: 250, CASCO: 250 },
  },
  {
    plate: '34 EPS 108',
    brand: 'Opel',
    model: 'Astra 1.6 CDTI',
    modelYear: 2016,
    color: 'Gümüş',
    fuelType: VehicleFuelType.DIESEL,
    ownership: VehicleOwnership.OWNED,
    department: 'SAT',
    odometer: 212000,
    weeklyKm: 500,
    consumption: 5.8,
    intervalKm: 15000,
    intervalMonths: 12,
    status: VehicleStatus.RETIRED,
    retiredWeeksAgo: 9,
    drivers: [{ employeeNo: 'PRS-000013', from: WEEKS, to: 9 }],
    periodicWeeksAgo: 30,
    documents: { INSPECTION: 40, TRAFFIC_INSURANCE: 20 },
    notes: 'Yüksek km nedeniyle satıldı.',
  },
];

const PROVIDERS: Record<VehicleDocumentType, string> = {
  INSPECTION: 'TÜVTÜRK Kartal',
  TRAFFIC_INSURANCE: 'Anadolu Sigorta',
  CASCO: 'Axa Sigorta',
  EMISSION: 'TÜVTÜRK Kartal',
};

const COSTS: Record<VehicleDocumentType, number> = {
  INSPECTION: 2950,
  TRAFFIC_INSURANCE: 11800,
  CASCO: 32500,
  EMISSION: 640,
};

/** Inspection and emission run for two years, insurance for one. */
const TERM_DAYS: Record<VehicleDocumentType, number> = {
  INSPECTION: 730,
  TRAFFIC_INSURANCE: 365,
  CASCO: 365,
  EMISSION: 730,
};

export async function seedFleet(prisma: PrismaClient, ctx: FleetSeedContext) {
  const { companyId, adminId } = ctx;
  const partners: Record<string, string> = {};
  for (const [code, title, city, taxNumber] of PARTNERS) {
    const partner = await prisma.businessPartner.upsert({
      where: { companyId_code: { companyId, code } },
      create: {
        companyId,
        code,
        title,
        type: 'SUPPLIER',
        city,
        taxNumber,
        taxOffice: city,
        email: `info@${code.toLowerCase()}.example.com`,
        phone: '+90 216 555 00 00',
        contactName: 'Servis Danışmanı',
      },
      update: {},
    });
    partners[code] = partner.id;
  }

  if (await prisma.vehicle.count({ where: { companyId } })) return;

  const today = parseDateOnly(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
  );
  const daysFrom = (base: Date, days: number) => new Date(base.getTime() + days * 86_400_000);
  const weeksAgo = (weeks: number, shift = 0) => daysFrom(today, -weeks * 7 + shift);
  const [departments, employees] = await Promise.all([
    prisma.department.findMany({ where: { companyId }, select: { id: true, code: true } }),
    prisma.employee.findMany({ where: { companyId }, select: { id: true, employeeNo: true } }),
  ]);
  const departmentId = (code: string) => departments.find((d) => d.code === code)?.id ?? null;
  const employeeId = (no: string) => {
    const found = employees.find((e) => e.employeeNo === no);
    if (!found) throw new Error(`Seed employee ${no} not found`);
    return found.id;
  };

  let seed = 20261014;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const between = (min: number, max: number) => min + (max - min) * random();

  for (const [index, v] of VEHICLES.entries()) {
    const every = v.every ?? 1;
    const lastWeek = v.retiredWeeksAgo ?? 0;
    const shift = index % 3;
    const start = weeksAgo(WEEKS, -1);

    // Odometer history: one stop every `every` weeks.
    const stops: { date: Date; odometer: number; liters: number; fullTank: boolean }[] = [];
    let odometer = v.odometer;
    let carry = 0;
    for (let w = WEEKS - every; w >= lastWeek; w -= every) {
      const date = weeksAgo(w, shift);
      if (date > today) break;
      const km = Math.round(v.weeklyKm * every * between(0.85, 1.15));
      odometer += km;
      const needed = (km * v.consumption * between(0.93, 1.07)) / 100 + carry;
      const fullTank = stops.length % 5 !== 3;
      const liters = Math.round((fullTank ? needed : needed * 0.5) * 100) / 100;
      carry = fullTank ? 0 : needed - liters;
      stops.push({ date, odometer, liters, fullTank });
    }
    const odometerAt = (date: Date) =>
      stops.filter((s) => s.date <= date).reduce((max, s) => Math.max(max, s.odometer), v.odometer);
    const driverAt = (date: Date) =>
      v.drivers.find(
        (d) => weeksAgo(d.from) <= date && (d.to === undefined || date < weeksAgo(d.to)),
      );

    const retiredOn = v.retiredWeeksAgo !== undefined ? weeksAgo(v.retiredWeeksAgo) : null;
    const vehicle = await prisma.vehicle.create({
      data: {
        companyId,
        plate: v.plate,
        brand: v.brand,
        model: v.model,
        modelYear: v.modelYear,
        color: v.color,
        fuelType: v.fuelType,
        ownership: v.ownership,
        contractEndsOn: v.contractDays !== undefined ? daysFrom(today, v.contractDays) : null,
        departmentId: departmentId(v.department),
        status: v.status ?? VehicleStatus.ACTIVE,
        odometer: stops.at(-1)?.odometer ?? v.odometer,
        serviceIntervalKm: v.intervalKm,
        serviceIntervalMonths: v.intervalMonths,
        notes: v.notes ?? null,
        retiredOn,
        createdById: adminId,
        createdAt: start,
      },
    });
    await prisma.vehicleOdometerReading.create({
      data: {
        vehicleId: vehicle.id,
        readingDate: start,
        odometer: v.odometer,
        source: VehicleOdometerSource.MANUAL,
        note: 'Filoya giriş',
        createdById: adminId,
      },
    });

    for (const d of v.drivers) {
      const from = weeksAgo(d.from);
      const to = d.to !== undefined ? weeksAgo(d.to) : null;
      await prisma.vehicleAssignment.create({
        data: {
          vehicleId: vehicle.id,
          employeeId: employeeId(d.employeeNo),
          startDate: from,
          endDate: to,
          startOdometer: odometerAt(from),
          endOdometer: to ? odometerAt(to) : null,
          note:
            d.to !== undefined && d.to === v.retiredWeeksAgo
              ? 'Araç satış öncesi teslim alındı'
              : null,
          createdById: adminId,
          createdAt: from,
        },
      });
    }

    const price = v.fuelType === VehicleFuelType.DIESEL ? 47.9 : 45.6;
    const created: {
      id: string;
      entryDate: Date;
      odometer: number;
      liters: Prisma.Decimal;
      fullTank: boolean;
    }[] = [];
    for (const [i, stop] of stops.entries()) {
      const driver = driverAt(stop.date);
      const unit = price + (WEEKS - i) * -0.04 + between(-0.6, 0.6);
      const entry = await prisma.vehicleFuelEntry.create({
        data: {
          companyId,
          vehicleId: vehicle.id,
          entryDate: stop.date,
          odometer: stop.odometer,
          liters: stop.liters,
          amount: Math.round(stop.liters * unit * 100) / 100,
          fullTank: stop.fullTank,
          station: STATIONS[(index + i) % STATIONS.length],
          employeeId: driver ? employeeId(driver.employeeNo) : null,
          createdById: adminId,
          createdAt: stop.date,
        },
      });
      await prisma.vehicleOdometerReading.create({
        data: {
          vehicleId: vehicle.id,
          readingDate: stop.date,
          odometer: stop.odometer,
          source: VehicleOdometerSource.FUEL,
          fuelEntryId: entry.id,
          createdById: adminId,
        },
      });
      created.push({
        id: entry.id,
        entryDate: stop.date,
        odometer: stop.odometer,
        liters: new Prisma.Decimal(stop.liters),
        fullTank: stop.fullTank,
      });
    }
    for (const [id, figures] of fuelFigures(created)) {
      await prisma.vehicleFuelEntry.update({ where: { id }, data: figures });
    }

    const services = [
      {
        type: VehicleServiceType.PERIODIC,
        weeksAgo: v.periodicWeeksAgo,
        cost: Math.round(between(5200, 9800)),
        description: 'Periyodik bakım: motor yağı, yağ/hava/polen filtresi, genel kontrol',
      },
      ...(v.repairs ?? []),
    ];
    for (const s of services) {
      const date = weeksAgo(s.weeksAgo, shift);
      const serviceDate = date > today ? today : date;
      const km =
        s.weeksAgo > WEEKS
          ? v.odometer - Math.round((s.weeksAgo - WEEKS) * v.weeklyKm)
          : odometerAt(serviceDate);
      const service = await prisma.vehicleService.create({
        data: {
          companyId,
          vehicleId: vehicle.id,
          type: s.type,
          serviceDate,
          odometer: km,
          partnerId: partners[s.type === VehicleServiceType.TIRE ? 'SRV-002' : 'SRV-001'],
          description: s.description,
          cost: s.cost,
          createdById: adminId,
          createdAt: serviceDate,
        },
      });
      await prisma.vehicleOdometerReading.create({
        data: {
          vehicleId: vehicle.id,
          readingDate: serviceDate,
          odometer: km,
          source: VehicleOdometerSource.SERVICE,
          serviceId: service.id,
          createdById: adminId,
        },
      });
      if (s.type === VehicleServiceType.PERIODIC) {
        const current = stops.at(-1)?.odometer ?? v.odometer;
        await prisma.vehicle.update({
          where: { id: vehicle.id },
          data: {
            nextServiceKm: v.next?.km !== undefined ? current + v.next.km : km + v.intervalKm,
            nextServiceDate:
              v.next?.days !== undefined
                ? daysFrom(today, v.next.days)
                : addMonths(serviceDate, v.intervalMonths),
          },
        });
      }
    }

    for (const [type, days] of Object.entries(v.documents) as [VehicleDocumentType, number][]) {
      const term = TERM_DAYS[type];
      const endDate = daysFrom(today, days);
      const terms =
        type === VehicleDocumentType.TRAFFIC_INSURANCE
          ? [endDate, daysFrom(endDate, -term)]
          : [endDate];
      for (const end of terms) {
        const startDate = daysFrom(end, -term);
        await prisma.vehicleDocument.create({
          data: {
            companyId,
            vehicleId: vehicle.id,
            type,
            startDate,
            endDate: end,
            provider: PROVIDERS[type],
            policyNumber:
              type === VehicleDocumentType.TRAFFIC_INSURANCE || type === VehicleDocumentType.CASCO
                ? `${type === VehicleDocumentType.CASCO ? 'KSK' : 'TRF'}-${end.getUTCFullYear() - 1}-${String(
                    Math.round(between(10000, 99999)),
                  )}`
                : null,
            cost: Math.round(COSTS[type] * between(0.85, 1.25)),
            createdById: adminId,
            createdAt: startDate < start ? start : startDate,
          },
        });
      }
    }
  }
}
