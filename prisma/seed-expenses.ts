import { randomUUID } from 'node:crypto';
import { HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  ExpenseCategoryKind,
  ExpenseReportStatus,
  Prisma,
  type PrismaClient,
  TreasuryDocumentType,
  WorkflowActionType,
  WorkflowStatus,
} from '@prisma/client';
import { config } from 'dotenv';
import { lineAmounts } from '../src/modules/expenses/expense-math';
import { formatNumber } from '../src/modules/numbering/number-format';

const YEAR = new Date().getFullYear();
const daysAgo = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - days));
};
const atDaysAgo = (days: number, hour: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour);
};

interface ExpenseSeedContext {
  companyId: string;
  adminId: string;
  managerRoleId: string;
}

const CATEGORIES: {
  code: string;
  name: string;
  kind?: ExpenseCategoryKind;
  rate?: number;
  limitAmount?: number;
  requiresReceipt?: boolean;
}[] = [
  { code: 'YEMEK', name: 'Yemek', limitAmount: 750 },
  { code: 'KONAKLAMA', name: 'Konaklama', limitAmount: 4000 },
  { code: 'ULASIM', name: 'Ulaşım (uçak, otobüs, tren)' },
  { code: 'TAKSI', name: 'Taksi ve otopark', limitAmount: 1000 },
  { code: 'TEMSIL', name: 'Temsil ve ağırlama' },
  { code: 'KIRTASIYE', name: 'Kırtasiye ve küçük alımlar', limitAmount: 2500 },
  { code: 'TELEFON', name: 'Telefon ve internet', requiresReceipt: false },
  { code: 'HARCIRAH', name: 'Yurt içi harcırah', kind: 'PER_DIEM', rate: 1050 },
  { code: 'KM', name: 'Özel araç kullanımı (km)', kind: 'MILEAGE', rate: 8.5 },
];

interface SeedLine {
  category: string;
  daysAgo: number;
  description: string;
  merchant?: string;
  quantity?: number;
  amount?: number;
  vat?: number;
  currency?: string;
}

interface SeedReport {
  employeeNo: string;
  title: string;
  description?: string;
  status: ExpenseReportStatus;
  createdDaysAgo: number;
  /** Days ago the approval finished / the payment was made. */
  decidedDaysAgo?: number;
  paidDaysAgo?: number;
  account?: string;
  rejectReason?: string;
  lines: SeedLine[];
}

