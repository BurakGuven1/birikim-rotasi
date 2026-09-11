# Kesitsel momentum — ilk pozitif bulgu (2026-09-09)

Araç: `scripts/bot-cross-sectional.ts`. Veri: OKX USDT perpetual, günlük kapanışlar, ~370 ortak gün,
45 coin. Maliyet 2 bp komisyon + 3 bp kayma. Yalnızca günlük mum çekilir; koşu ~1 dakika sürer.

## Neden farklı

Şimdiye kadar denenen her model **tek bir coini zamanlamaya** çalışıyordu. Bu model bunu yapmaz:
her gün tüm evreni sıralar, en güçlü N coini long, en zayıf N coini short tutar. Coinler arası
göreli güç, tek coin içindeki fiyat yapısından farklı bir getiri kaynağıdır — per-coin modeller
başarısız olduktan sonra denenmeye değer olmasının sebebi budur.

## Sonuçlar

**Önceden seçilen parametre zarar etti.** Veriye bakmadan seçtiğim kanonik ayar (30 gün momentum,
5 long / 5 short) tüm dönemde %−7,8 verdi. Bu dürüstlük açısından kayda geçmelidir.

Izgara, kazanan bölgenin kısa lookback olduğunu gösterdi (tüm dönem getirisi):

| lookback | K=3 | K=5 | K=8 |
| --- | --- | --- | --- |
| 7 gün | +150 | +126 | +58 |
| 14 gün | +160 | +149 | +78 |
| 30 gün | −26 | −8 | +5 |
| 60–90 gün | negatif | negatif | negatif |

### Maliyet duyarlılığı (kritik test)

Günlük ortalama devir %34,6. Yüksek devir sonucu maliyete bağımlı kılar, bu yüzden açıkça tarandı:

| Ayar | 0 bp | 5 bp | 10 bp | 20 bp | 40 bp |
| --- | --- | --- | --- | --- | --- |
| 14 gün / 5 | +170 | +149 | +129 | +94 | **+39** |
| 7 gün / 5 | +155 | +126 | +101 | +59 | −1 |

14 günlük varyant 40 bp gibi cömert bir maliyet varsayımında bile pozitif. Sonuç, maliyet
varsayımına yapılan bir bahis değil.

### Bacak ayrımı — hayatta kalma yanlılığı testi

| Ayar | long + short | yalnız long | yalnız short |
| --- | --- | --- | --- |
| 7 / 5 | +126 | +32 | +51 |
| 14 / 5 | +149 | +36 | +59 |
| 14 / 3 | +160 | +41 | +60 |

Hayatta kalma yanlılığı **long bacağını** şişirir (ölmüş coinler alım adaylarından eksiktir).
Burada kârın çoğu **short bacağından** geliyor. Bu, yanlılığın sonucu sürüklemediğine dair güçlü
bir kanıttır — ortadan kaldırmaz, ama ana şüpheliyi zayıflatır.

### Walk-forward — tek dürüst test

Yukarıdaki kazanan ayarları ızgaraya bakarak buldum; bu seçimdir. Walk-forward hiç geleceğe bakmaz:
her ayın parametresi yalnızca kendinden önceki 180 günden seçilir.

**Gerçek dış-örnek: 90 gün, getiri %8,0, Sharpe 0,91, azami düşüş %13,6.**
Seçilen parametreler sırayla: 7/5, 14/3, 14/3 — tutarlı biçimde kısa lookback bölgesi.

## Dürüst değerlendirme

+%8, ızgaradaki +%150'lik başlıklardan çok daha mütevazıdır — seçim etkisi çıkarıldığında beklenen
tam olarak budur ve **gerçek sayı budur.** Yine de araştırmada dürüst bir dış-örnek testini geçen
ilk sonuçtur; MPA v2 ve Donchian referansı geçememişti.

Açık kalan riskler, canlıya geçmeden önce kapatılmalı:

1. **Funding modellenmedi.** Perpetual long-short için maliyet kalemidir. Kazananları long'lamak
   genelde funding öder; kaybedenleri short'lamak genelde funding alır — net etki ölçülmeli.
2. **Dış-örnek yalnızca 90 gün ve 3 parametre kararı.** Küçük örneklem; daha uzun geçmişle
   tekrarlanmalı.
3. **Hayatta kalma yanlılığı mevcut.** Evren bugünkü likit kontratlardan seçiliyor. Bacak ayrımı
   ana şüpheyi zayıflatıyor ama tarihsel evren listesi ile doğrulanmalı.
4. **Günlük kapanışta işlem varsayıldı.** Gerçek dolum kalitesi ölçülmeli; 40 bp'ye kadar test edildi.
5. Gerçek emirler kilitli kalmalı. Paper'da ileri doğrulama olmadan sermaye konulmamalı.

---

# Ek: evren duyarlılığı — sonucu geçersiz kılan bulgu

Model bota bağlandıktan sonra aynı yürüyen doğrulama, yalnızca evren büyüklüğü değiştirilerek
tekrarlandı (maliyet 5 bp, aynı dönem, aynı aday parametreler):

| Evren | Dış-örnek getiri | Sharpe |
| --- | --- | --- |
| 20 coin | **−%19,3** | −2,33 |
| 25 coin | +%27,8 | 3,00 |
| 30 coin | +%48,9 | 3,71 |
| 34 coin | +%44,1 | 4,11 |
| 40 coin | +%36,0 | 3,15 |
| 45 coin | +%8,0 | 0,91 |

Tek bir parametre değil, yalnızca kaç coin dahil edildiği değişiyor ve sonuç −%19 ile +%49 arasında
savruluyor. Bu genişlik, getirinin birkaç aşırı hareket eden yeni listelenmiş coin tarafından
belirlendiğini gösterir. Bugünkü long tarafında USELESS, SOPH gibi kontratların çıkması bunu
doğruluyor: bu isimler bugün likit oldukları için evrende yer alıyorlar, yani hayatta kalma
yanlılığının tam merkezindeler.

**Sonuç:** daha önce raporlanan +%8'lik dış-örnek getiri kararlı bir edge değil, kararsız bir
tahmindir. Sharpe 4 gibi değerler bu örneklem boyutunda güvenilir kabul edilemez.

Bu nedenle `/bot` sayfasındaki Kesitsel sekmesi tek bir getiri sayısı göstermez; her çalıştırmada
evren duyarlılığı aralığını da gösterir ve sonucun kararsız olduğunu açıkça yazar.

Bunu gerçekten çözmek için gereken: tarihsel evren listesi (her gün o gün likit olan kontratlar,
bugünküler değil). O veri olmadan bu strateji için güvenilir bir getiri tahmini üretilemez.
