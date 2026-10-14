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

| Modül                      | Öne çıkanlar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kimlik doğrulama**       | JWT access token + rotasyonlu refresh token (HttpOnly cookie, yeniden kullanım tespiti), şifre sıfırlama, TOTP ile iki adımlı doğrulama                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Çoklu şirket ve şube**   | Kiracıya bağlı her tabloda `companyId`; aktif şirket `x-company-id` başlığıyla seçilir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Kullanıcı, rol ve izin** | `module:action` biçiminde izinler, şirket bazında rol atamaları, CASL ile yetki kontrolü                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Denetim kaydı**          | Prisma extension ile her oluşturma / güncelleme / silme işleminin önce-sonra farkı otomatik kaydedilir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Bildirimler**            | Veritabanı + Socket.IO ile anlık bildirim, BullMQ kuyruğu üzerinden e-posta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Onay akışı motoru**      | Rol veya kullanıcı bazlı çok adımlı onay; belgeler domain event'leriyle güncellenir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Ayarlar**                | Para birimi, döviz kuru, KDV oranları, birimler, belge numaralandırma serileri (`IZN-2026-000001`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Dosyalar**               | S3 uyumlu depolama (RustFS), imzalı indirme bağlantıları                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **İnsan Kaynakları**       | Hiyerarşik departmanlar, pozisyonlar, personel kartı, organizasyon şeması, izin türleri ve kıdeme göre yıllık hak ediş, resmi tatil ve iş günü hesabı, onay akışlı izin talebi; vardiya tanımları (gece vardiyası dahil) ve haftalık plan, self-servis giriş-çıkış, geç kalma / devamsızlık / fazla mesai hesaplayan aylık puantaj                                                                                                                                                                                                                                                      |
| **Masraf ve Harcırah**     | Fişli masraf, günlük harcırah ve km ücretli araç kalemleriyle masraf formu, dövizli fiş (kayıt anındaki kurla), fiş görseli / PDF ekleme, kalem limiti ve fiş zorunluluğu uyarıları, onay akışı, onaylanan formu kasa / bankadan ödeme ve ters kayıtla geri alma, türe ve aya göre masraf özeti                                                                                                                                                                                                                                                                                         |
| **Bordro**                 | Tarihli ücret geçmişi, yıla göre bordro parametreleri (asgari ücret, SGK tavanı, prim oranları, gelir vergisi dilimleri), puantajdan eksik gün ve fazla mesai, ücretsiz izin düşümü, kümülatif gelir vergisi ve asgari ücret istisnaları, ek kazanç / kesinti kalemleri, onay, tek hazine hareketiyle maaş ödemesi ve ters kayıtla geri alma, personelin kendi ücret pusulası                                                                                                                                                                                                           |
| **İşe Alım**               | İş ilanları (taslak, yayında, beklemede, kapalı; kadro, ücret aralığı, işe alım yöneticisi), aday havuzu ve CV dosyası, sürükle-bırak başvuru hattı, mülakat planlama ve mülakatçı değerlendirmesi, teklif (kabul / ret / geri çekme), adayı tek işlemde personele ve ilk ücret kaydına dönüştürme, işe alım hunisi                                                                                                                                                                                                                                                                     |
| **Performans ve Eğitim**   | Yetkinlik kataloğu, hedef / yetkinlik ağırlıklı değerlendirme dönemleri, dönemi başlatınca personel başına form ve yönetici ataması, hedef girişi, öz değerlendirme, yönetici değerlendirmesi ve puan hesabı, geri gönderme, çalışan onayı, puan dağılımı; eğitim kataloğu (zorunlu eğitim, sertifika geçerliliği), kontenjanlı oturum, toplu ve self-servis kayıt, katılım ve sınav puanı, memnuniyet anketi, zorunlu eğitim uyum raporu                                                                                                                                               |
| **Destek Talepleri**       | Self-servis destek talebi, kategoriye göre otomatik atama, öncelik bazlı SLA hedefleri (ilk yanıt ve çözüm), bilgi beklenirken duran çözüm saati, yanıt ve dahili not, dosya eki, durum geçmişi, çözüm onayı / yeniden açma, memnuniyet puanı, kuyruk filtreleri (bana atanan, atanmamış, SLA aşılan), ekip iş yükü ve 14 günlük trend                                                                                                                                                                                                                                                  |
| **Sözleşmeler**            | Cari ve personel sözleşmeleri, gelir / gider yönlü sözleşme türleri ve varsayılan süreler, taslak → yürürlükte → sona erdi / feshedildi yaşam döngüsü, otomatik yenileme ve ihbar süresi, manuel yenileme, ileri tarihli fesih ve geri alma, bitiş / fesih son günü hatırlatması (bildirim ve e-posta), günlük zamanlanmış iş, imzalı sözleşme ekleri, olay geçmişi, yıllık gelir / gider değeri ve 12 aylık bitiş takvimi                                                                                                                                                              |
| **Bütçe**                  | Gelir / gider bütçe kalemleri ve gerçekleşen kaynağı (masraf raporu, bordro, satın alma ve satış faturası, elle giriş), masraf ve ürün kategorisi eşlemesi, yıllık şirket ve departman bütçeleri, 12 aylık plan, geçen yılın bütçesinden veya gerçekleşeninden yüzde ayarlı kopyalama, taslak → onaylı → revizyon akışı, alt departmanları kapsayan plan / gerçekleşen karşılaştırması, belge kırılımı, %90 ve aşım uyarısı (bildirim ve e-posta), günlük zamanlanmış iş                                                                                                                |
| **Araç ve Filo**           | Araç kartı (Türk plakası doğrulama, mülkiyet ve kiralama bitişi, departman), sürücü zimmeti ve devir, sürücünün kendi aracına yakıt ve km girişi, geriye dönük km tutarlılığı, depo dolumu yöntemiyle L/100 km, periyodik bakım planı (km ve ay aralığı), onarım ve lastik kayıtları, muayene / trafik sigortası / kasko / egzoz emisyon takibi, bitişe 30 gün kala ve bittiğinde hatırlatma (bildirim ve e-posta), yıllık maliyet, km başına maliyet ve son 12 ay grafiği, günlük zamanlanmış iş                                                                                       |
| **Muhasebe**               | Tekdüzen hesap planı (ana ve alt hesaplar, sistem hesapları), yevmiye fişi (taslak, kesinleştirme, ters kayıt), satış / alış faturası, iade, irsaliye maliyeti, stok hareketi, tahsilat / ödeme, çek, kasa ve cari açılışı, masraf ve bordrodan otomatik fiş (gece çalışan iş ve elle çalıştırma), belge iptal edilince ters kayıt, değişen bordroda yeniden kayıt, dönem kilidi, muavin defter, mizan, bilanço ve gelir tablosu                                                                                                                                                        |
| **e-Fatura**               | Satış faturasından UBL-TR 2.1 XML (TR1.2), e-Fatura (TEMEL / TİCARİ) ve e-Arşiv profili, GİB numarası (EPF / EPA serisi) ve ETTN, VKN / TCKN doğrulaması, GİB gönderim simülasyonu (kuyrukta, gönderildi, alıcıya ulaştı, hata kodları), alıcı yanıtı (kabul / red, 8 gün), hatalı faturayı yeniden gönderme, gelen e-fatura simülasyonu, yanıt ve alış faturasına aktarma, otomatik gönderim ayarı, e-faturalı faturanın iptal kuralları                                                                                                                                               |
| **Üretim (MRP)**           | Ürün ağacı (parti miktarı, fire oranı, parti başına işçilik ve genel üretim gideri, varsayılan reçete, döngü kontrolü, çok seviyeli standart maliyet), iş emri (taslak, serbest, üretimde, tamamlandı, iptal; planlanan tarihler, malzeme ve mamul deposu, gecikme), üretim kaydı (FEFO ile malzeme çıkışı, gerçekleşen tüketim, tam maliyetle mamul girişi, lot), çok seviyeli üretim planı, malzeme ihtiyaç planlaması (açık iş emri ve onaylı sipariş ihtiyacı, stok, açık satın alma ve üretim netleştirmesi) ve eksiklerden satın alma talebi, üretim fişi (710 / 711 / 721 / 731) |
| **Proje Yönetimi**         | Müşteriye bağlı projeler, rol ve saatlik maliyetli proje ekibi, sürükle-bırak görev panosu (öncelik, sorumlu, termin, tahmini süre), haftalık zaman çizelgesi, işçilik ve projeye yansıtılan masraflarla bütçe takibi, geciken ve bütçesi aşan proje göstergeleri                                                                                                                                                                                                                                                                                                                       |
| **Zimmet ve Demirbaş**     | Demirbaş kartı ve QR etiket, personele / departmana / konuma zimmet, iade ve devir, elektronik onaylı zimmet tutanağı, bakım kaydı, doğrusal amortisman, zimmetli personelin işten çıkışını engelleme, QR okutarak demirbaş sayımı ve fark raporu                                                                                                                                                                                                                                                                                                                                       |
| **Stok ve Depo**           | Ürün ve varyantlar, çoklu depo, giriş / çıkış / transfer / düzeltme fişleri, hareketli ağırlıklı ortalama maliyet, lot (son kullanma tarihi) ve seri numarası takibi, barkodla stok sayımı ve otomatik düzeltme, kritik stok bildirimi                                                                                                                                                                                                                                                                                                                                                  |
| **Cari hesaplar**          | Müşteri / tedarikçi kartları, vade ve kredi limiti, döviz; değişmez cari hareket defteri, iptalde ters kayıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **CRM**                    | Potansiyel müşteri (aday) takibi ve cariye dönüştürme, aşama bazlı olasılıklı satış fırsatı hattı (pano), fırsattan teklif hazırlama (teklif fırsatı Teklif aşamasına taşır, siparişe dönüşmesi fırsatı kazandırır), kayıp nedeni, sorumluya bildirimli arama / toplantı / görev takibi, ağırlıklı hat ve kazanma oranı göstergeleri                                                                                                                                                                                                                                                    |
| **Satın Alma**             | Onay akışlı satın alma talebi, tedarikçi teklifleri ve karşılaştırma, sipariş onayı, kısmi mal kabul (lot / seri), üç yönlü eşleştirmeli alış faturası                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Satış**                  | Teklif ve siparişe dönüştürme, onayda kredi limiti kontrolü ve stok rezervasyonu, lot / seri seçimli sevk irsaliyesi, sevk edilen miktar kadar satış faturası, stoğa ve cariye işleyen satış iadesi                                                                                                                                                                                                                                                                                                                                                                                     |
| **Finans**                 | Kasa ve banka hesapları, tahsilat / ödeme ve faturalara otomatik (en eski vadeden) veya seçmeli kapama, müşteri çeki / senedi portföyü (bankaya verme, tahsil, ciro, karşılıksız), kendi çeklerimizin ödenmesi, yaşlandırma raporu ve nakit pozisyonu                                                                                                                                                                                                                                                                                                                                   |
| **Raporlar**               | Satış ve alış analizi (aylık, cari veya ürün bazında; şirket para biriminde, iadeler düşülmüş), açılış bakiyeli ve ters kayıtları ayıklayan aylık nakit akışı                                                                                                                                                                                                                                                                                                                                                                                                                           |

