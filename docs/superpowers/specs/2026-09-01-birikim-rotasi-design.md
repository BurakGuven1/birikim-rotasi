# Birikim Rotası — Tasarım Spesifikasyonu

## Amaç ve kapsam

Birikim Rotası, kullanıcının yatırım işlemlerini yalnızca kendi bilgisayarında saklayan; yatırılan toplam tutarı, güncel portföy değerini, gerçekleşmiş/gerçekleşmemiş kârı ve varlık bazında yüzde getiriyi gösteren yerel bir karar destek uygulamasıdır. Uygulama her ay varsayılan 50.000 TL katkıyı emtia, Bitcoin, yabancı hisse/fon ve Türk hisse/fon sınıfları arasında açıklanabilir ve deterministik biçimde dağıtır. Otomatik emir göndermez ve yatırım tavsiyesi iddiasında bulunmaz.

## Teknik mimari

- Next.js App Router, TypeScript ve Tailwind CSS kullanılacak.
- Grafikler Recharts; haftalık mum grafikleri TradingView Lightweight Charts ile çizilecek.
- Portföy, ayarlar, manuel değerleme girdileri ve veri önbelleği tarayıcıdaki IndexedDB'de tutulacak. Böylece Windows'ta native SQLite kurulumu gerekmeyecek ve finansal kayıtlar dışarı gönderilmeyecek.
- API anahtarları yalnızca `.env.local` içinde kalacak. Sunucu route'ları dış veri sağlayıcılarına istek yapacak; anahtarlar istemci paketine girmeyecek.
- Finansal hesaplar `lib/domain` altında saf TypeScript fonksiyonları olarak arayüzden ve veri sağlayıcılardan ayrılacak.
- Veri adaptörleri ortak `MarketDataProvider` sözleşmesini uygulayacak. Her sonuç değer, para birimi, veri zamanı, erişim zamanı, kaynak ve güncellik durumu taşıyacak.

## Ücretsiz veri stratejisi

- BTC güncel fiyatı: Binance public market data; CoinGecko keyless ve isteğe bağlı Demo anahtarı yedekleri.
- Hisse, ETF, BIST, emtia ve kur: anahtarsız Yahoo-compatible chart/quote adaptörü; Stooq, TCMB günlük kur ve yerel son başarılı veri yedekleri.
- Makro seriler: anahtarsız FRED grafik CSV indirmeleri; kullanıcı FRED anahtarı eklerse resmi API.
- Temel oranlar: isteğe bağlı ücretsiz Alpha Vantage anahtarı ve manuel doğrulanmış girişler.
- EVDS: isteğe bağlı ücretsiz anahtarla Türkiye makro serileri.
- KAP/Borsa İstanbul tarafında kırılgan HTML scraping yapılmayacak. Otomatik erişilemeyen değerlemeler kaynak URL'si, veri tarihi ve son kullanma tarihiyle manuel girilecek.
- Gerçek zaman lisansı gerektiren piyasalarda uygulama “anlık” iddiası kullanmayacak; son güncelleme ve gecikme açıkça gösterilecek. Sağlayıcı başarısızsa veri uydurulmayacak.

## Portföy muhasebesi

Her işlem varlık, işlem türü, adet, birim fiyat, para birimi, tarih ve komisyon içerir. FIFO lot muhasebesiyle kalan maliyet, gerçekleşmiş kâr ve gerçekleşmemiş kâr hesaplanır. Ayrıca toplam alış tutarı, net nakit katkısı, güncel değer, toplam kâr, TL/USD performansı ve varlık bazında getiri üretilir. Kur dönüşümlerinde kullanılan kur ve tarih sonuçlara eklenir.

Grafikler:

- Portföy değeri ile kümülatif yatırılan para zaman serisi.
- Gerçekleşmiş ve gerçekleşmemiş kâr dağılımı.
- Varlık bazında TL ve yüzde getiri çubuk grafiği.
- Mevcut ve hedef dağılım için yüzde yığılmış çubuk ve erişilebilir veri tablosu.
- Aylık katkılar ve portföy sınıfı gelişimi.

## Dağıtım motoru

Motor nötr ağırlıkları ve min/maks sınırları yapılandırmadan alır. Her sınıf için -1 ile +1 arasındaki veri yeterliliğine göre ağırlıklandırılmış sinyal, portföy hedef sapması ve güven skoru hesaplanır. Düşük güven aşırı değişimi bastırır; aylık değişim 10 yüzde puan turnover cap ile sınırlandırılır. Sonuçlar sınırlar içinde yüzde 100'e normalize edilir ve katkı tutarına çevrilir.

Varsayılan davranış satış yapmadan yeni katkıyla dengelemedir. Satış önerisi yalnızca gereksinimlerdeki bütün eşikler sağlandığında ve kullanıcı onayıyla gösterilir. “Bu ay alımı azalt” ve “mevcut pozisyondan satış düşün” farklı durumlar olarak sunulur.

## Backtest

Backtest aylık düzenli katkıyı 1, 3, 5 ve 10 yıllık pencerelerde simüle eder. Sabit nötr dağılım, fiyat/SMA tabanlı dinamik dağılım ve tek-varlık kıyasları çalışır. Çoklu sinyal stratejisi yalnızca point-in-time veri bulunduğunda tamamlanmış sayılır; bugünkü değerlemeler geçmişe taşınmaz. Sonuçlar yatırılan para, güncel değer, yıllıklandırılmış getiri, maksimum düşüş, volatilite, risk/getiri göstergesi, en kötü 12 ay ve devir oranını kapsar.

## Arayüz

Arayüz açık ve koyu modlu, modern ve ferah bir kişisel finans panelidir. Monokrom yüzeyler, ölçülü mavi vurgu, yüksek kontrast ve sınırlı hareket kullanılır. Ana navigasyon Aylık Plan, Piyasa, Portföyüm, Backtest, Araştırma ve Ayarlar sayfalarını içerir. Varlık detayına ilgili kartlardan gidilir.

Grafikler renk dışında desen, çizgi stili ve görünür sayı etiketleriyle de anlam taşır. Klavye odağı, 44 piksel dokunma hedefleri, azaltılmış hareket tercihi ve 375–1440 piksel arası responsive düzen desteklenir.

## Hata ve veri güncelliği

Her veri isteği doğrulanır. Başarısızlıkta son başarılı önbellek, kaynak zamanı ve “veri eski” uyarısıyla gösterilir. Önbellek yoksa kart boş durum ve çözüm önerisi sunar. Eksik kritik sinyaller güven skorunu düşürür. Demo veri yalnızca örnek portföy akışında ve belirgin “DEMO VERİ” etiketiyle kullanılabilir; canlı sonuç yerine geçirilemez.

## Doğrulama

- Önce saf finans fonksiyonlarının testleri yazılacak: SMA, volatilite-normalize uzaklık, yüzdelik, sınırlandırma/normalizasyon, katkı dağılımı, FIFO maliyet, kâr/zarar, veri güncelliği ve look-ahead engeli.
- Ardından veri adaptörlerinin hata/önbellek davranışı ve temel kullanıcı akışı doğrulanacak.
- Teslimden önce hedefli testler, TypeScript/lint, production build ve ana ekranların kısa görsel kontrolü yapılacak.

## Teslimatlar

Çalışan kaynak kodun yanında `README.md`, `RESEARCH.md`, `METHODOLOGY.md`, `DATA_SOURCES.md`, `.env.example`, örnek portföy, otomatik testler ve Windows/macOS/Linux başlatma betikleri teslim edilecek.
