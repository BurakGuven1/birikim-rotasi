# Fiyat odaklı yatırım uygulama kaydı

Onaylanan kapsam: 5 Aralık 2026 aylık 1000 USD; tahmini Nisan 2027'den yıllık 3500 USD; %10 reel USD hedefi; BTC brüt tavan %40; fırsat bekleyen OKX Simple Earn USDT rezervi; 2x swing, teminat %10, stop riski işlem başına %0,5 / toplam %1.

## Çalışma paylaşımı
- Veri: Massive, Binance spot/futures, kapsam ve sayfalama — market_data.
- Swing: ortak price-action motoru ve maliyetli backtest — swing_engine.
- Swing ekranı, günlük, grafik ve kaynak araştırması — swing_ui.
- Katkı, rezerv, fırsat dağılımı ve reel karşılaştırma — ana ajan.

## Kararlar
- Mevcut feature/core-tactical-engine dalı ve kaydedilmemiş çalışmalar temel alınır; eski modüller arşiv olarak korunur. Yeni sürümler mevcut gerçek işlemleri değiştirmez.
- Verisi olmayan tarihsel getiri/temettü/funding uydurulmaz. Varsayımsal rezerv getirisi ayrı senaryodur.
- Anahtarlar ve özel hesap verileri raporlara yazılmaz. Otomatik emir yoktur.
- Kullanıcının token ve süre tercihi gereği yalnız kritik hesap/veri testleri, bir derleme ve kısa görsel kontrol.

## Durum
- [x] Veri entegrasyonu
- [x] Katkı ve rezerv
- [x] Fırsat dağılımı ve projeksiyon
- [x] Swing motoru ve kanıt ekranı
- [x] Gerekli test, derleme ve görsel kontrol

## Doğrulama ve kapsam sınırları
- Kritik hesap/veri kontrolleri çalıştırıldı; son inceleme düzeltmelerinden sonra ilgili 18 test geçti.
- BTC futures canlı API: HTTP 200, 2.189 kapanmış 4 saatlik mum, tam 1 yıllık kapsam ve güncel piyasa bağlamı. Massive VTI aggregate erişimi doğrulandı.
- Masaüstü ve 390px mobil ekran kontrolü yapıldı; yatay taşma yok.
- Eski günlük bağlam sinyali engellenir; tüm emirlerin ücretleri brüt tavan hesabına dahil edilir.
- Massive kapsamı bu sürümde ABD hisse/ETF OHLC; opsiyon zinciri, vadeli ve forex işlem analizi eklenmedi. Anlık veri yetkisi varsayılmaz.
- Efloud kaynak envanteri erişilebilen raporları ayırır; tüm video ve X arşivinin incelendiği iddia edilmez.
- Backtestler kullanıcı başlattığında gerçek veriyle hesaplanır; önceden üretilmiş başarı sayısı yok. Manuel sanal günlükte gerçekleşen funding ayrıca tutulmaz.
