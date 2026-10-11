/* eslint-disable no-console */
import { ApproverType, PrismaClient, WorkflowActionType } from '@prisma/client';
import * as argon2 from 'argon2';
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

  const sequences = [
    ['PURCHASE_REQUEST', 'Satın Alma Talebi', 'STA'],
    ['PURCHASE_ORDER', 'Satın Alma Siparişi', 'SAS'],
    ['SALES_ORDER', 'Satış Siparişi', 'SPS'],
    ['INVOICE', 'Fatura', 'FTR'],
    ['ASSET', 'Demirbaş', 'DMB'],
    ['ASSET_ASSIGNMENT', 'Zimmet Tutanağı', 'ZMT'],
    ['LEAVE_REQUEST', 'İzin Talebi', 'IZN'],
  ];
  for (const [seqCode, seqName, prefix] of sequences) {
    await prisma.numberSequence.upsert({
      where: { companyId_code: { companyId: company.id, code: seqCode } },
      create: { companyId: company.id, code: seqCode, name: seqName, prefix, currentYear: YEAR },
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
  for (const [firstName, lastName] of SAMPLE_EMPLOYEES) {
    const slug = `${firstName}.${lastName}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i');
    await seedUser({
      email: `${slug}@enterprisepulse.dev`,
      password: 'Employee123!',
      firstName,
      lastName,
      companies: [{ companyId: pulse.id, roleIds: [pulseRoles.employee], isDefault: true }],
    });
  }

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