const REPORTS: SeedReport[] = [
  {
    employeeNo: 'PRS-000007',
    title: 'Ankara müşteri ziyareti',
    description: 'Başkent Ofis kurulum ve eğitim çalışması.',
    status: 'PAID',
    createdDaysAgo: 24,
    decidedDaysAgo: 22,
    paidDaysAgo: 20,
    account: 'BNK-TL',
    lines: [
      { category: 'HARCIRAH', daysAgo: 27, description: 'Ankara, 2 gün', quantity: 2 },
      {
        category: 'KONAKLAMA',
        daysAgo: 27,
        description: '1 gece otel',
        merchant: 'Kızılay Otel',
        amount: 2850,
        vat: 475,
      },
      {
        category: 'ULASIM',
        daysAgo: 27,
        description: 'İstanbul – Ankara uçak bileti (gidiş-dönüş)',
        merchant: 'AJet',
        amount: 2140,
        vat: 357,
      },
      {
        category: 'TAKSI',
        daysAgo: 26,
        description: 'Havalimanı – müşteri ofisi',
        merchant: 'Ankara Taksi',
        amount: 380,
      },
    ],
  },
  {
    employeeNo: 'PRS-000007',
    title: 'İzmir kurulum çalışması',
    description: 'Akdeniz Otelcilik resepsiyon tabletlerinin kurulumu.',
    status: 'PENDING',
    createdDaysAgo: 3,
    lines: [
      { category: 'HARCIRAH', daysAgo: 6, description: 'İzmir, 3 gün', quantity: 3 },
      { category: 'KM', daysAgo: 6, description: 'İstanbul – İzmir özel araç', quantity: 465 },
      {
        category: 'YEMEK',
        daysAgo: 5,
        description: 'Ekip yemeği (3 kişi)',
        merchant: 'Kordon Balık',
        amount: 920,
        vat: 84,
      },
      {
        category: 'KONAKLAMA',
        daysAgo: 6,
        description: '2 gece otel',
        merchant: 'Alsancak Park Otel',
        amount: 3600,
        vat: 600,
      },
    ],
  },
  {
    employeeNo: 'PRS-000007',
    title: 'Ekim kırtasiye alımları',
    status: 'DRAFT',
    createdDaysAgo: 1,
    lines: [
      {
        category: 'KIRTASIYE',
        daysAgo: 1,
        description: 'Etiket yazıcı şeridi ve kablo bağı',
        merchant: 'Ofis Market',
        amount: 245,
        vat: 41,
      },
    ],
  },
  {
    employeeNo: 'PRS-000005',
    title: 'Boğaziçi Perakende müşteri yemeği',
    status: 'APPROVED',
    createdDaysAgo: 6,
    decidedDaysAgo: 4,
    lines: [
      {
        category: 'TEMSIL',
        daysAgo: 7,
        description: 'Satın alma ekibiyle iş yemeği (4 kişi)',
        merchant: 'Nusr Bosphorus',
        amount: 3200,
        vat: 291,
      },
      {
        category: 'TAKSI',
        daysAgo: 7,
        description: 'Ofis – restoran',
        merchant: 'BiTaksi',
        amount: 260,
      },
    ],
  },
  {
    employeeNo: 'PRS-000012',
    title: 'Frankfurt teknoloji fuarı',
    description: 'Yeni tedarikçilerle görüşmeler.',
    status: 'APPROVED',
    createdDaysAgo: 9,
    decidedDaysAgo: 5,
    lines: [
      {
        category: 'ULASIM',
        daysAgo: 15,
        description: 'İstanbul – Frankfurt uçak bileti',
        merchant: 'Lufthansa',
        amount: 9800,
      },
      {
        category: 'KONAKLAMA',
        daysAgo: 14,
        description: '3 gece otel',
        merchant: 'Messe Hotel Frankfurt',
        amount: 540,
        currency: 'EUR',
      },
      {
        category: 'YEMEK',
        daysAgo: 13,
        description: 'Fuar alanında yemekler',
        merchant: 'Messe Gastronomie',
        amount: 85,
        currency: 'EUR',
      },
    ],
  },
  {
    employeeNo: 'PRS-000013',
    title: 'Bursa bayi ziyareti',
    status: 'REJECTED',
    createdDaysAgo: 12,
    decidedDaysAgo: 10,
    rejectReason: 'Bu ziyaret için havuzdaki şirket aracı kullanılmalıydı; km satırını çıkarın.',
    lines: [
      { category: 'KM', daysAgo: 13, description: 'İstanbul – Bursa – İstanbul', quantity: 310 },
      {
        category: 'YEMEK',
        daysAgo: 13,
        description: 'Öğle yemeği',
        merchant: 'Kebapçı İskender',
        amount: 410,
        vat: 37,
      },
    ],
  },
  {
    employeeNo: 'PRS-000002',
    title: 'Sunucu odası acil malzeme',
    status: 'PAID',
    createdDaysAgo: 38,
    decidedDaysAgo: 37,
    paidDaysAgo: 35,
    account: 'KASA-TL',
    lines: [
      {
        category: 'KIRTASIYE',
        daysAgo: 39,
        description: 'Patch kablo ve priz',
        merchant: 'Teknosa',
        amount: 1180,
        vat: 197,
      },
      {
        category: 'TAKSI',
        daysAgo: 39,
        description: 'Mağaza – ofis',
        merchant: 'İstanbul Taksi',
        amount: 190,
      },
    ],
  },
  {
    employeeNo: 'PRS-000014',
    title: 'Depo sayımı akşam yemeği',
    status: 'PENDING',
    createdDaysAgo: 2,
    lines: [
      {
        category: 'YEMEK',
        daysAgo: 2,
        description: 'Sayım ekibi yemeği (5 kişi)',
        merchant: 'Pideci Mehmet Usta',
        amount: 640,
        vat: 58,
      },
    ],
  },
  {
    employeeNo: 'PRS-000004',
    title: 'Vergi mevzuatı semineri',
    status: 'PAID',
    createdDaysAgo: 72,
    decidedDaysAgo: 71,
    paidDaysAgo: 70,
    account: 'BNK-TL',
    lines: [
      {
        category: 'ULASIM',
        daysAgo: 75,
        description: 'Ankara – İstanbul YHT',
        merchant: 'TCDD Taşımacılık',
        amount: 1250,
      },
      {
        category: 'KONAKLAMA',
        daysAgo: 75,
        description: '1 gece otel',
        merchant: 'Taksim Business Hotel',
        amount: 2400,
        vat: 400,
      },
      {
        category: 'YEMEK',
        daysAgo: 74,
        description: 'Akşam yemeği',
        merchant: 'Karaköy Lokantası',
        amount: 480,
        vat: 44,
      },
    ],
  },
  {
    employeeNo: 'PRS-000006',
    title: 'Kocaeli tedarikçi denetimi',
    status: 'PAID',
    createdDaysAgo: 112,
    decidedDaysAgo: 111,
    paidDaysAgo: 110,
    account: 'BNK-TL',
    lines: [
      { category: 'HARCIRAH', daysAgo: 114, description: 'Gebze, 1 gün', quantity: 1 },
      { category: 'KM', daysAgo: 114, description: 'Ofis – Gebze OSB – ofis', quantity: 220 },
      {
        category: 'TELEFON',
        daysAgo: 114,
        description: 'Mobil veri paketi',
        merchant: 'Turkcell',
        amount: 150,
      },
    ],
  },
];

