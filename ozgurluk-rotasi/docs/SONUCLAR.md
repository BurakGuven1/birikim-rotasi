# Backtest Sonuçları ve Yorum

> Bu dosya `npm run backtest` çıktısının (`out/RAPOR.md`) 2026-09-24 tarihli bir kopyası ve yorumudur.
> Güncel sonuç için komutu yeniden çalıştırın.

## Yöntem
- Veri: Yahoo (temettü düzeltmeli), BIST 100 USD/TRY ile USD'ye çevrildi, ABD TÜFE (FRED CPIAUCSL), nakit = 13 haftalık T-bill.
- Sinyal ay sonu kapanışında; işlem maliyeti varlık başına 5–20 baz puan. Swing'de sinyal kapanışta, dolum ertesi açılışta. Stop bar içinde, gap'te açılıştan dolar. Uzun perp pozisyonları fonlama öder (yıllık %6–10). Teminat T-bill getirisi kazanır.
- Katkılar nominal sabit ($1.000/ay + her Ocak $3.500). Reel IRR, her katkı kendi ayının TÜFE'siyle deflate edilerek hesaplanır.
- Parametreler literatür varsayılanlarıdır ve optimize edilmedi.

## Dürüst yorum
1. **Getirinin motoru varlık seçimi, zamanlama değil.** Filtresiz çok varlıklı al-tut (kripto %20) en yüksek reel IRR'ı verdi (%17,4). Bedeli -%43 maksimum düşüş ve -%34'lük bir yıl oldu. S&P 500 tek başına %10,5'te kaldı.
2. **Trend filtresi düşüşü dörtte bire indiriyor** (-%43 → -%12), ama bu örneklemde getiriden ~4 puan kaybettiriyor. Kriptonun V tipi toparlanmalarında filtre geç kalıyor.
3. **Hibrit (yarı al-tut + yarı trend)** iki ucun ortasında kaldı: reel IRR %15,5, maksimum düşüş -%28.
4. **Swing uydusu** Sharpe'ı ve düşüşü iyileştirdi, ama mutlak getiriyi düşürdü. RSI(2) piyasada yalnız ~%10 zaman kalıyor. Asıl katkı Donchian'ın kriptodaki trend yakalamasından geliyor.
5. **Plan değişikliği (şeffaflık):** İlk kaydedilen plan "tam trend filtresi + %20 swing" idi (reel IRR %11,5). Sonuçlar görüldükten sonra, Faber'in Trinity önerisine dayanarak hibrit çekirdeğe geçildi. Bu karar kısmen örneklem içi bilgiye dayandığı için ileriye dönük getiriyi tablodakinden 1–2 puan düşük bekleyin.
6. **Hedefe olasılık:** Monte Carlo'ya göre ana planla 20 yılda $1,5M'ye ulaşma olasılığı ~%30, medyan ~$1,14M. Agresif seçenekte ~%48, medyan ~$1,45M. Hedefi garantilemenin yolu getiri değil, **katkıyı artırmak** ve süreyi 20–25 yıla yaymaktır.
7. Uzun dönemde kripto 2015/2018'den itibaren dahil. Yalnız "tüm varlıklar mevcut" dönemi (2018–2026) kripto boğasını içerdiği için iyimser okunmalıdır.

---

Oluşturma: 2026-09-24 · Veri sonu: 2026-08 · Katkı: $1,000/ay + $3,500 her 1. ay (nominal sabit)

Hedef: reel %15/yıl. Finansal özgürlük sayısı: $5,000/ay reel harcama ÷ %4 = **$1,500,000** (bugünün doları).

## Uzun dönem: 2006-01 → 2026-08 (20.6 yıl)

_BTC 2015-09, ETH 2018-11 itibarıyla dahil olur; öncesinde ağırlıkları diğer varlıklara dağıtılır._