Sıradaki faz: canlı demo
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
- **Proje maliyeti:** Zaman kaydı, girildiği andaki ekip üyesi saatlik maliyetiyle (`projects/project-math.ts`)
  fiyatlanır; masraf modülü projeye yalnızca `ProjectsService` üzerinden dokunur: onaylanan form proje
  masrafına eklenir, iptal edilirse düşülür. Ekip üyeleri izin gerekmeden çalışır; maliyetleri yalnızca proje
  yöneticisi, lider üyeler ve `projects:read` izinliler görür. Görev numarası ve pano sırası proje satırı
  kilitlenerek verilir.
- **Bordro hesabı:** Saf fonksiyonlar (`payroll/payroll-math.ts`) 30 gün esaslı çalışır: SGK matrahı asgari
  ücret ile tavan arasında tutulur, gelir vergisi yıl içindeki kümülatif matrahla dilimlere bölünür, asgari
  ücret gelir ve damga vergisi istisnaları ayrıca hesaplanır. Oranlar şirket ve yıl bazında
  `PayrollParameter` satırında saklanır. Dönemler `DRAFT → APPROVED → PAID` ilerler; aynı anda tek taslak
  olur, onaylı aylara tarihlenen ücret değişikliği engellenir, ödeme hazineye `PAYROLL_PAYMENT` olarak
  tek satırda yazılır. Personel pusulasını yalnızca dönem onaylandıktan sonra görür.
