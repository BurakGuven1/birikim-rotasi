# Metodoloji

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

Her takvim ayında bir gözlem ve aynı TL katkı tutarı kullanılır. Katkı, ilgili tarihteki USD/TRY kuruyla dolara çevrilir. S&P 500, altın ve Bitcoin doğal USD fiyatıyla; BIST 100 ise her gözlemde tarihsel USD/TRY kuruna bölünerek USD bazında ölçülür. Seçimler tam 12/36/60/120 ortak takvim ayına karşılık gelir; daha eski veri yalnızca SMA200 ısınması için tutulur. Dinamik stratejinin tahsis fonksiyonuna yalnızca o ay ve öncesindeki fiyat/M2 dilimi verilir; gelecek gözlem erişilemez.

Ek kıyaslar üç ayrı soruyu yanıtlar:

- **Dengeli optimum:** Her varlık sınıfını %10–%50 aralığında tutan 5 yüzde puanlık statik kombinasyonlar arasından getiri/oynaklık/maksimum düşüş dengesi en yüksek olan geçmiş dağılım.
- **Maksimum statik:** 5 yüzde puanlık tüm statik kombinasyonlar arasından dönem sonu değeri en yüksek olan geçmiş dağılım.
- **Teorik üst sınır:** Her aylık katkının o tarihten dönem sonuna en çok yükselecek varlığa gittiğini varsayar. Gelecek bilgisi kullandığından uygulanabilir strateji veya tahmin değildir; yalnızca üst sınır kıyasıdır.

Toplam yatırılan para ve son değer USD olarak gösterilir. “USD getiri” son değer ile tarihsel kurdan çevrilmiş dolar katkılarını karşılaştırır. “Reel USD getiri”, her dolar katkısının FRED `CPIAUCSL` endeksiyle dönem sonuna taşınmış satın alma gücü eşiğine göre hesaplanır. Yıllık TWR, maksimum düşüş ve yıllıklandırılmış volatilite yeni katkıları getiri kabul etmeyen zaman ağırlıklı aylık getirilerden hesaplanır. Vergi, spread, tüm ürün masraf oranları ve farklı piyasa tatilleri tam modellenmediğinden sonuçlar karar desteğidir.

## Aylık Plan hibrit dağılımı

Aylık uygulanabilir alış listesi iki modelin eşit ağırlıklı uzlaşısıdır:

- **%50 çok dönemli dengeli optimum:** S&P 500, altın, Bitcoin ve USD bazlı BIST 100'ün son 1, 3, 5 ve 10 yıllık ortak geçmişinde ayrı ayrı hesaplanan risk ayarlı dengeli optimum ağırlıkların ortalaması.
- **%50 güncel dinamik:** Fiyat/SMA sinyalleri ile veri güveni; Bitcoin için ayrıca 45 gün geciktirilmiş BTC/M2 yüzdesi ve haftalık SMA200 rejimi.

İki ağırlık önce aritmetik olarak birleştirilir, ardından canlı alış sınırları uygulanır. Bu nedenle ekranda ham %50/%50 hesabı ile nihai oran ayrı gösterilir. “Daha fazla” ve “daha az” ifadeleri önceki aya değil, varlık sınıfının nötr uzun vadeli ağırlığına göredir. Daha az alım bir satış önerisi değildir. Tarihsel optimum geçmişe aşırı uyum gösterebilir; hibrit yöntem bu riski azaltmayı amaçlar fakat ortadan kaldırmaz ve getiri garantisi vermez.

## Satış davranışı

Varsayılan yaklaşım satış yapmadan yeni katkıyla dengedir. Uygulama emir göndermez. “Bu ay daha az al” ifadesi mevcut pozisyonu satmak anlamına gelmez. Otomatik satış önerisi üretilmez.