| Strateji | Reel IRR | Reel CAGR (TWR) | Nominal CAGR | Maks DD | Sharpe | En kötü yıl | Ort. maruziyet | Yatırılan (nominal) | Yatırılan (bugünün $) | Son değer | Kat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sadece S&P 500 (DCA, al-tut) | 10.5% | 8.4% | 11.1% | -50.8% | 0.67 | -36.8% | 100% | $320,500 | $435,992 | $1,577,498 | 3.62x |
| Statik çoklu varlık (DCA, al-tut) | 17.4% | 14.5% | 17.4% | -42.7% | 0.91 | -33.9% | 100% | $320,500 | $435,992 | $3,874,163 | 8.89x |
| Trend filtreli (SMA10) | 13.1% | 11.6% | 14.4% | -12.3% | 1.02 | -11.3% | 72% | $320,500 | $435,992 | $2,210,141 | 5.07x |
| Trend filtreli (SMA10 + 12a momentum) | 13.3% | 11.4% | 14.2% | -13.3% | 1.01 | -11.7% | 72% | $320,500 | $435,992 | $2,272,645 | 5.21x |
| Hibrit: yarı al-tut + yarı trend filtreli | 15.5% | 13.1% | 16.0% | -28.2% | 0.99 | -22.4% | 86% | $320,500 | $435,992 | $3,019,142 | 6.92x |
| İlk kayıtlı plan: trend çekirdek %80 + swing %20 | 11.5% | 9.8% | 12.5% | -10.2% | 1.03 | -8.9% | 78% | $320,500 | $435,992 | $1,788,394 | 4.10x |
| ANA PLAN: Hibrit çekirdek %80 + swing %20 | 13.3% | 11.2% | 14.0% | -22.1% | 1.02 | -17.3% | 89% | $320,500 | $435,992 | $2,248,752 | 5.16x |
| AGRESİF: Ana plan + oynaklık hedefi (≤1.5x) | 15.2% | 12.9% | 15.8% | -32.9% | 0.96 | -26.1% | 109% | $320,500 | $435,992 | $2,912,978 | 6.68x |

## Tüm varlıklar mevcut: 2018-11 → 2026-08 (7.8 yıl)

_Yedi varlığın hepsi 12 aylık geçmişe sahip._

| Strateji | Reel IRR | Reel CAGR (TWR) | Nominal CAGR | Maks DD | Sharpe | En kötü yıl | Ort. maruziyet | Yatırılan (nominal) | Yatırılan (bugünün $) | Son değer | Kat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sadece S&P 500 (DCA, al-tut) | 12.5% | 11.7% | 15.8% | -23.9% | 0.80 | -18.2% | 100% | $121,000 | $140,439 | $237,684 | 1.69x |
| Statik çoklu varlık (DCA, al-tut) | 19.8% | 22.2% | 26.7% | -28.0% | 1.13 | -19.7% | 100% | $121,000 | $140,439 | $322,025 | 2.29x |
| Trend filtreli (SMA10) | 14.1% | 14.7% | 18.9% | -12.3% | 1.09 | -5.2% | 72% | $121,000 | $140,439 | $254,256 | 1.81x |
| Trend filtreli (SMA10 + 12a momentum) | 15.2% | 15.1% | 19.4% | -12.8% | 1.13 | -4.3% | 72% | $121,000 | $140,439 | $265,767 | 1.89x |
| Hibrit: yarı al-tut + yarı trend filtreli | 17.6% | 18.9% | 23.2% | -20.4% | 1.18 | -11.9% | 86% | $121,000 | $140,439 | $294,418 | 2.10x |
| İlk kayıtlı plan: trend çekirdek %80 + swing %20 | 13.3% | 13.3% | 17.5% | -10.2% | 1.18 | -3.1% | 77% | $121,000 | $140,439 | $245,451 | 1.75x |
| ANA PLAN: Hibrit çekirdek %80 + swing %20 | 15.3% | 16.3% | 20.6% | -16.3% | 1.22 | -9.1% | 89% | $121,000 | $140,439 | $266,560 | 1.90x |
| AGRESİF: Ana plan + oynaklık hedefi (≤1.5x) | 15.6% | 16.7% | 20.9% | -19.9% | 1.14 | -11.6% | 97% | $121,000 | $140,439 | $270,082 | 1.92x |