- **İşe alım hattı:** Başvurular `APPLIED → SCREENING → INTERVIEW → OFFER` aşamalarında ilerler, `HIRED`,
  `REJECTED` ve `WITHDRAWN` kapanış aşamalarıdır; mülakat ve teklif başvuruyu yalnızca ileri taşır
  (`recruitment/recruitment-math.ts`). Mülakatçılar izin gerekmeden kendi mülakatlarını ve adayın CV'sini görür,
  değerlendirmeyi yalnızca katılımcı girer; herkes değerlendirince mülakat tamamlanır. İşe alma ilan satırı
  kilitlenerek yapılır: kabul edilmiş teklif şarttır, personel kartı (`EmployeesService.createInTx`) ve ilk
  ücret kaydı (`SalariesService.createInitial`) aynı işlemde açılır, kadro dolunca ilan kapanır.
- **Performans değerlendirme:** Dönem başlatılınca dönem bitişinden önce işe başlamış her aktif personel için
  form açılır, değerlendiren aktif yöneticidir. Form `SELF_REVIEW → MANAGER_REVIEW → COMPLETED` ilerler; hedef
  ağırlıkları %100 olmadan ve tüm puanlar girilmeden gönderilemez. Genel puan hedef ve yetkinlik puanlarının
  dönem ağırlığıyla ortalamasıdır (`performance/performance-math.ts`). Çalışan yönetici puanlarını tamamlanana
  kadar, diğerleri öz puanları gönderilene kadar görmez; form çalışana, yöneticisine ve `performance:read`
  iznine açıktır, diğerlerine 404 döner.
