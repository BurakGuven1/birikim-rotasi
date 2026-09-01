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
| Yabancı hisse/fon | %25 | %35 | %50 | 0,12 |
| Emtia | %10 | %25 | %40 | 0,10 |
| Bitcoin | %5 | %20 | %35 | 0,12 |
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

BTC/M2, piyasa değeri/M2, reel faiz, F/K ve PD/DD gibi sinyaller ancak tarihli ve güvenilir veri mevcutsa eklenmelidir. Mevcut sürüm bunları bugünkü değerlerle geçmişe taşımadığı için fiyat/SMA backtestini “tam”, çoklu temel-değerleme backtestini “kısmi” olarak sunar.

## Backtest

Her takvim ayında bir gözlem ve aynı katkı tutarı kullanılır. Dinamik stratejinin tahsis fonksiyonuna yalnızca o ay ve öncesindeki fiyat dilimi verilir; gelecek gözlem erişilemez. Kıyaslar sabit nötr sepet, SMA dinamik sepet, yalnız BTC, yalnız altın, dünya hisseleri ve BIST 100'dür.

Gösterilen ölçüler toplam yatırılan para, son değer, toplam/yıllıklandırılmış getiri, maksimum düşüş ve yıllıklandırılmış volatilitedir. Vergi, spread, tüm ürün masraf oranları ve farklı piyasa tatilleri tam modellenmediğinden sonuçlar karar desteğidir.

## Satış davranışı

Varsayılan yaklaşım satış yapmadan yeni katkıyla dengedir. Uygulama emir göndermez. “Bu ay daha az al” ifadesi mevcut pozisyonu satmak anlamına gelmez. Otomatik satış önerisi üretilmez.
