import {
  ApplicationActivityType,
  ApplicationStage,
  CandidateSource,
  InterviewRecommendation,
  InterviewStatus,
  InterviewType,
  JobOfferStatus,
  JobPostingStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { formatNumber } from '../src/modules/numbering/number-format';
import { ACTIVE_STAGES } from '../src/modules/recruitment/recruitment-math';

const DAY_MS = 86_400_000;
const now = new Date();
const YEAR = now.getFullYear();
/** `days` from today at `hour` o'clock Istanbul time (UTC+3). */
const at = (days: number, hour = 10) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  d.setUTCHours(hour - 3, 0, 0, 0);
  return d;
};
const dateOnly = (days: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));

const OFFERED_AT = at(-6, 15);

interface RecruitmentSeedContext {
  companyId: string;
  adminId: string;
  branchId: string;
}

interface PostingSeed {
  key: string;
  title: string;
  department: string;
  position: string;
  manager: string;
  status: JobPostingStatus;
  openings: number;
  salary: [number, number];
  location: string;
  publishedDaysAgo: number | null;
  closesInDays: number | null;
  description: string;
  requirements: string;
}

const POSTINGS: PostingSeed[] = [
  {
    key: 'dev',
    title: 'Kıdemli Yazılım Geliştirici',
    department: 'BT',
    position: 'YAZ',
    manager: 'PRS-000002',
    status: JobPostingStatus.OPEN,
    openings: 2,
    salary: [110_000, 150_000],
    location: 'İstanbul (hibrit)',
    publishedDaysAgo: 42,
    closesInDays: 30,
    description:
      'ERP ürünümüzün API ve web katmanlarında uçtan uca özellik geliştirecek takım arkadaşları arıyoruz.',
    requirements:
      '5+ yıl TypeScript deneyimi\nNode.js (NestJS) ve React\nPostgreSQL, ilişkisel modelleme\nTest yazma alışkanlığı',
  },
  {
    key: 'sales',
    title: 'Satış Temsilcisi',
    department: 'SAT',
    position: 'SAT-TEM',
    manager: 'PRS-000005',
    status: JobPostingStatus.OPEN,
    openings: 1,
    salary: [55_000, 70_000],
    location: 'İstanbul',
    publishedDaysAgo: 24,
    closesInDays: 21,
    description:
      'Kurumsal müşteri portföyümüzü büyütecek, saha ziyaretlerine açık satış temsilcisi.',
    requirements:
      '2+ yıl B2B satış deneyimi\nB sınıfı ehliyet\nİyi derecede İngilizce tercih sebebi',
  },
  {
    key: 'acc',
    title: 'Muhasebe Uzmanı',
    department: 'FIN',
    position: 'MUH',
    manager: 'PRS-000004',
    status: JobPostingStatus.ON_HOLD,
    openings: 1,
    salary: [60_000, 75_000],
    location: 'İstanbul',
    publishedDaysAgo: 65,
    closesInDays: null,
    description: 'Genel muhasebe, KDV beyannameleri ve ay sonu kapanış süreçlerinde görev alacak.',
    requirements:
      'SMMM stajyerliği veya ruhsatı\n3+ yıl genel muhasebe deneyimi\nLogo veya benzeri ERP',
  },
  {
    key: 'hr',
    title: 'İK Uzmanı (Bordro)',
    department: 'IK',
    position: 'IK-UZM',
    manager: 'PRS-000003',
    status: JobPostingStatus.DRAFT,
    openings: 1,
    salary: [50_000, 62_000],
    location: 'İstanbul',
    publishedDaysAgo: null,
    closesInDays: null,
    description: 'Bordro, SGK bildirgeleri ve özlük işlemlerinden sorumlu İK uzmanı.',
    requirements: '3+ yıl bordro deneyimi\nSGK ve vergi mevzuatı bilgisi',
  },
];

/** [first, last, source, title, company, city, expected salary, referred by]. */
type CandidateSeed = [
  string,
  string,
  CandidateSource,
  string,
  string,
  string,
  number,
  string | null,
];

