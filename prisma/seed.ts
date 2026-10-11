/* eslint-disable no-console */
import {
  ApproverType,
  Gender,
  LeaveRequestStatus,
  PrismaClient,
  WorkflowActionType,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { parseDateOnly } from '../src/modules/hr/date-only';
import { countWorkingDays } from '../src/modules/hr/working-days';
import { formatNumber } from '../src/modules/numbering/number-format';
import { ALL_PERMISSION_CODES } from '../src/modules/roles/permissions.registry';

const prisma = new PrismaClient();
const YEAR = new Date().getFullYear();

const ROLE_PERMISSIONS: Record<string, { name: string; description: string; codes: string[] }> = {
  admin: {
    name: 'Şirket Yöneticisi',
    description: 'Şirket içindeki tüm modüllere tam erişim',
    codes: ALL_PERMISSION_CODES,
  },
  manager: {
    name: 'Müdür',
    description: 'Kayıtları görüntüler, onay süreçlerini yönetir',
    codes: [
      'branches:read',
      'users:read',
      'roles:read',
      'audit:read',
      'files:read',
      'files:create',
      'numbering:read',
      'settings:read',
      'workflow:read',
      'workflow:start',
      'notifications:send',
      'departments:read',
      'positions:read',
      'employees:read',
      'leave:read',
    ],
  },
  employee: {
    name: 'Personel',
    description: 'Temel self-servis erişimi',
    codes: ['files:read', 'files:create', 'workflow:start', 'settings:read'],
  },
};

const SAMPLE_EMPLOYEES = [
  ['Ayşe', 'Yılmaz'],
  ['Mehmet', 'Kaya'],
  ['Zeynep', 'Demir'],
  ['Mustafa', 'Çelik'],
  ['Elif', 'Şahin'],
  ['Ahmet', 'Yıldız'],
  ['Fatma', 'Öztürk'],
  ['Emre', 'Aydın'],
  ['Selin', 'Arslan'],
  ['Burak', 'Doğan'],
  ['Merve', 'Koç'],
  ['Can', 'Kurt'],
];

async function seedPermissions() {
  for (const code of ALL_PERMISSION_CODES) {
    const [module, action] = code.split(':');
    await prisma.permission.upsert({
      where: { code },
      create: { code, module, action },
      update: { module, action },
    });
  }
}

async function seedCurrencies() {
  const currencies = [
    { code: 'TRY', name: 'Türk Lirası', symbol: '₺' },
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
  ];
  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      create: currency,
      update: currency,
    });
  }

  const today = new Date(Date.UTC(YEAR, new Date().getMonth(), new Date().getDate()));
  const rates = { USD: [41.2, 41.35], EUR: [47.9, 48.1], GBP: [55.1, 55.4] };
  for (const [currencyCode, [buying, selling]] of Object.entries(rates)) {
    await prisma.exchangeRate.upsert({
      where: { currencyCode_rateDate_source: { currencyCode, rateDate: today, source: 'manual' } },
      create: { currencyCode, rateDate: today, buying, selling },
      update: { buying, selling },
    });
  }
}

