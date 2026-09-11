# OKX long/short bot altyapısı — tasarım önerisi

Durum: Kullanıcı 8 Eylül 2026 tarihinde uygulamayı onayladı. Stratejiye hazır altyapı uygulandı; canlıya geçiş ve strateji doğrulama aşamalarının mevcut sınırları `docs/okx-bot.md` içinde kayıtlıdır.

## Amaç ve kapsam

Mevcut Next.js uygulamasına `/bot` kontrol paneli, OKX veri/hesap adaptörü, strateji eklenti sözleşmesi, backtest motoru, risk motoru ve kalıcı emir günlüğü eklemek. Kullanıcı strateji kurallarını daha sonra verecek. Bu aşamada uydurma strateji veya başarı sonucu oluşturulmaz. Strateji yokken motor `strategy_missing` durumunda bekler.

Hedef piyasa OKX üzerinde işlem gören, USDT uzlaşmalı doğrusal sürekli vadeli sözleşmelerdir. Long ve short desteklenir. Spot USDT çiftleriyle vadeli sözleşmeler karıştırılmaz. Kullanıcının başlangıç sermayesi beklentisi 200 USDT; gerçek kullanılabilir bakiye emir öncesinde borsadan okunur.

## Mimari seçenekleri ve seçim

1. Önerilen: Mevcut Next.js paneli + ayrı Node.js worker + SQLite kalıcı durum. Aynı makinede çalışır, tarayıcıdan bağımsızdır; tek worker kilidi ve yeniden başlatma uzlaştırması gerekir.
2. Yalnız Next.js istekleri içinde döngü: Kurulumu kısa ancak istek yaşam döngüsü ve sunucu yeniden başlatmaları sürekli pozisyon takibine uygun değil.
3. Ayrı işlem servisi ve PostgreSQL: Birden fazla sunucuya uygun, ilk tek kullanıcılı sürüm için ek işletim yükü.

Önerilen ilk sürüm tek makine ve tek hesap içindir. Worker durursa borsada kabul edilmiş koruyucu emirler kalır; uygulama içi stop taşıma devam etmez. 24/7 kullanım için makine veya sunucunun açık kalması gerekir.

## Bileşenler

- `src/lib/bot/`: strateji sözleşmesi, kapanmış mum eşlemesi, risk hesabı, pozisyon durum makinesi ve backtest.
- `src/lib/server/okx/`: sunucuya özel yapılandırma, imzalama, REST istemcisi, enstrüman, mum, bakiye, pozisyon ve emir adaptörleri.
- `src/lib/server/bot/`: SQLite repository, tek worker kilidi, hesap/emir uzlaştırması, kontrol yetkilendirmesi.
- `scripts/bot-worker.ts`: sınırlı eşzamanlı veri taraması, kapanmış mum tetikleyicisi, yeniden başlama ve emir takibi.
- `src/app/api/bot/`: durum, ayarlar, tarama/backtest işleri ve worker kontrol istekleri. Uzun işler istek içinde çalışmaz.
- `src/app/bot/page.tsx`, `src/features/bot/`: bağlantı, mod, worker kalp atışı, risk ayarları, fırsatlar, açık pozisyonlar, işlem günlüğü ve backtest sonuçları.

Tarayıcıdan bağımsız kalıcı durum mevcut Dexie portföy verisinden ayrılır. Anahtarlar, imzalar ve ham özel API cevapları istemciye veya günlüklere verilmez. Kontrol uçları sunucu tarafı oturum/erişim doğrulaması ve origin kontrolü olmadan işlem başlatamaz. Varsayılan yerel erişim; internete açma bu teslimata dahil değildir.

## Yapılandırma ve modlar