const CANDIDATES: Record<string, CandidateSeed> = {
  oguz: [
    'Oğuz',
    'Tan',
    CandidateSource.LINKEDIN,
    'Senior Software Engineer',
    'Trendyol',
    'İstanbul',
    140_000,
    null,
  ],
  ceren: [
    'Ceren',
    'Aktaş',
    CandidateSource.REFERRAL,
    'Full Stack Developer',
    'Param',
    'İstanbul',
    125_000,
    'PRS-000007',
  ],
  baris: [
    'Barış',
    'Güneş',
    CandidateSource.CAREER_SITE,
    'Backend Developer',
    'Insider',
    'Kocaeli',
    120_000,
    null,
  ],
  gizem: [
    'Gizem',
    'Uçar',
    CandidateSource.JOB_BOARD,
    'Frontend Developer',
    'Getir',
    'İstanbul',
    115_000,
    null,
  ],
  tolga: [
    'Tolga',
    'Er',
    CandidateSource.LINKEDIN,
    'Software Developer',
    'Logo Yazılım',
    'İzmir',
    110_000,
    null,
  ],
  irem: [
    'İrem',
    'Sezer',
    CandidateSource.REFERRAL,
    'Software Engineer',
    'Peak Games',
    'İstanbul',
    130_000,
    'PRS-000008',
  ],
  serkan: [
    'Serkan',
    'Bulut',
    CandidateSource.JOB_BOARD,
    'Junior Developer',
    'Serbest',
    'Ankara',
    80_000,
    null,
  ],
  ece: [
    'Ece',
    'Yalçın',
    CandidateSource.LINKEDIN,
    'Kurumsal Satış Uzmanı',
    'Turkcell',
    'İstanbul',
    65_000,
    null,
  ],
  kaan: [
    'Kaan',
    'Özkan',
    CandidateSource.JOB_BOARD,
    'Satış Temsilcisi',
    'Koçtaş',
    'İstanbul',
    58_000,
    null,
  ],
  melis: [
    'Melis',
    'Kara',
    CandidateSource.CAREER_SITE,
    'Müşteri Temsilcisi',
    'Garanti BBVA',
    'İstanbul',
    55_000,
    null,
  ],
  onur: [
    'Onur',
    'Acar',
    CandidateSource.AGENCY,
    'Bölge Satış Sorumlusu',
    'Arçelik',
    'Bursa',
    72_000,
    null,
  ],
  derya: [
    'Derya',
    'Akın',
    CandidateSource.JOB_BOARD,
    'Muhasebe Uzmanı',
    'Deloitte',
    'İstanbul',
    68_000,
    null,
  ],
  hande: [
    'Hande',
    'Çetin',
    CandidateSource.CAREER_SITE,
    'Muhasebe Uzman Yardımcısı',
    'Mavi',
    'İstanbul',
    60_000,
    null,
  ],
  yasin: [
    'Yasin',
    'Turan',
    CandidateSource.JOB_BOARD,
    'Lojistik Sorumlusu',
    'Aras Kargo',
    'İstanbul',
    40_000,
    null,
  ],
};

interface InterviewSeed {
  type: InterviewType;
  days: number;
  hour: number;
  location: string;
  /** Employee number → feedback, or null while it is pending. */
  panel: Record<string, [number, InterviewRecommendation, string] | null>;
  cancelled?: boolean;
}

interface ApplicationSeed {
  posting: string;
  candidate: string;
  stage: ApplicationStage;
  /** Stage it left when rejected or withdrawn, and when. */
  leftAt?: ApplicationStage;
  leftDaysAgo?: number;
  appliedDaysAgo: number;
  rating?: number;
  rejectReason?: string;
  note?: string;
  interviews?: InterviewSeed[];
  offer?: { status: JobOfferStatus; salary: number; startInDays: number; expiresInDays: number };
}

