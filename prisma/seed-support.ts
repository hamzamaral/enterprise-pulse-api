import {
  TicketEventType,
  TicketPriority,
  TicketStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { formatNumber } from '../src/modules/numbering/number-format';
import { DEFAULT_SLA, dueDates } from '../src/modules/support/support-math';

const HOUR_MS = 3_600_000;
const YEAR = new Date().getFullYear();

export interface SupportSeedContext {
  companyId: string;
  adminId: string;
  managerId: string;
}

type Agent = 'admin' | 'manager';

const CATEGORIES: { name: string; description: string; agent: Agent | null }[] = [
  {
    name: 'Donanım',
    description: 'Bilgisayar, yazıcı, telefon ve çevre birimi arızaları',
    agent: 'manager',
  },
  {
    name: 'Yazılım ve Lisans',
    description: 'Uygulama kurulumu, hata ve lisans talepleri',
    agent: 'manager',
  },
  {
    name: 'Hesap ve Erişim',
    description: 'Kullanıcı hesabı, şifre, klasör ve sistem yetkileri',
    agent: 'admin',
  },
  { name: 'Ağ ve İnternet', description: 'VPN, Wi-Fi ve bağlantı sorunları', agent: 'manager' },
  { name: 'İK ve Bordro', description: 'İzin, bordro ve özlük soruları', agent: 'admin' },
  { name: 'Tesis ve Ofis', description: 'Toplantı odaları, klima, kartlı geçiş', agent: null },
];

/** [hours after creation, author, body]; `note` is an internal note of the agent. */
type CommentSeed = [number, 'requester' | 'agent' | 'note', string];

export interface TicketSeed {
  subject: string;
  description: string;
  category: string | null;
  priority: TicketPriority;
  /** E-mail local part. */
  requester: string;
  agent: Agent | null;
  ageHours: number;
  status: TicketStatus;
  respondedAfter?: number;
  waitingAfter?: number;
  resolvedAfter?: number;
  closedAfter?: number;
  rating?: number;
  ratingComment?: string;
  comments?: CommentSeed[];
}

const DAY = 24;

const TICKETS: TicketSeed[] = [
  {
    subject: 'Kartlı geçiş kartım çalışmıyor',
    description: 'Sabah turnikeden geçerken kartım okunmadı, güvenlikten misafir kartı aldım.',
    category: 'Tesis ve Ofis',
    priority: TicketPriority.HIGH,
    requester: 'emre.aydin',
    agent: 'admin',
    ageHours: 22 * DAY,
    status: TicketStatus.CLOSED,
    respondedAfter: 2,
    resolvedAfter: 20,
    closedAfter: 26,
    rating: 5,
    comments: [
      [2, 'agent', 'Kart kaydınız güvenlik sisteminde yeniden tanımlanacak, yarın sabah deneyin.'],
      [20, 'agent', 'Kartınız yeniden tanımlandı.'],
    ],
  },
  {
    subject: 'Monitör kablosu talebi',
    description: 'İkinci monitör için HDMI kablosuna ihtiyacım var.',
    category: 'Donanım',
    priority: TicketPriority.LOW,
    requester: 'employee',
    agent: 'manager',
    ageHours: 20 * DAY,
    status: TicketStatus.CLOSED,
    respondedAfter: 3,
    resolvedAfter: 20,
    closedAfter: 22,
    rating: 5,
    ratingComment: 'Hızlı çözüm için teşekkürler.',
    comments: [[20, 'agent', 'Kablo masanıza bırakıldı.']],
  },
  {
    subject: 'Mobil cihazda e-posta kurulumu',
    description: 'Yeni telefonuma kurumsal e-posta hesabımı ekleyemiyorum.',
    category: 'Hesap ve Erişim',
    priority: TicketPriority.LOW,
    requester: 'selin.arslan',
    agent: 'admin',
    ageHours: 18 * DAY,
    status: TicketStatus.CLOSED,
    respondedAfter: 4,
    resolvedAfter: 30,
    closedAfter: 40,
    rating: 4,
    comments: [[4, 'agent', 'Kurulum adımlarını e-posta ile gönderdim; MDM onayı gerekiyor.']],
  },
  {
    subject: 'Muhasebe programı lisans yenileme',
    description: 'Muhasebe programı lisansın 3 gün içinde biteceği uyarısını veriyor.',
    category: 'Yazılım ve Lisans',
    priority: TicketPriority.MEDIUM,
    requester: 'mustafa.celik',
    agent: 'manager',
    ageHours: 15 * DAY,
    status: TicketStatus.CLOSED,
    respondedAfter: 10,
    resolvedAfter: 90,
    closedAfter: 100,
    rating: 2,
    ratingComment: 'Çözüm çok uzun sürdü, iki gün program kullanılamadı.',
    comments: [
      [10, 'agent', 'Satın alma onayı bekleniyor, takipteyim.'],
      [40, 'note', 'Satın alma talebi STA onayında bekliyor.'],
      [90, 'agent', 'Yeni lisans anahtarı yüklendi.'],
    ],
  },
  {
    subject: 'Sunucu odası sıcaklık alarmı',
    description: 'Sunucu odası sensörü 31°C gösteriyor, klima çalışmıyor olabilir.',
    category: 'Tesis ve Ofis',
    priority: TicketPriority.URGENT,
    requester: 'ayse.yilmaz',
    agent: 'manager',
    ageHours: 12 * DAY,
    status: TicketStatus.CLOSED,
    respondedAfter: 0.3,
    resolvedAfter: 3,
    closedAfter: 5,
    rating: 5,
    comments: [
      [0.3, 'agent', 'Yedek klima devreye alındı, teknik servis çağrıldı.'],
      [3, 'agent', 'Kompresör arızası giderildi, sıcaklık 21°C.'],
    ],
  },
  {
    subject: 'Uzak masaüstü erişimi',
    description: 'Evden çalışırken ofis bilgisayarıma bağlanmam gerekiyor.',
    category: 'Hesap ve Erişim',
    priority: TicketPriority.MEDIUM,
    requester: 'mehmet.kaya',
    agent: 'admin',
    ageHours: 11 * DAY,
    status: TicketStatus.CLOSED,
    respondedAfter: 3,
    resolvedAfter: 8,
    closedAfter: 12,
    rating: 4,
    comments: [[8, 'agent', 'VPN grubuna eklendiniz, RDP erişimi açıldı.']],
  },
  {
    subject: 'Telefon ahizesi değişimi',
    description: 'Masa telefonumun ahizesi cızırtı yapıyor.',
    category: 'Donanım',
    priority: TicketPriority.LOW,
    requester: 'mustafa.celik',
    agent: 'manager',
    ageHours: 9 * DAY,
    status: TicketStatus.CLOSED,
    respondedAfter: 20,
    resolvedAfter: 100,
    closedAfter: 140,
    comments: [[100, 'agent', 'Ahize yenisiyle değiştirildi.']],
  },
  {
    subject: 'Masraf formuna fiş yüklenemiyor',
    description: 'PDF fişi yüklerken "dosya türü desteklenmiyor" hatası alıyorum.',
    category: 'Yazılım ve Lisans',
    priority: TicketPriority.HIGH,
    requester: 'burak.dogan',
    agent: 'manager',
    ageHours: 8 * DAY,
    status: TicketStatus.CLOSED,
    respondedAfter: 1,
    resolvedAfter: 10,
    closedAfter: 30,
    rating: 3,
    comments: [
      [1, 'agent', 'Dosyayı bu talebe ekleyebilir misiniz?'],
      [3, 'requester', 'Taranmış PDF, telefonla çektim.'],
      [10, 'agent', 'Dosya şifreli PDF imiş; şifresiz kaydedince yükleniyor.'],
    ],
  },
  {
    subject: 'Misafir Wi-Fi şifresi',
    description: 'Yarınki müşteri toplantısı için misafir ağı şifresine ihtiyacım var.',
    category: 'Ağ ve İnternet',
    priority: TicketPriority.LOW,
    requester: 'can.kurt',
    agent: 'manager',
    ageHours: 6 * DAY,
    status: TicketStatus.CLOSED,
    respondedAfter: 1,
    resolvedAfter: 2,
    closedAfter: 50,
    rating: 4,
    comments: [[1, 'agent', 'Günlük misafir şifresi e-posta ile iletildi.']],
  },
  {
    subject: 'İzin bakiyem yanlış görünüyor',
    description: 'Geçen yıldan devreden 2 günlük iznim bakiyede görünmüyor.',
    category: 'İK ve Bordro',
    priority: TicketPriority.LOW,
    requester: 'elif.sahin',
    agent: 'admin',
    ageHours: 4 * DAY,
    status: TicketStatus.RESOLVED,
    respondedAfter: 5,
    resolvedAfter: 60,
    comments: [
      [5, 'agent', 'Devir kayıtlarını kontrol ediyorum.'],
      [60, 'agent', 'Devreden 2 gün bakiyenize eklendi.'],
    ],
  },
  {
    subject: 'Tasarım yazılımı kurulum talebi',
    description: 'Kampanya görselleri için tasarım programına ihtiyacım var.',
    category: 'Yazılım ve Lisans',
    priority: TicketPriority.MEDIUM,
    requester: 'merve.koc',
    agent: 'manager',
    ageHours: 3 * DAY,
    status: TicketStatus.WAITING,
    respondedAfter: 2,
    waitingAfter: 4,
    comments: [
      [2, 'agent', 'Kurulum yapılabilir, lisans hangi departman bütçesinden karşılanacak?'],
      [4, 'note', 'Pazarlama bütçesi onayı gelince satın alma talebi açılacak.'],
    ],
  },
  {
    subject: 'Ofis yazıcısı tarama yapmıyor',
    description: '2. kattaki yazıcıdan e-postaya tarama gönderemiyorum.',
    category: 'Donanım',
    priority: TicketPriority.LOW,
    requester: 'employee',
    agent: 'manager',
    ageHours: 50,
    status: TicketStatus.RESOLVED,
    respondedAfter: 6,
    resolvedAfter: 30,
    comments: [
      [6, 'agent', 'Yazıcının SMTP ayarlarını kontrol ediyorum.'],
      [30, 'agent', 'Tarama profili yeniden tanımlandı, tekrar dener misiniz?'],
    ],
  },
  {
    subject: 'Bordroda eksik fazla mesai',
    description: 'Eylül bordromda 6 saatlik fazla mesai görünmüyor.',
    category: 'İK ve Bordro',
    priority: TicketPriority.MEDIUM,
    requester: 'ahmet.yildiz',
    agent: 'admin',
    ageHours: 40,
    status: TicketStatus.IN_PROGRESS,
    respondedAfter: 4,
    comments: [
      [4, 'agent', 'Puantaj kayıtlarınızı kontrol ediyoruz.'],
      [5, 'note', 'Puantajda 3 ve 4 Eylül kayıtları onaylanmamış.'],
    ],
  },
  {
    subject: 'Yeni başlayan personel için hesap açılması',
    description: 'Pazartesi başlayan ekip arkadaşımız için e-posta ve ERP hesabı gerekiyor.',
    category: 'Hesap ve Erişim',
    priority: TicketPriority.HIGH,
    requester: 'fatma.ozturk',
    agent: 'admin',
    ageHours: 30,
    status: TicketStatus.IN_PROGRESS,
    respondedAfter: 1,
    comments: [[1, 'agent', 'E-posta hesabı açıldı, ERP rolleri tanımlanıyor.']],
  },
  {
    subject: 'Muhasebe klasörüne erişim yetkisi',
    description: 'Ortak sürücüdeki Muhasebe klasörünü açamıyorum, erişim reddedildi hatası.',
    category: 'Hesap ve Erişim',
    priority: TicketPriority.MEDIUM,
    requester: 'employee',
    agent: 'admin',
    ageHours: 26,
    status: TicketStatus.WAITING,
    respondedAfter: 2,
    waitingAfter: 3,
    comments: [
      [
        2,
        'agent',
        'Hangi alt klasöre okuma mı yazma mı yetkisi gerekiyor? Yöneticinizin onayını da ekler misiniz?',
      ],
    ],
  },
  {
    subject: 'Masaüstü için kulaklık talebi',
    description: 'Online toplantılar için mikrofonlu kulaklık talep ediyorum.',
    category: null,
    priority: TicketPriority.LOW,
    requester: 'ahmet.yildiz',
    agent: null,
    ageHours: 26,
    status: TicketStatus.OPEN,
  },
  {
    subject: 'Toplantı odası projektörü çalışmıyor',
    description:
      'Büyük toplantı odasındaki projektör görüntü vermiyor, öğleden sonra sunumumuz var.',
    category: 'Tesis ve Ofis',
    priority: TicketPriority.MEDIUM,
    requester: 'burak.dogan',
    agent: null,
    ageHours: 10,
    status: TicketStatus.OPEN,
  },
  {
    subject: 'CRM ekranında yavaşlık',
    description: 'Fırsat listesini açmak 20 saniyeden uzun sürüyor.',
    category: 'Yazılım ve Lisans',
    priority: TicketPriority.MEDIUM,
    requester: 'zeynep.demir',
    agent: 'manager',
    ageHours: 5,
    status: TicketStatus.IN_PROGRESS,
    respondedAfter: 1,
    comments: [
      [1, 'agent', 'Sorunu tekrar ettim, sistem ekibiyle inceliyoruz.'],
      [1.5, 'note', 'Yavaş sorgu: fırsat listesi aşama filtresi indeks kullanmıyor.'],
    ],
  },
  {
    subject: 'VPN bağlantısı sürekli kopuyor',
    description: 'Evden çalışırken VPN her 10 dakikada bir kopuyor, müşteri görüşmem yarıda kaldı.',
    category: 'Ağ ve İnternet',
    priority: TicketPriority.URGENT,
    requester: 'selin.arslan',
    agent: 'manager',
    ageHours: 3.5,
    status: TicketStatus.IN_PROGRESS,
    respondedAfter: 0.4,
    comments: [
      [0.4, 'agent', 'VPN istemcinizin sürümünü paylaşır mısınız?'],
      [0.8, 'requester', 'Sürüm 5.2.1, Windows 11.'],
    ],
  },
  {
    subject: 'Office lisansı süresi doldu uyarısı',
    description: 'Word ve Excel açılırken lisans süresi doldu uyarısı çıkıyor.',
    category: 'Yazılım ve Lisans',
    priority: TicketPriority.HIGH,
    requester: 'emre.aydin',
    agent: 'manager',
    ageHours: 3.2,
    status: TicketStatus.OPEN,
  },
  {
    subject: 'Dizüstü bilgisayar açılmıyor',
    description: 'Bilgisayarım şarjdayken bile açılmıyor, güç ışığı yanmıyor.',
    category: 'Donanım',
    priority: TicketPriority.HIGH,
    requester: 'mehmet.kaya',
    agent: 'manager',
    ageHours: 3,
    status: TicketStatus.IN_PROGRESS,
    respondedAfter: 0.5,
    comments: [
      [0.5, 'agent', 'Yedek şarj adaptörünü masanıza bırakıyorum, onunla dener misiniz?'],
      [0.6, 'note', 'Cihaz garanti kapsamında; gerekirse servis kaydı açılacak.'],
    ],
  },
  {
    subject: '3. kat klima arızası',
    description: '3. kat açık ofiste klima sıcak hava üflüyor.',
    category: 'Tesis ve Ofis',
    priority: TicketPriority.MEDIUM,
    requester: 'merve.koc',
    agent: null,
    ageHours: 1,
    status: TicketStatus.OPEN,
  },
];

export async function seedSupport(prisma: PrismaClient, ctx: SupportSeedContext) {
  const { companyId } = ctx;
  const agents: Record<Agent, string> = { admin: ctx.adminId, manager: ctx.managerId };

  for (const [priority, targets] of Object.entries(DEFAULT_SLA)) {
    await prisma.ticketSlaPolicy.upsert({
      where: { companyId_priority: { companyId, priority: priority as TicketPriority } },
      create: { companyId, priority: priority as TicketPriority, ...targets },
      update: {},
    });
  }
  for (const [index, seed] of CATEGORIES.entries()) {
    await prisma.ticketCategory.upsert({
      where: { companyId_name: { companyId, name: seed.name } },
      create: {
        companyId,
        name: seed.name,
        description: seed.description,
        defaultAssigneeId: seed.agent ? agents[seed.agent] : null,
        sortOrder: (index + 1) * 10,
      },
      update: {},
    });
  }

  if (await prisma.ticket.count({ where: { companyId } })) return;
  await createTickets(prisma, ctx, TICKETS);
}

/** Creates tickets with their SLA dates, status history and comments; categories match by name. */
export async function createTickets(
  prisma: PrismaClient,
  ctx: SupportSeedContext,
  seeds: TicketSeed[],
) {
  const { companyId } = ctx;
  const agents: Record<Agent, string> = { admin: ctx.adminId, manager: ctx.managerId };
  const categories = new Map(
    (await prisma.ticketCategory.findMany({ where: { companyId } })).map((c) => [c.name, c.id]),
  );
  const users = await prisma.user.findMany({
    where: { email: { endsWith: '@enterprisepulse.dev' } },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  const user = (local: string) => {
    const found = users.find((u) => u.email === `${local}@enterprisepulse.dev`);
    if (!found) throw new Error(`Seed user ${local} not found`);
    return found;
  };
  const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
  const now = Date.now();

  for (const seed of seeds) {
    const requester = user(seed.requester);
    const agentId = seed.agent ? agents[seed.agent] : null;
    const agent = agentId ? users.find((u) => u.id === agentId) : undefined;
    const createdAt = new Date(now - seed.ageHours * HOUR_MS);
    const after = (hours: number | undefined) =>
      hours === undefined ? null : new Date(createdAt.getTime() + hours * HOUR_MS);
    const respondedAt = after(seed.respondedAfter);
    const pausedAt = after(seed.waitingAfter);
    const resolvedAt = after(seed.resolvedAfter);
    const closedAt = after(seed.closedAfter);

    const events: Prisma.TicketEventCreateWithoutTicketInput[] = [
      { type: TicketEventType.CREATED, actor: { connect: { id: requester.id } }, createdAt },
    ];
    const event = (
      type: TicketEventType,
      at: Date,
      actorId: string | null,
      fromValue?: string,
      toValue?: string,
    ) =>
      events.push({
        type,
        createdAt: at,
        fromValue,
        toValue,
        ...(actorId ? { actor: { connect: { id: actorId } } } : {}),
      });
    if (agent) {
      const assignedAt = new Date(createdAt.getTime() + 1000);
      event(TicketEventType.ASSIGNED, assignedAt, null, undefined, name(agent));
    }
    let status: TicketStatus = TicketStatus.OPEN;
    const move = (to: TicketStatus, at: Date | null, actorId: string | null) => {
      if (!at) return;
      event(TicketEventType.STATUS_CHANGED, at, actorId, status, to);
      status = to;
    };
    if (seed.status !== TicketStatus.OPEN) move(TicketStatus.IN_PROGRESS, respondedAt, agentId);
    if (seed.status === TicketStatus.WAITING) move(TicketStatus.WAITING, pausedAt, agentId);
    move(TicketStatus.RESOLVED, resolvedAt, agentId);
    move(TicketStatus.CLOSED, closedAt, seed.rating ? requester.id : agentId);
    if (seed.rating && closedAt) {
      const ratedAt = new Date(closedAt.getTime() + 1000);
      event(TicketEventType.RATED, ratedAt, requester.id, undefined, String(seed.rating));
    }

    const seq = await prisma.numberSequence.update({
      where: { companyId_code: { companyId, code: 'TICKET' } },
      data: { nextValue: { increment: 1 }, currentYear: YEAR },
    });
    await prisma.ticket.create({
      data: {
        companyId,
        number: formatNumber(seq, YEAR, seq.nextValue - 1),
        subject: seed.subject,
        description: seed.description,
        categoryId: seed.category ? (categories.get(seed.category) ?? null) : null,
        priority: seed.priority,
        status: seed.status,
        requesterId: requester.id,
        assigneeId: agentId,
        ...dueDates(createdAt, DEFAULT_SLA[seed.priority]),
        firstRespondedAt: respondedAt,
        resolvedAt,
        closedAt,
        pausedAt,
        satisfactionRating: seed.rating ?? null,
        satisfactionComment: seed.ratingComment ?? null,
        createdAt,
        updatedAt: new Date(
          Math.max(
            ...[createdAt, respondedAt, pausedAt, resolvedAt, closedAt]
              .filter((d) => d !== null)
              .map((d) => d.getTime()),
          ),
        ),
        events: { create: events },
        comments: {
          create: (seed.comments ?? []).map(([hours, author, body]) => ({
            body,
            isInternal: author === 'note',
            authorId: author === 'requester' ? requester.id : (agentId ?? ctx.adminId),
            createdAt: new Date(createdAt.getTime() + hours * HOUR_MS),
          })),
        },
      },
    });
  }
}
