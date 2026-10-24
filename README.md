# SpoolTrack v0.8 — Mobil MVP

Tersane ve yat projelerinde izometri, spool üretimi ve malzeme takibi. React + TypeScript + Vite, PWA (telefona ana ekrandan eklenir), SheetJS ile Excel içe aktarma, Firebase Authentication + Cloud Firestore ile çok kullanıcılı kullanım.

`legacy/streamlit-v0.6/` klasöründe devralınan Streamlit/SQLite prototipi değiştirilmeden duruyor. Normalizasyon kuralları ve ISO durum mantığı oradan alınıp spesifikasyona göre düzeltildi (bkz. “v0.6'dan farklar”).

## Hızlı başlangıç (yerel mod)

Node.js 20+ gerekir.

```bash
npm install
npm run dev          # http://localhost:5173 — aynı Wi-Fi'deki telefondan da açılabilir
```

Firebase ayarı yoksa uygulama **Yerel mod**da çalışır: veriler tarayıcının IndexedDB'sinde saklanır, sayfa yenilense de kaybolmaz, ama yalnızca o cihazdadır. Hesap ekranından “Admin” ve “Üretim Mühendisi” görünümleri arasında geçilebilir. Gerçek çok kullanıcılı kullanım için Firebase kurun.

## Firebase kurulumu (çok kullanıcılı)

1. [Firebase console](https://console.firebase.google.com) → yeni proje.
2. **Authentication → Sign-in method → Email/Password**'ü açın.
3. **Firestore Database** oluşturun (production mode, `eur3` önerilir).
4. **Project settings → Your apps → Web app** ekleyin, config değerlerini `.env.example`'ı `.env` olarak kopyalayıp doldurun.
5. Kuralları ve uygulamayı yayınlayın:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add            # projenizi seçin
   npm run build
   firebase deploy --only firestore:rules,hosting
   ```
6. **İlk admin:** uygulamada kayıt olun (hesap “Onay bekliyor” durumunda açılır). Firebase console → Firestore → `users/{uid}` belgesinde `role` alanını `admin` yapın. Sonraki kullanıcıları uygulamanın **Hesap → Kullanıcılar** bölümünden onaylarsınız.

Roller: `pending` (erişim yok) · `engineer` (proje/konum/sistem seçer, spool durumu günceller, ISO ve malzeme durumunu görür) · `admin` (proje oluşturur, Excel yükler, raporlar, kullanıcı yönetimi). Yetkiler `firestore.rules` ile **veritabanı tarafında** uygulanır: üretim mühendisi bir spoolda yalnızca `status`, `updatedAt`, `updatedBy` alanlarını değiştirebilir; proje ve ana verileri yazamaz/silemez.

Firestore çevrimdışı önbelleği açıktır: sinyal olmayan yerde yapılan durum değişiklikleri bağlantı gelince gönderilir.

## Kullanım

**Admin → Veri Yükleme** (sırayla):
1. Proje oluştur
2. İzometri Excel'i → 3. Spool Excel'i → 4. Toplam malzeme listesi → 5. Spool malzeme listesi

Her adımda “Şablon” butonu doğru başlıklı Excel'i indirir. Dosya seçildiğinde **hiçbir şey kaydedilmeden** önizleme gösterilir: eksik sütunlar, geçersiz satırlar (Excel satır numarasıyla), dosyada mükerrer kayıtlar, sistemde zaten kayıtlı olanlar, eşleşmeyen spool/izometri/malzemeler. “X kaydı aktar” ile onaylanınca yazılır.

**Üretim** ekranı: Proje → Zone/Block → Sistem. Üstte toplam/başlamadı/devam/bitti ve ilerleme yüzdesi; SPOOL sekmesinde her spoolda üç büyük durum butonu (tek dokunuş), durum filtresi ve arama; ISO sekmesinde otomatik hesaplanan ilerleme ve durum.

**Malzeme** ekranı: toplam ihtiyaç, bitenlerde kullanılan, devam edenlere ayrılan, kalan ihtiyaç, depo stoğu, eksik satın alma. Sistem, Zone/Block, ölçü ve açıklama filtresi; Excel'e aktarım.

**Raporlar** (admin): proje, Zone/Block, sistem, ISO ilerlemesi, eksik satın alma; tümü tek Excel dosyasında (biten/üretimdeki/başlamayan spool listeleri dahil).

## Tersane raporu (GENERAL_REPORTS) yükleme

**Veri Yükleme → 2. Tersane raporu** adımı, “Spool List” ve “Material List” sayfaları olan rapor dosyasını (ör. `NB012-ZC1-GENERAL_REPORTS.xlsx`) dönüştürmeden okur. Sayfa adları değil sütun başlıkları aranır; başlık satırı üstteki başlık bloğundan (HULL NO, DATE, REVISION NO) sonra otomatik bulunur.

- **HULL NO** proje adı olarak önerilir (“NB012 projesini oluştur” butonu).
- **Pipeline** = izometri. Revizyon spool bazındadır: her spool kendi revizyonunu taşır, izometride en yüksek revizyon gösterilir.
- Her spool kendi **Zone** ve **Block** bilgisini taşır. Üretim ekranında Zone C1'i veya Block 107'yi seçebilirsiniz. Bir pipeline'ın spoolları farklı bloklardaysa ISO ilerlemesi pipeline'ın tüm spoollarından hesaplanır.
- **Production Note** spool kartında uyarı olarak gösterilir (ör. “DO NOT WELD!!”).
- “DELETE SPOOL” notlu satırlar spool olarak alınmaz; önizlemede listelenir.
- Aynı pipeline + spool iki kez geçerse ikincisi alınmaz ve hangi bloklarda olduğu gösterilir.
- **Yeni rapor yüklendiğinde:** yeni spoollar eklenir. Değişen revizyon, not ve konum bilgileri güncellenir. Sahadaki durum hiçbir zaman değişmez; revizyonu değişen ve üretimi başlamış spoollar önizlemede ayrıca uyarılır. Raporda artık bulunmayan spoollar silinmez, uyarı olarak listelenir.
- **Malzeme listesi** bir özet: malzeme kodu, depo stoğu ve spool bazında dağılım içermiyor. Bu yüzden:
  - Kod, malzemenin tanımından (açıklama, ölçü, sınıf, açı, malzeme, standart) türetilir (`M-xxxxxxxx`). Aynı satır her yüklemede aynı kodu alır.
  - Aynı malzeme iki kez listelenmişse miktarlar toplanır.
  - Açıklaması olmayan toplam satırları alınmaz.
  - Birim: boru ve izolasyon **mm** kabul edilir (değerler 84808 gibi), diğerleri **adet**.
  - Stok 0 alınır, bu yüzden eksik satın alma = kalan ihtiyaç olur.
  - “Kullanılan” miktarlar ancak spool malzeme listesi (şablon adımı 6) yüklenirse hesaplanır.

Gerçek bir rapor dosyasıyla test etmek için (dosya repoya eklenmez):

```bash
REAL_FILE=/yol/NB012-ZC1-GENERAL_REPORTS.xlsx npx vitest run src/domain/real-file.node.test.ts
REAL_FILE=/yol/NB012-ZC1-GENERAL_REPORTS.xlsx npm run test:e2e
```

## İş kuralları

| Konu | Kural |
|---|---|
| İzometri anahtarı | proje + izometri_no + revizyon. Belge kimliği bu anahtardan üretilir; tekrar yükleme ikinci kayıt oluşturamaz. |
| Spool anahtarı | izometri kaydı + spool_no. Spool **aynı revizyondaki** izometriye bağlanır; revizyon eşleşmezse başka revizyona düşmez, hata listesine girer. |
| Malzeme anahtarı | proje + malzeme_kodu. Tekrar yüklemede miktar/stok **güncellenir**. |
| Spool malzeme anahtarı | spool + malzeme_kodu. Tekrar yüklemede miktar güncellenir. |
| Kimlik normalizasyonu | izometri_no, spool_no, revizyon, konum_adi, malzeme_kodu: boşluklar kırpılır, büyük harfe çevrilir (`fo-120-001` = `FO-120-001`). Sistem adları büyük/küçük harf duyarsız eşleşir, projedeki ilk yazım korunur. |
| konum_turu | Zone/zone/ZONE/zon → Zone; Block/block/Blok/blok/BLK → Block. Diğer değerler **hata** (sessizce Zone yapılmaz). |
| baslangic_durumu | Bekliyor/Not Started → Başlamadı; Üretimde/In Progress → Devam Ediyor; Tamamlandı/Completed/Done → Bitti. Tanınmayan değer hata; boş hücre uyarıyla Başlamadı. |
| Yeniden spool yükleme | Kayıtlı spoolun sahadaki durumu **korunur**, Excel'deki başlangıç durumu uygulanmaz. |
| ISO durumu | Elle değiştirilemez. Spool yoksa “Spool Tanımlanmamış”; hepsi bittiyse Bitti; en az biri devam/bitti ise Devam Ediyor; değilse Başlamadı. İlerleme = biten / toplam. |
| Malzeme hesapları | Saklanan miktarlar **hiç azaltılmaz**; her ekranda spoolların güncel durumundan hesaplanır. Bitti → geri alınırsa malzeme otomatik geri gelir, çift düşüm olmaz. Kalan = toplam − bitenler; eksik = max(0, kalan − stok). |
| Filtreli malzeme raporu | Sistem veya Zone/Block filtresi açıkken “toplam ihtiyaç” o kapsamdaki spool malzeme listelerinin toplamıdır. Depo stoğu proje geneli olduğundan stok ve eksik satın alma yalnızca filtresiz görünümde gösterilir. |
| Spool listeleri > toplam | Spool malzeme toplamı toplam listedeki ihtiyacı aşarsa yükleme önizlemesinde ve raporda ⚠ uyarısı. |

## Testler

```bash
npm test                 # 29 birim/entegrasyon testi (Vitest)
npm run build
npm run test:e2e         # gerçek tarayıcıda telefon ekranında uçtan uca test (Playwright)
                         # kurulu Chrome kullanmak için: CHROME_PATH=/path/to/chrome npm run test:e2e
npm run templates        # şablonları ve test-data/ dosyalarını yeniden üretir (python3 + openpyxl)
```

Uçtan uca test `test-data/` içindeki gerçek .xlsx dosyalarını arayüzden yükler (kasıtlı hatalı satırlar dahil), 390×844 telefon ekranında durumları dokunarak değiştirir, ISO ve malzeme sonuçlarını, Excel dışa aktarımını, sayfa yenilemeden sonra kalıcılığı, mühendis görünümünü ve PWA manifest/service worker'ı doğrular.

## Durum

| Özellik | Durum |
|---|---|
| Excel 1–4 yükleme, önizleme, doğrulama, mükerrer önleme | Çalışıyor, birim + tarayıcı testli |
| Proje → Zone/Block → Sistem seçimi | Çalışıyor, tarayıcı testli |
| SPOOL tek dokunuş durum, filtre, arama | Çalışıyor, tarayıcı testli |
| ISO otomatik ilerleme | Çalışıyor, birim + tarayıcı testli |
| Malzeme hesapları ve raporu, Excel'e aktarma | Çalışıyor, birim + tarayıcı testli |
| Raporlar + Excel'e aktarma | Çalışıyor, tarayıcı testli (sayfa adları ve satır sayısı) |
| Yerel kalıcılık (IndexedDB) | Çalışıyor, test edildi (sayfa yenileme) |
| PWA (manifest, service worker, ikonlar) | Çalışıyor, tarayıcı testli. Gerçek telefonda “Ana ekrana ekle” henüz denenmedi. |
| Açık/koyu tema, telefon kart / masaüstü tablo | Çalışıyor, ekran görüntüleriyle kontrol edildi |
| Firebase Auth + Firestore backend | Kod yazıldı ve Firebase SDK'ya karşı tip kontrolünden geçiyor. **Gerçek Firebase projesine karşı çalıştırılmadı** (geliştirme ortamında Firestore emülatörü indirilemedi). İlk kurulumda giriş, kayıt, onay ve durum güncellemesi elle denenmeli. |
| `firestore.rules` | Yazıldı, **emülatörde test edilmedi**. Yayından önce Rules Playground veya emülatörle denenmeli. |
| Firebase Storage | Kullanılmıyor: Excel tarayıcıda okunur, dosyanın kendisi saklanmaz. |

## Bilinen sınırlamalar

- **SheetJS sürümü:** derleme ortamında SheetJS CDN'i erişilemediği için npm'deki `xlsx@0.18.5` kullanıldı (bilinen güvenlik açıkları var: CVE-2023-30533, CVE-2024-22363; yalnızca admin'in yüklediği dosyaları etkiler). Yayından önce düzeltilmiş sürüme geçin (API aynı):
  ```bash
  npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
  ```
- Firestore'da bir proje açıldığında projenin tüm verisi okunur. Birkaç bin spool için uygundur; on binlerce spool malzeme satırında okuma maliyeti artar, o noktada sorgu bazlı yüklemeye geçilmeli.
- Firestore'da 450'den fazla kayıtlık yüklemeler birden fazla batch'te yazılır; ortada bağlantı koparsa yükleme yarım kalabilir. Aynı dosyayı tekrar yüklemek güvenlidir (kimlikler sabit, mükerrer oluşmaz).
- Hatalı yüklenmiş veriyi düzeltme/silme ekranı yok (spesifikasyondaki “verileri düzeltme”). Şimdilik düzeltme Excel ile yeniden yüklemeyle (malzeme/miktar) veya Firebase console'dan yapılır.
- Kullanıcı hesabı kişinin kendisi tarafından açılır, admin onaylar; admin'in doğrudan hesap oluşturması yok.

## v0.6'dan farklar (tespit edilen hatalar)

v0.6 çalışıyor (Streamlit açılıyor) ama spesifikasyona göre şu sorunlar vardı, hepsi v0.7'de giderildi:
- Bilinmeyen `konum_turu` (`Deck`, boş) sessizce **Zone** yapılıyordu.
- Bilinmeyen `baslangic_durumu` sessizce **Başlamadı** yapılıyordu.
- Spool yüklemede revizyon boşsa izometrinin **son revizyonuna** bağlanıyordu (revizyon karışması).
- Önizleme yalnızca ilk 50 satırı gösteriyordu; geçersiz/mükerrer/eşleşmeyen satırlar listelenmiyor, sadece sayılıyordu.
- Malzeme yönetimi (Excel 3/4, hesaplar, rapor) hiç yoktu.
- Spoolu olmayan izometri “Spool Tanımlanmamış” yerine “Başlamadı” görünüyordu.
- Durum değişikliği tablo içi açılır menü + ayrı “Kaydet” butonuyla yapılıyordu; filtre ve arama yoktu.
- Kimlik doğrulama, roller, çok kullanıcılı veri ve PWA yoktu.
