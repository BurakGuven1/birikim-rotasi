# TradingView Strateji ve Sinyal Botları: 15m, 1h, 2h ve 4h Araştırması

**Araştırma tarihi:** 10 Eylül 2026  
**Kapsam:** TradingView'da yayımlanan kripto ve ABD hissesi strateji/sinyal scriptleri; 15 dakika, 1 saat, 2 saat ve 4 saat sonuçları; OKX'te uygulanabilirlik.

## Düzeltme ve kısa cevap

Önceki rapor emir ileten platformlara fazla ağırlık veriyordu. Bu sürüm doğrudan **TradingView strateji ve sinyal scriptlerini** karşılaştırıyor.

Tarama sonunda dört zaman diliminde yayımlanmış sonuçları en güçlü görünen adaylar şunlar:

| Mum | En güçlü yayımlanmış aday | Piyasa / yön | Test dönemi ve işlem | Win rate | Profit factor | Maks. düşüş | TP/SL veya gerçekleşen kazanç/zarar | Karar |
|---|---|---|---|---:|---:|---:|---|---|
| **15m** | **Scalping Strategy Signal v2** | BTCUSDT, long + short | Birbirinden ayrı üç adet 6 aylık rejim; her dönemde 473–496 sinyal | **%42,74–%51,84** | **2,924–3,419** | %1,99–%9,59 | Varsayılan SL 1,5 ATR, TP 4 ATR; brüt hedef RR **2,67** | 15m'deki en iyi yayımlanmış özet; ancak kapalı kaynak, parçalı dönem ve maliyet yok. **Sadece paper test.** |
| **1h** | **KST Strategy [Skyrexio]** | BTCUSDT, yalnız long | 01.01.2023–01.05.2025; **120 işlem** | **%56,67** | **1,747** | **%9,10** | Varsayılan SL 1,5 ATR, TP 3,5 ATR; PF/WR'den gerçekleşen ortalama kazanç/zarar yaklaşık **1,34** | Açık kaynak ve maliyetli test nedeniyle **genel olarak en dengeli aday**. Short üretmiyor. |
| **2h** | **ETH Momentum Breakout** | ETH, önerilen mod yalnız long | 10.2020–02.2026; yaklaşık **12 işlem/yıl** | **%56** | **3,08** | **%14** | SL 2 ATR, tam TP 3,5 ATR; brüt RR **1,75**; yayımlanan ortalama kazanç/zarar **2,4** | 2h'de ham sonuç lideri. İşlem sayısı düşük ve slippage açıklanmamış. |
| **4h** | **Red Dragon Model 1** | BTCUSDT.P, long + short | 24.09.2019–21.11.2025; **1.042 işlem** | **%63,92** | **1,247** | **%18,44** | TP %1,5, SL %2; RR **0,75** | En yüksek açıklanmış 4h WR ve en büyük örneklem; fakat ince avantaj, 10x ayarı ve kapalı kaynak nedeniyle **yüksek riskli**. |

Bu sonuçların hiçbiri bağımsız denetimli OKX canlı hesap geçmişi değildir. Rakamlar script yazarlarının TradingView sayfalarında yayımladığı backtest sonuçlarıdır. “En başarılı” ifadesi bu raporda **yayımlanan geçmiş test bakımından en güçlü** anlamına gelir; gelecekte kazandırma garantisi anlamına gelmez.

## Benim gerçek sıralamam