const APPLICATIONS: ApplicationSeed[] = [
  {
    posting: 'dev',
    candidate: 'oguz',
    stage: ApplicationStage.OFFER,
    appliedDaysAgo: 38,
    rating: 5,
    note: 'Mikroservis ve ölçekleme deneyimi çok güçlü.',
    interviews: [
      {
        type: InterviewType.PHONE,
        days: -30,
        hour: 11,
        location: 'Telefon',
        panel: {
          'PRS-000002': [4, InterviewRecommendation.YES, 'İletişimi net, beklentileri uyumlu.'],
        },
      },
      {
        type: InterviewType.TECHNICAL,
        days: -21,
        hour: 14,
        location: 'Toplantı Odası 2',
        panel: {
          'PRS-000002': [5, InterviewRecommendation.STRONG_YES, 'Sistem tasarımında çok iyi.'],
          'PRS-000007': [5, InterviewRecommendation.STRONG_YES, 'Canlı kodlamada temiz ve hızlı.'],
        },
      },
    ],
    offer: { status: JobOfferStatus.ACCEPTED, salary: 138_000, startInDays: 18, expiresInDays: 4 },
  },
  {
    posting: 'dev',
    candidate: 'ceren',
    stage: ApplicationStage.OFFER,
    appliedDaysAgo: 33,
    rating: 4,
    interviews: [
      {
        type: InterviewType.TECHNICAL,
        days: -16,
        hour: 10,
        location: 'https://meet.enterprisepulse.dev/ceren',
        panel: {
          'PRS-000002': [4, InterviewRecommendation.YES, 'React tarafı çok güçlü, backend orta.'],
          'PRS-000007': [4, InterviewRecommendation.YES, 'Takıma hızlı uyum sağlar.'],
        },
      },
    ],
    offer: { status: JobOfferStatus.PENDING, salary: 122_000, startInDays: 30, expiresInDays: 6 },
  },
  {
    posting: 'dev',
    candidate: 'baris',
    stage: ApplicationStage.INTERVIEW,
    appliedDaysAgo: 26,
    rating: 4,
    interviews: [
      {
        type: InterviewType.PHONE,
        days: -9,
        hour: 15,
        location: 'Telefon',
        panel: { 'PRS-000002': [4, InterviewRecommendation.YES, 'Teknik mülakata geçebilir.'] },
      },
      {
        type: InterviewType.TECHNICAL,
        days: 2,
        hour: 14,
        location: 'Toplantı Odası 2',
        panel: { 'PRS-000002': null, 'PRS-000007': null },
      },
    ],
  },
  {
    posting: 'dev',
    candidate: 'gizem',
    stage: ApplicationStage.INTERVIEW,
    appliedDaysAgo: 20,
    rating: 3,
    interviews: [
      {
        type: InterviewType.VIDEO,
        days: -3,
        hour: 11,
        location: 'https://meet.enterprisepulse.dev/gizem',
        panel: {
          'PRS-000002': [3, InterviewRecommendation.YES, 'Arayüz tarafı iyi, test deneyimi az.'],
          'PRS-000007': null,
        },
      },
    ],
  },
  { posting: 'dev', candidate: 'tolga', stage: ApplicationStage.SCREENING, appliedDaysAgo: 9 },
  {
    posting: 'dev',
    candidate: 'irem',
    stage: ApplicationStage.APPLIED,
    appliedDaysAgo: 2,
    note: 'Elif Şahin tarafından önerildi.',
  },
  {
    posting: 'dev',
    candidate: 'serkan',
    stage: ApplicationStage.REJECTED,
    leftAt: ApplicationStage.SCREENING,
    leftDaysAgo: 30,
    appliedDaysAgo: 35,
    rejectReason: 'Deneyim seviyesi kıdemli pozisyon için yetersiz.',
  },
  {
    posting: 'sales',
    candidate: 'ece',
    stage: ApplicationStage.INTERVIEW,
    appliedDaysAgo: 18,
    rating: 4,
    interviews: [
      {
        type: InterviewType.ONSITE,
        days: 1,
        hour: 11,
        location: 'Merkez Ofis, 3. kat',
        panel: { 'PRS-000005': null, 'PRS-000002': null },
      },
    ],
  },
  { posting: 'sales', candidate: 'kaan', stage: ApplicationStage.SCREENING, appliedDaysAgo: 12 },
  { posting: 'sales', candidate: 'melis', stage: ApplicationStage.APPLIED, appliedDaysAgo: 4 },
  {
    posting: 'sales',
    candidate: 'onur',
    stage: ApplicationStage.WITHDRAWN,
    leftAt: ApplicationStage.INTERVIEW,
    leftDaysAgo: 10,
    appliedDaysAgo: 22,
    note: 'Mevcut şirketinden karşı teklif aldığını bildirdi.',
    interviews: [
      {
        type: InterviewType.PHONE,
        days: -14,
        hour: 16,
        location: 'Telefon',
        panel: { 'PRS-000005': [4, InterviewRecommendation.YES, 'Saha deneyimi güçlü.'] },
      },
    ],
  },
  { posting: 'acc', candidate: 'derya', stage: ApplicationStage.SCREENING, appliedDaysAgo: 55 },
  { posting: 'acc', candidate: 'hande', stage: ApplicationStage.APPLIED, appliedDaysAgo: 48 },
];

