# EnterprisePulse API

[![CI](https://github.com/hamzamaral/enterprise-pulse-api/actions/workflows/ci.yml/badge.svg)](https://github.com/hamzamaral/enterprise-pulse-api/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-22_LTS-339933?logo=node.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)

**EnterprisePulse**, çok şirketli (multi-tenant) kurumsal bir ERP sistemidir. Bu repo, sistemin backend'idir:
NestJS ile yazılmış **modüler monolit** bir REST API.

| Repo                                                                       | İçerik                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **enterprise-pulse-api** (bu repo)                                         | NestJS API, veritabanı şeması, migration'lar, demo verisi, testler             |
| [enterprise-pulse-web](https://github.com/hamzamaral/enterprise-pulse-web) | React arayüzü (API'yi yalnızca OpenAPI sözleşmesi üzerinden kullanır)          |
| [EnterprisePulse](https://github.com/hamzamaral/EnterprisePulse)           | Yol haritası, mimari dokümanlar, ADR'ler, yerel altyapı (`docker-compose.yml`) |

![Stok durumu ekranı](https://raw.githubusercontent.com/hamzamaral/enterprise-pulse-web/main/docs/screenshots/stock-levels.png)

## Modüller

| Modül                      | Öne çıkanlar                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Kimlik doğrulama**       | JWT access token + rotasyonlu refresh token (HttpOnly cookie, yeniden kullanım tespiti), şifre sıfırlama, TOTP ile iki adımlı doğrulama                                                                                                                                                                                              |
| **Çoklu şirket ve şube**   | Kiracıya bağlı her tabloda `companyId`; aktif şirket `x-company-id` başlığıyla seçilir                                                                                                                                                                                                                                               |
| **Kullanıcı, rol ve izin** | `module:action` biçiminde izinler, şirket bazında rol atamaları, CASL ile yetki kontrolü                                                                                                                                                                                                                                             |
| **Denetim kaydı**          | Prisma extension ile her oluşturma / güncelleme / silme işleminin önce-sonra farkı otomatik kaydedilir                                                                                                                                                                                                                               |
| **Bildirimler**            | Veritabanı + Socket.IO ile anlık bildirim, BullMQ kuyruğu üzerinden e-posta                                                                                                                                                                                                                                                          |
| **Onay akışı motoru**      | Rol veya kullanıcı bazlı çok adımlı onay; belgeler domain event'leriyle güncellenir                                                                                                                                                                                                                                                  |
| **Ayarlar**                | Para birimi, döviz kuru, KDV oranları, birimler, belge numaralandırma serileri (`IZN-2026-000001`)                                                                                                                                                                                                                                   |
| **Dosyalar**               | S3 uyumlu depolama (RustFS), imzalı indirme bağlantıları                                                                                                                                                                                                                                                                             |
| **İnsan Kaynakları**       | Hiyerarşik departmanlar, pozisyonlar, personel kartı, organizasyon şeması, izin türleri ve kıdeme göre yıllık hak ediş, resmi tatil ve iş günü hesabı, onay akışlı izin talebi; vardiya tanımları (gece vardiyası dahil) ve haftalık plan, self-servis giriş-çıkış, geç kalma / devamsızlık / fazla mesai hesaplayan aylık puantaj   |
| **Masraf ve Harcırah**     | Fişli masraf, günlük harcırah ve km ücretli araç kalemleriyle masraf formu, dövizli fiş (kayıt anındaki kurla), fiş görseli / PDF ekleme, kalem limiti ve fiş zorunluluğu uyarıları, onay akışı, onaylanan formu kasa / bankadan ödeme ve ters kayıtla geri alma, türe ve aya göre masraf özeti                                      |
| **Zimmet ve Demirbaş**     | Demirbaş kartı ve QR etiket, personele / departmana / konuma zimmet, iade ve devir, elektronik onaylı zimmet tutanağı, bakım kaydı, doğrusal amortisman, zimmetli personelin işten çıkışını engelleme, QR okutarak demirbaş sayımı ve fark raporu                                                                                    |
| **Stok ve Depo**           | Ürün ve varyantlar, çoklu depo, giriş / çıkış / transfer / düzeltme fişleri, hareketli ağırlıklı ortalama maliyet, lot (son kullanma tarihi) ve seri numarası takibi, barkodla stok sayımı ve otomatik düzeltme, kritik stok bildirimi                                                                                               |
| **Cari hesaplar**          | Müşteri / tedarikçi kartları, vade ve kredi limiti, döviz; değişmez cari hareket defteri, iptalde ters kayıt                                                                                                                                                                                                                         |
| **CRM**                    | Potansiyel müşteri (aday) takibi ve cariye dönüştürme, aşama bazlı olasılıklı satış fırsatı hattı (pano), fırsattan teklif hazırlama (teklif fırsatı Teklif aşamasına taşır, siparişe dönüşmesi fırsatı kazandırır), kayıp nedeni, sorumluya bildirimli arama / toplantı / görev takibi, ağırlıklı hat ve kazanma oranı göstergeleri |
| **Satın Alma**             | Onay akışlı satın alma talebi, tedarikçi teklifleri ve karşılaştırma, sipariş onayı, kısmi mal kabul (lot / seri), üç yönlü eşleştirmeli alış faturası                                                                                                                                                                               |
| **Satış**                  | Teklif ve siparişe dönüştürme, onayda kredi limiti kontrolü ve stok rezervasyonu, lot / seri seçimli sevk irsaliyesi, sevk edilen miktar kadar satış faturası, stoğa ve cariye işleyen satış iadesi                                                                                                                                  |
| **Finans**                 | Kasa ve banka hesapları, tahsilat / ödeme ve faturalara otomatik (en eski vadeden) veya seçmeli kapama, müşteri çeki / senedi portföyü (bankaya verme, tahsil, ciro, karşılıksız), kendi çeklerimizin ödenmesi, yaşlandırma raporu ve nakit pozisyonu                                                                                |
| **Raporlar**               | Satış ve alış analizi (aylık, cari veya ürün bazında; şirket para biriminde, iadeler düşülmüş), açılış bakiyeli ve ters kayıtları ayıklayan aylık nakit akışı                                                                                                                                                                        |

Sıradaki fazlar: proje yönetimi, bordro ve canlı demo
([yol haritası](https://github.com/hamzamaral/EnterprisePulse/blob/main/docs/roadmap.md)).

## Mimari ve teknik kararlar

```
src/
  config/           zod ile doğrulanan tipli ortam değişkenleri
  common/           guard, decorator, filter, sayfalama, request context, CASL
  infrastructure/   prisma, redis, kuyruk, depolama, e-posta (iş kuralı içermez)
  modules/<modül>/  controller, service, dto, event listener
prisma/schema/      alan bazında bölünmüş çok dosyalı Prisma şeması
prisma/migrations/  commit'lenmiş migration'lar
test/               gerçek veritabanıyla uçtan uca HTTP testleri
```

- **Modüler monolit:** Modüller birbirinin tablolarına dokunmaz; dışa açılan servisler veya domain event'leri
  (`EventEmitter2`) üzerinden konuşur. Örneğin İK, işten çıkışta zimmet modülüne
  `AssetAssignmentsService.countActiveForEmployee` ile sorar.
- **Çoklu şirket güvenliği:** `companyId` her zaman oturumdan gelir, istek gövdesinden asla alınmaz.
  `AsyncLocalStorage` tabanlı `RequestContext` kullanıcı, şirket ve şubeyi tüm katmanlara taşır.
- **Varsayılan olarak korumalı endpoint'ler:** Her endpoint JWT ister; açık olanlar `@Public()` ile işaretlenir,
  diğerleri `@RequirePermissions('inventory:move')` ile izin kontrolünden geçer.
- **Para ve miktar:** Veritabanında `Decimal`, API'de string olarak taşınır; kayan nokta hatası olmaz.
- **Eşzamanlılığa dayanıklı stok:** Fişler tek transaction içinde işlenir; varyant satırları sıralı
  `SELECT … FOR UPDATE` ile kilitlenir (deadlock önlenir), stok düşümü koşullu `UPDATE … WHERE quantity >= x`
  ile yapılır (eksi stok imkânsızdır). Fişler değiştirilemez; düzeltme yeni bir fiştir. Her hareket,
  `seq` ile sıralanan bir stok defterine (`StockTransaction`) bakiyesiyle birlikte yazılır.
- **Belge numaraları:** `NumberingService.next()` belgeyi oluşturan transaction'ın içinde, satır kilidiyle
  boşluksuz numara üretir.
- **Onay akışı:** Belgeler bir workflow başlatır; son onayda yayınlanan event'i ilgili modül dinler ve durum
  yalnızca `PENDING`'den geçebildiği için tekrar gelen event'ler zararsızdır.
- **Puantaj hesabı:** Gün sonucu (geldi, geç, devamsız, izinli, resmi tatil) saf ve birim testli bir fonksiyonda
  (`hr/timesheet.ts`) vardiya planı, giriş-çıkış, onaylı izin ve tatillerden hesaplanır. Saatler şirketin saat
  diliminde yorumlanır; gece vardiyasının çıkışı ertesi güne düşse de vardiyanın başladığı iş gününe yazılır.
- **Sayım oturumları:** Stok ve demirbaş sayımları açıldığı anın beklenen durumunu kopyalar, yalnızca taslakken
  (satır kilidiyle) düzenlenir ve etkisini tamamlandığında bir kez uygular.
- **CRM hattı:** Aşama kuralları (varsayılan olasılık, teklifle ilerleme, kazanma oranı) `crm/crm-math.ts`
  içinde saf fonksiyonlardır. Satış modülü fırsata yalnızca `OpportunitiesService` üzerinden, teklifi oluşturan
  transaction içinde dokunur; farklı para birimindeki fırsatlar pano ve göstergelerde güncel kurla şirket para
  birimine çevrilir.
- **Masraf formları:** Kalem tutarı `expenses/expense-math.ts` içinde hesaplanır: fişli kalemler kayıt anındaki
  kurla şirket para birimine çevrilir, harcırah ve km kalemleri türün birim ücretiyle çarpılır. Personel
  yalnızca kendi formlarını görür (izin gerekmez); onay bitince form `expenses:pay` izinlilere bildirilir,
  ödeme kasa / banka defterine `EXPENSE_PAYMENT` olarak yazılır ve geri alındığında ters kayıt atılır.
- **OpenAPI sözleşmesi:** Swagger şeması web reposundaki tipli istemcinin (Orval) kaynağıdır.

## Hızlı başlangıç

Gereksinimler: Node 22 LTS, pnpm 9, Docker.

```bash
# Altyapı: PostgreSQL, Redis, RustFS (S3), Mailpit
git clone https://github.com/hamzamaral/EnterprisePulse.git && cd EnterprisePulse
cp .env.example .env && docker compose up -d

# API
git clone https://github.com/hamzamaral/enterprise-pulse-api.git api && cd api
cp .env.example .env
pnpm install
pnpm db:deploy        # migration'ları uygula
pnpm db:seed          # demo şirket, personel, demirbaş ve stok verisi
pnpm start:dev        # http://localhost:3000/api/v1
```

| Adres                               | Açıklama                            |
| ----------------------------------- | ----------------------------------- |
| http://localhost:3000/docs          | Swagger arayüzü                     |
| http://localhost:3000/docs-json     | OpenAPI şeması                      |
| http://localhost:3000/api/v1/health | Sağlık kontrolü (veritabanı, Redis) |
| http://localhost:8025               | Mailpit: gönderilen e-postalar      |

### Demo kullanıcılar

| Rol               | E-posta                        | Şifre          |
| ----------------- | ------------------------------ | -------------- |
| Sistem yöneticisi | `admin@enterprisepulse.dev`    | `Admin123!`    |
| Müdür             | `manager@enterprisepulse.dev`  | `Manager123!`  |
| Personel          | `employee@enterprisepulse.dev` | `Employee123!` |

## Komutlar

| Komut                                                | Açıklama                                      |
| ---------------------------------------------------- | --------------------------------------------- |
| `pnpm start:dev`                                     | İzleme modunda geliştirme sunucusu            |
| `pnpm build` / `pnpm start:prod`                     | Derleme / üretim modu                         |
| `pnpm lint` / `pnpm format:check` / `pnpm typecheck` | Kod kalitesi kontrolleri                      |
| `pnpm test` / `pnpm test:cov`                        | Birim testleri / kapsam raporu                |
| `pnpm test:e2e`                                      | Gerçek PostgreSQL ile uçtan uca HTTP testleri |
| `pnpm db:migrate --name <değişiklik>`                | Yeni migration oluştur                        |
| `pnpm db:deploy` / `pnpm db:seed`                    | Migration'ları uygula / demo verisini yükle   |
| `pnpm db:studio`                                     | Prisma Studio                                 |

## Testler ve CI

- **Birim testleri (Jest):** iş günü ve izin hesabı, puantaj (geç kalma, fazla mesai, gece vardiyası, saat dilimi),
  amortisman, stok matematiği, CRM aşama kuralları, masraf kalemi hesabı, numaralandırma gibi saf iş kuralları.
- **Uçtan uca testler (Supertest):** kimlik doğrulama, İK, puantaj ve vardiya, zimmet ve demirbaş sayımı, stok akışları,
  CRM hattı (adayın dönüştürülmesi, teklifle fırsat kazanma), masraf formu (onay, ödeme, ters kayıt, gizlilik)
  gerçek veritabanında; yetki sınırları, ortalama maliyet, eksi stok engeli, lot / seri kuralları, sayım düzeltmesi ve
  kritik stok bildirimi dahil.
- **Ayrı test veritabanı:** e2e testleri `<db>_e2e` veritabanında çalışır (yoksa oluşturulur, migration ve seed
  otomatik uygulanır), demo verisi kirlenmez. `E2E_RESET=1 pnpm test:e2e` test veritabanını sıfırdan kurar.
- **GitHub Actions:** lint, format, tip kontrolü, kapsamlı birim testleri, build; PostgreSQL ve Redis servisleriyle
  e2e; Docker imajı derlemesi.
- Commit mesajları [Conventional Commits](https://www.conventionalcommits.org) biçimindedir; Husky, commitlint ve
  lint-staged ile denetlenir.

## Teknolojiler

NestJS 11 · TypeScript · PostgreSQL 17 · Prisma 6 · Redis · BullMQ · Socket.IO · Passport JWT · argon2 · otplib ·
CASL · class-validator · zod · Swagger · Pino · Helmet · Throttler · AWS S3 SDK (RustFS) · Nodemailer · Jest · Supertest · Docker
