# MPA v2 — neden kaybediyor ve neyi düzeltmek gerçekten işe yarar

Tarih: 2026-09-09. Veri: OKX public geçmiş, 5 coin (BTC, ETH, SOL, XRP, ADA) × 3 giriş dilimi (15m, 1H, 4H).

## 1. Ölçülen durum (90 gün, 2026-06-11 → 2026-09-09, taker maliyeti 5 bp + 5 bp)

| Giriş | İşlem | Kazanma | Ort. kazanç | Ort. kayıp | Beklenti | Medyan stop | Maliyetin risk birimindeki payı |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 15m | 240 | %30 | +1,29R | −1,28R | −0,48R | %0,49 | %32 |
| 1H | 117 | %26 | +1,14R | −1,16R | −0,54R | %0,91 | %20 |
| 4H | 27 | %15 | +1,31R | −1,07R | −0,72R | %1,56 | %13 |

Çıkış dağılımı: 342 stop, 13 hedef, 21 ters yapı, 8 süre sınırı.

## 2. İki yapısal hata

**a) Maliyet, risk biriminin üçte birini yiyordu.** Gidiş-dönüş ~20 bp'lik maliyete karşılık 15m'de
medyan stop mesafesi fiyatın %0,49'u. Her işlem %32 handikapla başlıyordu.

**b) Stop gürültünün içindeydi.** Giriş `extreme − 0,15 × ATR`; bu tek bir mumun olağan salınımının içi.

**c) "2R hedef" gerçekleşmiyordu.** Sinyal filtresi maliyet sonrası 2R şartı arıyor ama gerçekleşen
ortalama kazanç 1,29R. 384 işlemin yalnızca 13'ü hedefe ulaştı.

## 3. Maliyet duyarlılığı — belirleyici test (90 gün)

| Komisyon + kayma | İşlem | Kazanma | Toplam net (200 USDT) |
| --- | --- | --- | --- |
| 5 bp + 5 bp (taker) | 34 | %35 | −9,89 |
| 2 bp + 1 bp (maker/limit) | 240 | %32 | −43,52 |
| 1 bp + 1 bp (gerçekçi olmayan alt sınır) | 325 | %33 | −44,27 |

**Sonuç: maliyeti sıfıra yaklaştırmak kurtarmıyor.** Ucuzlayınca bot sadece daha çok kaybeden işlem
alıyor. Yani asıl sorun maliyet değil; `range-sweep-reclaim` ve `structure-break-retest` giriş
modellerinin bu veride ölçülebilir bir edge'i yok. %32–33 kazanma oranı ile ~1:1 gerçekleşen ödül/risk
yazı-turadan ayırt edilemiyor. Stop, hedef, kaldıraç veya pozisyon boyutu ayarı bunu düzeltemez —
düzeltilecek bir edge yok.

## 4. Pozisyon büyütme neden çözüm değil

İşlem başı beklenti −0,48R iken pozisyon boyutunu veya kaldıracı artırmak beklentiyi değiştirmez,
yalnızca aynı negatif beklentiyi daha büyük çarpanla ve daha hızlı gerçekleştirir. Boyut tartışması
ancak ayrılmış test üzerinde pozitif beklenti kanıtlandıktan sonra anlamlıdır.

## 5. Yapılan kalıcı değişiklikler

- `maxCostSharePercent` ayarı (varsayılan %12): gidiş-dönüş maliyeti risk biriminin bu payını aşarsa
  işlem reddedilir. İlkeye dayalı bir emniyet kuralı; geçmiş veriye uydurulmuş bir eşik değil.
- MPA v2 stop tamponu 0,15 ATR → 0,5 ATR; stop tek mum gürültüsünün dışına çıkarıldı.
- Araştırma penceresi 90 gün sınırından 400 güne çıkarıldı; sayfalama bütçesi istenen aralıktan
  hesaplanıyor, böylece uzun pencereler sessizce eksik veri ile koşmuyor.
- `scripts/bot-research.ts` artık `--days`, `--fee`, `--slip`, `--costshare` alıyor ve coin başına tek
  veri setiyle üç giriş dilimini replay ediyor.

## 6. Sıradaki gerçek iş (öneri)

1. Edge'i önce **ayrı ve ucuz** biçimde ölç: giriş sinyalinden sonraki N mumda fiyatın yönü, stop/hedef
   mantığından bağımsız olarak rastgeleden farklı mı? Fark yoksa exit tuning zaman kaybıdır.