- **Eğitim ve sertifika:** Oturum tamamlanınca işaretlenmeyen kayıtlar `NO_SHOW` olur, katılanların
  sertifikası bitiş tarihine eğitimin geçerlilik süresi eklenerek hesaplanır. Kontenjan oturum satırı
  kilitlenerek denetlenir. Uyum raporu zorunlu eğitimlerde personelin en son sertifikasını `VALID`,
  `EXPIRING` (30 gün), `EXPIRED` veya `MISSING` olarak sınıflar (`training/training-math.ts`).
- **Destek ve SLA:** Talep açılınca önceliğin SLA hedefinden ilk yanıt ve çözüm zamanı hesaplanır; talep
  kategorinin varsayılan sorumlusuna atanır, yoksa ortak kuyruğa düşer. `WAITING` (bilgi bekleniyor) süresince
  çözüm saati durur ve talep sahibi yanıt verince bekleme süresi hedefe eklenir. Önceliği değişen talebin
  hedefleri açılış zamanından yeniden hesaplanır. SLA durumu (`ON_TRACK`, `AT_RISK`, `BREACHED`, `MET`,
  `PAUSED`) `support/support-math.ts` içindedir. Dahili notları yalnızca destek ekibi görür; talep
  sahibi çözümü onaylayıp puanlar veya yeniden açar, yanıtsız talebi geri çekerse yanıt / çözüm sayılmaz.
- **Sözleşme yaşam döngüsü:** Tarih kuralları (`contracts/contract-math.ts`) saf fonksiyonlardır: otomatik
  yenilenen sözleşmede karar tarihi fesih son günüdür (bitiş − ihbar süresi), diğerlerinde bitiş tarihidir;
  hatırlatma bu tarihten `reminderDays` gün önce dönem başına bir kez gider. BullMQ `contracts` kuyruğundaki
  günlük iş (07:00, Europe/Istanbul) her yürürlükteki sözleşmeyi satır kilidiyle işler: tarihi gelen feshi
  uygular, süresi dolanı `EXPIRED` yapar veya bugüne yetişene kadar dönem dönem yeniler, sonra hatırlatmayı
  gönderir. Sözleşmeyi `contracts:read` izinliler ve sorumlusu görür; yürürlükteki sözleşmenin tarihleri
  yalnızca yenileme ve fesihle değişir.
- **Bütçe karşılaştırması:** Gerçekleşenler kayıt tutulmaz, her istekte kaynak belgelerden derlenir
  (`budgets/budget-actuals.service.ts`): onaylı / ödenmiş masraf raporu satırları ve bordrolar, kesilmiş alış
  ve satış faturaları (satış iadeleri düşülür) ile elle girilen bütçe girişleri. Satır, kategorisi eşlenen
  kaleme, yoksa kaynağın kategorisiz kalemine yazılır; departman bütçesi alt departmanları da kapsar.
  Durum kuralları (`budgets/budget-math.ts`) saf fonksiyonlardır: gider kalemi YBK planını aşınca uyarı,
  %10'dan fazla aşınca aşım; gelir kalemi YBK planının %90'ının altındaysa geride sayılır. BullMQ `budgets`
  kuyruğundaki günlük iş (07:30, Europe/Istanbul) onaylı bütçelerde yıllık planın %90'ına ulaşan ve aşan
  gider kalemleri için sorumluya seviye başına bir kez bildirim ve e-posta gönderir; yeniden açılan bütçenin
  uyarıları sıfırlanır. Bütçeyi `budgets:read` izinliler ve sorumlusu görür.