- `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`: gerçek hesap bağlantısı.
- Demo için ayrı `OKX_DEMO_API_KEY`, `OKX_DEMO_API_SECRET`, `OKX_DEMO_API_PASSPHRASE`.
- Bölgesel OKX adresi doğrulanmış sabit izin listesiyle yapılandırılır; kimlik bilgileri kullanıcı girdisi olan rastgele adrese gönderilmez.
- İlk açılış `paper`: gerçek piyasa verisi, yerel sanal bakiye, borsaya emir yok.
- `demo`: ayrı demo anahtarları ve OKX simulated-trading başlığı; gerçek anahtar demo olarak varsayılmaz.
- `live`: strateji, test kabulü ve kullanıcı tarafından ayrıca etkinleştirme gerektirir. Bu aşamada canlı emir gönderilmez.
- Bot transfer veya para çekme akışı içermez; kullanıcı bakiyeyi kendisi hazırlar.

## Veri ve strateji sözleşmesi

Enstrüman evreni OKX kataloğundan alınır. Aktiflik, sözleşme tipi, USDT uzlaşma, minimum miktar, miktar adımı, fiyat adımı ve kontrat değeri doğrulanır. Likidite, spread ve yeterli veri geçmişi filtreleri ayarlanabilir; yalnız geçmiş kazanma yüzdesine göre seçim yapılmaz.

Strateji sürümlü bir arayüzle yalnız kapanmış 15m, 1H ve 4H mumlarını alır. Karar anından sonra kapanan üst zaman dilimi mumu görülemez. Mum boşluğu, eskilik veya yetersiz ısınma döneminde yeni giriş engellenir.

Strateji `wait` veya yön, giriş koşulu, ilk stop, TP seviyeleri, geçerlilik süresi ve üç zaman diliminin teyit gerekçelerini içeren sinyal döndürür. TP dağılımı ve stop taşıma koşulları da strateji parametresidir. Kullanıcının sonraki promptu bu kuralları belirler. Altyapı testlerindeki sentetik stratejiler ticaret önerisi olarak panelde sunulmaz.

## Önerilen başlangıç risk ayarları

Bunlar tasarım varsayımlarıdır; optimize edilmiş sonuç değildir:

- İşlem başına özsermayenin %0,5'i: 200 USDT için yaklaşık 1 USDT planlanan stop riski.
- Toplam açık planlanan risk %1, en fazla 2 eşzamanlı pozisyon.
- Günlük özsermaye kaybı %2'ye ulaştığında yeni giriş durur; açık pozisyonların koruması devam eder. Gün UTC, eşik gün başı özsermayeye göre ücretler ve açık PnL dahil hesaplanır; para yatırma/çekme PnL sayılmaz.
- Başlangıç 5x; ayarlanabilir üst sınır 10x. İzole marjin ve tek yönlü pozisyon modeli. Mevcut hesap modu uyuşmazsa hesap modu otomatik değiştirilmez.
- Önerilen minimum maliyet sonrası ödül/risk 2:1. Çoklu TP varsa ağırlıklı planlanan ödül hesaplanır.

Miktar, stop mesafesi ve tahmini maliyetlerden hesaplanır; kaldıraç risk bütçesini çarpmaz. OKX kontrat birimleri ve adımlarına aşağı yuvarlanır, yuvarlama sonrası risk/RR/marjin tekrar doğrulanır. Minimum emri karşılamak için risk artırılmaz. Marjin rezervi ve likidasyon tamponu sağlanmıyorsa işlem reddedilir. Stop riski tahmindir; kayma nedeniyle fiili kayıp aşılabilir.

## Emir yaşam döngüsü

Her sinyal için strateji sürümü, enstrüman, yön ve mum kapanışından tekil kimlik türetilir. Emir niyeti gönderimden önce kalıcı kaydedilir. Timeout veya bağlantı hatasında tekrar emir göndermeden önce istemci emir kimliğiyle borsa sorgulanır.

Kısmi dolum, ret, iptal, dolum ve çıkış ayrı durumlar olarak takip edilir. Gerçekleşen miktar için borsada koruyucu stop teyit edilmeden pozisyon korunmuş sayılmaz. Ek TP/SL emirlerinin kısmi dolum davranışı adaptör testlerinde doğrulanır; koruma kurulamıyorsa yeni girişler durdurulur ve dolan miktar için acil kapatma yolu işletilir. Kapatma da teyit edilemiyorsa kritik durum görünür tutulur.

