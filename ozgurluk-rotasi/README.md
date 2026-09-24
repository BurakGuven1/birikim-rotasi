# Özgürlük Rotası

**Birikim Rotası'ndan bağımsız**, sıfırdan kurulmuş bir araştırma ve sinyal motoru. Hedef:
**her ay $1.000 + yılda $3.500** katkıyla, ABD enflasyonundan arındırılmış (**reel**) getiriyi
en üst düzeye çıkarmak ve 10–20 yılda finansal özgürlük sermayesine ulaşmak.

- **Çekirdek (%80):** S&P 500, Nasdaq 100, altın, BIST 100 (USD), BTC, ETH/altcoin, emtia.
  Yarısı her zaman al-tut; diğer yarısı aylık trend kuralına (Faber SMA10 + 12 aylık momentum)
  göre nakde geçer veya perp short ile hedge edilir ("Trinity" yaklaşımı).
- **Swing uydu (%20):** OKX perp'lerinde günlük sistemler: RSI(2) geri çekilme (yüksek win
  rate) ve Donchian 55/20 trend kırılımı (düşük win rate, yüksek beklenti).
- **Uygulama:** BIST banka üzerinden, global varlıklar OKX üzerinden (spot çekirdek, perp swing/hedge).
  TradingView Pine scriptleri ve webhook alıcısı dahil.

📘 Strateji el kitabı: [docs/STRATEJI.md](docs/STRATEJI.md) · 📊 Backtest sonuçları: [docs/SONUCLAR.md](docs/SONUCLAR.md) · 📚 Kaynaklar: [docs/ARASTIRMA.md](docs/ARASTIRMA.md)

## Kurulum

Node.js ≥ 22.18 gerekir. TypeScript, derleme adımı olmadan doğrudan çalışır. Çalışma zamanında bağımlılık yok.

```sh
cd ozgurluk-rotasi
npm install            # yalnız tip denetimi için (typescript, @types/node)
cp .env.example .env   # isteğe bağlı; anahtarsız da çalışır
```

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `npm run veri` | Fiyatları indirir, önbelleğe alır ve veri kapsamını gösterir (Yahoo, OKX, FRED) |
| `npm run backtest` | Tüm varyantları, kayan 10 yıllık pencereleri, swing sistemlerini ve Monte Carlo'yu çalıştırır → `out/RAPOR.md` |
| `npm run sinyal` | **Aylık eylem raporu**: rejim, bu ayın katkısının dağılımı, hedge, açık swing pozisyonları, fonlama, altcoin radarı → `out/SINYAL.md` |
| `npm run sinyal -- --ek` | Yıllık $3.500'ü de dahil eder (Ocak'ta otomatik) |
| `npm run takvim` | Aylık getiri takvimi: son 10 yılın yeşil/kırmızı ayları, "8/10" eğilimleri, seçim/halving olay çalışması → `out/TAKVIM.md` |
| `npm run plan -- --harcama 5000 --mevcut 20000` | Hedef hesabı: gereken reel getiri ve hedefe kalan süre |
| `npm run okx -- fonlama` | OKX perp fonlama oranları |
| `npm run okx -- bakiye` / `pozisyon` | Hesap bakiyesi ve pozisyonlar (Read yetkili anahtar) |
| `npm run okx -- emir --inst BTC-USDT-SWAP --yon buy --usd 300 --stop 80000` | Emir **önizlemesi**. Canlı emir için `.env`'de `OKX_LIVE=1` ve `--canli` gerekir |
| `npm run web` | Panel: http://localhost:4173 (Lightweight Charts). Ayrıca TradingView webhook alıcısı: `POST /webhook` |
| `npm test` · `npm run typecheck` | Birim testleri ve tip denetimi |

`portfoy.example.json` dosyasını `portfoy.json` olarak kopyalayıp güncel pozisyonlarınızı USD
cinsinden girerseniz, `sinyal` aylık katkıyı hedefin en çok altında kalan kalemlere yönlendirir.
Böylece portföy satış yapmadan dengelenir.

## Panel (http://localhost:4173)