- **Filo ve km tutarlılığı:** Her km bilgisi `vehicle_odometer_readings` tablosuna yazılır (elle giriş, yakıt,
  servis, zimmet); bir tarihteki değer o güne kadarki en yüksek okumadan düşük, sonraki okumalardan yüksek
  olamaz (`fleet/fleet-math.ts` `odometerRange`), aracın km'si en yüksek okumadır. Yakıt tüketimi depo dolumu
  yöntemiyle hesaplanır: iki tam depo arasındaki litre / km × 100; kayıt eklenip silindikçe aracın tüm
  yakıt satırları satır kilidi altında yeniden hesaplanır. Periyodik bakım sonraki bakımı km ve ay
  aralığından planlar. BullMQ `fleet` kuyruğundaki günlük iş (07:15, Europe/Istanbul) bitişi 30 gün içinde
  olan veya biten belge ve yaklaşan / geciken bakım için `fleet:update` izinlilere ve sürücüye durum başına
  bir kez bildirim ve e-posta gönderir. Aracı `fleet:read` izinliler ve güncel sürücüsü görür.
- **Otomatik muhasebe fişleri:** `AccountingPostingService` her belge türü için bir aday listesi çıkarır
  (`source` + `sourceId`, fiş tarihi, istenip istenmediği ve satırları) ve açık fişle karşılaştırır: istenen
  ama fişi olmayan belge için fiş keser, iptal edilen belgenin fişini ters kayıtla kapatır, değişebilen
  bordroda satırların parmak izi değişince ters kayıt + yeni fiş keser. Her belge `pg_advisory_xact_lock`
  altında ayrı işlemde muhasebeleşir; aynı belge iki kez fişe dönüşmez. Hesap kuralları
  `accounting/accounting-rules.ts`'tedir (ör. satış faturası 120 / 600 + 391, alış faturası 153 + 770 + 191 /
  320, maaş tahakkuku 770 / 335 + 360 + 361 + 336). Kilit tarihine düşen belgeler atlanır; elle fiş, ters kayıt
  ve kesinleştirme de kilitli döneme yapılamaz. BullMQ `accounting` kuyruğundaki iş her gece 02:30'da
  (Europe/Istanbul) tüm şirketlerde çalışır.
- **e-Fatura simülasyonu:** `POST /e-invoices` satış faturasından UBL-TR XML üretir (`einvoice-xml.ts`) ve
  kaydı kuyruğa alır; alıcının etiketi varsa e-Fatura, yoksa e-Arşiv profili seçilir. BullMQ `einvoice`
  kuyruğu (gönderimden 3 ve 8 saniye sonra, ayrıca dakikada bir) GİB'i taklit eder: kuyruktaki fatura
  doğrulanır (VKN / TCKN kontrol hanesi, etiket, satırlar, tutarlar) ve gönderildi ya da hata (1150) olur,
  gönderilen fatura alıcıya ulaşır (1300), yanıtsız TİCARİ fatura 8 gün sonra kabul sayılır. Durum geçişleri
  `FOR UPDATE` kilidiyle yapılır, her geçiş `e_invoice_events` tablosuna yazılır. Kurallar
  `einvoice/einvoice-rules.ts`'tedir. Gelen fatura kabul edildikten sonra `PurchaseInvoicesService` ile alış
  faturasına aktarılır (tedarikçi fatura no = e-fatura numarası).