1. **İlk forward-test adayı: KST Strategy, BTCUSDT 1h.** Kaynak kodu açık, 120 işlem var, %0,1 komisyon ve 5 tick slippage hesaba katılmış. Win rate ile PF dengesi listedeki en savunulabilir kombinasyon. Eksisi yalnız long olması ve testin Mayıs 2025'te bitmesi.[^kst]
2. **İkinci aday: Triple CCI, BTCUSDT 2h.** Ham getirisi ETH Momentum'dan düşük; buna karşılık açık kaynak, 108 işlem, %0,1 komisyon, 5 tick slippage ve %7,77 düşüş ile daha muhafazakâr bir test sunuyor.[^cci]
3. **Yüksek WR isteyen long/short aday: Red Dragon, BTCUSDT.P 4h.** 1.042 işlem ve %63,92 WR etkileyici. PF 1,247 olduğu için maliyet veya execution farkındaki küçük bozulma avantajı silebilir. Varsayılan 10x ayarla canlıya alınmamalı.[^dragon]
4. **15m araştırma adayı: Scalping Strategy Signal v2.** Üç piyasa rejiminde PF yaklaşık 3 görünse de dönemler seçilmiş ve birbirinden kopuk, komisyon/slippage/funding açıklanmıyor, kod kapalı. Canlı para için yeterli kanıt yok.[^scalp]
5. **2h ham performans adayı: ETH Momentum Breakout.** PF 3,08 ve %56 WR iyi; fakat yaklaşık 12 işlem/yıl ile örneklem küçüktür ve önerilen mod yalnız long'dur.[^eth]

Long ve short'u aynı scriptte zorunlu tutarsak seçenekler ciddi biçimde daralıyor:

- **15m:** Scalping Strategy Signal v2
- **1h:** BTC MTF Engulfing Flip + Pyramid; az işlemli ve aşırı optimize göründüğü için araştırma düzeyinde
- **2h:** TSI Long/Short for BTC 2H; yayımlanmış performans tablosu olmadığı için sıralanamaz
- **4h:** Red Dragon Model 1

Bu yüzden bugün gerçek para dağıtacak olsam tek bir “kazandıran bot” seçmek yerine **KST 1h, Triple CCI 2h ve Red Dragon 4h'yi aynı tarihlerde OKX verisiyle ileri test eder**, yalnız test dışı sonuçlar yeterliyse geçiş yapardım.

## Nasıl değerlendirdim?

Bir stratejiyi yalnız win rate'e göre sıralamak hatalı sonuç verir. Aşağıdaki ölçütleri birlikte kullandım:

- **Win rate:** Kârlı kapanan işlem oranı.
- **Profit factor (PF):** Brüt kâr / brüt zarar. 1'in üstü pozitif geçmiş sonuç demektir; 1,20 civarı sonuç maliyetlere karşı kırılgandır.
- **Gerçekleşen ortalama kazanç/zarar oranı:** PF ve win rate verildiğinde yaklaşık olarak  
  `ortalama kazanç / ortalama zarar = PF × (1 − WR) / WR`.
- **Maksimum drawdown:** Test boyunca tepeden dibe en büyük sermaye kaybı.
- **Örneklem:** 40–70 işlemle çıkan yüksek sonuç, 500–1.000 işlemlik sonuçtan daha belirsizdir.
- **Maliyet modeli:** Komisyon, slippage ve perpetual funding dikkate alındı mı?
- **Kaynak kodu:** Açık kaynakta repaint/lookahead, emir ve maliyet ayarları incelenebilir; korumalı scriptte yazarın özetine güvenilir.
- **Dönem seçimi:** Tek boğa dönemi yerine boğa, ayı ve yatay dönemleri kapsayan test daha değerlidir.
- **Yön:** Long-only bir sistem, long/short gereksinimini tek başına karşılamaz.

TradingView stratejileri geçmiş barlarda işlemleri bir **broker emulator** ile simüle eder. Varsayılan komisyon ve slippage sıfırdır; yazar bunları özellikle eklemezse rapor gerçek maliyeti olduğundan iyi gösterir. Mum içinde fiyatın hangi sırayla high/low yaptığı da varsayılır. Bar Magnifier bunu iyileştirebilir, tamamen ortadan kaldırmaz.[^tv-strategy][^tv-emulator]

## 15 dakika

### 1. Scalping Strategy Signal v2 — yayımlanmış 15m lideri

TradingView scripti BTCUSDT 15m için tasarlanmış; varsayılan 4h onayıyla long ve short sinyali üretiyor. ATR tabanlı SL/TP, trailing ve zarar sonrası tekrar giriş mantığı var. Kaynak korumalıdır.[^scalp]