Stop yalnız riski azaltan yönde taşınır. Başabaş seviyesi maliyetleri hesaba katar; entry fiyatı sıfır net zarar anlamına gelmez. Azaltıcı çıkışlar pozisyon tersine çeviremez. Bot yalnız kendisine ait emir/pozisyonları yönetir; aynı enstrümanda harici pozisyon tespitinde yeni giriş durur.

Worker yeniden başladığında önce borsa ile açık emir ve pozisyonlarını uzlaştırır. Durdur komutu yeni girişleri keser, koruyucu takibi sürdürür. Acil kapat ayrı, açıkça etiketli kullanıcı komutudur. Mod geçişi açık iş veya pozisyon varken engellenir.

## Backtest ve başarı ölçümü

Aynı strateji/risk sözleşmeleri tarihsel oynatmada kullanılır. Karar kapanmış mumda, en erken sonraki erişilebilir fiyat üzerinde gerçekleşir. Aynı mumda stop ve TP görülürse daha düşük zaman çözünürlüğü yokken ihtiyatlı olarak stop önce uygulanır. Stop taşıma geçmiş mumun önceki fiyatlarına uygulanmaz.

Komisyon, spread/kayma, funding, kontrat yuvarlaması ve marjin kısıtları hesaplanır. Eksik funding veya tarihsel enstrüman bilgisi raporda belirtilir ve sonuç canlıya geçiş kanıtı olarak kabul edilmez. Kaldıraç/likidasyon varsayımları raporlanır; sade OHLC modeli gerçek dolum garantisi vermez.

Eğitim, doğrulama ve dokunulmamış test dönemleri ayrılır. Coin seçimi yalnız seçim anına kadar olan veriyi kullanır; sonuçları görülen coinlerde tekrar seçim yapmanın yanlılığı engellenir. Listeden çıkan coin/veri eksikliği ayrıca raporlanır.

Panel net kazanma oranı, işlem sayısı, ortalama kazanç/kayıp, net beklenti, profit factor, maksimum düşüş, ücret/funding ve dönem/coin bazlı sonuçları gösterir. Kazanç, tüm kısmi çıkışlar ve maliyetler birleştirilmiş kapanmış işlemin pozitif net PnL'sidir; başabaş ayrı gösterilir.

%60+ yalnız hedef; garanti değildir. Önerilen ilk inceleme eşiği ayrılmış testte en az 100 kapanmış işlem, %60 veya üzeri net kazanma oranı, pozitif net beklenti, profit factor en az 1,3 ve en fazla %10 düşüştür. Güven aralığı ve dönem dağılımı da gösterilir; eşikleri geçmek otomatik canlı onayı değildir. Kesin kabul ölçütleri strateji promptundan sonra netleştirilir.

## Doğrulama ve teslimat sınırı

İmzalama, hata/saat/rate-limit, veri eşleme, ileri veri sızıntısı, long/short kontrat miktarı, maliyet sonrası RR, günlük kayıp, mükerrer emir, kısmi dolum koruması, yeniden başlama ve stop taşıma için anlamlı birim/entegrasyon testleri. Panel için bağlantı eksikliği, strateji bekleme, mod ayrımı ve günlük ekranı tarayıcı testleri. TypeScript, ESLint ve production build.

Kimlik bilgisi eksikliği public veri ve paper altyapısını engellemez; özel hesap/demo doğrulaması ayrı eksik olarak raporlanır. Kullanıcı stratejisi verilmeden gerçek strateji backtesti veya %60 başarı iddiası yapılamaz. Canlı emir denemesi bu altyapı teslimatının doğrulama adımı değildir.

Kaynak: https://www.okx.com/docs-v5 — API authentication, Demo Trading, instruments, orders ve attached TP/SL belgeleri; 8 Eylül 2026 tarihinde kontrol edildi. Uygulamada ilgili Next.js kılavuzları `node_modules/next/dist/docs/` içinden okunacak.
