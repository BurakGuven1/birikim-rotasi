# Veri Kaynakları

Erişim tarihi: **1 Eylül 2026**. Uygulama her yanıtta kaynak adı, verinin zamanı ve güncellik sınıfı taşır.

| Kaynak | Kullanım | Anahtar | Güncellik / sınırlama | Yedek |
| --- | --- | --- | --- | --- |
| [Binance Public Market Data](https://developers.binance.com/en/docs/products/spot/rest-api) | BTC/USD fiyat ve OHLC | Yok | Kripto piyasasına yakın anlık; oran limiti var | CoinGecko |
| [CoinGecko Keyless Public API](https://docs.coingecko.com/docs/keyless-public-api) | BTC fiyat/geçmiş | Yok; Demo isteğe bağlı | IP oran limitli, yüksek frekans garantisi yok | Binance/önbellek |
| Yahoo-compatible chart endpoint | Hisse, ETF, BIST, endeks, emtia, kur | Yok | Resmî SLA yok; borsa verisi gecikebilir | Stooq/TCMB/önbellek |
| [Stooq](https://stooq.com/q/d/) | Bazı endeks/ETF/emtia geçmişi | Yok | Genellikle gün sonu | Yerel son başarılı veri |
| [TCMB Kurlar](https://www.tcmb.gov.tr/kurlar/kurlar_tr.html) | USD/TRY günlük resmî kur | Yok | Günlük gösterge niteliğinde | Yahoo-compatible |
| [TCMB EVDS](https://evds2.tcmb.gov.tr/) | Türkiye makro serileri | Ücretsiz, isteğe bağlı | Üyelik/API anahtarı gerekir | Manuel veri |
| [FRED](https://fred.stlouisfed.org/docs/api/fred/) | M2, CPI, reel faiz ve makro | CSV anahtarsız; API anahtarı isteğe bağlı | Seriye göre günlük/aylık; revizyon olabilir | Son başarılı veri |
| [Alpha Vantage](https://www.alphavantage.co/documentation/) | İsteğe bağlı temel oranlar | Ücretsiz anahtar | Ücretsiz plan 25 istek/gün; ABD realtime ücretli | Manuel değerleme |
| [KAP](https://www.kap.org.tr/) | Resmî şirket finansalları için araştırma bağlantısı | Yok | Otomatik kırılgan scraping yapılmaz | Kaynak URL'li manuel giriş |
| [Borsa İstanbul veri dağıtıcıları](https://www.borsaistanbul.com/tr/veriler/veri-yayini/veri-dagitici-kuruluslar) | Lisans/güncellik referansı | Dağıtıcıya bağlı | Lisanslı gerçek zaman veri ücretsiz garanti edilemez | Gecikmeli fiyat + açık rozet |

## Güncellik sınıfları

- `fresh`: kriptoda 15 dakikadan, piyasa fiyatında 24 saatten genç veri.
- `delayed`: kaynağın gün sonu/gecikmeli olabildiği veya taze eşiği aşan veri.
- `stale`: canlı kaynaklar başarısız olduğunda gösterilen son başarılı veri.
- `unavailable`: güvenilir değer ve önbellek yok; hesaplamaya sıfır fiyat eklenmez.

FRED API kullanıldığında arayüzde şu uyarı geçerlidir: “This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.”