2. Aynı test iskeletiyle birkaç **basit ve iyi belgelenmiş** referans model kıyaslansın (ör. donchian
   kırılımı + ATR stop, EMA rejim filtresi). Amaç kâr değil, iskeletin pozitif beklentiyi tespit
   edebildiğini doğrulamak. Referans model de kaybediyorsa sorun stratejide değil test kurgusundadır.
3. Örneklem büyütülsün: 5 coin × 90 gün istatistiksel olarak yetersiz. En az 1 yıl ve 15+ coin.
4. Canlı emirler kilitli kalsın; ayrılmış testte pozitif beklenti kanıtlanmadan boyut konuşulmasın.

---

# Ek: bir yıllık doğrulama ve referans kontrol (2025-09-09 → 2026-09-09)

Kullanıcının gerçek OKX futures kademesi doğrulandı: **maker %0,0200 (2 bp), taker %0,0500 (5 bp).**

## A. MPA v2, bir yıl, 5 coin × 3 dilim (maliyet 2 bp + 1 bp)

| Giriş | İşlem | Kazanma | Toplam net |
| --- | --- | --- | --- |
| 15m | 767 | %34,2 | −97,83 |
| 1H | 459 | %34,9 | −55,21 |
| 4H | 149 | %34,2 | −18,37 |
| **Toplam** | **1375** | **%34,5** | **−171,41** |

15 varyantın yalnızca 3'ü pozitif (BTC 15m +2,62, SOL 4H +3,04, ADA 4H +3,76) — 15 denemede
beklenen gürültü kadar. **Kritik gözlem:** kazanma oranı zaman diliminden bağımsız olarak %34'te
sabit. Maliyet sonrası 2R hedef şartıyla *rastgele* bir giriş de tam olarak ~%33 üretir. Yani giriş
modeli yazı-turadan ayırt edilemiyor. 1375 işlemlik örneklemle bu artık tesadüf değil, sonuçtur.

## B. Referans kontrol: Donchian kırılımı (20 bar kanal, 2 ATR stop, 4 ATR hedef)

Amaç kâr değil, **test iskeletinin pozitif beklentiyi tespit edebildiğini doğrulamak.**

İlk koşuda kontrol neredeyse hiç işlem üretmedi. Sebep stratejide değil kurgudaydı: Donchian'ın
brüt ödül/risk oranı tam 2,0, bizim `minRewardRisk: 2` şartımız ise **maliyet sonrası** ölçülüyor,
dolayısıyla her sinyal kılpayı eleniyordu. Bu, ana bottaki 300/371 sinyal elenmesinin de sebebi.
Filtre `--minrr` ile parametrik yapıldı ve kontrol kendi tasarımıyla (1,5) koşuldu.

Maliyet duyarlılığı (bir yıl, toplam net / 5 coinden kaçı pozitif):

| Maliyet | 15m | 1H | 4H |
| --- | --- | --- | --- |
| 2 bp + 1 bp | −145,2 (0/5) | **+80,6 (4/5)** | −7,3 (2/5) |
| 2 bp + 3 bp | −147,9 (0/5) | **+30,0 (3/5)** | −16,3 (2/5) |
| 2 bp + 5 bp | −98,6 (0/5) | **+15,5 (4/5)** | −19,7 (2/5) |
| 5 bp + 5 bp (taker) | −37,1 (0/5) | **+5,6 (4/5)** | −22,8 (1/5) |

**Sonuç 1: test iskeleti sağlam.** Pozitif beklentiyi tespit edebiliyor; MPA v2'nin negatif çıkması
bir backtest hatası değil, gerçek bulgudur.

**Sonuç 2: 15m yapısal olarak ölü.** Her modelde, her maliyet seviyesinde negatif. Maliyet, 15m'de
risk biriminin ~%32'sini yiyor. Bu dilimi tamamen bırakmak gerekir.

## C. Ama referans model de ayrılmış testi geçemiyor (maliyet 2 bp + 3 bp, 1H)

| Coin | Geliştirme (ilk 8 ay) | Ayrılmış test (son 4 ay) |
| --- | --- | --- |
| BTC | 169 işlem, +0,29, PF 1,00 | 66 işlem, −5,20, PF 0,86 |
| ETH | 201 işlem, +13,83, PF 1,12 | 81 işlem, −14,59, PF 0,71 |
| SOL | 216 işlem, +14,25, PF 1,11 | 92 işlem, +0,50, PF 1,01 |
| XRP | 225 işlem, −0,76, PF 0,99 | 97 işlem, +8,42, PF 1,15 |
| ADA | 219 işlem, +11,13, PF 1,09 | 120 işlem, +0,50, PF 1,01 |
| **Toplam** | **1030 işlem, +38,75** | **456 işlem, −10,37** |