/** Days ago of the candidate's first application (today for the pool-only ones). */
const firstApplied = (candidate: string) =>
  Math.max(
    0,
    ...APPLICATIONS.filter((a) => a.candidate === candidate).map((a) => a.appliedDaysAgo),
  );

/** Interviews are scheduled four days ahead. */
const scheduledOn = (interview: InterviewSeed) =>
  new Date(at(interview.days, interview.hour).getTime() - 4 * DAY_MS);

/** When the application entered each stage: anchored stages keep their date, the rest are spread. */
function stageTimes(
  path: ApplicationStage[],
  appliedAt: Date,
  end: Date,
  anchors: Partial<Record<ApplicationStage, Date | undefined>>,
): Date[] {
  const times: (Date | null)[] = path.map((stage, i) => (i ? (anchors[stage] ?? null) : appliedAt));
  for (let i = 1; i < times.length; i++) {
    if (times[i]) continue;
    let next = i + 1;
    while (next < times.length && !times[next]) next++;
    const from = times[i - 1]!.getTime();
    const to = (next < times.length ? times[next]! : end).getTime();
    times[i] = new Date(from + (to - from) / (next - i + 1));
  }
  return times as Date[];
}

/**
 * Recruitment demo: open postings with a full pipeline (interviews with feedback, an accepted
 * offer ready to hire, a pending offer, upcoming interviews for Deniz and Kerem) and last
 * year's closed logistics posting that hired Can Kurt.
 */