async function seedCompany(code: string, name: string, branches: [string, string, string][]) {
  const company = await prisma.company.upsert({
    where: { code },
    create: {
      code,
      name,
      legalName: `${name} A.Ş.`,
      taxNumber: code === 'PULSE' ? '1234567890' : '9876543210',
      taxOffice: 'Kozyatağı',
      email: `info@${code.toLowerCase()}.enterprisepulse.dev`,
      city: 'İstanbul',
    },
    update: {},
  });

  for (const [branchCode, branchName, city] of branches) {
    await prisma.branch.upsert({
      where: { companyId_code: { companyId: company.id, code: branchCode } },
      create: { companyId: company.id, code: branchCode, name: branchName, city },
      update: {},
    });
  }

  const taxRates = [
    { code: 'KDV20', name: 'KDV %20', rate: 20, isDefault: true },
    { code: 'KDV10', name: 'KDV %10', rate: 10 },
    { code: 'KDV1', name: 'KDV %1', rate: 1 },
    { code: 'KDV0', name: 'KDV İstisna', rate: 0 },
  ];
  for (const tax of taxRates) {
    await prisma.taxRate.upsert({
      where: { companyId_code: { companyId: company.id, code: tax.code } },
      create: { ...tax, companyId: company.id },
      update: {},
    });
  }

  const units = [
    ['ADET', 'Adet'],
    ['KG', 'Kilogram'],
    ['LT', 'Litre'],
    ['M', 'Metre'],
    ['M2', 'Metrekare'],
    ['KOLI', 'Koli'],
    ['SAAT', 'Saat'],
  ];
  for (const [unitCode, unitName] of units) {
    await prisma.unit.upsert({
      where: { companyId_code: { companyId: company.id, code: unitCode } },
      create: { companyId: company.id, code: unitCode, name: unitName },
      update: {},
    });
  }

  const sequences: [string, string, string, boolean?][] = [
    ['PURCHASE_REQUEST', 'Satın Alma Talebi', 'STA'],
    ['PURCHASE_ORDER', 'Satın Alma Siparişi', 'SAS'],
    ['SALES_ORDER', 'Satış Siparişi', 'SPS'],
    ['INVOICE', 'Fatura', 'FTR'],
    ['ASSET', 'Demirbaş', 'DMB'],
    ['ASSET_ASSIGNMENT', 'Zimmet Tutanağı', 'ZMT'],
    ['LEAVE_REQUEST', 'İzin Talebi', 'IZN'],
    ['EMPLOYEE', 'Personel Sicil No', 'PRS', false],
  ];
  for (const [seqCode, seqName, prefix, yearly = true] of sequences) {
    await prisma.numberSequence.upsert({
      where: { companyId_code: { companyId: company.id, code: seqCode } },
      create: {
        companyId: company.id,
        code: seqCode,
        name: seqName,
        prefix,
        currentYear: YEAR,
        includeYear: yearly,
        resetYearly: yearly,
      },
      update: {},
    });
  }

  await prisma.setting.upsert({
    where: { companyId_key: { companyId: company.id, key: 'general' } },
    create: {
      companyId: company.id,
      key: 'general',
      value: { dateFormat: 'dd.MM.yyyy', timezone: 'Europe/Istanbul', fiscalYearStartMonth: 1 },
    },
    update: {},
  });

  return company;
}

async function seedRoles(companyId: string) {
  const roles: Record<string, string> = {};
  for (const [code, def] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { companyId_code: { companyId, code } },
      create: {
        companyId,
        code,
        name: def.name,
        description: def.description,
        isSystem: code === 'admin',
      },
      update: { name: def.name, description: def.description },
    });
    const permissions = await prisma.permission.findMany({ where: { code: { in: def.codes } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
    roles[code] = role.id;
  }
  return roles;
}

async function seedUser(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  isSuperAdmin?: boolean;
  companies: { companyId: string; roleIds: string[]; isDefault: boolean; branchId?: string }[];
}) {
  const user = await prisma.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      passwordHash: await argon2.hash(input.password),
      firstName: input.firstName,
      lastName: input.lastName,
      isSuperAdmin: input.isSuperAdmin ?? false,
    },
    update: {},
  });

  for (const membership of input.companies) {
    await prisma.userCompany.upsert({
      where: { userId_companyId: { userId: user.id, companyId: membership.companyId } },
      create: {
        userId: user.id,
        companyId: membership.companyId,
        isDefault: membership.isDefault,
        defaultBranchId: membership.branchId,
      },
      update: {},
    });
    for (const roleId of membership.roleIds) {
      await prisma.userRole.upsert({
        where: {
          userId_roleId_companyId: { userId: user.id, roleId, companyId: membership.companyId },
        },
        create: { userId: user.id, roleId, companyId: membership.companyId },
        update: {},
      });
    }
  }
  return user;
}

