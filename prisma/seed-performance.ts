import { PerformanceReviewStatus, ReviewCycleStatus, type PrismaClient } from '@prisma/client';
import {
  competencyScore,
  goalScore,
  overallScore,
} from '../src/modules/performance/performance-math';

const now = new Date();
const YEAR = now.getUTCFullYear();
const dateOnly = (days: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const at = (value: string, hour: number) =>
  new Date(`${value}T${String(hour - 3).padStart(2, '0')}:00:00.000Z`);

interface PerformanceSeedContext {
  companyId: string;
  adminId: string;
}

const COMPETENCIES: [string, string][] = [
  ['İletişim', 'Fikirlerini açık ifade eder, dinler ve zamanında bilgi paylaşır.'],
  ['Takım çalışması', 'Ortak hedefe katkı verir, ekip arkadaşlarına destek olur.'],
  ['Problem çözme', 'Sorunun kökünü bulur, veriye dayalı ve uygulanabilir çözüm üretir.'],
  ['Sorumluluk ve sahiplenme', 'Üstlendiği işi sonuna kadar takip eder, sözünü tutar.'],
  [
    'Müşteri odaklılık',
    'İç ve dış müşterinin ihtiyacını önceler, geri bildirime göre iyileştirir.',
  ],
  ['Gelişime açıklık', 'Geri bildirimi kabul eder, yeni beceriler edinmek için çaba gösterir.'],
  ['Liderlik', 'Yön gösterir, ekibini motive eder ve geliştirir.'],
];

const GOALS: Record<string, [string, string, string]> = {
  'Genel Müdür': [
    'Yıllık ciro hedefine ulaşmak',
    'İki yeni sektörde müşteri kazanmak',
    'Yönetim ekibinin gelişim planlarını tamamlamak',
  ],
  'BT Müdürü': [
    'Sistem erişilebilirliğini %99,9 seviyesinde tutmak',
    'Bulut maliyetlerini %15 azaltmak',
    'Ekip gelişim planlarını tamamlamak',
  ],
  'İK Müdürü': [
    'Çalışan bağlılığı anketini %80 katılımla tamamlamak',
    'İşe alım süresini 30 güne indirmek',
    'Performans sürecini dijitalleştirmek',
  ],
  'Finans Müdürü': [
    'Ay sonu kapanışını 5 iş gününe indirmek',
    'Nakit akışı tahmin doğruluğunu artırmak',
    'Bütçe sapmalarını aylık raporlamak',
  ],
  'Satış Müdürü': [
    'Bölge satış hedefini tutturmak',
    '10 yeni kurumsal müşteri kazanmak',
    "Teklif dönüşüm oranını %35'e çıkarmak",
  ],
  'Operasyon Müdürü': [
    "Zamanında teslim oranını %97'ye çıkarmak",
    'Depo sayım farklarını yarıya indirmek',
    'Tedarikçi performans karnesi kurmak',
  ],
  'Yazılım Geliştirici': [
    'Proje modülünü zamanında teslim etmek',
    "Birim test kapsamını %80'e çıkarmak",
    'Kod inceleme sürelerini kısaltmak',
  ],
  'Sistem Yöneticisi': [
    'Yedekten geri dönüş testlerini her ay yapmak',
    'Yama yönetimini otomatikleştirmek',
    'Destek taleplerini bir iş gününde kapatmak',
  ],
  'İK Uzmanı': [
    'Bordro hatalarını sıfırlamak',
    'Oryantasyon programını yenilemek',
    'Özlük dosyalarını dijitale taşımak',
  ],
  'Muhasebe Uzmanı': [
    'Cari hesap mutabakatlarını çeyrek sonunda tamamlamak',
    'Masraf onay süresini 3 güne indirmek',
    'Banka hareketlerini günlük eşleştirmek',
  ],
  'Satış Temsilcisi': [
    'Çeyreklik satış kotasını tutturmak',
    'Aylık müşteri ziyaretini 20 seviyesine çıkarmak',
    'CRM kayıtlarını eksiksiz tutmak',
  ],
  'Lojistik Uzmanı': [
    'Sevkiyat planlama hatalarını azaltmak',
    'Taşıma maliyetlerini %5 düşürmek',
    'Depo yerleşim düzenini iyileştirmek',
  ],
};
const WEIGHTS = [40, 35, 25];
const OFFSETS = [0, -1, 1, 0, -1, 0, 1, 0];

/** Overall level of each employee (by employee no) in the two cycles. */
const LEVELS: Record<string, [number, number]> = {
  'PRS-000001': [4, 4],
  'PRS-000002': [4, 4],
  'PRS-000003': [4, 4],
  'PRS-000004': [3, 4],
  'PRS-000005': [5, 5],
  'PRS-000006': [4, 4],
  'PRS-000007': [4, 4],
  'PRS-000008': [5, 4],
  'PRS-000009': [3, 3],
  'PRS-000010': [4, 4],
  'PRS-000011': [3, 3],
  'PRS-000012': [4, 5],
  'PRS-000013': [3, 3],
  'PRS-000014': [4, 4],
  'PRS-000015': [3, 4],
};

/** Stage of each review in the running mid-year cycle. */
const MID_YEAR: Record<string, PerformanceReviewStatus> = {
  'PRS-000001': PerformanceReviewStatus.SELF_REVIEW,
  'PRS-000002': PerformanceReviewStatus.SELF_REVIEW,
  'PRS-000003': PerformanceReviewStatus.MANAGER_REVIEW,
  'PRS-000004': PerformanceReviewStatus.COMPLETED,
  'PRS-000005': PerformanceReviewStatus.MANAGER_REVIEW,
  'PRS-000006': PerformanceReviewStatus.SELF_REVIEW,
  'PRS-000007': PerformanceReviewStatus.SELF_REVIEW,
  'PRS-000008': PerformanceReviewStatus.MANAGER_REVIEW,
  'PRS-000009': PerformanceReviewStatus.COMPLETED,
  'PRS-000010': PerformanceReviewStatus.COMPLETED,
  'PRS-000011': PerformanceReviewStatus.MANAGER_REVIEW,
  'PRS-000012': PerformanceReviewStatus.COMPLETED,
  'PRS-000013': PerformanceReviewStatus.SELF_REVIEW,
  'PRS-000014': PerformanceReviewStatus.COMPLETED,
  'PRS-000015': PerformanceReviewStatus.MANAGER_REVIEW,
};
/** Completed mid-year reviews the employee has not acknowledged yet. */
const NOT_ACKNOWLEDGED = new Set(['PRS-000009', 'PRS-000013']);

const FEEDBACK: Record<number, { manager: string; strengths: string; improvements: string }> = {
  5: {
    manager: 'Beklentilerin belirgin şekilde üzerinde bir dönem geçirdi; ekibine örnek oldu.',
    strengths: 'Sahiplenme, sonuç odaklılık ve ekip içi iletişim',
    improvements: 'Bilgi birikimini dokümantasyon ve eğitimlerle ekibe yayması',
  },
  4: {
    manager: 'Hedeflerinin büyük kısmını başarıyla tamamladı, işbirliğine açık ve güvenilir.',
    strengths: 'Planlı çalışma ve problem çözme',
    improvements: 'Paydaşlarla iletişimde daha proaktif olması',
  },
  3: {
    manager: 'Beklentileri karşıladı; bazı hedeflerde gecikmeler yaşandı.',
    strengths: 'Teknik bilgi ve özveri',
    improvements: 'Önceliklendirme ve zaman yönetimi',
  },
};

const clamp = (value: number) => Math.min(5, Math.max(1, value));

export async function seedPerformance(prisma: PrismaClient, ctx: PerformanceSeedContext) {
  const exists = await prisma.competency.count({ where: { companyId: ctx.companyId } });
  if (exists) return;

  await prisma.competency.createMany({
    data: COMPETENCIES.map(([name, description], index) => ({
      companyId: ctx.companyId,
      name,
      description,
      sortOrder: index + 1,
    })),
  });
  const competencies = await prisma.competency.findMany({
    where: { companyId: ctx.companyId },
    orderBy: { sortOrder: 'asc' },
  });
  const byName = new Map(competencies.map((c) => [c.name, c.id]));
  const pick = (names: string[]) => names.map((n) => byName.get(n)!);

  const employees = await prisma.employee.findMany({
    where: { companyId: ctx.companyId, deletedAt: null, status: 'ACTIVE' },
    select: {
      id: true,
      employeeNo: true,
      managerId: true,
      hireDate: true,
      position: { select: { name: true } },
    },
    orderBy: { employeeNo: 'asc' },
  });

  // ---------- Last year: closed, every review completed ----------
  const lastYear = YEAR - 1;
  const closedCompetencies = pick([
    'İletişim',
    'Takım çalışması',
    'Problem çözme',
    'Sorumluluk ve sahiplenme',
    'Gelişime açıklık',
  ]);
  const closed = await prisma.reviewCycle.create({
    data: {
      companyId: ctx.companyId,
      name: `${lastYear} Yıl Sonu Değerlendirmesi`,
      periodStart: day(`${lastYear}-01-01`),
      periodEnd: day(`${lastYear}-12-31`),
      selfReviewDue: day(`${YEAR}-01-16`),
      managerReviewDue: day(`${YEAR}-01-30`),
      goalWeight: 60,
      status: ReviewCycleStatus.CLOSED,
      launchedAt: at(`${YEAR}-01-05`, 9),
      closedAt: at(`${YEAR}-02-06`, 17),
      createdById: ctx.adminId,
      createdAt: at(`${lastYear}-12-22`, 11),
      competencies: { create: closedCompetencies.map((competencyId) => ({ competencyId })) },
    },
  });
  for (const [index, employee] of employees.entries()) {
    if (employee.hireDate > closed.periodEnd) continue;
    await createReview(prisma, {
      companyId: ctx.companyId,
      cycleId: closed.id,
      goalWeight: 60,
      employee,
      index,
      level: LEVELS[employee.employeeNo]?.[0] ?? 4,
      status: PerformanceReviewStatus.COMPLETED,
      competencyIds: closedCompetencies,
      selfSubmittedAt: at(`${YEAR}-01-${String(12 + (index % 4)).padStart(2, '0')}`, 16),
      managerSubmittedAt: at(`${YEAR}-01-${String(20 + (index % 8)).padStart(2, '0')}`, 15),
      acknowledgedAt: at(`${YEAR}-02-0${2 + (index % 3)}`, 10),
      progressDone: true,
    });
  }

  // ---------- Mid-year: running ----------
  const midCompetencies = pick([
    'İletişim',
    'Takım çalışması',
    'Problem çözme',
    'Sorumluluk ve sahiplenme',
    'Müşteri odaklılık',
  ]);
  const launchedAt = dateOnly(-28);
  launchedAt.setUTCHours(6);
  const mid = await prisma.reviewCycle.create({
    data: {
      companyId: ctx.companyId,
      name: `${YEAR} Yıl Ortası Değerlendirmesi`,
      periodStart: day(`${YEAR}-01-01`),
      periodEnd: day(`${YEAR}-06-30`),
      selfReviewDue: dateOnly(4),
      managerReviewDue: dateOnly(18),
      goalWeight: 60,
      status: ReviewCycleStatus.ACTIVE,
      launchedAt,
      createdById: ctx.adminId,
      createdAt: new Date(launchedAt.getTime() - 3 * 86_400_000),
      competencies: { create: midCompetencies.map((competencyId) => ({ competencyId })) },
    },
  });
  for (const [index, employee] of employees.entries()) {
    if (employee.hireDate > mid.periodEnd) continue;
    const status = MID_YEAR[employee.employeeNo] ?? PerformanceReviewStatus.SELF_REVIEW;
    const submitted = (days: number, hour: number) => {
      const d = dateOnly(days);
      d.setUTCHours(hour - 3);
      return d;
    };
    await createReview(prisma, {
      companyId: ctx.companyId,
      cycleId: mid.id,
      goalWeight: 60,
      employee,
      index,
      level: LEVELS[employee.employeeNo]?.[1] ?? 4,
      status,
      competencyIds: midCompetencies,
      selfSubmittedAt: status === 'SELF_REVIEW' ? null : submitted(-12 + (index % 5), 16),
      managerSubmittedAt: status === 'COMPLETED' ? submitted(-5 + (index % 3), 15) : null,
      acknowledgedAt:
        status === 'COMPLETED' && !NOT_ACKNOWLEDGED.has(employee.employeeNo)
          ? submitted(-2 + (index % 2), 10)
          : null,
      progressDone: false,
      // Kerem is half way through his self review; Deniz and Mustafa only set goals; the rest
      // in self review have not started.
      selfDraft:
        employee.employeeNo === 'PRS-000007'
          ? 'partial'
          : ['PRS-000002', 'PRS-000006'].includes(employee.employeeNo)
            ? 'goals'
            : status === 'SELF_REVIEW'
              ? 'empty'
              : undefined,
    });
  }

  // ---------- Year end: being prepared ----------
  await prisma.reviewCycle.create({
    data: {
      companyId: ctx.companyId,
      name: `${YEAR} Yıl Sonu Değerlendirmesi`,
      periodStart: day(`${YEAR}-07-01`),
      periodEnd: day(`${YEAR}-12-31`),
      selfReviewDue: day(`${YEAR + 1}-01-15`),
      managerReviewDue: day(`${YEAR + 1}-01-29`),
      goalWeight: 50,
      createdById: ctx.adminId,
      competencies: {
        create: pick([
          'İletişim',
          'Takım çalışması',
          'Problem çözme',
          'Sorumluluk ve sahiplenme',
          'Müşteri odaklılık',
          'Gelişime açıklık',
        ]).map((competencyId) => ({ competencyId })),
      },
    },
  });
}

interface ReviewSeed {
  companyId: string;
  cycleId: string;
  goalWeight: number;
  employee: { id: string; managerId: string | null; position: { name: string } | null };
  index: number;
  level: number;
  status: PerformanceReviewStatus;
  competencyIds: string[];
  selfSubmittedAt: Date | null;
  managerSubmittedAt: Date | null;
  acknowledgedAt: Date | null;
  /** Goals of a finished period are complete. */
  progressDone: boolean;
  /** How far a review still in self review got. */
  selfDraft?: 'empty' | 'goals' | 'partial';
}

async function createReview(prisma: PrismaClient, seed: ReviewSeed) {
  const { index, level, status } = seed;
  const titles = GOALS[seed.employee.position?.name ?? ''] ?? GOALS['Yazılım Geliştirici'];
  const hasGoals = seed.selfDraft !== 'empty';
  const selfRated = status !== 'SELF_REVIEW' || seed.selfDraft === 'partial';
  const managerRated = status === 'COMPLETED';
  const rating = (slot: number, self: boolean) =>
    clamp(level + OFFSETS[(index + slot) % OFFSETS.length] + (self && slot % 2 === 0 ? 1 : 0));

  const goals = hasGoals
    ? titles.map((title, slot) => ({
        title,
        weight: WEIGHTS[slot],
        progress: seed.progressDone
          ? 100
          : Math.min(100, 35 + level * 10 + OFFSETS[(index + slot) % OFFSETS.length] * 15),
        // A partial self review has rated the first two goals only.
        selfRating:
          selfRated && (seed.selfDraft !== 'partial' || slot < 2) ? rating(slot, true) : null,
        managerRating: managerRated ? rating(slot, false) : null,
        sortOrder: slot + 1,
      }))
    : [];
  const ratings = seed.competencyIds.map((competencyId, slot) => ({
    competencyId,
    selfRating: status !== 'SELF_REVIEW' ? rating(slot + 3, true) : null,
    managerRating: managerRated ? rating(slot + 3, false) : null,
  }));

  const goal = managerRated
    ? goalScore(goals.map((g) => ({ weight: g.weight, rating: g.managerRating })))
    : null;
  const competency = managerRated ? competencyScore(ratings.map((r) => r.managerRating)) : null;
  const feedback = FEEDBACK[clamp(level) < 3 ? 3 : level];

  await prisma.performanceReview.create({
    data: {
      companyId: seed.companyId,
      cycleId: seed.cycleId,
      employeeId: seed.employee.id,
      reviewerId: seed.employee.managerId,
      status,
      selfComment: selfRated
        ? 'Dönem boyunca hedeflerime odaklandım; öncelik değişikliklerine rağmen teslimleri aksatmadım.'
        : null,
      managerComment: managerRated ? feedback.manager : null,
      strengths: managerRated ? feedback.strengths : null,
      improvements: managerRated ? feedback.improvements : null,
      goalScore: goal,
      competencyScore: competency,
      overallScore: managerRated ? overallScore(goal, competency, seed.goalWeight) : null,
      selfSubmittedAt: seed.selfSubmittedAt,
      managerSubmittedAt: seed.managerSubmittedAt,
      acknowledgedAt: seed.acknowledgedAt,
      goals: { create: goals },
      ratings: { create: ratings },
    },
  });
}