- **Üretim (MRP):** ürün ağacı satırları parti miktarına göre birim başına miktara çevrilir (fire dahil,
  `production-math.ts`); iş emri açılırken bileşenler, birim işçilik ve genel üretim gideri iş emrine
  kopyalanır, sonradan yapılan reçete değişiklikleri açık iş emirlerini etkilemez. Üretim kaydı tek
  işlemde iş emrini `FOR UPDATE` ile kilitler, malzemeyi kaynak depodan çıkış hareketiyle (lotlu
  malzemede FEFO) düşer ve mamulü (malzeme + işçilik + GÜG) / miktar birim maliyetiyle hedef depoya
  alır; son kayıt kalan malzemeyi tüketir ve iş emrini kapatır. Malzeme ihtiyacı: brüt ihtiyaç = açık iş
  emirlerinin kalan bileşenleri + onaylı satış siparişlerinin kalanı (yalnız üretilen ürünler), eksik =
  brüt − stok − (açık satın alma siparişi + açık iş emri çıktısı). Muhasebe kaynağı `PRODUCTION`:
  710 / 153 malzeme, 153 / 711 + 721 + 731 mamul; üretim hareketleri genel stok fişine girmez.
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
  amortisman, stok matematiği, CRM aşama kuralları, masraf kalemi hesabı, proje ilerlemesi ve bütçe kullanımı, bordro
  hesabı (SGK tavanı, vergi dilimi geçişi, asgari ücret istisnası), işe alım hunisi ve mülakat puanı,
  performans puanı ve dağılımı, sertifika geçerliliği ve uyum oranı, SLA hedefi ve durumu,
  sözleşme dönemi, otomatik yenileme ve hatırlatma tarihi, yıllık sözleşme değeri,
  bütçe kalemi durumu, kategori eşlemesi ve plan / gerçekleşen karşılaştırması,
  plaka doğrulama, km aralığı, depo dolumu tüketimi, belge ve bakım durumu,
  fiş satırı normalleştirme, mizan, bilanço ve gelir tablosu, belge başına muhasebe kuralları,
  VKN / TCKN kontrol hanesi, GİB numarası, profil seçimi, e-fatura doğrulaması ve durum geçişleri,
  UBL-TR XML üretimi, ürün ağacı birim miktarı ve maliyeti, standart tüketim, çok seviyeli patlatma,
  döngü kontrolü, net ihtiyaç ve üretilebilir miktar, numaralandırma gibi saf iş kuralları.
- **Uçtan uca testler (Supertest):** kimlik doğrulama, İK, puantaj ve vardiya, zimmet ve demirbaş sayımı, stok akışları,
  CRM hattı (adayın dönüştürülmesi, teklifle fırsat kazanma), masraf formu (onay, ödeme, ters kayıt, gizlilik),
  proje yönetimi (ekip yetkisi, görev panosu, haftalık zaman çizelgesi, projeye masraf yansıtma),
  bordro (pusula gizliliği, kümülatif matrah, onay / ödeme / ters kayıt, ücret geçmişi, parametreler),
  işe alım (mülakatçı yetkisi, değerlendirme, teklif, adayı personele dönüştürme, ret ve yeniden açma),
  performans (form görünürlüğü, hedef ağırlığı, geri gönderme, puan hesabı, onay, yeniden açma),
  eğitim (kontenjan, self-servis kayıt, katılım, sertifika süresi, geri bildirim, uyum raporu),
  destek (talep görünürlüğü, dahili not, SLA duraklatma, öncelik değişimi, yeniden açma, puanlama, ekler),
  sözleşmeler (sorumlu yetkisi, taraf ve süre kuralları, yürürlüğe alma, yenileme, fesih, günlük iş, ekler),
  bütçe (sorumlu görünürlüğü, kalem eşleme kuralları, plan / onay / revizyon, departman kapsamı,
  belge kırılımı, geçen yıldan kopyalama, seviye başına tek uyarı),
  filo (sürücü self-servisi, plaka kuralları, zimmet devri, km tutarlılığı, tüketim hesabı, bakım planı,
  belge durumları, durum başına tek hatırlatma, silme ve hizmetten çıkarma),
  muhasebe (yetki sınırları, açılış / fatura / tahsilat fişleri, iptalde ters kayıt ve tekrar çalıştırmada
  değişmezlik, elle fişin dengesi, kesinleştirme ve ters kaydı, dönem kilidi, mizan ve bilanço dengesi,
  alt hesap ve sistem hesabı kuralları),
  e-Fatura (yetki sınırları, gönderim ve GİB durumları, doğrulama hatası ve yeniden gönderme, alıcı reddi,
  e-Arşiv iptali, satış faturası iptal kuralı, gelen faturayı kabul edip alış faturasına aktarma, ayarlar),
  üretim (yetki sınırları, ürün ağacı doğrulaması ve varsayılan reçete, FEFO lotlu üretim kaydı ve maliyet,
  eksik kapatma ve iptal, kullanılan reçetenin silinmemesi, üretim planı, malzeme ihtiyacı ve satın alma
  talebi, üretim fişi)
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
