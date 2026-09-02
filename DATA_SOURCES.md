# Veri Kaynakları

Erişim tarihi: **1 Eylül 2026**. Uygulama her yanıtta kaynak adı, verinin zamanı ve güncellik sınıfı taşır.

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