const DEPARTMENTS: [code: string, name: string, parent: string | null][] = [
  ['YON', 'Yönetim', null],
  ['BT', 'Bilgi Teknolojileri', 'YON'],
  ['IK', 'İnsan Kaynakları', 'YON'],
  ['FIN', 'Finans', 'YON'],
  ['SAT', 'Satış', 'YON'],
  ['OPS', 'Operasyon', 'YON'],
];

const POSITIONS: [code: string, name: string, department: string][] = [
  ['GM', 'Genel Müdür', 'YON'],
  ['BT-MDR', 'BT Müdürü', 'BT'],
  ['YAZ', 'Yazılım Geliştirici', 'BT'],
  ['SIS', 'Sistem Yöneticisi', 'BT'],
  ['IK-MDR', 'İK Müdürü', 'IK'],
  ['IK-UZM', 'İK Uzmanı', 'IK'],
  ['FIN-MDR', 'Finans Müdürü', 'FIN'],
  ['MUH', 'Muhasebe Uzmanı', 'FIN'],
  ['SAT-MDR', 'Satış Müdürü', 'SAT'],
  ['SAT-TEM', 'Satış Temsilcisi', 'SAT'],
  ['OPS-MDR', 'Operasyon Müdürü', 'OPS'],
  ['LOJ', 'Lojistik Uzmanı', 'OPS'],
];

/** [full name, department, position, manager, hire date, gender]; the first one heads the company. */
const EMPLOYEES: [string, string, string, string | null, string, Gender][] = [
  ['Hakan Erdem', 'YON', 'GM', null, '2015-01-05', Gender.MALE],
  ['Deniz Aksoy', 'BT', 'BT-MDR', 'Hakan Erdem', '2018-03-12', Gender.FEMALE],
  ['Ayşe Yılmaz', 'IK', 'IK-MDR', 'Hakan Erdem', '2017-06-01', Gender.FEMALE],
  ['Mehmet Kaya', 'FIN', 'FIN-MDR', 'Hakan Erdem', '2016-09-19', Gender.MALE],
  ['Zeynep Demir', 'SAT', 'SAT-MDR', 'Hakan Erdem', '2019-02-04', Gender.FEMALE],
  ['Mustafa Çelik', 'OPS', 'OPS-MDR', 'Hakan Erdem', '2018-11-15', Gender.MALE],
  ['Kerem Polat', 'BT', 'YAZ', 'Deniz Aksoy', '2022-04-18', Gender.MALE],
  ['Elif Şahin', 'BT', 'YAZ', 'Deniz Aksoy', '2023-01-09', Gender.FEMALE],
  ['Ahmet Yıldız', 'BT', 'SIS', 'Deniz Aksoy', '2021-07-01', Gender.MALE],
  ['Fatma Öztürk', 'IK', 'IK-UZM', 'Ayşe Yılmaz', '2020-10-12', Gender.FEMALE],
  ['Emre Aydın', 'FIN', 'MUH', 'Mehmet Kaya', '2022-08-22', Gender.MALE],
  ['Selin Arslan', 'SAT', 'SAT-TEM', 'Zeynep Demir', '2023-05-15', Gender.FEMALE],
  ['Burak Doğan', 'SAT', 'SAT-TEM', 'Zeynep Demir', '2024-02-01', Gender.MALE],
  ['Merve Koç', 'OPS', 'LOJ', 'Mustafa Çelik', '2021-03-29', Gender.FEMALE],
  ['Can Kurt', 'OPS', 'LOJ', 'Mustafa Çelik', '2025-06-02', Gender.MALE],
];

