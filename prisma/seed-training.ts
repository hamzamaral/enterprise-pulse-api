import {
  TrainingCategory,
  TrainingEnrollmentStatus,
  TrainingFormat,
  TrainingSessionStatus,
  type PrismaClient,
} from '@prisma/client';
import { certificateExpiry } from '../src/modules/training/training-math';

const now = new Date();
/** `days` from today at `hour` o'clock Istanbul time (UTC+3). */
const at = (days: number, hour: number, minute = 0) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  d.setUTCHours(hour - 3, minute, 0, 0);
  return d;
};
const dateOf = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

interface TrainingSeedContext {
  companyId: string;
  adminId: string;
}

interface CourseSeed {
  code: string;
  title: string;
  category: TrainingCategory;
  format: TrainingFormat;
  hours: number;
  provider: string | null;
  mandatory: boolean;
  validity: number | null;
  description: string;
}

const COURSES: CourseSeed[] = [
  {
    code: 'ISG-TEMEL',
    title: 'Temel İş Sağlığı ve Güvenliği',
    category: TrainingCategory.OCCUPATIONAL_SAFETY,
    format: TrainingFormat.CLASSROOM,
    hours: 8,
    provider: 'Güven OSGB',
    mandatory: true,
    validity: 12,
    description:
      'Çalışma ortamındaki riskler, kişisel koruyucu donanım, ergonomi ve iş kazalarında ilk müdahale.',
  },
  {
    code: 'KVKK',
    title: 'KVKK Farkındalık Eğitimi',
    category: TrainingCategory.COMPLIANCE,
    format: TrainingFormat.ONLINE,
    hours: 2,
    provider: null,
    mandatory: true,
    validity: 24,
    description: 'Kişisel verilerin işlenmesi, aydınlatma yükümlülüğü ve veri ihlali bildirimi.',
  },
  {
    code: 'YANGIN',
    title: 'Yangın ve Acil Durum Tatbikatı',
    category: TrainingCategory.OCCUPATIONAL_SAFETY,
    format: TrainingFormat.CLASSROOM,
    hours: 3,
    provider: 'Güven OSGB',
    mandatory: true,
    validity: 12,
    description: 'Yangın söndürücü kullanımı, tahliye planı ve toplanma alanı tatbikatı.',
  },
  {
    code: 'LIDER-101',
    title: 'Etkili Liderlik ve Geri Bildirim',
    category: TrainingCategory.LEADERSHIP,
    format: TrainingFormat.CLASSROOM,
    hours: 12,
    provider: 'Akademi Plus',
    mandatory: false,
    validity: null,
    description:
      'Durumsal liderlik, birebir görüşmeler ve gelişim odaklı geri bildirim teknikleri.',
  },
  {
    code: 'NEST-ILERI',
    title: 'İleri Seviye NestJS',
    category: TrainingCategory.TECHNICAL,
    format: TrainingFormat.ONLINE,
    hours: 16,
    provider: 'Kod Akademi',
    mandatory: false,
    validity: null,
    description: 'Modüler mimari, guard ve interceptor yapıları, Prisma ile transaction yönetimi.',
  },
  {
    code: 'MUZAKERE',
    title: 'Satışta Müzakere Teknikleri',
    category: TrainingCategory.SOFT_SKILLS,
    format: TrainingFormat.CLASSROOM,
    hours: 8,
    provider: 'Akademi Plus',
    mandatory: false,
    validity: null,
    description: 'Hazırlık, karşı tarafın ihtiyaçlarını anlama, itiraz yönetimi ve kapanış.',
  },
  {
    code: 'EXCEL-ILERI',
    title: 'İleri Excel ve Veri Analizi',
    category: TrainingCategory.TECHNICAL,
    format: TrainingFormat.ONLINE,
    hours: 10,
    provider: 'Kod Akademi',
    mandatory: false,
    validity: null,
    description: 'Pivot tablolar, Power Query, dinamik diziler ve panolar.',
  },
  {
    code: 'ORYANTASYON',
    title: 'Yeni Çalışan Oryantasyonu',
    category: TrainingCategory.ORIENTATION,
    format: TrainingFormat.BLENDED,
    hours: 6,
    provider: null,
    mandatory: false,
    validity: null,
    description: 'Şirket kültürü, süreçler, sistemlere giriş ve ilk 90 günün hedefleri.',
  },
];

type Attendance = [employeeNo: string, status: TrainingEnrollmentStatus, score?: number];
const A = TrainingEnrollmentStatus.ATTENDED;
const N = TrainingEnrollmentStatus.NO_SHOW;
const E = TrainingEnrollmentStatus.ENROLLED;