## 10 yıllık kayan pencereler (her Ocak başlangıçlı, reel IRR)

| Strateji | Pencere | Min | Medyan | Maks | ≥ %15 reel oranı |
| --- | --- | --- | --- | --- | --- |
| Sadece S&P 500 (DCA, al-tut) | 11 | 7.5% | 10.9% | 12.8% | 0% |
| Statik çoklu varlık (DCA, al-tut) | 11 | 6.4% | 20.2% | 24.7% | 73% |
| Trend filtreli (SMA10) | 11 | 5.0% | 15.7% | 18.6% | 55% |
| Trend filtreli (SMA10 + 12a momentum) | 11 | 4.5% | 15.3% | 18.4% | 55% |
| Hibrit: yarı al-tut + yarı trend filtreli | 11 | 5.5% | 18.4% | 21.3% | 73% |
| İlk kayıtlı plan: trend çekirdek %80 + swing %20 | 11 | 3.8% | 13.0% | 15.7% | 36% |
| ANA PLAN: Hibrit çekirdek %80 + swing %20 | 11 | 4.7% | 15.2% | 18.1% | 55% |
| AGRESİF: Ana plan + oynaklık hedefi (≤1.5x) | 11 | 6.0% | 17.9% | 22.0% | 82% |

## Swing stratejileri (günlük, işlem bazlı)

Sinyal kapanışta, dolum ertesi açılışta; komisyon+kayma ve perp fonlama maliyeti dahil. ✓ = ana plandaki uydu kolunda (önceden kayıtlı).

| Strateji | Varlık | İşlem | Win rate | Ort. kazanç R | Ort. kayıp R | Beklenti R | Kâr faktörü | PF 1. yarı | PF 2. yarı | CAGR | Maks DD | Piyasada |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rsi2 ✓ | S&P 500 | 277 | 72% | 0.33 | -0.44 | 0.11 | 1.90 | 2.64 | 1.60 | 3.0% | -14.2% | 10% |
| rsi2 ✓ | Nasdaq 100 (US100) | 223 | 66% | 0.32 | -0.42 | 0.07 | 1.52 | 1.45 | 1.58 | 2.1% | -20.9% | 11% |
| rsi2 ✓ | Altın | 149 | 64% | 0.31 | -0.48 | 0.03 | 1.10 | 1.05 | 1.15 | -0.5% | -26.3% | 10% |
| rsi2 | Bitcoin | 123 | 72% | 0.28 | -0.55 | 0.05 | 1.13 | 1.04 | 1.29 | 2.7% | -47.6% | 8% |
| rsi2 | Ethereum (altcoin vekili) | 66 | 64% | 0.25 | -0.43 | 0.00 | 0.89 | 0.78 | 1.17 | -2.8% | -51.1% | 7% |
| rsi2 | Emtia sepeti | 124 | 50% | 0.27 | -0.55 | -0.14 | 0.62 | 0.69 | 0.53 | -3.3% | -55.2% | 8% |
| donchian | S&P 500 | 151 | 34% | 2.13 | -0.92 | 0.11 | 1.09 | 1.06 | 1.15 | -1.8% | -54.7% | 58% |
| donchian | Nasdaq 100 (US100) | 119 | 34% | 2.39 | -0.88 | 0.25 | 1.39 | 1.19 | 1.63 | 0.1% | -32.8% | 60% |
| donchian ✓ | Altın | 91 | 32% | 3.28 | -0.98 | 0.38 | 1.42 | 1.26 | 1.66 | -0.6% | -45.5% | 53% |
| donchian ✓ | Bitcoin | 62 | 42% | 6.87 | -0.88 | 2.37 | 3.87 | 4.47 | 3.70 | 19.4% | -33.0% | 53% |
| donchian ✓ | Ethereum (altcoin vekili) | 41 | 51% | 4.84 | -0.82 | 2.08 | 5.29 | 7.29 | 4.20 | 15.0% | -34.1% | 56% |
| donchian ✓ | Emtia sepeti | 86 | 31% | 4.44 | -0.97 | 0.73 | 1.80 | 2.17 | 1.55 | 2.8% | -30.8% | 53% |
| sweep | S&P 500 | 210 | 28% | 2.61 | -1.08 | -0.06 | 0.93 | 0.93 | 0.93 | -1.0% | -28.5% | 14% |
| sweep | Nasdaq 100 (US100) | 166 | 24% | 2.35 | -1.24 | -0.37 | 0.78 | 0.78 | 0.78 | -1.8% | -43.6% | 12% |
| sweep | Altın | 91 | 27% | 3.02 | -1.20 | -0.04 | 1.06 | 1.17 | 0.97 | -0.6% | -26.6% | 13% |
| sweep | Bitcoin | 99 | 26% | 2.36 | -0.95 | -0.08 | 0.85 | 0.56 | 1.08 | -1.6% | -28.2% | 20% |
| sweep | Ethereum (altcoin vekili) | 78 | 27% | 3.00 | -0.94 | 0.12 | 1.12 | 1.06 | 1.17 | 0.9% | -24.0% | 19% |
| sweep | Emtia sepeti | 100 | 26% | 2.73 | -1.25 | -0.21 | 0.86 | 0.88 | 0.83 | -1.0% | -26.5% | 12% |