const LEAVE_TYPES = [
  { code: 'YILLIK', name: 'Yıllık İzin', defaultDays: 14, color: '#6366f1' },
  { code: 'MAZERET', name: 'Mazeret İzni', defaultDays: 5, color: '#f59e0b' },
  {
    code: 'HASTALIK',
    name: 'Hastalık İzni',
    defaultDays: 0,
    requiresBalance: false,
    color: '#ef4444',
  },
  {
    code: 'UCRETSIZ',
    name: 'Ücretsiz İzin',
    defaultDays: 0,
    isPaid: false,
    requiresBalance: false,
    color: '#64748b',
  },
];

const FIXED_HOLIDAYS: [string, string][] = [
  ['01-01', 'Yılbaşı'],
  ['04-23', 'Ulusal Egemenlik ve Çocuk Bayramı'],
  ['05-01', 'Emek ve Dayanışma Günü'],
  ['05-19', "Atatürk'ü Anma, Gençlik ve Spor Bayramı"],
  ['07-15', 'Demokrasi ve Milli Birlik Günü'],
  ['08-30', 'Zafer Bayramı'],
  ['10-29', 'Cumhuriyet Bayramı'],
];

/** Religious holidays follow the lunar calendar, so they are listed per year. */
const RELIGIOUS_HOLIDAYS: Record<number, [string, string][]> = {
  2026: [
    ['2026-03-20', 'Ramazan Bayramı 1. Gün'],
    ['2026-03-21', 'Ramazan Bayramı 2. Gün'],
    ['2026-03-22', 'Ramazan Bayramı 3. Gün'],
    ['2026-05-27', 'Kurban Bayramı 1. Gün'],
    ['2026-05-28', 'Kurban Bayramı 2. Gün'],
    ['2026-05-29', 'Kurban Bayramı 3. Gün'],
    ['2026-05-30', 'Kurban Bayramı 4. Gün'],
  ],
};

