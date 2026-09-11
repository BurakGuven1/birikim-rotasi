# Metodoloji

## Hedef ve üç katmanlı rota

Reel USD `%10–11` bir optimizasyon hedefidir; garanti, sabit beklenti veya uygulamanın ürettiği bir tahmin değildir. Sistem önce sermayenin kalıcılığını, sonra risk ayarlı ek getiriyi gözetir:

| Katman | Varsayılan pay | Görev |
| --- | ---: | --- |
| Çekirdek | `%70` | Uzun vadeli küresel/ABD hisse, Bitcoin ve altın/reel varlık birikimi |
| Taktik / swing | `%20` | Yalnız doğrulanmış trend ve momentum kurulumlarında sınırlı risk |
| Fırsat rezervi | `%10` | Kurulum yokken nakit bekletme ve sonraki fırsatı finanse etme |

Aylık `$1.000` katkı bu oranlarla yönlendirilir. Varsayılan yıllık `$3.750` ek katkının yarısı seçilen ay çekirdeğe eklenir; diğer yarısı üç aya bölünerek zamanlama riski azaltılır. Taktik kurulum yoksa o ayki taktik pay da rezervde kalır. Ana yaklaşım satış yapmadan yeni katkıyla dengelemektir.

## Kurallı swing motoru

Kurulum evreni S&P 500, Nasdaq 100, Bitcoin, altın ve BIST 100’dür. En az 200 işlem günü olmadan `long` üretilmez. Adayın aynı anda şu filtreleri geçmesi gerekir:

- fiyat 200 günlük ortalamanın üzerinde,
- 50 günlük ortalama 200 günlük ortalamanın üzerinde,
- 6–1 ve 12–1 momentum pozitif,
- güven skoru varsayılan `%60` eşiğini geçiyor,
- ilk hedefe getiri/risk oranı en az `2,0`,
- fiyat 50 günlük trendden dört ATR’den fazla uzak değil.

Giriş aralığı ve geçersizleşme seviyesi 14 günlük ATR ile kurulur. İlk hedef yaklaşık `4 ATR`, ikinci hedef `6 ATR` uzaktadır. Pozisyon büyüklüğü:

```text
risk bütçesi = portföy değeri × işlem başına risk
risk mesafesi = (giriş − geçersizleşme) / giriş
risk bazlı pozisyon = risk bütçesi / risk mesafesi
nihai pozisyon = min(risk bazlı pozisyon, portföy × taktik tavan)
```

Varsayılan işlem başına risk `%0,50`, taktik pay `%20`, kesin taktik üst sınır `%25`tir. Taktik katmanın kendi düşüşü `-%12` olduğunda yeni taktik bütçe yarıya iner; `-%18` olduğunda durur. En az 12 işlem ve 12 aylık gözlemden sonra çekirdeğe göre düşük performans taktik payı en fazla `%10`a indirir; iki ardışık başarısız inceleme yeni taktik bütçeyi sıfırlar.

## Portföy muhasebesi

İşlemler tarih sırasına alınır. Alış komisyonu maliyete, satış komisyonu net satış gelirine eklenir. Satışlarda FIFO lot yöntemi kullanılır.

```text
alış lot maliyeti = (adet × birim fiyat + komisyon) × işlem kuru
gerçekleşmiş kâr = net satış geliri − satılan FIFO lot maliyeti
gerçekleşmemiş kâr = güncel değer − kalan lot maliyeti
toplam kâr = gerçekleşmiş kâr + gerçekleşmemiş kâr
net yatırılan para = toplam alış maliyeti − net satış gelirleri
```

Fiyatı veya kuru bulunmayan varlık güncel değer toplamına uydurma değerle eklenmez; sembol “fiyat eksik” olarak gösterilir.

## Nötr dağılım ve sınırlar

| Sınıf | Minimum | Nötr | Maksimum | Sinyal hassasiyeti |
| --- | ---: | ---: | ---: | ---: |
| S&P 500 / ABD hisseleri | %25 | %35 | %50 | 0,12 |
| Emtia | %10 | %25 | %40 | 0,10 |
| Bitcoin | %5 | %20 | %45 | 0,22 |
| Türk hisse/fon | %10 | %20 | %35 | 0,10 |

Başlangıç isteği şu biçimde hesaplanır:

```text
istek = nötr + sinyal × hassasiyet × güven
        + 0,35 × (nötr − mevcut portföy ağırlığı)
```

Sinyal ve güven sırasıyla `[-1,+1]` ve `[0,1]` aralığına sıkıştırılır. Ardından sınıf sınırları ve önceki aya göre ±10 yüzde puan turnover sınırı uygulanır. Kalan fark, sınırlar içindeki kapasite oranında diğer sınıflara dağıtılır; nihai toplam tam yüzde 100 olur.

## Fiyat sinyali

Ulaşılabilen fiyatlar haftalık kapanışlara indirgenir. Uzun dönem ortalaması SMA200, orta dönem eğimi SMA40 ile temsil edilir. Fiyatın uzun ortalamaya uzaklığı logaritmik getiri volatilitesiyle normalize edilir; BTC için daha geniş volatilite ölçeği kullanılır.

Başlangıç fiyat sinyali:

- volatilite-normalize değer/uzaklık: %55,
- ATH'den düşüş: %25,
- orta dönem trendi: %20.