| Rejim | Dönem | Long + short sinyal | Win rate | PF | P&L | Maks. düşüş | Yaklaşık ort. kazanç/zarar |
|---|---|---:|---:|---:|---:|---:|---:|
| Boğa | Tem–Ara 2023 | 277 + 219 = **496** | %42,74 | 3,074 | %108 | %1,99 | **4,12** |
| Ayı | Oca–Haz 2022 | 262 + 211 = **473** | %44,40 | 3,419 | %239,80 | %3,74 | **4,28** |
| Yatay | Oca–Haz 2021 | 280 + 208 = **488** | %51,84 | 2,924 | %340,33 | %9,59 | **2,72** |

Varsayılan sabit hedef mantığı 1,5 ATR risk ve 4 ATR kâr hedefidir; brüt RR `4 / 1,5 = 2,67`. Gerçekleşen oranların daha yüksek görünmesi manuel/trailing çıkışlar, farklı stop tipleri ve raporlama biçiminden kaynaklanabilir.

**Sorunlar:**

- Üç dönem devamlı tek bir test değil; yazarın seçtiği farklı altı aylık pencereler.
- Komisyon, slippage ve funding açıklanmıyor.
- 4h verisi ve 4h kapanış kontrolü kullanılıyor; kapalı kaynak olduğu için repaint/HTF doğrulaması denetlenemiyor.
- Yazarın kendi notu canlı sonuçların backtestten sapabileceğini ve uyarıların senkron olmayabileceğini söylüyor.

**Karar:** 15m için izleme listesinin ilk sırasında; gerçek para adayı değil.

### 2. Session Momentum v3 — daha geniş ama eksik rapor

Korumalı script 15m kripto için 10 varlığı ve üç yıldan uzun dönemi Bybit maliyetleriyle test ettiğini, birleşik PF'nin **1,385** ve kârlı ay oranının **%76** olduğunu yayımlıyor. Her ayağın PF'sinin 1,10 üstünde olduğu belirtiliyor. İşlem sayısı, trade win rate, drawdown ve TP/SL dağılımı verilmediği için tam sıralamaya alınmadı.[^session]

### 3. Quantum Reversal Engine — daha gerçekçi maliyet, zayıf avantaj

BTCUSDT 15m, 25.06.2024–25.06.2025 Deep Backtest:

- 185 işlem, %34,05 win rate
- PF 1,295, maksimum düşüş %0,65
- Ortalama kazanç %3, ortalama kayıp %1,2; oran 2,51
- %0,075 komisyon, 3 tick slippage, işlem başına %5 sermaye

Maliyet varsayımları 15m liderinden daha iyi açıklanmış; fakat PF düşüktür. `calc_on_every_tick` ve isteğe bağlı Heikin-Ashi kullanımı canlı/tarihsel fark riskini büyütür.[^quantum]

## 1 saat

### 1. KST Strategy [Skyrexio] — genel seçimim

KST, Williams Alligator, uzun trend ortalaması ve isteğe bağlı Choppiness filtresini birleştiren açık kaynaklı, yalnız-long stratejidir.[^kst]

| Metrik | Yayımlanan sonuç |
|---|---:|
| Piyasa / zaman dilimi | BTCUSDT, 1h |
| Test | 01.01.2023–01.05.2025 |
| İşlem | 120 |
| Kazanan / kaybeden | Yaklaşık 68 / 52 |
| Win rate | %56,67 |
| Profit factor | 1,747 |
| Net kâr | %51,75 |
| Maks. birikimli kayıp | %9,10 |
| En iyi / en kötü tek işlem | +%8,35 / -%5,53 |
| Ortalama işlem | +%0,60 |
| Ortalama süre | 27 saat |
| Maliyet | %0,1 komisyon + 5 tick slippage |
| Pozisyon | Sermayenin %60'ı |

Varsayılan TP 3,5 ATR'dir. Stop, giriş mumunun low seviyesinin 1,5 ATR altına konduğu için tam başlangıç riski 1,5 ATR'den biraz büyüktür. PF ile WR'nin ima ettiği gerçekleşen ortalama kazanç/zarar oranı yaklaşık **1,34**.