- **Dönem filtresi:** Son 1 / 2 / 3 / 5 / 7 / 10 / 15 yıl, 20+ yıl (2006'dan beri) ve 2018+ seçilebilir. Her pencere o tarihte $0 ile başlanıp aynı katkıların yapıldığı varsayımıyla hesaplanır. KPI'lar, grafik ve tablo seçili döneme göre güncellenir.
- **Dönem matrisi:** Tüm stratejilerin tüm dönemlerdeki reel getirisi tek tabloda görünür. Böylece hangi stratejinin tutarlı olduğu, hangisinin yalnız belirli bir dönemde parladığı görülür.
- **Gelecek projeksiyonu:** "Bu başarı devam ederse" sorusunu yanıtlar. Seçilen dönemin reel getirisi 20 yıl ileri taşınır. Tablo 1, 3, 5, 10, 15 ve 20 yıl sonra hangi yılda ne kadar yatırımla hangi değere ulaşılacağını ve hedefe hangi tarihte ulaşılacağını gösterir. Mevcut birikim, katkılar, harcama hedefi, enflasyon ve reel/nominal gösterim ayarlanabilir. Ana plan için Monte Carlo bandı (kötü %10 – iyi %90) çizilir.
- **Kalıcılık:** Strateji çizgileri lejanttan açılıp kapatılır. Seçimler tarayıcıda hatırlanır.

## Aylık Getiri Takvimi (http://localhost:4173/takvim)

Takvim şu varlıkları kapsar: XU100 (TL ve USD), S&P 500, Nasdaq 100, altın, BTC, ETH ve emtia.
- **Isı haritası:** Son 10 yılın her ayı yeşil/kırmızı bir hücre olarak, getirisiyle birlikte gösterilir. Renk yoğunluğu varlığın tipik aylık hareketine göre ölçeklenir. En sağ sütun yıllık getiriyi verir.
- **Alt satırlar:** Her takvim ayı için son 10 kapanmış gözlemin yeşil sayısı ("8/10"), ortalaması, medyanı ve en iyi/en kötü değeri.
- **Uyarılar:** ≥7/10 yeşil ya da ≤3/10 yeşil olan aylar listelenir. Yanlarındaki "kanıt" düzeyi binom testine dayanır: 10 yıllık örneklemde tesadüf olasılığını ölçer.
- **Olay notları:** Hücre köşesindeki nokta bir olayı gösterir; üzerine gelince ayrıntı açılır. Kapsanan olaylar: ABD ve TR seçimleri, BTC halving'leri, kur krizleri, Covid, Fed döngüsü gibi şoklar. Seçimler, halving ve şoklar ayrı ayrı gizlenebilir. Liste `src/data/events.ts` dosyasında tutulur.
- **Seçim ve olay çalışması:** Her seçim için öncesindeki 6 ve 3 ayın, sonrasındaki 1 ve 3 ayın getirisi hesaplanır. Aynı uzunluktaki "herhangi bir dönem" ortalamasıyla karşılaştırılır. Örneğin TL bazında XU100 seçim öncesi 6 ayda ortalama yükseliyor olsa bile, yüksek enflasyon döneminde bu herhangi bir 6 aydan daha iyi olmayabilir.
- **Kartlar:** "Bu ay / gelecek ay" ve "yaklaşan olaylar" kartları (ör. ABD ara seçimi 3 Kasım 2026) en üstte yer alır. Aynı notlar `npm run sinyal` raporunun 7. bölümünde de bulunur.
- **Güncelleme:** Sunucu fiyatları 12 saatte bir, takvimi saatte bir yeniden hesaplar. Bir ay kapandığında yeni ay otomatik eklenir ve istatistiklere katılır. Devam eden ay kesikli çerçeveyle gösterilir ve istatistiklere dahil edilmez.

## TradingView

- `pine/ozgurluk_rejim.pine`: Aylık rejim paneli (AÇIK / YARIM / KAPALI + hedef maruziyet). Her çekirdek varlığa ekleyin ve "Rejim değişti" alarmı kurun.
- `pine/ozgurluk_swing.pine`: Motorla aynı kurallara sahip swing stratejisi. Strateji test aracıyla sonuçları doğrulayın. Alarmda mesaj olarak `{{strategy.order.alert_message}}` kullanın ve webhook URL'si olarak panel sunucunuzun `/webhook` adresini girin. Bunun için sunucu genel bir HTTPS adresinden erişilebilir olmalıdır (ör. Cloudflare Tunnel).

## Güvenlik

- Anahtarlar yalnız `.env` dosyasında durur (Git'e girmez). OKX anahtarı için önce **yalnız Read** yetkisi verin, IP kısıtı ekleyin ve **Withdraw yetkisi hiçbir zaman vermeyin**.
- Anahtarları sohbet ya da ekran görüntüsüyle paylaştıysanız OKX ve diğer servislerde **iptal edip yeniden oluşturun**.
- Canlı emir için üç kilit birlikte gerekir: `OKX_LIVE=1`, `--canli` (webhook'ta `"live":true`) ve `OKX_MAX_ORDER_USD` üst sınırı. Yanlış taraftaki stop ile `SPX-USDT-SWAP` (memecoin) emirleri engellenir.

> Bu proje bir araştırma ve karar destek aracıdır; yatırım tavsiyesi değildir. Geçmiş performans geleceği garanti etmez.