Fiyat uzun ortalamanın en az %10 altında ve orta trend güçlü negatifse düşen bıçak filtresi pozitif sinyali en fazla `+0,30` yapar. Uzun ortalamanın ±%5 çevresi gürültü bandı kabul edilir. Eksik uzun tarih güveni azaltır ve dağılımı nötre yaklaştırır.

Bitcoin sinyali fiyat bileşenine ek olarak BTC/M2 tarihsel yüzdesini (%30), 200 haftalık SMA rejimini (%15) ve son 12 haftadaki yukarı SMA200 geçişini kullanır. FRED M2 gözlemleri yayın gecikmesini azaltmak için 45 gün sonra kullanılabilir kabul edilir. Bununla birlikte FRED serilerinin sonradan revize edilen güncel sürümü kullanıldığı için backtestte sınırlı revizyon yanlılığı kalabilir. F/K ve PD/DD gibi tarihli temel veriler güvenilir ücretsiz seri bulunmadıkça geçmişe taşınmaz.

## Backtest ve USD ölçümü

Her takvim ayında varsayılan `$1.000`, seçilen takvim ayında ayrıca varsayılan `$3.750` USD katkı kullanılır. S&P 500, altın ve Bitcoin doğal USD fiyatıyla; BIST 100 ise her gözlemde tarihsel USD/TRY kuruna bölünerek USD bazında ölçülür. Seçimler tam 12/36/60/120 ortak takvim ayına karşılık gelir.

Ana karşılaştırma **Çekirdek + kurallı swing** satırıdır. Çekirdek alımları düzenli yapılır; yıllık katkının yarısı hemen, kalanı üç aya bölünerek çekirdeğe dağıtılır. Swing sinyali yalnız o günün kapanışına kadar olan gözlemlerden üretilir ve aynı barda girişe izin verilmez. Bekleyen giriş en erken sonraki barda, yedi günlük geçerlilik içinde çalışabilir. Giriş ve çıkışta varsayılan 8 baz puan toplam spread etkisi ve işlem başına `$0,50` komisyon hesaba katılır. Bir bar hem stopu hem hedefi görürse muhafazakâr olarak stop önce çalışmış sayılır.

**Aylık plan · %70/%30 walk-forward** satırı ikinci, bağımsız kıyastır. Her alım ayında dengeli optimum tabanı yalnızca önceki aya kadar bilinen ortak fiyat geçmişinde 1/3/5/10 yıllık uygun pencerelerle yeniden hesaplanır; dinamik sinyal de aynı tarih kesimindeki fiyat ve geciktirilmiş M2 verisini kullanır. Seçilen dönemden eski gözlemler yalnızca model ısınması içindir ve bu aylarda para yatırılmış sayılmaz.

Toplam yatırılan para ve son değer USD olarak gösterilir. “USD getiri” son değer ile dolar katkılarının toplamını karşılaştırır. “Reel USD getiri”, her dolar katkısının FRED `CPIAUCSL` endeksiyle dönem sonuna taşınmış satın alma gücü eşiğine göre hesaplanır. Yıllık TWR, maksimum düşüş ve yıllıklandırılmış volatilite yeni katkıları getiri kabul etmeyen zaman ağırlıklı getirilerden hesaplanır. Vergi, ürün masraf oranı, temettü stopajı, kayma, kısmi dolum ve farklı piyasa tatilleri tam modellenmediğinden sonuçlar karar desteğidir.

## Enflasyona bağlı USD hedefi

Varsayılan hedef bugünün alım gücüyle `$500.000`dır. Gelecekte ekranda karşılaştırılan nominal hedef `500.000 × (1 + son 12 aylık ABD TÜFE)^yıl` olarak büyütülür. Hedef süresi hesabı sıfır başlangıcı, aylık `$1.000` katkının sabit kaldığını ve gösterilen nominal getiri varsayımını kullanır; kayıtlı mevcut portföy bu kaba süreye dahil değildir. Beş yılda gereken aylık katkı aynı hareketli hedefe göre hesaplanır; bir getiri vaadi değildir.

## Aylık Plan hibrit dağılımı

Aylık uygulanabilir alış listesinde dengeli optimum ana model, dinamik sinyal küçük ayarlayıcıdır:

- **%70 çok dönemli dengeli optimum:** S&P 500, altın, Bitcoin ve USD bazlı BIST 100'ün son 1, 3, 5 ve 10 yıllık ortak geçmişinde ayrı ayrı hesaplanan risk ayarlı dengeli optimum ağırlıkların ortalaması.
- **%30 güncel dinamik:** Fiyat/SMA sinyalleri ile veri güveni; Bitcoin için ayrıca 45 gün geciktirilmiş BTC/M2 yüzdesi ve haftalık SMA200 rejimi.

İki ağırlık önce %70/%30 oranıyla birleştirilir, ardından canlı alış sınırları uygulanır. Bu nedenle ekranda ham hesap ile nihai oran ayrı gösterilir. “Daha fazla” ve “daha az” ifadeleri önceki aya değil, varlık sınıfının nötr uzun vadeli ağırlığına göredir. Daha az alım bir satış önerisi değildir. Walk-forward test geriye bakış riskini azaltır fakat ortadan kaldırmaz ve getiri garantisi vermez.

## Satış davranışı

Varsayılan yaklaşım satış yapmadan yeni katkıyla dengedir. Uygulama emir göndermez. “Bu ay daha az al” ifadesi mevcut pozisyonu satmak anlamına gelmez. Otomatik satış önerisi üretilmez.