**Karar:** Maliyet, açıklık ve örneklem birlikte düşünüldüğünde ilk paper-forward-test adayı. Short gereksinimi için yanına ayrı bir short sistemi gerekir.

### 2. BTC MTF Engulfing Flip + Pyramid — yüksek PF, yüksek model riski

Açık kaynaklı 1h BTC perpetual stratejisi long ve short çalışır. Yazarın ayrı Python testinde Eylül 2019–Nisan 2026 arasında 73 işlem, %34,2 WR, **5,54 PF**, %20,3 düşüş ve %142,8 CAGR açıklanıyor. Stop %2,5 ile sınırlı; +6R'de %15 çıkış ve kalan stopun başa taşınması, +3R'de ek pozisyon mantığı var.[^engulf]

73 işlemde birkaç büyük trend kazancı sonucu belirliyor. Test sayfasında Python sonucu için net komisyon/funding açıklaması yok ve parametreler BTC 1h'ye yoğun biçimde uyarlanmış. **Canlı aday değil; bağımsız yeniden test adayıdır.**

## 2 saat

### 1. ETH Momentum Breakout — ham sonuç lideri

Açık kaynaklı strateji 1h–8h aralığına yönelik; yayımlanan en iyi kullanım ETH 2h ve long-only moddur.[^eth]

| Metrik | Yayımlanan sonuç |
|---|---:|
| Test | Ekim 2020–Şubat 2026 |
| İşlem sıklığı | Yaklaşık 12/yıl |
| Win rate | %56 |
| Profit factor | 3,08 |
| Getiri | %197 |
| CAGR | Yaklaşık %29 |
| Maks. düşüş | %14 |
| Ortalama kazanç / kayıp | 2,4 |
| Yıllar | 7 takvim yılının 6'sı kârlı; 2022 negatif |
| Maliyet | %0,1 komisyon; slippage açıklanmamış |

Çıkışlar: 2 ATR stop, 3,5 ATR tam TP, 2,5 ATR trailing, +1,2 ATR sonrası +0,2 ATR break-even, stagnation ve 100 bar zaman aşımı. Varsayılan brüt sabit RR **1,75**. Kısmi TP seçeneği varsayılan olarak kapalıdır.

Sayfanın giriş kısmındaki “ortalama %65” ifadesi ile ayrıntılı performans kısmındaki **%56** çelişiyor. Bu raporda ayrıntılı tablodaki %56 kullanıldı.

### 2. Triple CCI Strategy MFI Confirmed [Skyrexio] — daha muhafazakâr aday

Açık kaynaklı, yalnız-long BTC 2h stratejisidir.[^cci]

| Metrik | Yayımlanan sonuç |
|---|---:|
| Test | 01.04.2022–25.11.2024 |
| İşlem | 108 |
| Win rate | %44,44 |
| Profit factor | 2,006 |
| Net kâr | %54,21 |
| Maks. düşüş | %7,77 |
| En iyi / en kötü tek işlem | +%19,66 / -%4,13 |
| Ortalama işlem süresi | 44 saat |
| Maliyet | %0,1 komisyon + 5 tick slippage |
| İma edilen ort. kazanç/kayıp | **2,51** |

Varsayılan stop 1,75 ATR'dir. Kâr çıkışı sabit TP yerine +2,25 ATR sonrası açılan trailing ve EMA20 kapanışıyla yapılır. ETH Momentum'a göre PF düşük; maliyet ve drawdown açıklaması daha güçlüdür.

### 3. TSI Long/Short for BTC 2H — ölçülemeyen aday

Script açık kaynaklı ve long/short üretir; ancak sayfada tarih, işlem sayısı, win rate, PF ve drawdown yayımlanmamıştır. Bu nedenle “başarılı” diye sıralamak mümkün değildir.[^tsi]

## 4 saat

### 1. Red Dragon Model 1 — en yüksek açıklanmış WR

Korumalı BTCUSDT.P stratejisi long ve short çalışır. Yayımlanan test 24.09.2019–21.11.2025 dönemini kapsar.[^dragon]

