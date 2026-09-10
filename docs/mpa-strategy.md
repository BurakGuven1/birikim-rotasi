# CryptoBot.txt → MPA teyitli yapı 1.0.0

Bu uygulama dosyadaki anlatımın ölçülebilir, ihtiyatlı bir yorumudur. Efloud'un takdire dayalı kararlarını birebir uyguladığı veya %60 başarı sağlayacağı iddia edilmez. Dosyanın sonundaki Python örneği doğrudan çalıştırılmadı.

## Sabit giriş kuralları

1. Yalnız kapanmış mumlar kullanılır. Günlük ve haftalık fiyat/EMA20/EMA50 aynı yönde olmalı; 4H yönü de eşleşmelidir. Pencereler 15m/1H/4H için 100/200/100, günlük/haftalık için 80/60 mumdur; backtest ve paper aynı pencereyle hesaplanır. Belirsiz yön ve karşı trend atlanır. EMA seçimi, anlatımdaki öznel HTF yönünü sayısallaştıran uygulama kararıdır.
2. Swing, önceki üç mumun ekstremidir; sonraki en az üç mum görülmeden ve swing öncesi mumun karşı fitili aşılmadan kullanılamaz. Teyit zamanı saklanır. Sonraki veriler geçmiş kararına taşınmaz.
3. Son 16 saat içinde 1H kapanışı önceden teyitli seviyeyi kırmalıdır. Gövde, önceki 14 mum ATR'sinin en az 1,3 katı; hacim önceki 20 mum ortalamasının en az 1,5 katı olmalıdır. Önceki mum zaten kırılmış bölgede ise yeni kırılım sayılmaz.
4. Kırılımdan sonra 15m retest: kırılan seviye ±0,2 saatlik ATR veya impulsun %61,8–79 geri çekilme bölgesi. Son sekiz 15m mum değerlendirilir. Son kapanış önceki mumun karşı fitilini aşmalı, dönüş aralığının en az %60'ını geri almalı; gövde ≥0,6 ATR ve hacim ≥1,2 önceki ortalama olmalıdır.
5. Kırılım öncesinde likidite süpürmesi ve geri kazanım görülmüşse `sweep-breaker-retest`, aksi halde `msb-ote-retest` veya `momentum-msb-retest` etiketi kullanılır. Her MSB otomatik breaker sayılmaz. Bu etiketler tam takdire dayalı order-block sınıflandırmasının yerine geçmez.
6. Giriş, sinyal sonrasındaki 15m mum açılışına kayma eklenerek modellenir. Stop retest ekstremi ±0,15 ATR; TP1 en yakın karşı 15m/1H swing veya dokunulmamış karşı FVG sınırıdır. RR tutturmak için daha uzak hedef seçilmez.

Range/EQ karşı trend işlemleri, aylık takdire dayalı bias, manuel order-block seçimi ve her görsel varyasyon bu sürümde otomatikleştirilmez. Bu durum paneldeki sürümün kapsamıdır; dosyanın tamamının mekanik eşdeğeri değildir.

## Miktar ve çıkış

- Varsayılan 200 USDT, 5× kaldıraç; ayardan 5–10×. İşlem riski %0,5, toplam açık risk %1, UTC günlük kayıp freni %2, en fazla iki pozisyon, azami teminat %40.
- Stop kaybı + komisyon + kayma + funding tamponuna göre kontrat sayısı aşağı yuvarlanır. Minimum kontrat ve kısmi çıkış adımları karşılanmazsa işlem atlanır.
- TP1 yaklaşık %85; lot adımı nedeniyle aşağı yuvarlanır. Artan miktar runner'dır. Net en az 2:1 RR hesabında runner'a varsayımsal kâr yazılmaz, masrafları düşülür.
- TP1 gerçekten dolmadan stop başlangıç seviyesinde kalır. Sonrasında giriş fiyatına, ardından girişten sonra oluşmuş teyitli 1H swing seviyesine taşınabilir. Stop asla genişletilmez; yeni stop ancak sonraki mumda geçerlidir. Başabaş fiyatı komisyon/kayma dahil kayıpsızlık garantisi değildir.
- En fazla 7 gün tutma, stop veya dönem sonu kalan miktarı kapatır. Aynı setup yeniden işleme alınmaz. Paper ayarları açık pozisyon varken değiştirilemez.

## Örnekte düzeltilen sorunlar

Gelecekteki mumlarla swing bulup geçmişte biliniyormuş gibi kullanma; her yapı kırılımını breaker sayma; zayıf V dönüş testi; kapanmamış mum; yalnız log yazan “dry run”; TP1 dolmadan takip stopu; kontrat/baz miktar karışıklığı; pozisyonun yönünü kontrat sayısının işaretinden çıkarma ve kalıcı durum eksikliği giderildi. Başlangıç stopunun sabitliği ile TP1 sonrası stop yönetimi ayrı kurallardır.

CCXT sözleşmelerde miktarı kontrat cinsinden ele alır; baz miktar için contractSize dönüşümü gerekir. Long/short yönü ayrı `side` alanıdır. [CCXT manual](https://docs.ccxt.com/docs/manual), [CCXT FAQ](https://docs.ccxt.com/docs/faq).

## Gerçek veri doğrulaması

`npm run bot:research` aynı kayıtlı 90 günlük dönemi tamamlar/yeniden hesaplar; yeni tarihli karşılaştırma için `npm run bot:research:fresh`. BTC, ETH, SOL, XRP, ADA önceden sabitlenmiştir; sonuçtan sonra kazanan coin seçilmez. İlk 60 gün geliştirme, son 30 gün ayrılmış testtir. Parametreler sonuçları gördükten sonra %60'a zorlanacak şekilde değiştirilmez. Bölümler bağımsız 200 USDT ile başlar; toplam tablo beş coinin ortak 200 USDT portföy sonucu değildir.

Kapanmış OHLC kapsamı ve ısınma aralıkları doğrulanır. Gerçek funding oranları, settlement anındaki 15m mark mum açılışı ile yaklaşık maliyetlenir. Aynı mum stop/TP belirsizliğinde stop önce; boşlukta stop kötü açılıştan yürür. Likidasyon, tarihsel kontrat değişikliği, delist edilen evren ve emir defteri dolumları tam modellenmez. [OKX API v5](https://www.okx.com/docs-v5).

Geçiş taraması: ayrılmış testte ≥100 işlem, ≥%60 net kazanma, pozitif net beklenti, kâr faktörü ≥1,30, düşüş ≤%10 ve eksiksiz funding. Sıfır işlem “%0 başarı” değildir; oran hesaplanamaz. Tarihsel eşiği geçmek dahi otomatik gerçek para yetkisi vermez; ileri paper ve borsa koruma yürütmesinin doğrulanması gerekir. Gerçek hesap emirleri ve transferler bu sürümde kapalıdır.

Tüm sonuçlar `artifacts/bot-research/summary.json` ve coin bazlı JSON dosyalarında, işlem geçmişleri panelde saklanır. Ağ/veri hataları başarısız veri edinimi olarak raporlanır; sahte sonuç üretilmez.

Tamamlanan karşılaştırma: [9 Eylül 2026 backtest raporu](mpa-backtest-2026-09-09.md).