interface SessionSeed {
  course: string;
  startsAt: Date;
  endsAt: Date;
  status: TrainingSessionStatus;
  location: string | null;
  instructor: string | null;
  capacity: number | null;
  cost: number | null;
  selfEnrollment?: boolean;
  notes?: string;
  attendance: Attendance[];
  /** Participant ratings: employee no → [rating, comment]. */
  feedback?: Record<string, [number, string | null]>;
}

const ALL = Array.from({ length: 15 }, (_, i) => `PRS-${String(i + 1).padStart(6, '0')}`);
/** Whose safety certificate from last year runs out in ten days. */
const ISG_LAST_YEAR = ALL.filter(
  (no) => !['PRS-000008', 'PRS-000012', 'PRS-000013', 'PRS-000015'].includes(no),
);

const SESSIONS: SessionSeed[] = [
  {
    course: 'ISG-TEMEL',
    startsAt: at(-355, 9, 30),
    endsAt: at(-355, 17, 30),
    status: TrainingSessionStatus.COMPLETED,
    location: 'Genel Merkez · Eğitim Salonu',
    instructor: 'Selim Ateş (İSG Uzmanı)',
    capacity: 20,
    cost: 15_000,
    attendance: ISG_LAST_YEAR.map((no) => [no, A, 80 + (Number(no.slice(-2)) % 4) * 5]),
  },
  {
    course: 'ISG-TEMEL',
    startsAt: at(-30, 9, 30),
    endsAt: at(-30, 17, 30),
    status: TrainingSessionStatus.COMPLETED,
    location: 'Genel Merkez · Eğitim Salonu',
    instructor: 'Selim Ateş (İSG Uzmanı)',
    capacity: 10,
    cost: 6_000,
    attendance: [
      ['PRS-000008', A, 90],
      ['PRS-000012', A, 85],
      ['PRS-000013', A, 75],
      ['PRS-000015', A, 80],
    ],
    feedback: {
      'PRS-000008': [4, 'Uygulamalı kısımlar faydalıydı.'],
      'PRS-000015': [5, null],
    },
  },
  {
    course: 'ISG-TEMEL',
    startsAt: at(5, 9, 30),
    endsAt: at(5, 17, 30),
    status: TrainingSessionStatus.PLANNED,
    location: 'Genel Merkez · Eğitim Salonu',
    instructor: 'Selim Ateş (İSG Uzmanı)',
    capacity: 14,
    cost: 15_000,
    notes: 'Geçen yıl sertifika alanların yenileme eğitimi.',
    attendance: ISG_LAST_YEAR.filter((no) => no !== 'PRS-000001').map((no) => [no, E]),
  },
  {
    course: 'KVKK',
    startsAt: at(-200, 10),
    endsAt: at(-200, 12),
    status: TrainingSessionStatus.COMPLETED,
    location: 'Çevrim içi',
    instructor: 'Av. Derya Tunç',
    capacity: null,
    cost: 4_500,
    attendance: ALL.filter((no) => no !== 'PRS-000015').map((no) =>
      no === 'PRS-000013' ? [no, N] : [no, A],
    ),
    feedback: {
      'PRS-000003': [5, 'Örnek olaylar çok açıklayıcıydı.'],
      'PRS-000010': [4, null],
      'PRS-000011': [3, 'Biraz kısa kaldı.'],
    },
  },
  {
    course: 'YANGIN',
    startsAt: at(-545, 14),
    endsAt: at(-545, 17),
    status: TrainingSessionStatus.COMPLETED,
    location: 'Genel Merkez · Otopark',
    instructor: 'İtfaiye Eğitim Birimi',
    capacity: null,
    cost: 3_000,
    attendance: [['PRS-000009', A]],
  },
  {
    course: 'YANGIN',
    startsAt: at(-180, 14),
    endsAt: at(-180, 17),
    status: TrainingSessionStatus.COMPLETED,
    location: 'Genel Merkez · Otopark',
    instructor: 'İtfaiye Eğitim Birimi',
    capacity: null,
    cost: 4_000,
    attendance: ALL.map((no) => (no === 'PRS-000009' ? [no, N] : [no, A])),
  },
  {
    course: 'LIDER-101',
    startsAt: at(-60, 9, 30),
    endsAt: at(-59, 16, 30),
    status: TrainingSessionStatus.COMPLETED,
    location: 'Akademi Plus · Levent',
    instructor: 'Dr. Ece Karaca',
    capacity: 8,
    cost: 45_000,
    attendance: ['PRS-000002', 'PRS-000003', 'PRS-000004', 'PRS-000005', 'PRS-000006'].map((no) => [
      no,
      A,
    ]),
    feedback: {
      'PRS-000002': [5, 'Birebir görüşme şablonlarını ekipte kullanmaya başladık.'],
      'PRS-000003': [4, null],
      'PRS-000004': [5, 'Çok verimliydi.'],
      'PRS-000005': [4, 'Rol oyunları daha uzun olabilirdi.'],
    },
  },
  {
    course: 'NEST-ILERI',
    startsAt: at(-45, 10),
    endsAt: at(-41, 12),
    status: TrainingSessionStatus.COMPLETED,
    location: 'Çevrim içi',
    instructor: 'Onur Bal',
    capacity: 5,
    cost: 12_000,
    attendance: [
      ['PRS-000007', A, 88],
      ['PRS-000008', A, 92],
      ['PRS-000009', N],
    ],
    feedback: { 'PRS-000008': [4, 'Transaction örnekleri çok işe yaradı.'] },
  },
  {
    course: 'MUZAKERE',
    startsAt: at(-20, 9, 30),
    endsAt: at(-20, 17, 30),
    status: TrainingSessionStatus.CANCELLED,
    location: 'Genel Merkez · Toplantı Salonu A',
    instructor: 'Kaan Uysal',
    capacity: 12,
    cost: null,
    notes: 'Eğitmenin rahatsızlığı nedeniyle ertelendi.',
    attendance: [],
  },
  {
    course: 'MUZAKERE',
    startsAt: at(9, 9, 30),
    endsAt: at(9, 17, 30),
    status: TrainingSessionStatus.PLANNED,
    location: 'Genel Merkez · Toplantı Salonu A',
    instructor: 'Kaan Uysal',
    capacity: 12,
    cost: 18_000,
    selfEnrollment: true,
    attendance: [
      ['PRS-000005', E],
      ['PRS-000012', E],
      ['PRS-000013', E],
    ],
  },
  {
    course: 'EXCEL-ILERI',
    startsAt: at(16, 13),
    endsAt: at(16, 18),
    status: TrainingSessionStatus.PLANNED,
    location: 'Çevrim içi',
    instructor: 'Onur Bal',
    capacity: 25,
    cost: 7_500,
    selfEnrollment: true,
    attendance: [
      ['PRS-000010', E],
      ['PRS-000011', E],
    ],
  },
  {
    course: 'ORYANTASYON',
    startsAt: at(-480, 9),
    endsAt: at(-480, 16),
    status: TrainingSessionStatus.COMPLETED,
    location: 'Genel Merkez',
    instructor: 'Ayşe Yılmaz',
    capacity: null,
    cost: null,
    attendance: [['PRS-000015', A]],
    feedback: { 'PRS-000015': [5, 'Ekibi ve süreçleri hızlıca tanıdım.'] },
  },
];