export async function seedRecruitment(prisma: PrismaClient, ctx: RecruitmentSeedContext) {
  const { companyId, adminId, branchId } = ctx;
  if (await prisma.jobPosting.count({ where: { companyId } })) return;

  const [departments, positions, employees] = await Promise.all([
    prisma.department.findMany({ where: { companyId }, select: { id: true, code: true } }),
    prisma.position.findMany({ where: { companyId }, select: { id: true, code: true } }),
    prisma.employee.findMany({
      where: { companyId },
      select: { id: true, employeeNo: true, email: true, phone: true, hireDate: true },
    }),
  ]);
  const departmentId = (code: string) => departments.find((d) => d.code === code)?.id ?? null;
  const positionId = (code: string) => positions.find((p) => p.code === code)?.id ?? null;
  const employee = (no: string) => employees.find((e) => e.employeeNo === no);

  const activity = (
    applicationId: string,
    createdAt: Date,
    data: {
      type: ApplicationActivityType;
      fromStage?: ApplicationStage | null;
      toStage?: ApplicationStage | null;
      body?: string | null;
    },
  ) =>
    prisma.applicationActivity.create({
      data: { applicationId, createdById: adminId, createdAt, ...data },
    });

  const postings = new Map<string, string>();
  for (const seed of POSTINGS) {
    const seq = await prisma.numberSequence.update({
      where: { companyId_code: { companyId, code: 'JOB_POSTING' } },
      data: { nextValue: { increment: 1 }, currentYear: YEAR },
    });
    const row = await prisma.jobPosting.create({
      data: {
        companyId,
        number: formatNumber(seq, YEAR, seq.nextValue - 1),
        title: seed.title,
        departmentId: departmentId(seed.department),
        positionId: positionId(seed.position),
        branchId,
        location: seed.location,
        description: seed.description,
        requirements: seed.requirements,
        openings: seed.openings,
        status: seed.status,
        hiringManagerId: employee(seed.manager)?.id ?? null,
        salaryMin: seed.salary[0],
        salaryMax: seed.salary[1],
        publishedAt: seed.publishedDaysAgo === null ? null : at(-seed.publishedDaysAgo, 9),
        closesAt: seed.closesInDays === null ? null : dateOnly(seed.closesInDays),
        createdById: adminId,
        createdAt: at(-(seed.publishedDaysAgo ?? 3) - 2, 9),
      },
    });
    postings.set(seed.key, row.id);
  }

  const candidates = new Map<string, string>();
  for (const [
    key,
    [firstName, lastName, source, title, company, city, salary, referrer],
  ] of Object.entries(CANDIDATES)) {
    const email = `${key}.${lastName}`
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i');
    const row = await prisma.candidate.create({
      data: {
        companyId,
        firstName,
        lastName,
        email: `${email}@example.com`,
        phone: `+90 5${String(30 + candidates.size).padStart(2, '0')} 555 ${String(1000 + candidates.size * 37).slice(0, 4)}`,
        city,
        source,
        currentTitle: title,
        currentCompany: company,
        linkedinUrl:
          source === CandidateSource.LINKEDIN
            ? `https://www.linkedin.com/in/${email.replace('.', '-')}`
            : null,
        expectedSalary: salary,
        referredById: referrer ? (employee(referrer)?.id ?? null) : null,
        createdById: adminId,
        createdAt: at(-firstApplied(key), 8),
      },
    });
    candidates.set(key, row.id);
  }

  const sortOrders = new Map<string, number>();
  for (const seed of APPLICATIONS) {
    const postingId = postings.get(seed.posting)!;
    const appliedAt = at(-seed.appliedDaysAgo, 9);
    const leftAt = seed.leftDaysAgo === undefined ? null : at(-seed.leftDaysAgo, 16);
    const path = ACTIVE_STAGES.slice(0, ACTIVE_STAGES.indexOf(seed.leftAt ?? seed.stage) + 1);
    const times = stageTimes(path, appliedAt, leftAt ?? now, {
      [ApplicationStage.INTERVIEW]: seed.interviews?.[0] && scheduledOn(seed.interviews[0]),
      [ApplicationStage.OFFER]: seed.offer && OFFERED_AT,
    });
    const columnKey = `${postingId}:${seed.stage}`;
    const sortOrder = sortOrders.get(columnKey) ?? 0;
    sortOrders.set(columnKey, sortOrder + 1);

    const app = await prisma.jobApplication.create({
      data: {
        companyId,
        postingId,
        candidateId: candidates.get(seed.candidate)!,
        stage: seed.stage,
        rating: seed.rating ?? null,
        sortOrder,
        appliedAt,
        stageChangedAt: leftAt ?? times[times.length - 1],
        rejectReason: seed.rejectReason ?? null,
        createdById: adminId,
        createdAt: appliedAt,
      },
    });
    for (const [index, stage] of path.entries()) {
      await activity(app.id, times[index], {
        type: ApplicationActivityType.STAGE,
        fromStage: index ? path[index - 1] : null,
        toStage: stage,
      });
    }
    if (seed.note) {
      await activity(app.id, new Date(appliedAt.getTime() + 3_600_000), {
        type: ApplicationActivityType.NOTE,
        body: seed.note,
      });
    }
    for (const interview of seed.interviews ?? []) {
      const scheduledAt = at(interview.days, interview.hour);
      const feedback = Object.values(interview.panel);
      const status = interview.cancelled
        ? InterviewStatus.CANCELLED
        : feedback.every(Boolean)
          ? InterviewStatus.COMPLETED
          : InterviewStatus.SCHEDULED;
      await prisma.interview.create({
        data: {
          companyId,
          applicationId: app.id,
          type: interview.type,
          status,
          scheduledAt,
          durationMinutes: interview.type === InterviewType.PHONE ? 30 : 60,
          location: interview.location,
          createdById: adminId,
          createdAt: scheduledOn(interview),
          participants: {
            create: Object.entries(interview.panel).map(([no, answer]) => ({
              employeeId: employee(no)!.id,
              rating: answer?.[0] ?? null,
              recommendation: answer?.[1] ?? null,
              feedback: answer?.[2] ?? null,
              submittedAt: answer ? new Date(scheduledAt.getTime() + 3 * 3_600_000) : null,
            })),
          },
        },
      });
      await activity(app.id, scheduledOn(interview), {
        type: ApplicationActivityType.INTERVIEW,
        body: InterviewStatus.SCHEDULED,
      });
      if (status === InterviewStatus.COMPLETED) {
        await activity(app.id, new Date(scheduledAt.getTime() + 3 * 3_600_000), {
          type: ApplicationActivityType.INTERVIEW,
          body: InterviewStatus.COMPLETED,
        });
      }
    }
    if (seed.offer) {
      const offeredAt = OFFERED_AT;
      await prisma.jobOffer.create({
        data: {
          companyId,
          applicationId: app.id,
          grossSalary: seed.offer.salary,
          startDate: dateOnly(seed.offer.startInDays),
          expiresAt: dateOnly(seed.offer.expiresInDays),
          status: seed.offer.status,
          respondedAt: seed.offer.status === JobOfferStatus.PENDING ? null : at(-2, 12),
          createdById: adminId,
          createdAt: offeredAt,
        },
      });
      await activity(app.id, offeredAt, {
        type: ApplicationActivityType.OFFER,
        body: JobOfferStatus.PENDING,
      });
      if (seed.offer.status !== JobOfferStatus.PENDING) {
        await activity(app.id, at(-2, 12), {
          type: ApplicationActivityType.OFFER,
          body: seed.offer.status,
        });
      }
    }
    if (seed.leftAt && leftAt) {
      await activity(app.id, leftAt, {
        type: ApplicationActivityType.STAGE,
        fromStage: seed.leftAt,
        toStage: seed.stage,
        body: seed.rejectReason ?? null,
      });
    }
  }

  await seedClosedPosting(prisma, ctx, {
    departmentId: departmentId('OPS'),
    positionId: positionId('LOJ'),
    manager: employee('PRS-000006')?.id ?? null,
    hired: employee('PRS-000015'),
  });
}

