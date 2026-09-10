# Portföy grafikleri

Portföyüm sayfasındaki **Portföy geçmişini hesapla**, yerel işlem kayıtlarıyla tarihsel fiyatları tarayıcıda birleştirir. API'ye işlem adetleri, maliyetleri veya portföy kayıtları gönderilmez; yalnız sembol ve tarih aralığı ile fiyat istenir. İstekler üç eşzamanlı bağlantıyla sınırlıdır ve ekran kapanınca iptal edilir.

- Net yatırılan tutar: alış bedeli + komisyon − net satış geliri; her hareket kendi gününün USD/TRY kuru ile TL'ye çevrilir.
- Varlık değeri: o gün elde bulunan adet × günlük kapanış × o günün kuru.
- Kazanç: varlık değeri − net yatırılan tutar. Satış gelirinin hesapta nakit olarak tutulduğu varsayılmaz.
- Son kapanış en fazla dört takvim günü taşınır. Gelecekteki fiyat veya kur geriye uygulanmaz. Eksik kurla yapılmış bir hareket sonraki toplam katkıyı da bilinmez yapar; eksik varlık fiyatı yalnız değer çizgisini keser.
- EUR kuru, temettü, vergi ve bölünme hareketleri modellenmez. Sağlayıcının bölünmeye göre düzeltilmiş fiyatı işlem adetleriyle uyumlu olmalıdır. Bu grafik tam kurumsal aksiyon destekli toplam getiri hesabı değildir.

Varlık detayında işlem tarihiyle eşleşen mumlarda alış/satış işaretleri görünür. Kalan FIFO lotlarının komisyon dahil maliyeti, yalnız işlem para birimi fiyat para birimiyle aynıysa çizilir. Farklı para birimindeki alım için bugünkü kurdan maliyet üretilmez.

Grafik tüm gelen tarihçeyi kullanır. SMA40/200, sırasıyla 40/200 gerçek gözlem oluşunca başlar. Dönem düğmeleri görünümü değiştirir; mum/çizgi ve tema geçişlerinde grafik nesnesi yeniden oluşturulmaz. Hacim yalnız kaynakta varsa çizilir. Tam ekran görünümü Escape ile kapanır.

Doğrulama: `src/lib/domain/portfolio-history.test.ts`, `src/features/market/chart-data.test.ts`, `tests/e2e/portfolio-history.spec.ts`. Uçtan uca test kontrollü fiyat verisi kullanır; sağlayıcı erişimi veya veri lisansı doğrulaması değildir.