/** Annual leave entitlement under Turkish Labour Law art. 53, by completed years of service. */
function annualLeaveDays(hireDate: string): number {
  const years = YEAR - Number(hireDate.slice(0, 4));
  if (years >= 15) return 26;
  if (years >= 5) return 20;
  return 14;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function seedHr(
  companyId: string,
  branchId: string,
  usersByName: Map<string, string>,
  roles: Record<string, string>,
) {
  const departments = new Map<string, string>();
  for (const [code, name, parent] of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { companyId_code: { companyId, code } },
      create: { companyId, code, name, parentId: parent ? departments.get(parent) : null },
      update: {},
    });
    departments.set(code, row.id);
  }

  const positions = new Map<string, string>();
  for (const [code, name, department] of POSITIONS) {
    const row = await prisma.position.upsert({
      where: { companyId_code: { companyId, code } },
      create: { companyId, code, name, departmentId: departments.get(department) },
      update: {},
    });
    positions.set(code, row.id);
  }

  const employees = new Map<string, { id: string; hireDate: string }>();
  for (const [
    index,
    [fullName, department, position, managerName, hireDate, gender],
  ] of EMPLOYEES.entries()) {
    const [firstName, ...rest] = fullName.split(' ');
    const lastName = rest.join(' ');
    const employeeNo = formatNumber(
      { prefix: 'PRS', padding: 6, includeYear: false },
      YEAR,
      index + 1,
    );
    const userId = usersByName.get(fullName) ?? null;
    const row = await prisma.employee.upsert({
      where: { companyId_employeeNo: { companyId, employeeNo } },
      create: {
        companyId,
        employeeNo,
        firstName,
        lastName,
        gender,
        userId,
        branchId,
        email: userId ? undefined : `${firstName.toLowerCase()}@pulse.example`,
        phone: `+90 532 000 ${String(index + 1).padStart(4, '0')}`,
        hireDate: parseDateOnly(hireDate),
        departmentId: departments.get(department),
        positionId: positions.get(position),
        managerId: managerName ? employees.get(managerName)?.id : null,
      },
      update: {},
    });
    employees.set(fullName, { id: row.id, hireDate });
  }
  await prisma.numberSequence.updateMany({
    where: { companyId, code: 'EMPLOYEE', nextValue: { lte: EMPLOYEES.length } },
    data: { nextValue: EMPLOYEES.length + 1 },
  });

  const userEmails = await prisma.user.findMany({
    where: { id: { in: [...usersByName.values()] } },
    select: { id: true, email: true },
  });
  for (const { id, email } of userEmails) {
    await prisma.employee.updateMany({
      where: { companyId, userId: id, email: null },
      data: { email },
    });
  }

  for (const [fullName, department, position] of EMPLOYEES) {
    if (position !== 'GM' && !position.endsWith('-MDR')) continue;
    await prisma.department.updateMany({
      where: { companyId, code: department, managerId: null },
      data: { managerId: employees.get(fullName)?.id },
    });
  }

  const leaveTypes = new Map<string, string>();
  for (const type of LEAVE_TYPES) {
    const row = await prisma.leaveType.upsert({
      where: { companyId_code: { companyId, code: type.code } },
      create: { ...type, companyId },
      update: {},
    });
    leaveTypes.set(type.code, row.id);
  }

  for (const { id, hireDate } of employees.values()) {
    const entitlements: [string, number][] = [
      ['YILLIK', annualLeaveDays(hireDate)],
      ['MAZERET', 5],
    ];
    for (const [code, entitledDays] of entitlements) {
      await prisma.leaveBalance.upsert({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: id,
            leaveTypeId: leaveTypes.get(code)!,
            year: YEAR,
          },
        },
        create: {
          companyId,
          employeeId: id,
          leaveTypeId: leaveTypes.get(code)!,
          year: YEAR,
          entitledDays,
        },
        update: {},
      });
    }
  }

  const holidays: [string, string][] = [
    ...[YEAR, YEAR + 1].flatMap((year) =>
      FIXED_HOLIDAYS.map(([day, name]): [string, string] => [`${year}-${day}`, name]),
    ),
    ...(RELIGIOUS_HOLIDAYS[YEAR] ?? []),
  ];
  for (const [date, name] of holidays) {
    await prisma.holiday.upsert({
      where: { companyId_date: { companyId, date: parseDateOnly(date) } },
      create: { companyId, date: parseDateOnly(date), name },
      update: {},
    });
  }

  const definition = await prisma.workflowDefinition.upsert({
    where: { companyId_code: { companyId, code: 'LEAVE_REQUEST' } },
    create: {
      companyId,
      code: 'LEAVE_REQUEST',
      name: 'İzin Talebi Onayı',
      entityType: 'LeaveRequest',
      description: 'Önce yönetici, ardından İK (şirket yöneticisi) onaylar',
      steps: {
        create: [
          {
            order: 1,
            name: 'Yönetici Onayı',
            approverType: ApproverType.ROLE,
            approverRoleId: roles.manager,
          },
          {
            order: 2,
            name: 'İK Onayı',
            approverType: ApproverType.ROLE,
            approverRoleId: roles.admin,
          },
        ],
      },
    },
    update: {},
  });

  if (await prisma.leaveRequest.count({ where: { companyId } })) return;

  const holidaySet = new Set(holidays.map(([date]) => date));
  const nextMonday = new Date(Date.UTC(YEAR, new Date().getMonth(), new Date().getDate() + 14));
  nextMonday.setUTCDate(nextMonday.getUTCDate() + ((8 - nextMonday.getUTCDay()) % 7));
  const nextFriday = new Date(nextMonday.getTime() + 4 * 24 * 60 * 60 * 1000);

  const samples = [
    {
      employee: 'Elif Şahin',
      type: 'YILLIK',
      start: `${YEAR}-07-13`,
      end: `${YEAR}-07-17`,
      reason: 'Yaz tatili',
      status: LeaveRequestStatus.APPROVED,
    },
    {
      employee: 'Can Kurt',
      type: 'HASTALIK',
      start: `${YEAR}-02-09`,
      end: `${YEAR}-02-10`,
      reason: 'Doktor raporu',
      status: LeaveRequestStatus.APPROVED,
    },
    {
      employee: 'Kerem Polat',
      type: 'YILLIK',
      start: isoDay(nextMonday),
      end: isoDay(nextFriday),
      reason: 'Aile ziyareti',
      status: LeaveRequestStatus.PENDING,
    },
  ];

  for (const [index, sample] of samples.entries()) {
    const employeeId = employees.get(sample.employee)!.id;
    const leaveTypeId = leaveTypes.get(sample.type)!;
    const startDate = parseDateOnly(sample.start);
    const endDate = parseDateOnly(sample.end);
    const days = countWorkingDays(startDate, endDate, holidaySet);
    const number = formatNumber({ prefix: 'IZN', padding: 6, includeYear: true }, YEAR, index + 1);
    const requesterId = usersByName.get(sample.employee)!;
    const approved = sample.status === LeaveRequestStatus.APPROVED;

    let workflowInstanceId: string | null = null;
    if (!approved) {
      const instance = await prisma.workflowInstance.create({
        data: {
          companyId,
          definitionId: definition.id,
          entityType: 'LeaveRequest',
          entityId: number,
          title: `${sample.employee} — Yıllık İzin (${days} gün)`,
          currentStepOrder: 1,
          startedById: requesterId,
          actions: {
            create: { stepOrder: 0, type: WorkflowActionType.START, userId: requesterId },
          },
        },
      });
      workflowInstanceId = instance.id;
      await prisma.notification.create({
        data: {
          userId: usersByName.get('Deniz Aksoy')!,
          companyId,
          type: 'workflow.approval_requested',
          title: 'Onayınızı bekleyen talep',
          body: `"${instance.title}" — Yönetici Onayı`,
          link: `/workflow/instances/${instance.id}`,
        },
      });
    }

    await prisma.leaveRequest.create({
      data: {
        companyId,
        number,
        employeeId,
        leaveTypeId,
        startDate,
        endDate,
        days,
        reason: sample.reason,
        status: sample.status,
        workflowInstanceId,
        createdById: requesterId,
        decidedAt: approved ? new Date() : null,
      },
    });
    if (approved) {
      await prisma.leaveBalance.updateMany({
        where: { employeeId, leaveTypeId, year: YEAR },
        data: { usedDays: { increment: days } },
      });
    }
  }
  await prisma.numberSequence.updateMany({
    where: { companyId, code: 'LEAVE_REQUEST', nextValue: { lte: samples.length } },
    data: { nextValue: samples.length + 1, currentYear: YEAR },
  });
}

