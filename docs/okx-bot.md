# OKX bot altyapısı

Panel: `http://localhost:3000/bot` — sol menüde **Kripto bot**.

## Çalıştırma

Node.js 22.13 veya üzeri gerekir; mevcut ortam 22.17.0 ile doğrulandı. SQLite bu Node sürümünde deneysel uyarı yazabilir.

```powershell
npm install
npm run dev
```

Ayrı terminalde:

```powershell
npm run bot:worker
```

Worker, panelden alınan tarama/bağlantı/backtest işlerini yürütür. Tek çevrim kontrolü için `npm run bot:once`. Birden fazla worker aynı veritabanında aktif olamaz. Bir süreç zorla kapatılırsa kilidi en fazla 60 saniye içinde sona erer; yarım kalan işler başarısız işaretlenir.

Panelde **Şimdi tara** tek bir iş kuyruğa alır. **Otomatik taramayı aç** açık worker'a dakikada bir tarama yaptırır; süreç başlatmaz. Süreç kapalıysa işler sırada kalır. Bilgisayar uyuduğunda veya kapandığında worker da çalışmaz.

Üretim arayüzü `npm run build` ve `npm start` ile açılır; worker ayrı tutulur. Desteklenen başlatma komutları `127.0.0.1` adresine bağlanır. Bu tek kullanıcılı yerel sürümü farklı hostname, açık proxy veya port yönlendirmesiyle internete/LAN'a açmayın; uzaktan kullanım için ayrıca gerçek kullanıcı kimlik doğrulaması gerekir.

## Kimlik bilgileri

`.env.local` içinde:

```dotenv
OKX_API_KEY=
OKX_API_SECRET=
OKX_API_PASSPHRASE=
OKX_REGION=global
```

`OKX_SECRET_KEY` ve `OKX_PASSPHRASE` eşanlamlı alan adlarıdır. Secret ve passphrase anahtar oluştururken verilen ayrı bilgilerdir; API passphrase, OKX hesap giriş parolası değildir. Özel hesap API'sinde üç alan da gereklidir. Anahtar değerleri panelde gösterilmez. Anahtar değerlerini sohbete, kaynak koduna veya ekran görüntüsüne koymayın.

Demo bağlantısı ayrı `OKX_DEMO_API_KEY`, `OKX_DEMO_API_SECRET`, `OKX_DEMO_API_PASSPHRASE` gerektirir. Gerçek anahtar simulated-trading anahtarı olarak kullanılamaz. Bölge `global`, `us`, `eea`, `tr` olabilir; hesabın bölgesini kullanın. Ortam değişikliğinden sonra arayüzü ve worker'ı yeniden başlatın.

**Bağlantı denetle** yalnız hesap bilgisi okur; emir, transfer veya çekim yapmaz. Anahtarların dosyada bulunması bağlantının doğrulandığı anlamına gelmez. Global public veri `openapi.okx.com` adresinden gelir; özel erişim ve bölgesel vadeli ürün yetkisi ayrıca doğrulanmalıdır.

## Bu teslimatta çalışanlar

- Aktif doğrusal USDT kripto sürekli vadeli sözleşme kataloğu, güncel spread/hacim ve likidite filtreleri. Yalnız OKX kripto kategorisi (`instCategory=1`) alınır; hisse, emtia, döviz ve kategorisi belirsiz ürünler elenir. 24 saat USDT hacmi, baz hacim × son fiyat yaklaşımıdır.
- 15m, 1H, 4H kapanmış mum adaptörü ve sınırlı sayfalama ile geçmiş veri indirme.
- 200 USDT başlangıç paper hesabı; ayarlanabilir 5–10x kaldıraç, stop tabanlı miktar, maliyet sonrası RR, kontrat/fiyat adımları ve minimum emir kontrolleri.
- Pozisyon başına %0,5, toplam %1 risk; UTC günlük %2 kayıpta yeni girişleri durdurma varsayılanları. Pozisyon koruma takibi durdur komutundan sonra sürer.
- Paylaşılan paper/backtest çekirdeğinde long/short, kısmi TP, başabaş ve takip stopu; sinyal kimlikleri, tekrar işlem engeli, SQLite kalıcılığı.
- Backtest çekirdeğinde sonraki mum açılışı, komisyon, kayma ve verilen funding olayları; aynı mumda stop/TP belirsizliğinde stop önce. İşlem sayısı, net kazanma oranı ve %95 Wilson aralığı, net beklenti, kâr faktörü ve düşüş.
- Sunucu tarafında imzalı demo emir adaptörü; canlı yazma kapısı kapalı. Belirsiz cevaplarda otomatik emir tekrarı yok.
- Demo emir yaşam döngüsü çekirdeği ve worker kilidine bağlı atomik SQLite emir kaydı: önce niyet kaydı, belirsiz gönderimde sorgulama, kısmi doluma koruma, koruma başarısızlığında azaltıcı kapatma ve borsada düz pozisyon teyidi. Borsa koruma/pozisyon doğrulama portları bağlanmadan çalıştırılamaz.
- Yerel HttpOnly oturum, origin kontrolleri, iş kuyruğu, worker kalp atışı ve kalıcı günlük.

