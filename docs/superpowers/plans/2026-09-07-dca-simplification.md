# DCA sadeleştirmesi

Kullanıcının son talebi önceki fırsat/swing ağırlıklı tasarımın yerini alır.

- Ana yöntem DCA; önceki kayıtlı fırsat politikası sürüm 3’e geçirilir. Katkı takvimi ve gerçek kayıtlar korunur.
- Düzenlenebilir başlangıç sepeti: %35 BTC, %45 VTI, %20 IAU. Düzenli USDT payı yok. BTC brüt sınırında aşan katkı diğer varlıklara dağıtılır.
- Teknik sinyal olmadan tutar planı üretilir. Eksik güncel fiyat tutarı rezerv yapmaz; plan taslak olarak işaretlenir. Mevcut portföy değerlemesi veya gerçek profil engeli varsa alım bekler.
- Backtest sayfasında yalnız BTC, VTI, QQQ (Nasdaq-100), IAU (XAU vekili) ve mevcut sepet DCA karşılaştırması vardır. 3/5/10 yıl, aynı katkılar, görünür yüzdeler ve maliyetler.
- Kıyas sepetinde satış ve yeniden dengeleme yoktur; canlı plandaki BTC tavanına göre yönlendirme uygulanmaz. Bu fark yöntem sayfasında belirtilir.
- Eksik tarihçe tam dönemle karşılaştırılmaz; grafik yalnız tam kapsamlı kolları gösterir. Fiyat getirisi: temettü/vergi hariç.
- Ana ekran: katkı, sepet, alım tutarları. Projeksiyon, rezerv, arşiv ve kaynaklar kapalı ayrıntılardır. Swing menüden ve BTC işlem backtesti ekranlardan kaldırıldı; eski sanal kayıt erişimi yöntem ayrıntısında kaldı.
- Kullanıcının backtests/3-yil.png, 5-yil.png ve 10-yil.png dosyaları incelendi. Özellikle kısa dönemde rezerv ağırlığı ve uzun BTC tarihçesinde eksik kapsam görüldü; bunlar yeni modelde açıkça ele alındı.
- Gerekli doğrulama: 17 hesap testi, TypeScript, kapsamlı olmayan hedefli ESLint, üretim derlemesi ve kısa masaüstü/mobil ekran kontrolü.