/** Last year's logistics posting: Can Kurt was hired through it, another candidate was rejected. */
async function seedClosedPosting(
  prisma: PrismaClient,
  { companyId, adminId, branchId }: RecruitmentSeedContext,
  refs: {
    departmentId: string | null;
    positionId: string | null;
    manager: string | null;
    hired?: {
      id: string;
      employeeNo: string;
      email: string | null;
      phone: string | null;
      hireDate: Date;
    };
  },
) {
  const { hired } = refs;
  if (!hired) return;
  const hireDate = hired.hireDate;
  const day = (offset: number) => new Date(hireDate.getTime() + offset * DAY_MS);
  const year = hireDate.getUTCFullYear();
  const seq = await prisma.numberSequence.update({
    where: { companyId_code: { companyId, code: 'JOB_POSTING' } },
    data: { nextValue: { increment: year === YEAR ? 1 : 0 } },
  });
  const posting = await prisma.jobPosting.create({
    data: {
      companyId,
      number: formatNumber(seq, year, year === YEAR ? seq.nextValue - 1 : 1),
      title: 'Lojistik Uzmanı',
      departmentId: refs.departmentId,
      positionId: refs.positionId,
      branchId,
      location: 'İstanbul',
      description: 'Depo ve sevkiyat planlamasında görev alacak lojistik uzmanı.',
      requirements: '2+ yıl depo/sevkiyat deneyimi\nWMS kullanımı',
      openings: 1,
      status: JobPostingStatus.CLOSED,
      hiringManagerId: refs.manager,
      salaryMin: 30_000,
      salaryMax: 38_000,
      publishedAt: day(-60),
      closesAt: day(-20),
      closedAt: day(-14),
      createdById: adminId,
      createdAt: day(-62),
    },
  });

  const can = await prisma.candidate.create({
    data: {
      companyId,
      firstName: 'Can',
      lastName: 'Kurt',
      email: hired.email ?? 'can.kurt@example.com',
      phone: hired.phone,
      city: 'İstanbul',
      source: CandidateSource.CAREER_SITE,
      currentTitle: 'Depo Sorumlusu',
      currentCompany: 'MNG Kargo',
      expectedSalary: 34_000,
      createdById: adminId,
      createdAt: day(-50),
    },
  });
  const yasin = await prisma.candidate.update({
    where: { companyId_email: { companyId, email: 'yasin.turan@example.com' } },
    data: { createdAt: day(-48) },
  });

  const hiredApp = await prisma.jobApplication.create({
    data: {
      companyId,
      postingId: posting.id,
      candidateId: can.id,
      stage: ApplicationStage.HIRED,
      rating: 4,
      appliedAt: day(-50),
      stageChangedAt: day(-14),
      hiredAt: day(-14),
      employeeId: hired.id,
      createdById: adminId,
      createdAt: day(-50),
    },
  });
  const rejectedApp = await prisma.jobApplication.create({
    data: {
      companyId,
      postingId: posting.id,
      candidateId: yasin.id,
      stage: ApplicationStage.REJECTED,
      rating: 2,
      appliedAt: day(-48),
      stageChangedAt: day(-30),
      rejectReason: 'Mülakat sonrası beklentiler uyuşmadı.',
      createdById: adminId,
      createdAt: day(-48),
    },
  });
  const interviewer = refs.manager;
  for (const [app, days, answer] of [
    [hiredApp.id, -35, [4, InterviewRecommendation.YES, 'Saha tecrübesi iyi, hemen başlayabilir.']],
    [rejectedApp.id, -33, [2, InterviewRecommendation.NO, 'WMS deneyimi yok.']],
  ] as const) {
    if (!interviewer) break;
    await prisma.interview.create({
      data: {
        companyId,
        applicationId: app,
        type: InterviewType.ONSITE,
        status: InterviewStatus.COMPLETED,
        scheduledAt: day(days),
        location: 'Depo, toplantı odası',
        createdById: adminId,
        createdAt: day(days - 4),
        participants: {
          create: {
            employeeId: interviewer,
            rating: answer[0],
            recommendation: answer[1],
            feedback: answer[2],
            submittedAt: day(days),
          },
        },
      },
    });
  }
  await prisma.jobOffer.create({
    data: {
      companyId,
      applicationId: hiredApp.id,
      grossSalary: 34_000,
      startDate: hireDate,
      expiresAt: day(-18),
      status: JobOfferStatus.ACCEPTED,
      respondedAt: day(-20),
      createdById: adminId,
      createdAt: day(-24),
    },
  });

  const steps: Prisma.ApplicationActivityUncheckedCreateInput[] = [];
  const log = (
    applicationId: string,
    createdAt: Date,
    type: ApplicationActivityType,
    fromStage: ApplicationStage | null,
    toStage: ApplicationStage | null,
    body: string | null = null,
  ) =>
    steps.push({ applicationId, createdAt, type, fromStage, toStage, body, createdById: adminId });
  const { STAGE, INTERVIEW, OFFER, HIRED } = ApplicationActivityType;
  const {
    APPLIED,
    SCREENING,
    INTERVIEW: AT_INTERVIEW,
    OFFER: AT_OFFER,
    REJECTED,
  } = ApplicationStage;
  log(hiredApp.id, day(-50), STAGE, null, APPLIED);
  log(hiredApp.id, day(-44), STAGE, APPLIED, SCREENING);
  log(hiredApp.id, day(-39), INTERVIEW, null, null, InterviewStatus.SCHEDULED);
  log(hiredApp.id, day(-39), STAGE, SCREENING, AT_INTERVIEW);
  log(hiredApp.id, day(-35), INTERVIEW, null, null, InterviewStatus.COMPLETED);
  log(hiredApp.id, day(-24), OFFER, null, null, JobOfferStatus.PENDING);
  log(hiredApp.id, day(-24), STAGE, AT_INTERVIEW, AT_OFFER);
  log(hiredApp.id, day(-20), OFFER, null, null, JobOfferStatus.ACCEPTED);
  log(hiredApp.id, day(-14), HIRED, AT_OFFER, ApplicationStage.HIRED, hired.employeeNo);
  log(rejectedApp.id, day(-48), STAGE, null, APPLIED);
  log(rejectedApp.id, day(-42), STAGE, APPLIED, SCREENING);
  log(rejectedApp.id, day(-37), INTERVIEW, null, null, InterviewStatus.SCHEDULED);
  log(rejectedApp.id, day(-37), STAGE, SCREENING, AT_INTERVIEW);
  log(rejectedApp.id, day(-33), INTERVIEW, null, null, InterviewStatus.COMPLETED);
  log(
    rejectedApp.id,
    day(-30),
    STAGE,
    AT_INTERVIEW,
    REJECTED,
    'Mülakat sonrası beklentiler uyuşmadı.',
  );
  await prisma.applicationActivity.createMany({ data: steps });
}