## Aktif strateji

`CryptoBot.txt` temel alınarak **MPA teyitli yapı 1.0.0** bağlandı. Günlük/haftalık yön, 4H teyit, hacimli 1H yapı kırılımı ve 15m retest/geri kazanım aranır. TP1 en yakın karşı yapıdır; yaklaşık %85 kapanır, kalan miktar önce giriş fiyatına, sonra teyitli 1H swing seviyelerine çekilen stopla izlenir. Başlangıç stopu genişletilmez; azami tutma süresi 7 gündür. Kurallar ve yorum sınırları [MPA strateji belgesinde](mpa-strategy.md).

Strateji kapanmış üç zaman dilimi, ısınma sayıları, yön/entry/stop/TP dağılımı, sinyal ömrü ve teyit gerekçeleri verir. Başabaş ve trailing parametreleri de stratejiye aittir. Altyapı testlerindeki sentetik stratejiler panelde seçilemez.

Paper, kapanan mumları geriden oynatır; gerçek zamanlı borsa dolum simülasyonu değildir. Risk ayarlarını değiştirmek için otomatik taramayı durdurmak, açık pozisyon/işlerin tamamlanmasını beklemek gerekir. Başlangıç sermayesi başlamış işlem oturumunu sıfırlamaz.

## Canlıya geçmeden tamamlanacak strateji doğrulaması

Bu sürüm **canlı işlem botunun etkinleştirilmiş hali değildir**. Demo emir yaşam döngüsü ve borsa koruma doğrulamaları, gerçek demo hesabıyla uçtan uca sınanmadan worker'a bağlanmaz. Canlı mod için panelde açılabilir bir anahtar yoktur. Transfer ve para çekme işlevi yoktur.

Panelden başlatılan backtest, gerçek funding oranları ve 15m mark mumunun açılış fiyatını yaklaşık settlement fiyatı olarak kullanır. Eksik maliyet/veri kapsamı açıkça raporlanır ve doğrulamayı geçemez. Marjin tamponu gerçek likidasyon modelinin yerine geçmez; gerçek borsa likidasyonu ve tarihsel kontrat kuralları doğrulanmış değildir.

Backtest dönemi kronolojik olarak ilk ⅔ geliştirme, son ⅓ ayrılmış test şeklinde bölünür; her bölüm ayrı başlangıç sermayesiyle çalışır. Testte en az 100 işlem, en az %60 net kazanma, pozitif beklenti, en az 1,30 kâr faktörü, en fazla %10 düşüş ve tam funding kapsamı aranır. %60+ garanti değildir. Tarihsel eleme tek başına gerçek işlem yetkisi vermez (`eligible: false`); ileri paper doğrulaması, tarihsel coin seçimi/portföy etkisi ve borsa koruma bağlantısı ayrıca tamamlanmalıdır.

Sabit BTC/ETH/SOL/XRP/ADA, 90 gün karşılaştırması: `npm run bot:research`. Aynı komut ağ kesintisinden sonra kayıtlı dönemi önbellekten sürdürür; yeni tarihli dönem için `npm run bot:research:fresh`. Sonuçlar panelde ve `artifacts/bot-research/` altında; yalnız halka açık mum/funding verisi `.bot-data/market-cache/` içinde tutulur.

## Veri ve testler

Kalıcı bot verisi `.bot-data/bot.sqlite` ve SQLite yan dosyalarındadır; Git dışında tutulur. Portföyün Dexie verisiyle karışmaz. Veriyi yedeklemek için worker ve web sunucusunu durdurup dizini birlikte kopyalayın. Anahtarlar bu veritabanına kaydedilmez. `BOT_DATA_DIR` ile ayrı bir veri dizini kullanılabilir.

```powershell
npm test -- src/lib/bot src/lib/server/bot src/lib/server/okx
npx tsc --noEmit
npm run build
$env:PLAYWRIGHT_CHANNEL='msedge'
npx playwright test tests/e2e/bot.spec.ts
```

Testler sentetik strateji verisiyle altyapı doğrulamasıdır; kârlılık backtesti değildir.

8 Eylül 2026 teslimat kontrolü: 84 bot testi ve 4 arayüz testi geçti; bot dosyaları ESLint, TypeScript ve üretim derlemesi geçti. Gerçek public taramada 281 kripto sözleşmesi görüldü, ayarlı filtrelerden 20'si geçti. Özel hesap/demo emir testi yapılmadı. Projenin genel testinde bot öncesinde de bulunan Yahoo haftalık periyot testi başarısız; genel lintte bot dışındaki `use-strategy-route.ts:129` uyarısı mevcut.

Kaynak: [OKX API v5](https://www.okx.com/docs-v5) — authentication, demo trading, instruments, candles, orders ve attached TP/SL.
