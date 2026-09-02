# Araştırma Notları

Araştırma erişim tarihi: **1 Eylül 2026**. Aşağıdaki fiyat karşılaştırması `scripts/research-performance.mjs` ile anahtarsız tarihsel chart verisinden tekrar üretilebilir. Başlangıç noktası her hedef tarihe en yakın işlem günü, bitiş 1 Eylül 2026'daki son erişilebilir gözlemdir.

## Geçmiş fiyat performansı

Tablolar basit fiyat değişimidir; vergi ve yatırımcıya özel işlem maliyeti içermez. ETF düzeltilmiş kapanışı temettü/bölünme etkisini içerebilirken endeks ve vadeli emtia serileri aynı ekonomik yapıda değildir. Bu nedenle tablo sıralama yarışması değil, risk ve rejim karşılaştırmasıdır.

### USD bazında toplam değişim

| Varlık / vekil | 1 yıl | 3 yıl | 5 yıl | 10 yıl |
| --- | ---: | ---: | ---: | ---: |
| Bitcoin (BTC-USD) | -%28,3 | +%202,6 | +%60,3 | +%13.579,3 |
| Altın (GC=F) | +%24,3 | +%127,5 | +%143,4 | +%236,3 |
| Gümüş (SI=F) | +%59,5 | +%170,4 | +%171,0 | +%247,4 |
| S&P 500 | +%19,3 | +%69,5 | +%69,2 | +%252,6 |
| BIST 100, USD'ye çevrilmiş | +%7,2 | -%2,7 | +%65,5 | +%14,6 |

### TL bazında toplam değişim

| Varlık / vekil | 1 yıl | 3 yıl | 5 yıl | 10 yıl |
| --- | ---: | ---: | ---: | ---: |
| Bitcoin | -%15,9 | +%447,3 | +%831,4 | +%223.151,7 |
| Altın | +%45,8 | +%311,4 | +%1.314,5 | +%5.388,9 |
| Gümüş | +%87,1 | +%388,9 | +%1.474,8 | +%5.570,2 |
| S&P 500 | +%39,9 | +%206,5 | +%883,2 | +%5.654,3 |
| BIST 100 | +%25,7 | +%76,0 | +%862,1 | +%1.769,6 |

USD/TRY aynı dönemlerde sırasıyla yaklaşık `%17,3`, `%80,8`, `%481,1` ve `%1.532,0` yükselmiştir. Çok yüksek TL getirilerinin önemli bölümü varlığın reel üretiminden değil, TL'nin dolar karşısındaki değer kaybından gelir; bu nedenle hem TL hem USD görünümü zorunludur.

## On yıllık risk görünümü

| Varlık / vekil | Yıllıklandırılmış günlük volatilite | Maksimum düşüş |
| --- | ---: | ---: |
| Bitcoin | %66,8 | -%83,4 |
| Altın | %16,8 | -%25,1 |
| Gümüş | %34,5 | -%51,4 |
| S&P 500 | %18,1 | -%33,9 |
| BIST 100 (TL) | %25,3 | -%31,8 |

BTC'nin yüksek geçmiş getirisi çok daha yüksek oynaklık ve düşüşle birlikte gelmiştir. Bu, BTC'yi dışlamak için değil, `%5–%45` sınırı ve katkıyla dengeleme kullanmak için gerekçedir. Gümüş de altından belirgin daha oynaktır; emtia bütçesinde altının ana, gümüşün tamamlayıcı olması bu bulguyla uyumludur.

## Değerleme ve resmi karşılaştırmalar

- [S&P Dow Jones Indices](https://www.spglobal.com/spdji/en/indices/equity/sp-500/) 31 Temmuz 2026 itibarıyla S&P 500 fiyat getirisini yıllıklandırılmış olarak 3 yılda `%17,74`, 5 yılda `%11,25`, 10 yılda `%13,17`; 10 yıllık yıllıklandırılmış riski `%15,34` yayımladı.
- [FRED DFII10](https://fred.stlouisfed.org/series/DFII10) ABD 10 yıllık piyasa bazlı reel faiz için kullanılacak resmi seridir. Altın sinyalinde nominal faizden basitçe CPI çıkarılmaz.
- Borsa İstanbul gerçek zaman veriyi [lisanslı dağıtıcılar](https://www.borsaistanbul.com/tr/veriler/veri-yayini/veri-dagitici-kuruluslar) üzerinden yayar. Güvenilir ücretsiz tarihsel BIST F/K/PD-DD otomasyonu bulunmadığında kaynak URL'li manuel giriş tercih edilmelidir.

## DCA ve tek seferlik yatırım

Yukarıdaki performans tablosu tek başlangıç–bitiş fiyatı değişimidir. Uygulamanın Backtest sayfası ise her ay aynı katkıyı o ayın fiyatından alır; sonuçları “toplam yatırılan” ve “son değer” olarak ayrı gösterir. DCA zamanlama riskini dağıtır ancak düşen piyasada zararı engellemez ve her yükselen piyasada tek seferlik yatırımdan iyi olmak zorunda değildir.

## 3/5/10/15 yıllık senaryo bantları

Aşağıdaki yıllık nominal USD varsayımları tahmin değil, stres testi girdileridir:

| Sınıf | Kötümser | Temel | İyimser |
| --- | ---: | ---: | ---: |
| S&P 500 / ABD hisseleri | %1 | %5 | %8 |
| Altın ağırlıklı emtia | -%2 | %2,5 | %6 |
| Bitcoin | -%20 | %8 | %20 |
| Türk hisseleri, USD bazında | -%5 | %3 | %10 |

Ufuk uzadıkça tek yıllık oranı kesin şekilde bileşiklemek sahte hassasiyet yaratır. Uygulama bu bantları garanti edilen hedef olarak kullanmaz; aylık dağıtımı güncel veri, güven ve portföy sapmasıyla sınırlar. Bitcoin iyimser senaryosunun bile yıllık `%20` ile sınırlandırılması geçmiş `%13.000+` on yıllık değişimi geleceğe körlemesine taşımama tercihidir.

## Sonuç

Nötr `%35 S&P 500 / %25 emtia / %20 BTC / %20 Türk hisse` dağılımı araştırmayla çelişmemektedir. Geçmiş lideri otomatik büyütmek yerine S&P 500 çekirdeği, altın ağırlıklı emtia, sınırlandırılmış BTC ve USD bazında izlenen Türk hisseleri birlikte kullanılır. HALKB varsayılan evrene eklenmez; işveren ve yatırımın aynı kuruma bağlanması yoğunlaşma riskini artırır.
