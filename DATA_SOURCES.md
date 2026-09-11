## BIST sepeti ve göreli analiz eklemesi

BIST 5’li: THYAO.IS, HALKB.IS, KCHOL.IS, PETKM.IS, ASELS.IS; katkı başına %20. Tarihsel USD/TRY ile dolar dönüşümü, ABD CPI ile reel XIRR. Temettü/vergi hariç. Yahoo BIST için ilk kaynaktır; ABD sağlayıcısı sorgulanmaz. Oran grafikleri yalnız ortak kapanışları eşler; BTC/IAU doğrudan BTC/XAU değildir. Yeni katkı varsayılan olarak hedef portföy açığına göre değişir; sabit hedefler optimum diye sunulmaz. Backtest’te ayrı seçim/doğrulama dönemli yaklaşık sepet taraması vardır.

## Güncel varsayılan: DCA (7 Eylül 2026)

Ana sayfa yalnız güncel fiyatları alır; yıllarca tarihçe ve teknik sinyal beklemez. BTC/VTI/QQQ/IAU geçmişi yalnız DCA karşılaştırması başlatıldığında yüklenir. Nasdaq satırı QQQ, altın satırı doğrudan XAU yerine IAU vekilidir. Aynı katkı tarihleri, maliyetler ve düzenlenebilir sepet yüzdeleri sonuçlarda görünür. Eksik tarihçe tam dönem sonucu olarak sunulmaz. Aşağıdaki fırsat/swing açıklamaları önceki modelin teknik kaydıdır; güncel ana yatırım yöntemi değildir.

# Veri Kaynakları

Erişim tarihi: **4 Eylül 2026**. Uygulama her yanıtta kaynak adı, verinin zamanı ve güncellik sınıfı taşır.

| Kaynak | Kullanım | Anahtar | Güncellik / sınırlama | Yedek |
| --- | --- | --- | --- | --- |
| [Binance Public Market Data](https://developers.binance.com/en/docs/products/spot/rest-api) | BTC/USD fiyat ve OHLC | Yok | Kripto piyasasına yakın anlık; oran limiti var | EODHD/önbellek |
| [EODHD](https://eodhd.com/financial-apis/) | Hisse, ETF, BIST, emtia, döviz ve kripto fiyat/geçmişi | Anahtar | Hesap paketine göre kapsam ve gecikme değişir; WebSocket gerçek zaman ücretlidir | Alpha Vantage/Yahoo/Stooq |
| Yahoo-compatible chart endpoint | Hisse, ETF, BIST, endeks, emtia, kur | Yok | Resmî SLA yok; borsa verisi gecikebilir | Stooq/önbellek |
| [Stooq](https://stooq.com/q/d/) | Bazı endeks/ETF/emtia geçmişi | Yok | Genellikle gün sonu | Yerel son başarılı veri |
| [FRED](https://fred.stlouisfed.org/docs/api/fred/) | M2, CPI ve 10 yıllık reel faiz | API anahtarı; CSV yedeği | Seriye göre günlük/aylık; revizyon olabilir | Son başarılı veri |
| [Alpha Vantage](https://www.alphavantage.co/documentation/) | ABD hisse ve ETF fiyat/geçmiş yedeği | Ücretsiz anahtar | Ücretsiz kota sınırlı; ABD realtime ücretli | Yahoo/Stooq |
| [KAP](https://www.kap.org.tr/) | Resmî şirket finansalları için araştırma bağlantısı | Yok | Otomatik kırılgan scraping yapılmaz | Kaynak URL'li manuel giriş |
| [Borsa İstanbul veri dağıtıcıları](https://www.borsaistanbul.com/tr/veriler/veri-yayini/veri-dagitici-kuruluslar) | Lisans/güncellik referansı | Dağıtıcıya bağlı | Lisanslı gerçek zaman veri ücretsiz garanti edilemez | Gecikmeli fiyat + açık rozet |

## Güncellik sınıfları

- `fresh`: kriptoda 15 dakikadan, piyasa fiyatında 24 saatten genç veri.
- `delayed`: kaynağın gün sonu/gecikmeli olabildiği veya taze eşiği aşan veri.
- `stale`: canlı kaynaklar başarısız olduğunda gösterilen son başarılı veri.
- `unavailable`: güvenilir değer ve önbellek yok; hesaplamaya sıfır fiyat eklenmez.

FRED API kullanıldığında arayüzde şu uyarı geçerlidir: “This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.”

## Araştırma bağlayıcıları ve çalışma zamanı ayrımı

ChatGPT Work araştırma oturumunda Bigdata.com şirket/market bağlamı, CoinMarketCap kripto piyasa rejimi ve Financial Datasets makro veri erişimi kullanılabilir. Bunlar bu yerel Next.js uygulamasının tarayıcı veya sunucu çalışma zamanı bağımlılığı değildir; bağlayıcı kimlik bilgileri repoya yazılmaz ve portföy verisi bu servislere gönderilmez.

Uygulamanın canlı çalışma zamanı yalnız yukarıdaki tabloda yer alan EODHD, Alpha Vantage, FRED, Binance, Yahoo-compatible uç ve Stooq adaptörlerini kullanır. Yeni bir sağlayıcı eklenirse kaynak adı, zaman damgası, gecikme sınıfı, kota davranışı ve başarısızlık yedeği tanımlanmadan hesaplamaya alınmamalıdır.
# Fiyat odaklı sürüm · 7 Eylül 2026

Massive ABD hisse/ETF için önceliklidir. Günlük ve 4 saatlik split-adjusted OHLC kullanılır; temettü dahil toplam getiri değildir. Paket erişimi doğrulanmadan anlık fiyat veya tam 10 yıl iddiası yoktur. Sunucu anahtarı Authorization başlığındadır; aynı host dışındaki sayfalama reddedilir. Varsayılan 5 istek/dakika, 5 dakikalık sınırlı önbellek; ayar aboneliğe göre değiştirilebilir.

Binance BTC/ETH spot ve USDT perpetual tarihçesi sayfalıdır. Yalnız kapanmış mumlar; futures isteği spot veya günlük yedekle karşılanmaz. Funding tarihçesi, mark fiyatı, en iyi alış/satış ve son işlem akışı ayrı alınır. USD etiketindeki USDT fiyatı yaklaşımı açıkça gösterilir. Borsanın listeleme öncesi dönemine veri uydurulmaz.

Yeni geçmiş yanıtı `coverage` ile istenen/gerçek tarihleri, gözlem sayısını, periyodu ve eksik kapsamı taşır. Örtüşmeyen sağlayıcı geçmişleri sessizce birleştirilmez. Eksik günlük frekans, yalnız ay sayısı yeterli diye tam kabul edilmez.

OKX Earn hesap bağlantısı yoktur. Gerçek ödül ve rezerv hareketleri kullanıcı tarafından girilir; APR üst limitleri ve USDT/USD kontrol tarihi ayrı saklanır. Tarihsel APR yoksa %0 referans ile isteğe bağlı açık APR senaryosu karşılaştırılır.

Efloud kaynak durumu: `docs/efloud-research.md`; bütün YouTube ve X arşivi incelenmiş değildir.