/**
 * Expense demo: categories (receipt, per diem, mileage), reports in every status with their
 * approval history, reimbursements from the cash / bank accounts and generated PDF receipts when
 * object storage is reachable.
 */
export async function seedExpenses(prisma: PrismaClient, ctx: ExpenseSeedContext) {
  const { companyId, adminId, managerRoleId } = ctx;

  const definition = await prisma.workflowDefinition.upsert({
    where: { companyId_code: { companyId, code: 'EXPENSE_REPORT' } },
    create: {
      companyId,
      code: 'EXPENSE_REPORT',
      name: 'Masraf Formu Onayı',
      entityType: 'ExpenseReport',
      description: 'Yönetici onaylar; onaylanan masraflar finans tarafından ödenir',
      steps: {
        create: [
          { order: 1, name: 'Yönetici Onayı', approverType: 'ROLE', approverRoleId: managerRoleId },
        ],
      },
    },
    update: {},
  });

  for (const category of CATEGORIES) {
    await prisma.expenseCategory.upsert({
      where: { companyId_code: { companyId, code: category.code } },
      create: {
        companyId,
        code: category.code,
        name: category.name,
        kind: category.kind ?? 'RECEIPT',
        rate: category.rate ?? null,
        limitAmount: category.limitAmount ?? null,
        requiresReceipt:
          (category.kind ?? 'RECEIPT') === 'RECEIPT' && category.requiresReceipt !== false,
      },
      update: {},
    });
  }
  if (await prisma.expenseReport.count({ where: { companyId } })) return;

  const categories = await prisma.expenseCategory.findMany({ where: { companyId } });
  const byCode = new Map(categories.map((c) => [c.code, c]));
  const employees = new Map(
    (await prisma.employee.findMany({ where: { companyId } })).map((e) => [e.employeeNo, e]),
  );
  const accounts = new Map(
    (await prisma.treasuryAccount.findMany({ where: { companyId } })).map((a) => [a.code, a]),
  );
  const rates = new Map<string, Prisma.Decimal>();
  for (const code of ['EUR', 'USD']) {
    const rate = await prisma.exchangeRate.findFirst({
      where: { currencyCode: code },
      orderBy: { rateDate: 'desc' },
    });
    if (rate) rates.set(code, rate.selling);
  }
  const managerUser = await prisma.userRole.findFirst({
    where: { companyId, roleId: managerRoleId },
    select: { userId: true },
  });
  const approverId = managerUser?.userId ?? adminId;
  const storage = await receiptStorage();

  const next = async () => {
    const seq = await prisma.numberSequence.update({
      where: { companyId_code: { companyId, code: 'EXPENSE_REPORT' } },
      data: { nextValue: { increment: 1 } },
    });
    return formatNumber(seq, YEAR, seq.nextValue - 1);
  };

  for (const report of REPORTS) {
    const employee = employees.get(report.employeeNo);
    if (!employee) continue;
    const ownerId = employee.userId ?? adminId;
    const number = await next();
    const lines = [];
    for (const [index, line] of report.lines.entries()) {
      const category = byCode.get(line.category)!;
      const currencyCode = line.currency ?? 'TRY';
      const exchangeRate = currencyCode === 'TRY' ? new Prisma.Decimal(1) : rates.get(currencyCode);
      if (!exchangeRate) continue;
      const amounts = lineAmounts(category, {
        quantity: line.quantity,
        amount: line.amount,
        exchangeRate,
      });
      const receiptFileId =
        category.kind === 'RECEIPT' && storage
          ? await storage.upload(prisma, companyId, ownerId, line, amounts.amount, currencyCode)
          : null;
      lines.push({
        lineNo: index + 1,
        categoryId: category.id,
        expenseDate: daysAgo(line.daysAgo),
        description: line.description,
        merchant: line.merchant ?? null,
        quantity: amounts.quantity,
        amount: amounts.amount,
        vatAmount: line.vat ?? 0,
        currencyCode,
        exchangeRate,
        amountBase: amounts.amountBase,
        receiptFileId,
      });
    }
    const total = lines.reduce((sum, l) => sum.plus(l.amountBase), new Prisma.Decimal(0));
    const submitted = report.status !== 'DRAFT';
    const decided =
      report.decidedDaysAgo === undefined ? null : atDaysAgo(report.decidedDaysAgo, 15);
    const paid = report.paidDaysAgo !== undefined;
    const account = report.account ? accounts.get(report.account) : undefined;

    const instance = submitted
      ? await prisma.workflowInstance.create({
          data: {
            companyId,
            definitionId: definition.id,
            entityType: 'ExpenseReport',
            entityId: number,
            title: `${number} — ${employee.firstName} ${employee.lastName}: ${report.title}`,
            status:
              report.status === 'PENDING'
                ? WorkflowStatus.PENDING
                : report.status === 'REJECTED'
                  ? WorkflowStatus.REJECTED
                  : WorkflowStatus.APPROVED,
            currentStepOrder: 1,
            startedById: ownerId,
            startedAt: atDaysAgo(report.createdDaysAgo, 10),
            completedAt: decided,
            actions: {
              create: [
                {
                  stepOrder: 0,
                  type: WorkflowActionType.START,
                  userId: ownerId,
                  createdAt: atDaysAgo(report.createdDaysAgo, 10),
                },
                ...(decided
                  ? [
                      {
                        stepOrder: 1,
                        type:
                          report.status === 'REJECTED'
                            ? WorkflowActionType.REJECT
                            : WorkflowActionType.APPROVE,
                        userId: approverId,
                        comment: report.rejectReason ?? null,
                        createdAt: decided,
                      },
                    ]
                  : []),
              ],
            },
          },
        })
      : null;

    const created = await prisma.expenseReport.create({
      data: {
        companyId,
        number,
        employeeId: employee.id,
        title: report.title,
        description: report.description ?? null,
        status: report.status,
        totalAmount: total,
        workflowInstanceId: instance?.id ?? null,
        submittedAt: submitted ? atDaysAgo(report.createdDaysAgo, 10) : null,
        decidedAt: decided,
        paymentAccountId: paid ? (account?.id ?? null) : null,
        paymentDate: paid ? daysAgo(report.paidDaysAgo!) : null,
        paidAt: paid ? atDaysAgo(report.paidDaysAgo!, 11) : null,
        paidById: paid ? adminId : null,
        createdById: ownerId,
        createdAt: atDaysAgo(report.createdDaysAgo, 9),
        lines: { createMany: { data: lines } },
      },
    });
    const receiptIds = lines.map((l) => l.receiptFileId).filter((id): id is string => !!id);
    if (receiptIds.length) {
      await prisma.fileObject.updateMany({
        where: { id: { in: receiptIds } },
        data: { entityId: created.id },
      });
    }
    if (paid && account) {
      await prisma.treasuryTransaction.create({
        data: {
          companyId,
          accountId: account.id,
          txDate: daysAgo(report.paidDaysAgo!),
          documentType: TreasuryDocumentType.EXPENSE_PAYMENT,
          documentId: created.id,
          documentNumber: number,
          description: `Masraf ödemesi: ${employee.firstName} ${employee.lastName} — ${report.title}`,
          amountOut: total,
          createdById: adminId,
          createdAt: atDaysAgo(report.paidDaysAgo!, 11),
        },
      });
    }
    if (report.status === 'PENDING') {
      await prisma.notification.create({
        data: {
          userId: approverId,
          companyId,
          type: 'workflow.approval_requested',
          title: 'Onayınızı bekleyen talep',
          body: `"${number} — ${report.title}" — Yönetici Onayı`,
          link: instance ? `/workflow/instances/${instance.id}` : '/workflow/inbox',
        },
      });
    }
  }
}