| Metrik | Yayımlanan sonuç |
|---|---:|
| İşlem | **1.042** |
| Kazanan / kaybeden | **666 / 376** |
| Win rate | **%63,92** |
| Profit factor | **1,247** |
| Net kâr | %634,47 |
| Maks. düşüş | %18,44 |
| Ortalama işlem | 60,89 USDT |
| Ortalama süre | 15 saat |
| Maks. art arda TP / SL | **11 kazanç / 7 kayıp** |
| TP / SL | +%1,5 / -%2 |
| Planlanan RR | **0,75** |
| İma edilen gerçekleşen ort. kazanç/kayıp | Yaklaşık **0,70** |
| Test ayarı | %10 equity emir, 10x leverage, %0,03 komisyon |

Bu strateji yüksek win rate'i düşük RR ile satın alıyor. Başabaş win rate maliyet öncesi `1 / (1 + 0,75) = %57,14`; açıklanan %63,92 oranıyla güvenlik payı yaklaşık 6,8 puandır. PF 1,247 de bu ince avantajı doğruluyor. Slippage ve funding açıklanmadığından canlı sonuç daha zayıf olabilir.

**Karar:** 4h long/short içinde en doğrudan eşleşme. 10x varsayılan ayar kabul edilmemeli; önce 1x demo ve test dışı dönem gerekir.

### 2. PriceFlow Pro — düşük drawdown iddiası, eksik veri

BTCUSD 4h ve beş yıllık testte 533'ten fazla işlem, PF 1,587 ve %4,3 drawdown yayımlıyor; long PF 1,631, short PF 1,481. Win rate, net sonuç, komisyon/slippage ve kesin TP/SL açıklanmadığı için Red Dragon'ın önüne konamaz.[^priceflow]

### 3. Momentum Alligator — düşük WR, yüksek payoff

Açık kaynaklı, yalnız-long BTC 4h stratejisi 01.01.2021–01.05.2024 arasında:[^alligator]

- 118 işlem
- %24,58 win rate
- PF 1,71
- %62,28 net kâr
- %11,52 maksimum düşüş
- %0,1 komisyon + 5 tick slippage
- Sabit %2 stop; kâr çıkışı Alligator Jaw ile dinamik
- PF/WR'den ima edilen ortalama kazanç/kayıp yaklaşık **5,25**

Win rate'i düşük olduğu için kullanımı psikolojik olarak zor; açık kaynak ve maliyet ayarı sayesinde araştırma değeri var.

## ABD hisseleri için bulabildiğim sonuç

TradingView'daki **Golden Cross 50/200 EMA Strategy**, aynı açık kaynak mantığı farklı ABD hissesi ve zaman dilimlerinde raporluyor:[^golden]

| Mum | Hisse | Dönem | İşlem | Win rate | PF | Maks. düşüş | İma edilen ort. kazanç/kayıp |
|---|---|---|---:|---:|---:|---:|---:|
| 15m | NVDA | 03.01.2000–17.11.2025 | 466 | %28,11 | 2,033 | %8,06 | 5,20 |
| 1h | AAPL | 03.01.2000–17.11.2025 | 118 | %35,59 | 3,463 | %2,26 | 6,27 |
| 2h | NFLX | 23.05.2002–17.11.2025 | 56 | %41,07 | 3,891 | %6,03 | 5,58 |
| 4h | — | Yayımlanmış sonuç yok | — | — | — | — | — |

Bu strateji:

- Yalnız long çalışır.
- Golden Cross'ta girer; Death Cross veya son 15 barın swing-low stopuyla çıkar.
- Sabit take-profit kullanmaz.
- Sonuçlar hissenin kendi grafiğindeki backtesttir; OKX X-Perpetual sonucu değildir.

OKX'teki hisse maruziyetli X-Perpetual ürünler kendi 24/7 emir defterine sahip, USD marjinli türevlerdir ve dayanak hisseye sahiplik vermez. Hisse seansı kapalıyken oluşan gap, funding/basis ve likidite davranışı TradingView'daki normal hisse testinden farklıdır.[^okx-xperp]