async function main() {
  console.log('Seeding permissions and currencies...');
  await seedPermissions();
  await seedCurrencies();

  console.log('Seeding companies...');
  const pulse = await seedCompany('PULSE', 'Pulse Teknoloji', [
    ['MERKEZ', 'Genel Merkez', 'İstanbul'],
    ['ANK', 'Ankara Şube', 'Ankara'],
    ['IZM', 'İzmir Şube', 'İzmir'],
  ]);
  const logistics = await seedCompany('PULSE-LOJ', 'Pulse Lojistik', [
    ['MERKEZ', 'Merkez Depo', 'Kocaeli'],
  ]);

  const pulseRoles = await seedRoles(pulse.id);
  const logisticsRoles = await seedRoles(logistics.id);
  const hq = await prisma.branch.findUniqueOrThrow({
    where: { companyId_code: { companyId: pulse.id, code: 'MERKEZ' } },
  });

  console.log('Seeding users...');
  const admin = await seedUser({
    email: 'admin@enterprisepulse.dev',
    password: 'Admin123!',
    firstName: 'Sistem',
    lastName: 'Yöneticisi',
    isSuperAdmin: true,
    companies: [
      { companyId: pulse.id, roleIds: [pulseRoles.admin], isDefault: true, branchId: hq.id },
      { companyId: logistics.id, roleIds: [logisticsRoles.admin], isDefault: false },
    ],
  });
  const manager = await seedUser({
    email: 'manager@enterprisepulse.dev',
    password: 'Manager123!',
    firstName: 'Deniz',
    lastName: 'Aksoy',
    companies: [
      { companyId: pulse.id, roleIds: [pulseRoles.manager], isDefault: true, branchId: hq.id },
      { companyId: logistics.id, roleIds: [logisticsRoles.manager], isDefault: false },
    ],
  });
  const employee = await seedUser({
    email: 'employee@enterprisepulse.dev',
    password: 'Employee123!',
    firstName: 'Kerem',
    lastName: 'Polat',
    companies: [
      { companyId: pulse.id, roleIds: [pulseRoles.employee], isDefault: true, branchId: hq.id },
    ],
  });
  const usersByName = new Map<string, string>([
    ['Deniz Aksoy', manager.id],
    ['Kerem Polat', employee.id],
  ]);
  for (const [firstName, lastName] of SAMPLE_EMPLOYEES) {
    const slug = `${firstName}.${lastName}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i');
    const sample = await seedUser({
      email: `${slug}@enterprisepulse.dev`,
      password: 'Employee123!',
      firstName,
      lastName,
      companies: [{ companyId: pulse.id, roleIds: [pulseRoles.employee], isDefault: true }],
    });
    usersByName.set(`${firstName} ${lastName}`, sample.id);
  }

  console.log('Seeding human resources...');
  await seedHr(pulse.id, hq.id, usersByName, pulseRoles);

  console.log('Seeding workflow...');
  const definition = await prisma.workflowDefinition.upsert({
    where: { companyId_code: { companyId: pulse.id, code: 'PURCHASE_REQUEST' } },
    create: {
      companyId: pulse.id,
      code: 'PURCHASE_REQUEST',
      name: 'Satın Alma Talebi Onayı',
      entityType: 'PurchaseRequest',
      description: 'Önce departman müdürü, ardından şirket yöneticisi onaylar',
      steps: {
        create: [
          {
            order: 1,
            name: 'Müdür Onayı',
            approverType: ApproverType.ROLE,
            approverRoleId: pulseRoles.manager,
          },
          {
            order: 2,
            name: 'Yönetici Onayı',
            approverType: ApproverType.ROLE,
            approverRoleId: pulseRoles.admin,
          },
        ],
      },
    },
    update: {},
  });

  const existing = await prisma.workflowInstance.count({ where: { definitionId: definition.id } });
  if (!existing) {
    await prisma.workflowInstance.create({
      data: {
        companyId: pulse.id,
        definitionId: definition.id,
        entityType: 'PurchaseRequest',
        entityId: `STA-${YEAR}-000001`,
        title: '5 adet dizüstü bilgisayar talebi',
        currentStepOrder: 1,
        startedById: employee.id,
        actions: { create: { stepOrder: 0, type: WorkflowActionType.START, userId: employee.id } },
      },
    });
    await prisma.notification.createMany({
      data: [
        {
          userId: manager.id,
          companyId: pulse.id,
          type: 'workflow.approval_requested',
          title: 'Onayınızı bekleyen talep',
          body: '"5 adet dizüstü bilgisayar talebi" — Müdür Onayı',
          link: '/workflow/inbox',
        },
        {
          userId: admin.id,
          companyId: pulse.id,
          type: 'announcement',
          title: 'EnterprisePulse’a hoş geldiniz',
          body: 'Demo verileri yüklendi. Sol menüden modülleri keşfedebilirsiniz.',
        },
      ],
    });
  }

  console.log('Seed completed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