Geliştirme dönemindeki artı, ayrılmış testte kayboluyor. Yani yayımlanmış klasik bir trend takip
kuralı bile bu evrende ve bu maliyetlerle **kanıtlanmış bir edge üretmiyor** — en iyi ihtimalle başabaş.

## D. Dürüst genel sonuç

Bu maliyet seviyesinde, bu 5 coinde ve bu bir yıllık dönemde ne MPA v2 ne de klasik referans model
maliyet sonrası pozitif beklenti gösterdi. Sorun ayar, stop, hedef veya pozisyon boyutu değil.
Basit fiyat-yapısı ve kırılım kuralları, komisyon + kayma düşüldükten sonra sıfır ile negatif toplamlı.

Bundan sonrası için gerçekçi seçenekler — hiçbiri "parametre kıvırmak" değil:

1. **15m'i tamamen bırak.** Kanıt tartışmasız: her modelde, her maliyette negatif.
2. **1H'e odaklan.** Tek umut veren dilim orası; hem MPA hem referans modelde en iyi göreli sonuç.
3. **Evreni büyüt.** 5 coin çok dar. 30+ coinde aynı kural setinin kesitsel davranışı (ör. en güçlü
   trendli N coini seçmek) tek tek coin işlemekten yapısal olarak farklıdır ve gerçek edge oradadır.
4. **Kaymayı ölç, varsayma.** Kırılım girişlerinde gerçek kayma, paper işlemlerin gerçek defter
   verisiyle karşılaştırılmasıyla ölçülmeli. Şu an varsayım kullanıyoruz ve sonucu domine ediyor.
5. **Gerçek emirler kilitli kalsın.** Ayrılmış testte pozitif beklenti kanıtlanmadan pozisyon boyutu
   tartışması anlamsızdır; boyut, negatif beklentiyi yalnızca hızlandırır.

---

# Ek 2: Ek-confirm özellikleri kazananı kaybedenden ayırıyor mu? (LMO hipotez testi)

Kullanıcının eklediği LMO göstergesinin (sweep/reclaim likidite osilatörü) temel iddiası test edildi:
"yüksek kaliteli sweep daha iyi devam eder". Yeni veri çekilmedi; bir yıllık **1375 gerçek işlemin**
giriş barındaki özellikleri önbellekteki mumlardan yeniden hesaplandı (`scripts/bot-features.ts`).

Genel: 1375 işlem, beklenti −0,143R, kazanan oranı %34,4.

| Özellik | Q1..Q5 beklenti farkı | En iyi beşte bir | Yorum |
| --- | --- | --- | --- |
| Fitil skoru (LMO ana girdisi) | 0,058R | −0,108R | Ayırt etmiyor; düz |
| Hacim z-skoru (LMO ana girdisi) | 0,078R | −0,105R | **Ters yönlü**: hacim arttıkça sonuç kötüleşiyor |
| Sweep derinliği | 0,294R | −0,057R | Zayıf monoton eğilim, hepsi negatif |
| Volatilite rejimi | 0,185R | −0,064R | Tutarsız, hepsi negatif |
| Gövde oranı | 0,276R | −0,050R | En iyisi, yine de negatif |
| Stop genişliği | 0,128R | −0,084R | Ayırt etmiyor |

**Otuz beşte birlik dilimin hiçbiri pozitif değil.** En iyi dilim bile işlem başına 0,050R kaybediyor.
Yalnızca en iyi beşte bire filtrelense yılda ~275 işlem kalır ve yine zarar edilir.

LMO'nun iki ana girdisi için sonuç özellikle nettir: fitil kalitesi ayırt etmiyor, hacim genişlemesi
ise iddia edilenin **tersi** yönde çalışıyor. Bu nedenle 967 satırlık göstergeyi port etmek önerilmez;
port edilse dahi hesaplayacağı sinyaller bu veride kaybeden işlemleri kazanana çeviremez.

Yöntem notu: bu, LMO'nun TradingView'de yanlış çizdiği anlamına gelmez. Ölçülen şey, onun ürettiği
kalite sinyallerinin **bizim giriş kümemizde** sonuç ayrımı yapmamasıdır. Giriş kümesinin kendisi
öngörü taşımadığı için üzerine konan hiçbir teyit katmanı bunu düzeltemez.
