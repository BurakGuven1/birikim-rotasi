# Strateji El Kitabı

## 0. Önce gerçekçilik: hedef ne kadar zor?

Katkı yılda $15.500 (reel, enflasyonla birlikte artırılırsa). Finansal özgürlük için bugünün
doları ile aylık $5.000 harcama ÷ %4 güvenli çekim oranı = **$1,5M** (`npm run plan` ile değiştirilebilir).

| Ufuk | Gereken sabit reel getiri |
| --- | --- |
| 10 yıl | %41,9 — gerçekçi değil |
| 15 yıl | %22,0 — çok zor |
| 20 yıl | %13,8 — iddialı ama ulaşılabilir |
| 25 yıl | %9,5 |

Bağlam: ABD hisseleri uzun vadede reel ~%6,5–7 getirdi. S&P 500 DCA son 20 yılda reel IRR %10,5 verdi.
Reel %15'i 20 yıl boyunca sürdürmek en iyi fonların seviyesidir. Plan, **%12–15 hedeflenip %10'da
bile hedefe 24 yılda ulaşılacak** biçimde kurulmalı. Getiriyi artırmanın en güvenilir kaldıracı
katkıyı artırmaktır: gelir arttıkça aylık tutarı yükseltin.

## 1. Mimari

```
Toplam portföy
├─ Çekirdek %80  (aylık karar, ay sonu kapanışı)
│   ├─ Stratejik ağırlıklar: SPY 30 · QQQ 20 · Altın 15 · BIST(USD) 10 · BTC 15 · ETH/alt 5 · Emtia 5
│   ├─ Her varlığın YARISI her zaman tutulur (al-tut)
│   └─ Diğer YARISI trend skoruna göre: skor = ½·[ay sonu > SMA10] + ½·[12a getiri > T-bill]
│        skor 1 → tam · 0,5 → yarım · 0 → nakit (ya da perp short hedge)
└─ Swing uydu %20 (günlük karar, OKX perp, USDT teminat)
    ├─ RSI(2) geri çekilme: S&P 500, Nasdaq 100, Altın   (yüksek win rate)
    └─ Donchian 55/20: BTC, ETH, Altın, Emtia            (yüksek beklenti)
```

**Agresif seçenek:** Çekirdeğin oynaklığı %16'ya hedeflenir ve brüt maruziyet en fazla 1,5x olur
(sakin trendlerde perp ile kaldıraç). Tarihsel olarak reel ~%15'e yaklaştı, ama maksimum düşüş
%22'den %33'e çıktı. Yalnız ilk 2–3 yılı kurallara sadık kalarak geçirdikten sonra düşünün.

## 2. Aylık rutin (ayın ilk iş günü, ~20 dk)

