# BIST DCA, oran grafikleri ve değişken katkı

- THYAO.IS, HALKB.IS, KCHOL.IS, PETKM.IS, ASELS.IS: 5 yıllık Yahoo günlük veri HTTP 200. Sepet her yeni katkıda %20’şer; satışla yeniden dengeleme yok.
- TRY açılış/kapanışları o anda bilinen son USD/TRY kapanışıyla USD’ye çevrilir; gün içi kur modellenmez. Reel XIRR gerçekleşmiş ABD CPI üzerinden hesaplanır. Temettü ve vergi hariç; bugünkü hisse seçimini geçmişe uygulama yanlılığı belirtilir.
- BIST sorguları ABD sağlayıcılarını dolaşmaz. Yahoo 10 yıl için de günlük veri ister; günlük veri gelmezse tam kapsam sayılmaz.
- Analiz sayfasında VTI/BTC, BTC/IAU, VTI/IAU, QQQ/VTI. Ortak UTC tarihli kapanışlar, EMA20/50, RSI14, yatay kullanıcı seviyeleri ve yakınlaştırma. IAU, XAU ons fiyatı değildir; eşzamanlı piyasa fiyatı iddiası yok.
- Yeni varsayılan katkı yöntemi hedef açıklarını yeni parayla kapatır. Portföy değerleri değiştikçe alım yüzdeleri değişir; satış ve düzenli USDT payı yok. BTC brüt %40 korunur. Eski kullanıcı hedefleri değiştirilmez; sabit katkı yöntemi profil seçeneği olarak kalır.
- 19 adaylık ucuz tarama: BTC 0–40, altın 10–40, VTI kalan; ilk %60 dönemde nominal XIRR − 0,5 × azami düşüş ile seçim. Tek seçilen aday son %40’ta mevcut sabit sepetle kontrol edilir. Doğrulama seçimde kullanılmaz; minimum emir/kuruş farklarından dolayı yaklaşık tarama. Hedef otomatik değiştirilmez; geçen aday kullanıcı butonuyla uygulanabilir.
- Canlı 5 yıl BIST kontrolü: 77.500 USD katkı, yaklaşık 159.690 USD son değer, %26,54 yıllık reel XIRR; fiyat getirisi, temettü/vergi hariç. Bu bir gelecek tahmini değildir.
- Kritik 8 test: kur dönüşümü, ortak kapanış eşleme, katkı muhasebesi, hedef açığı dağılımı ve doğrulama döneminin seçimi değiştirmemesi. TypeScript/ESLint ve üretim derlemesi ile kısa ekran kontrolü.