export async function seedTraining(prisma: PrismaClient, ctx: TrainingSeedContext) {
  const exists = await prisma.trainingCourse.count({ where: { companyId: ctx.companyId } });
  if (exists) return;

  const courses = new Map<string, { id: string; validity: number | null }>();
  for (const course of COURSES) {
    const row = await prisma.trainingCourse.create({
      data: {
        companyId: ctx.companyId,
        code: course.code,
        title: course.title,
        category: course.category,
        format: course.format,
        durationHours: course.hours,
        provider: course.provider,
        description: course.description,
        isMandatory: course.mandatory,
        validityMonths: course.validity,
      },
    });
    courses.set(course.code, { id: row.id, validity: course.validity });
  }

  const employees = await prisma.employee.findMany({
    where: { companyId: ctx.companyId, employeeNo: { in: ALL } },
    select: { id: true, employeeNo: true },
  });
  const employeeId = new Map(employees.map((e) => [e.employeeNo, e.id]));

  for (const session of SESSIONS) {
    const course = courses.get(session.course)!;
    const completed = session.status === TrainingSessionStatus.COMPLETED;
    const expiresAt = completed ? certificateExpiry(dateOf(session.endsAt), course.validity) : null;
    await prisma.trainingSession.create({
      data: {
        companyId: ctx.companyId,
        courseId: course.id,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        location: session.location,
        instructor: session.instructor,
        capacity: session.capacity,
        cost: session.cost,
        selfEnrollment: session.selfEnrollment ?? false,
        status: session.status,
        notes: session.notes ?? null,
        completedAt: completed ? new Date(session.endsAt.getTime() + 3_600_000) : null,
        createdById: ctx.adminId,
        createdAt: new Date(session.startsAt.getTime() - 21 * 86_400_000),
        enrollments: {
          create: session.attendance
            .filter(([no]) => employeeId.has(no))
            .map(([no, status, score]) => {
              const feedback = session.feedback?.[no];
              return {
                employeeId: employeeId.get(no)!,
                status,
                score: score ?? null,
                certificateExpiresAt: status === A ? expiresAt : null,
                feedbackRating: feedback?.[0] ?? null,
                feedbackComment: feedback?.[1] ?? null,
                feedbackAt: feedback ? new Date(session.endsAt.getTime() + 86_400_000) : null,
                createdAt: new Date(session.startsAt.getTime() - 14 * 86_400_000),
              };
            }),
        },
      },
    });
  }
}