1. `npm run sinyal` (Ocak'ta yıllık $3.500 otomatik eklenir).
2. **Çekirdek:** Rapordaki "Bu ayın katkısı" tablosuna göre alım yapın. Mümkünse satış yapmayın;
   `portfoy.json` güncel tutulursa katkı zaten hedefin altındaki kalemlere gider.
   - BIST payı: bankadan BIST 100/30 endeks fonu veya BYF (TL). Performansı USD ile ölçün.
   - Altın: OKX `XAUT-USDT` / `PAXG-USDT` spot (perp değil; XAU perp fonlaması yıllık %10–20 olabiliyor).
   - BTC/ETH: OKX spot. Uzun vadeli kısmı mümkünse kendi cüzdanınızda tutun.
   - S&P 500 / Nasdaq: En verimlisi gerçek ETF (VOO/QQQM) tutabileceğiniz bir aracı kurum.
     Yalnız OKX kullanılacaksa `US500-USDT-SWAP` / `US100-USDT-SWAP` 1x uzun pozisyon açılabilir,
     ama fonlama maliyetini rapordan her ay kontrol edin.
     ⚠️ **`SPX-USDT-SWAP` S&P 500 değildir, SPX6900 adlı memecoin'dir.**
3. **Rejim değiştiyse** (🔴/🟡): O varlığın trend yarısını satın. Satmak istemiyorsanız (vergi, cüzdan)
   rapordaki oran kadar 1x perp short açın ("hedge"). Rejim yeniden AÇIK olunca short'u kapatın.
4. **Yıllık ek ($3.500):** Ocak'ta tek seferde, aynı hedef ağırlıklarla yatırın. Araştırmalar toplu
   yatırımın DCA'yı yaklaşık 3 seferden 2'sinde geçtiğini gösteriyor. Trend kapalı varlıkların payı
   zaten nakitte bekler; bu, "doğru zamanda yatırım" kuralının kendisidir.

## 3. Swing kuralları (günlük kapanış sonrası, ~5 dk)

TradingView'da `pine/ozgurluk_swing.pine` scriptini ilgili varlıklara ekleyip alarm kurun, ya da
`npm run sinyal` tablosunu kontrol edin.

| Sistem | Giriş (kapanışta sinyal, sonraki açılışta işlem) | Stop | Çıkış |
| --- | --- | --- | --- |
| RSI(2) | Fiyat > SMA200 ve RSI(2) < 10 | 3·ATR(14) felaket stopu | Kapanış > SMA5 ya da 10 gün |
| Donchian | Kapanış > önceki 55 günün zirvesi → long; < 55 gün dibi → short | 2·ATR(20) | Karşı yönde 20 günlük kırılım |

**Risk yönetimi (tartışmaya kapalı):**
- İşlem başına swing kasasının **%1–2'si** risk: `adet = risk$ / |giriş − stop|`.
- Swing kasasında toplam nominal ≤ 1x (backtest varsayımı). Kaldıraçlı perp açılsa bile izole marj
  kullanın ve likidasyon fiyatını stopun çok ötesinde tutun.
- Stopsuz işlem yok. Stop genişletilmez.
- **Devre kesici:** Swing kasası zirveden %25 düşerse sistemi 1 ay durdurun ve işlem günlüğünü inceleyin.
  Swing kasası çekirdekten beslenmez; en fazla toplam portföyün %20'si olabilir.
- Swing kârları ayda bir yeniden %20 hedefine dengelenir: fazlası çekirdeğe aktarılır.

## 4. Win rate hakkında

İstenen şey "uzun vadede win rate'i yüksek" işlemler, ama win rate tek başına yanıltıcıdır:
- RSI(2): %66–72 win rate, küçük kazançlar (+0,3R), kâr faktörü 1,5–1,9.
- Donchian: %31–51 win rate, ama BTC/ETH'de ortalama kazanç 5–7R. Uydunun getirisinin büyük kısmı buradan geliyor.
- Efloud tarzı range sapması (mekanik versiyonu): %24–28 win rate ve negatif beklenti. Uyduya alınmadı.
  Price action'ı yalnız takdire dayalı bir **onay** aracı olarak kullanın ve günlükte ölçün.

## 5. Varlık ve platform eşlemesi

| Varlık | Çekirdek (uzun vade) | Swing / hedge |
| --- | --- | --- |
| BIST 100 | Banka: endeks fonu veya BYF | — (banka üzerinden kaldıraç önerilmez) |
| S&P 500 | ETF (VOO/SPY) ya da OKX US500 1x | OKX `US500-USDT-SWAP`, `SPY-USDT-SWAP` |
| Nasdaq 100 | ETF (QQQM/QQQ) ya da OKX US100 1x | OKX `US100-USDT-SWAP`, `QQQ-USDT-SWAP` |
| Altın | OKX `XAUT-USDT` / `PAXG-USDT` spot | OKX `XAU-USDT-SWAP` |
| Bitcoin | OKX `BTC-USDT` spot → soğuk cüzdan | OKX `BTC-USDT-SWAP` |
| ETH / altcoin | OKX spot; altcoin radarından en fazla 3 coin, ETH payının içinde | OKX `ETH-USDT-SWAP` |
| Emtia | — | OKX `CL-USDT-SWAP` (petrol), `XAG-USDT-SWAP` (gümüş) |

## 6. Vergi ve mevzuat (kontrol listesi)

- Türkiye'de hisse senedi yoğun fonlar, yurt dışı menkul kıymet ve kripto kazançlarının
  vergilendirmesi 2025–2026'da değişiklik gündeminde. Yıllık beyan yükümlülükleri için bir
  **mali müşavire danışın**. Bu kurallar netleştikçe aylık dengelemenin "satış yerine katkı ile
  dengeleme" ve "satış yerine hedge" öncelikleri vergi verimliliğini artırır.
- Yurt dışı borsa hesaplarının kullanımı ve TL–USDT geçişleri için güncel SPK/MASAK düzenlemelerini takip edin.

## 7. Kural defteri — neyi YAPMAYACAĞIZ

1. Ay içinde çekirdek kararını değiştirmek (rejim yalnız ay sonu kapanışıyla değişir).
2. Kaybeden swing işleminin stopunu genişletmek veya pozisyonu büyütmek.
3. Backtest'e bakarak parametre değiştirmek. Değişiklik yalnız yeni bir araştırma sonucu çıkarsa
   ve önceden yazılı gerekçeyle yapılır; eski sonuçlar `docs/SONUCLAR.md` içinde saklanır.
4. BTC trendi kapalıyken altcoin almak.
5. Tek bir işleme swing kasasının %2'sinden fazlasını riske etmek.