## Hedefe ulaşma: sabit reel getiri senaryoları (bugünün doları)

| Reel getiri | 10 yıl | 15 yıl | 20 yıl |
| --- | --- | --- | --- |
| 5% | $201,216 | $345,205 | $528,975 |
| 7% | $223,761 | $406,972 | $663,934 |
| 10% | $262,817 | $523,945 | $944,495 |
| 12% | $292,827 | $622,068 | $1,202,303 |
| 15% | $344,741 | $807,877 | $1,739,409 |

## Monte Carlo (uzun dönem reel aylık getirilerden 12 aylık blok bootstrap, 5000 yol)

Katkıların enflasyonla artırıldığı (reel sabit) varsayılır. Hedef: $1,500,000.

**Ana plan**

| Ufuk | Kötü (P10) | Medyan | İyi (P90) | Hedefe ulaşma olasılığı |
| --- | --- | --- | --- | --- |
| 10 yıl | $198,976 | $284,585 | $437,845 | 0% |
| 15 yıl | $371,802 | $603,321 | $1,035,512 | 2% |
| 20 yıl | $645,248 | $1,138,769 | $2,217,961 | 30% |

**Agresif**

| Ufuk | Kötü (P10) | Medyan | İyi (P90) | Hedefe ulaşma olasılığı |
| --- | --- | --- | --- | --- |
| 10 yıl | $203,864 | $319,242 | $521,055 | 0% |
| 15 yıl | $395,017 | $714,187 | $1,358,132 | 7% |
| 20 yıl | $704,109 | $1,445,182 | $3,212,709 | 48% |

## Güncel çekirdek ağırlıkları (2026-08 sonu sinyali)

| Kalem | Ana plan | Agresif |
| --- | --- | --- |
| S&P 500 | 24.0% | 35.3% |
| Nasdaq 100 (US100) | 16.0% | 23.5% |
| Altın | 9.0% | 13.2% |
| BIST 100 (USD) | 8.0% | 11.8% |
| Bitcoin | 9.0% | 13.2% |
| Ethereum (altcoin vekili) | 3.0% | 4.4% |
| Emtia sepeti | 4.0% | 5.9% |
| Swing uydu | 20.0% | 20.0% |

> Geçmiş performans gelecekteki sonuçları garanti etmez. Bu rapor yatırım tavsiyesi değildir; araştırma ve karar desteği içindir.