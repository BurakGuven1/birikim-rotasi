# Araştırma Notları ve Kaynaklar

Parametreler aşağıdaki literatürden **olduğu gibi** alındı ve geçmiş veriye göre optimize edilmedi.
Amaç, "backtest'te harika görünüp canlıda çöken" aşırı uyumdan kaçınmaktır.

## 1. Trend filtresi: Faber 10 aylık SMA
- Kural: Ay sonu fiyatı 10 aylık ortalamanın üstündeyse tut, altındaysa o varlığın payını nakde çevir.
- Bulgu: Hisse benzeri getiri, tahvil benzeri oynaklık ve düşüş. S&P 500'de maksimum düşüş %46'dan tek hanelere indi. Bedeli, gecikme yüzünden bir miktar getiri kaybı.
- Kaynaklar: [Faber — A Quantitative Approach to Tactical Asset Allocation (SSRN)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=962461) · [10 yıl sonra yeniden değerlendirme](https://allocatortraining.com/wp-content/uploads/2023/06/A-Quantitative-Approach-to-Tactical-Asset-Allocation.pdf)
- **Trinity yaklaşımı:** Faber sonraki çalışmalarında portföyün yarısını al-tut, yarısını trend takibiyle yönetmeyi önerir. Bu projedeki `trendFloor = 0.5` bunu uygular.

## 2. Zaman serisi momentumu (TSMOM)
- Moskowitz, Ooi ve Pedersen (2012): 58 vadeli işlem piyasasında 12 aylık getiri sonraki ayı tahmin ediyor. Strateji en iyi performansını aşırı piyasalarda gösteriyor ("kriz alfası").
- Uyarı: Kriz trend şeklinde gelişirse korur; ani şoklarda (Mart 2020 gibi) geç kalır. Getirinin önemli kısmı oynaklık ölçeklemesinden gelir.
- Kaynaklar: [Time Series Momentum (SSRN)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2089463) · [Alpha Architect özeti](https://alphaarchitect.com/time-series-momentum-theory-and-evidence/) · [CME: Demystifying TSMOM](https://www.cmegroup.com/education/files/demystifiing-time-series-momentum-strategies.pdf)
- Oynaklık hedefleme: Moreira ve Muir (2017), [Time series momentum and volatility scaling](https://www.sciencedirect.com/science/article/abs/pii/S1386418116301379)

## 3. Dual momentum (Antonacci GEM)
- Mutlak ve göreli momentum birlikte kullanılır. Örneklem dışında karışık sonuç verdi: 60/40'ın gerisinde kaldı ve düşüş avantajı büyük ölçüde 2008'e dayanıyor. Bu yüzden tek başına kullanılmadı; yalnız 12 aylık mutlak momentum bileşeni alındı.
- Kaynaklar: [Antonacci — Extended backtest](https://medium.com/@garyantonacci_30463/extended-backtest-of-global-equities-momentum-dual-momentum-eb12902612e0) · [Örneklem dışı değerlendirme](https://quant4free.com/analysis/dual-momentum/) · [1971–2026 replikasyonu (SSRN)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7427878)

## 4. Yüksek win rate: Connors RSI(2)
- Kural: Fiyat SMA200'ün üstündeyken RSI(2) < 10 ise al; kapanış SMA5'in üstüne çıkınca ya da 10 gün dolunca çık.
- Literatür, endekslerde %70–85 win rate raporluyor. Bu projenin testi: SPY'de %72, QQQ'da %66 win rate ve 1,5–1,9 kâr faktörü. Ancak piyasada yalnız ~%10 zaman kalınıyor ve tek başına al-tut'u yenmiyor.
- Kaynaklar: [StockCharts ChartSchool — RSI(2)](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/rsi-2) · [26 yıllık SPY testi](https://gurufinanceinsights.substack.com/p/i-backtested-the-classic-rsi2-mean) · [QuantifiedStrategies](https://www.quantifiedstrategies.com/rsi-2-strategy/)

## 5. Kriptoda trend takibi
- Grayscale: BTC'de 20/100 günlük ortalama kesişimi, al-tut'tan daha yüksek Sharpe sağladı. Kapsamlı testlerde en iyi 11 stratejinin 9'u trend takipçisi. Win rate ~%35, ama kazananlar kaybedenlerin 3–4 katı büyüklükte.
- Altcoin momentumuna 200 günlük BTC trend filtresi eklemek, maksimum düşüşü yaklaşık yarıya indirdi. Altcoin radarı bu yüzden yalnız BTC trendi açıkken çalışır.
- Kaynaklar: [Grayscale — The Trend is Your Friend](https://research.grayscale.com/reports/the-trend-is-your-friend-managing-bitcoins-volatility-with-momentum-signals) · [49 kripto stratejisinin testi](https://dev.to/maymay5692/i-backtested-49-crypto-trading-strategies-heres-every-single-result-4gg5) · [BTC 200g filtreli altcoin momentumu](https://github.com/IsaacDodds/crypto-momentum-backtest) · [ETH Zürich tezi](https://ethz.ch/content/dam/ethz/special-interest/mtec/chair-of-entrepreneurial-risks-dam/documents/dissertation/master%20thesis/Master_Thesis_Gl%C3%BCcksmann_13June2019.pdf)

## 6. Efloud ve price action swing yaklaşımı
- Efloud ("efloud the surfer"), price action temelli analizleriyle bilinen Türk kripto analisti. Yaklaşımı genel hatlarıyla şöyle özetlenebilir: yüksek zaman diliminde piyasa yapısı, range sınırları, destek/direnç dönüşümleri ve likidite süpürmesi (deviation/reclaim). Kişisel yöntemi yayımlanmış mekanik bir kural seti olmadığı için birebir kopyalanamaz. Kaynaklar: [ekşi sözlük](https://eksisozluk.com/efloud--6042812) · [X](https://x.com/Efloud/status/2087965484201418879) · [OKX TR haftalık raporları](https://tr.okx.com/en/learn/haftalik-arastirma-raporu-12)
- Bu projede bu yaklaşımın **sistematik bir yorumu** test edildi (`sweep`): SMA200 yönünde, 20 günlük range dibinin altına iğne atıp içeri kapanış → hedef range tepesi. **Sonuç:** 6 varlıkta %24–28 win rate ve çoğunda negatif beklenti. Mekanik haliyle uydu koluna **alınmadı**.
- Çıkarım: Price action değerini okuyucunun takdirinden (bağlam, hacim, haber, çoklu zaman dilimi) alır. Kullanacaksanız yalnız trend yönünde ve *onay* aracı olarak kullanın. Her işlemi günlüğe yazın; kendi 50+ işlemlik örnekleminizde pozitif beklenti ölçmeden sermayeyi büyütmeyin.
- Genel kaynaklar: [Likidite süpürmesi (FXOpen)](https://fxopen.com/blog/en/what-is-a-liquidity-sweep-and-how-can-you-use-it-in-trading/) · [Swing high/low piyasa yapısı](https://www.colibritrader.com/swing-high-swing-low/)

## 7. BIST 100 (USD bazlı)
- 2016–2025 döneminde BIST 100'ün dolar bazlı yıllık getirisi ortalama ~%9,6. On yılın beşinde USD/TRY'yi geçti, beşinde geride kaldı. Oynaklık yüksek. Bu yüzden stratejik ağırlığı %10.
- Kaynaklar: [Haluk Canberk — BIST 100 2016–2025](https://www.halukcanberk.com/13/02/2026/turkiye-borsasi-bist-100-performans-analizi-2016-2025/) · [Borsa İstanbul — BIST 100 USD getiri endeksi](https://www.borsaistanbul.com/en/index/xu100cfnntlus)

## 8. Win rate ≠ kârlılık
| Sistem tipi | Win rate | Ort. kazanç / kayıp | Bu projede |
| --- | --- | --- | --- |
| Ortalamaya dönüş (RSI2) | %65–75 | küçük / orta | SPY: %72 WR, 0,11R beklenti |
| Trend takibi (Donchian) | %30–50 | büyük / küçük | BTC: %42 WR, 2,37R beklenti |
| Price action sweep (mekanik) | %25–28 | büyük / büyük | çoğunda negatif |

Doğru hedef yüksek win rate değil, **pozitif beklenti** (ortalama R) ve bu beklentinin iki farklı dönemde (1. yarı / 2. yarı kâr faktörü) sürmesidir. Uydu kolunda iki tipin birlikte bulunmasının nedeni de budur: biri sık ve küçük kazanır, diğeri seyrek ama büyük kazanır.