/** Uploads generated receipt PDFs when object storage answers; the seed works without it. */
async function receiptStorage() {
  config({ quiet: true });
  const { S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY || !S3_BUCKET) return null;
  const client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }), {
      abortSignal: AbortSignal.timeout(3000),
    });
  } catch {
    return null;
  }
  return {
    async upload(
      prisma: PrismaClient,
      companyId: string,
      userId: string,
      line: SeedLine,
      amount: Prisma.Decimal,
      currency: string,
    ): Promise<string> {
      const date = daysAgo(line.daysAgo);
      const body = receiptPdf([
        (line.merchant ?? 'MAGAZA').toUpperCase(),
        '------------------------------',
        `TARIH: ${date.toISOString().slice(0, 10)}`,
        `FIS NO: ${String(Math.floor(Math.random() * 9000) + 1000)}`,
        '',
        line.description,
        '',
        `KDV:    ${(line.vat ?? 0).toFixed(2)} ${currency}`,
        `TOPLAM: ${amount.toFixed(2)} ${currency}`,
        '------------------------------',
        'TESEKKUR EDERIZ',
      ]);
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const key = `${companyId}/${date.getUTCFullYear()}/${month}/${randomUUID()}.pdf`;
      await client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: 'application/pdf',
        }),
      );
      const file = await prisma.fileObject.create({
        data: {
          companyId,
          storageKey: key,
          originalName: `fis-${slug(line.merchant ?? line.description)}.pdf`,
          mimeType: 'application/pdf',
          size: body.length,
          entityType: 'ExpenseReceipt',
          uploadedById: userId,
        },
      });
      return file.id;
    },
  };
}

const ASCII: Record<string, string> = {
  ç: 'c',
  Ç: 'C',
  ğ: 'g',
  Ğ: 'G',
  ı: 'i',
  İ: 'I',
  ö: 'o',
  Ö: 'O',
  ş: 's',
  Ş: 'S',
  ü: 'u',
  Ü: 'U',
  '–': '-',
  '—': '-',
};
const ascii = (text: string) => text.replace(/[^\x20-\x7e]/g, (c) => ASCII[c] ?? '?');
const slug = (text: string) =>
  ascii(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

/** A one-page till receipt in a standard PDF font (ASCII only). */
function receiptPdf(lines: string[]): Buffer {
  const escape = (text: string) => ascii(text).replace(/[\\()]/g, (c) => `\\${c}`);
  const height = 60 + lines.length * 14;
  const text = [
    'BT',
    '/F1 9 Tf',
    '14 TL',
    `16 ${height - 30} Td`,
    ...lines.map((line, i) => `${i ? 'T* ' : ''}(${escape(line)}) Tj`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 230 ${height}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