Bu nedenle ABD hisseleri için bu taramada **OKX'te doğrudan canlıya alınabilecek, 15m/1h/2h/4h'nin tamamında doğrulanmış tek bir TradingView botu bulamadım**. Golden Cross yalnız karşılaştırmalı araştırma adayıdır.

## Yüksek win rate görünüp eleme yaptıklarım

| Script | İddia | Eleme nedeni |
|---|---|---|
| **Smart Impulse PRO v1.0** | 1h volatil kriptolarda %90–%94 WR, PF 3–3,9, parite başına yaklaşık 100–130 işlem | Davetli/kapalı kaynak; bağımsız işlem listesi ve tekrar üretilebilir Strategy Tester kanıtı yok.[^smart] |
| **ETH DCA Strategy – 3Commas** | 4h, %71,64 WR, PF 7,513, 134 işlem | Stop yok; fiyat düştükçe -%25'e kadar 5 büyüyen ek emir. Tek büyük trend kaybı geçmiş başarıyı silebilir.[^dca] |
| **ETH Grid Bot Long Strategy** | 15m, %67,32 WR, PF 2,433, 355 işlem | Yalnız long ve **stop-loss yok**; test yaklaşık dört ay. Grid kuyruk riski taşır.[^grid] |
| **ETH-USD 15m iTradebot** | %54,17 WR, PF 6,523, +%717,56 | Haziran 2020–Ocak 2021 seçilmiş eski boğa dönemi; %100 equity kullanımı.[^itrade] |
| **BTC Ultimate Entry System** | %55+ hedef WR, 2–3 RR | Bu bir indicator; yayımlanmış Strategy Report veya işlem geçmişi yok.[^ultimate] |
| **RSI Mean Reversion** | 34 walk-forward pencerenin %61'i kârlı | Bu rakam trade win rate değil, kârlı test penceresi oranı; normalize edilmiş pozisyon büyüklüğü de açıklanmıyor.[^rsi] |

## “Maksimum kaç stop / kaç TP?” sorusunun net cevabı

Bu ifade iki biçimde okunabilir:

### Bir işlemde kaç çıkış emri var?

| Strateji | Stop yapısı | Take-profit yapısı |
|---|---|---|
| Scalping 15m | 1 aktif stop mantığı; giriş tipine göre ATR veya mum seviyesi | 1 ATR hedefi + trailing/manual çıkış |
| KST 1h | 1 ATR stop | 1 ATR TP |
| ETH Momentum 2h | 1 ATR stop; sonra break-even olabilir | Varsayılan 1 tam TP; isteğe bağlı kısmi TP1 + kalan pozisyon |
| Triple CCI 2h | 1 ATR stop | Sabit TP yok; aktivasyondan sonra trailing/EMA çıkışı |
| Red Dragon 4h | 1 sabit SL | 1 sabit TP |

### Art arda kaç SL veya TP görülmüş?

Yalnız **Red Dragon** yazarı gerçek tarihsel maksimum seriyi yayımlıyor: **en çok 7 ardışık kayıp ve 11 ardışık kazanç**. Diğer ana adaylarda bu veri açıklanmadı.

Kaba bir planlama ölçüsü olarak, işlemler birbirinden bağımsız kabul edilirse önümüzdeki 100 işlemde yaklaşık %95 olasılıkla aşılmaması beklenen kayıp serileri şöyledir:

| Strateji | Kullanılan WR | 100 işlem için yaklaşık %95 kayıp serisi |
|---|---:|---:|
| Scalping 15m | %42,74 | 11 |
| KST 1h | %56,67 | 8 |
| ETH Momentum 2h | %56 | 8 |
| Red Dragon 4h | %63,92 | 6 |

Bu sayılar tarihsel veri değil, bağımsız Bernoulli varsayımıyla risk tahminidir. Piyasa rejimlerinde kayıplar kümelendiği için gerçek seri daha uzun olabilir. Red Dragon'ın yayımlanan **7** stop serisi bunun pratik örneğidir.

## OKX'e bağlamadan önce uygulanacak doğrulama

Bir TradingView sayfasındaki iyi backtest doğrudan OKX canlı uygunluğu anlamına gelmez. Her adayı aynı prosedürden geçirmek gerekir:

1. **Aynı OKX sembolünde yeniden test:** Örneğin `OKX:BTCUSDT.P`; başka borsanın spot verisi kullanılmamalı.
2. **Test dışı dönem:** Scriptin yayımlanan/ayarlandığı dönemin ardından en az 100 işlem veya 6 ay.
3. **Maliyet:** Gerçek OKX fee seviyesi, makul slippage ve perpetual funding.
4. **Bar Magnifier:** Özellikle 15m'de stop ile TP'nin aynı mumda temas ettiği işlemler.
5. **Repaint kontrolü:** Sinyal yalnız mum kapanışında ve yalnız doğrulanmış HTF barıyla çıkmalı.[^repaint]
6. **Alarm kaydı:** TradingView sinyal zamanı, OKX kabul zamanı, dolum fiyatı ve pozisyon miktarı karşılaştırılmalı.
7. **Risk:** İşlem başına en fazla %0,25–%0,50 hesap riski; ilk aşamada kaldıraç 1x.
8. **Geçiş kapısı:** Canlıya geçmek için en az PF 1,25, pozitif maliyet sonrası beklenti, backtest drawdown'ının 1,5 katını aşmayan forward drawdown ve alarm/emir uyuşması.

OKX Signal Bot TradingView webhook mesajlarını perpetual sözleşmelere aktarabilir; kısmi çıkış ve pozisyon kapatma mesajları desteklenir.[^okx-signal][^okx-alert] Ancak OKX'in hisse X-Perpetual ürünleri ayrı ürün yapısındadır; Signal Bot FAQ yalnız perpetual contracts derken X-Perpetual belgesi expiry-futures API ayrımını belirtir. Hisse tarafında destek, gerçek para öncesi demo hesapta sembol bazında doğrulanmalıdır.

## Uygulanabilir test sırası

| Sıra | Script | Demo pazar | Süre / örnek | Geçiş için bakılacak ana ölçü |
|---:|---|---|---|---|
| 1 | KST Strategy | BTCUSDT 1h | En az 100 işlem | PF ≥ 1,35; WR'den çok maliyet sonrası expectancy |
| 2 | Triple CCI | BTCUSDT 2h | En az 80 işlem | PF ≥ 1,50; DD ≤ %12 |
| 3 | ETH Momentum | ETHUSDT 2h | En az 50 işlem | PF ≥ 1,75; 2022 benzeri zayıf rejim davranışı |
| 4 | Red Dragon | BTCUSDT.P 4h, 1x | En az 150 işlem | PF ≥ 1,20; 8 ardışık stop için sermaye dayanıklılığı |
| 5 | Scalping v2 | BTCUSDT 15m | En az 250 işlem | Fee + slippage + funding sonrası PF ≥ 1,30; repaint yok |

## Son hüküm

- **Tek bir bot seçeceksem:** **KST Strategy 1h**, çünkü yayımlanmış sonuçtan çok kanıt kalitesi daha iyi.
- **Long/short ve yüksek WR zorunluysa:** **Red Dragon 4h**, ancak düşük RR/PF nedeniyle yalnız düşük riskli forward-test için.
- **2h ham performans lideri:** **ETH Momentum Breakout**; daha temkinli alternatif **Triple CCI**.
- **15m lideri:** **Scalping Strategy Signal v2**; maliyetsiz, kapalı kaynak ve parçalı test nedeniyle canlı sermaye için henüz uygun değil.
- **ABD hisseleri:** Normal hisse verisinde Golden Cross karşılaştırması var; OKX X-Perpetual için aynı sonuçlar geçerli sayılamaz.

Bugün itibarıyla bu listedeki hiçbir script için “kanıtlanmış kazandıran bot” denemez. En güçlü karar, ilan edilen WR'yi satın almak değil; aynı OKX verisinde, maliyetli ve test dışı sonuçla avantajı yeniden göstermektir.

## Kaynaklar

[^scalp]: TradingView, [Scalping Strategy Signal v2 by INFINITYTRADER](https://www.tradingview.com/script/D898fmMY-Scalping-Strategy-Signal-v2-by-INFINITYTRADER/).
[^session]: TradingView, [Session Momentum v3](https://www.tradingview.com/script/yYzYhM89-Session-Momentum-v3/).
[^quantum]: TradingView, [Quantum Reversal Engine](https://www.tradingview.com/script/GnYGFaJP-Quantum-Reversal-Engine-ApexLegion/).
[^kst]: TradingView, [KST Strategy — Skyrexio](https://www.tradingview.com/script/Pv1GvUVs-KST-Strategy-Skyrexio/).
[^engulf]: TradingView, [BTC MTF Engulfing Flip + Pyramid Strategy](https://www.tradingview.com/script/GoUoySJs-BTC-MTF-Engulfing-Flip-Pyramid-Strategy-1H-2X/).
[^eth]: TradingView, [ETH Momentum Breakout Strategy](https://www.tradingview.com/script/T3t4yoJx-ETH-Momentum-Breakout-Strategy-geektrade-online/).
[^cci]: TradingView, [Triple CCI Strategy MFI Confirmed — Skyrexio](https://www.tradingview.com/script/PETNavGq-Triple-CCI-Strategy-MFI-Confirmed-Skyrexio/).
[^tsi]: TradingView, [TSI Long/Short for BTC 2H](https://www.tradingview.com/script/EiOQOcZd-TSI-Long-Short-for-BTC-2H/).
[^dragon]: TradingView, [Red Dragon Model 1 — Titans Invest](https://www.tradingview.com/script/RHeSZyBH-STRATEGY-1-Red-Dragon-Model-1-Titans-Invest/).
[^priceflow]: TradingView, [PriceFlow Pro Strategy](https://www.tradingview.com/script/1WxCjYUn-PriceFlow-Pro-Strategy/).
[^alligator]: TradingView, [Momentum Alligator 4h Bitcoin Strategy](https://www.tradingview.com/script/u31hDmOU-Momentum-Alligator-4h-Bitcoin-Strategy/).
[^golden]: TradingView, [Golden Cross 50/200 EMA Strategy](https://www.tradingview.com/script/gMdx2jrl/).
[^smart]: TradingView, [Smart Impulse PRO v1.0](https://www.tradingview.com/script/YXy1g7th-smart-impulse-pro-v1-0/).
[^dca]: TradingView, [ETH DCA Strategy — 3Commas Quantpilot](https://www.tradingview.com/script/jXxP2m1Q-ETH-DCA-Strategy-3Commas-Quantpilot/).
[^grid]: TradingView, [ETH Grid Bot Long Strategy](https://www.tradingview.com/script/WhxmHc8H-ETH-Grid-Bot-Long-Strategy/).
[^itrade]: TradingView, [ETH-USD 15m iTradebot](https://www.tradingview.com/script/Phr3tZRE-ETH-USD-15m-iTradebot/).
[^ultimate]: TradingView, [BTC Ultimate Entry System](https://www.tradingview.com/script/tPp1qPZQ-BTC-Ultimate-Entry-System/).
[^rsi]: TradingView, [RSI Mean Reversion](https://www.tradingview.com/script/2qjlEzOH-RSI-Mean-Reversion/).
[^tv-strategy]: TradingView Pine Script documentation, [Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/).
[^tv-emulator]: TradingView Help, [Broker emulator](https://www.tradingview.com/support/solutions/43000786181-broker-emulator/).
[^repaint]: TradingView Pine Script documentation, [Repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/).
[^okx-xperp]: OKX, [How do stock and commodity X-Perpetuals work?](https://www.okx.com/en-us/help/how-do-stock-and-commodity-x-perps-work).
[^okx-signal]: OKX, [Trading Signal Bot FAQs](https://www.okx.com/en-eu/help/trading-signal-bot-faqs).
[^okx-alert]: OKX, [Signal Bot alert message specifications](https://www.okx.com/en-us/help/signal-bot-alert-message-specifications).
