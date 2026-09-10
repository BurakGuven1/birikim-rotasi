# Uzun vade fırsat taraması

8 Eylül 2026 · Model: `qvm-preview-1` · Durum: **ön değerlendirme; optimize edilmedi, geçmiş test yok**.

## Kullanım

Takip listesinde Güncelle ile iki piyasanın verisi alınır. ABD/BIST sekmesi fırsat panelini de değiştirir. Panel en fazla 20 aday gösterir; aşağıdaki arama, sektör, SMA ve portföy filtreleri bu sıralamayı değiştirmez. Sayılar azaldığında eşikler gevşetilmez.

Puanın büyüklüğü kazanma olasılığı, hedef fiyat veya portföy ağırlığı değildir. 1 numara modelde daha yüksek puanlı adaydır; gelecekte en fazla getiri sağlayacak şirket olduğu iddia edilmez. 20 numara da tüm piyasanın en kötü şirketi değildir.

## Evren ve veri

- ABD: ABD merkezli, birincil kotasyonlu şirketlerin piyasa değerine göre ilk 100'ü. S&P 100 değildir; tüm ABD piyasası değildir.
- Türkiye: güncel BIST 100 bileşenleri.
- Kaynak: TradingView herkese açık scanner. Sözleşmeli, garantili veri API'si değildir.
- Son işlem zamanı `lp_time`; boşsa `update_time` kaynak güncelleme zamanı ayrı alan olarak kullanılır. Son işlem zamanı uydurulmaz. İki zaman da boşsa sıralama yapılmaz.
- Uygulamanın `fetchedAt` zamanı, fiyatın oluştuğu zaman yerine kullanılmaz.
- Kayıt ve fiyat/source-update yaşı en fazla 5 takvim günü; kaynağın sonuç açıklama tarihi en fazla 180 gün. Gelecekteki tarih için yalnız 5 dakika saat sapması toleransı vardır.
- `earnings_release_date` sonuç açıklamasıdır; ilgili bilanço dönemi ve her alanın güncelliği ayrıca teyit edilmiş değildir.
- Eksik veya anlamsız oranlar puanla doldurulmaz. Finans dışı şirketlerde negatif serbest nakit ve büyüme değerleri korunur, eleme için kullanılır.
- Genişletilmiş kolon isteği HTTP 400/422 dönerse yalnız temel takip verisi istenir; fırsat verisinin alınamadığı açıklanır. 429 için ek istek yapılmaz.
- Eski v1 cihaz kayıtları okunabilir. Temel veri bulunmayan eski kayıtlar fırsat adayı oluşturmaz.

### Alan eşlemesi

| Model alanı | Kaynak alanı / hesap |
|---|---|
| ROE / ROA / ROIC (%) | return_on_equity / return_on_assets / return_on_invested_capital |
| Toplam borç | total_debt_fq |
| FVAÖK | ebitda_ttm |
| Serbest nakit akışı getirisi (%) | 100 / price_free_cash_flow_ttm |
| Nakit/kâr | cash_f_operating_activities_ttm / net_income_ttm |
| Hisse başı kâr büyümesi (%) | earnings_per_share_diluted_yoy_growth_ttm |
| Gelir büyümesi (%) | total_revenue_yoy_growth_ttm |
| Piotroski F skoru | piotroski_f_score_ttm (0–9) |
| 6–1 fiyat getirisi (%) | 100 × ((1 + Perf.6M/100)/(1 + Perf.1M/100) − 1) |
| 12–1 fiyat getirisi (%) | 100 × ((1 + Perf.Y/100)/(1 + Perf.1M/100) − 1) |

Nakit/kâr ve borç/FVAÖK oranlarında aynı kaynaktaki finansal tutarlar bölünür; piyasa değeri başka para birimindeki nakit tutarına bölünmez. Serbest nakit getirisi kaynağın fiyat/nakit çarpanından hesaplanır. Borç, net borç değildir. Momentum temettü dahil toplam getiri değildir.

## Model

Her piyasa ayrı değerlendirilir. Bankalar (`Finance` sektöründe bankacılık endüstrisi) ayrı model kullanır. Diğer finans, GYO, holding ve tanımsız sektörler uzman model gerektirdiğinden değerlendirme dışıdır.

### Eleme

Her aday için fiyat, zaman, kullanılabilir değerleme, kalite ve momentum verisi zorunludur. Kâr ve ROE pozitif; hisse başı kâr ve gelir büyümesi negatif olmamalıdır.

Finans dışı şirketlerde ayrıca:

- ROIC, FVAÖK, faaliyet ve serbest nakit akışı pozitif.
- Toplam borç negatif değil; toplam borç/FVAÖK en fazla 4.
- Faaliyet nakit akışı/net kâr en az 0,8.
- Piotroski F skoru en az 5.

Bankalarda ROA pozitif olmalıdır. Sanayi borç/nakit/F skor eşikleri uygulanmaz. **Banka sermaye yeterliliği ve kredi kalitesi ölçülmediğinden banka puanı daha kapsamlı bir banka analizinin yerini tutmaz.**

Bu eşikler şeffaf başlangıç kurallarıdır; optimum oldukları kanıtlanmamıştır.

### Göreli puanlar

Bir değer için yüksek-daha-iyi orta sıra yüzdeliği:

`100 × (daha düşük değerli emsal sayısı + 0,5 × eşit değerli emsal sayısı) / emsal sayısı`

Değerleme için çarpanın tersi kullanılır. Böylece düşük çarpan yüksek puan alır. Eşit değerler eşit puan alır; uç değerlerin mutlak büyüklüğü skoru sınırsız büyütmez.

- Emsal havuzu: aynı piyasa, sektör ve modelde zaman/veri kontrolünden geçen şirketler. Kalite elemesine takılan şirketler de karşılaştırma havuzunda kalır. En az 5 emsal gerekir; aday da bu sayıya dahildir.
- Şirket ucuzluğu: E/P, EBITDA/EV, serbest nakit getirisi yüzdeliklerinin aritmetik ortalaması. PD/DD gösterilir, varlık hafif şirketleri cezalandırmamak için bu modele eklenmez.
- Şirket kalitesi: ROE, ROIC, nakit/kâr, F skoru yüzdeliklerinin aritmetik ortalaması.
- Banka ucuzluğu: E/P ve B/P yüzdeliklerinin ortalaması.
- Banka kalitesi: ROE ve ROA yüzdeliklerinin ortalaması.
- Momentum: hesaplanabilir piyasa evreninde 6–1 ve 12–1 getiri yüzdeliklerinin ortalaması. Referans bir endeks değildir; bu evrenin kesitsel dağılımıdır.
- Fırsat: `(ucuzluk + kalite + momentum) / 3`. Ağırlıklar sabittir, kullanıcı getirisini maksimize edecek biçimde optimize edilmemiştir.
- Aday olmak için ucuzluk ve kalite puanı ayrı ayrı en az 50 olmalıdır. Bu, mutlak olarak ucuz veya yüksek kaliteli olmanın garantisi değildir; pahalı bir sektörde göreli ucuzluk olabilir.
- Her iki momentum getirisi pozitif ve her iki yüzdelik en az 50 ise toparlanma destekli; diğer durumda toparlanma bekleniyor.
- Sıralama: ham fırsat puanı azalan, sonra kalite azalan, sonra sembol. Gösterimde tek ondalık; sıralamada yuvarlanmamış değerler kullanılır.
- En fazla 20 aday, sektör başına en fazla 5. Bu aday listesi bir yatırım portföyü değildir; bu sınır bir risk optimizasyonu değildir.

## Çıkış takibi

Her piyasanın bir önceki başarılı, farklı zamanlı kaydı cihazda saklanır. Hata veya 30 saniyelik aynı cache yanıtı geçmişi ilerletmez. Başka istemcinin güncellediği daha yeni sunucu cache kaydı ise bu istemci için yeni kayıttır ve geçmişi ilerletir. Önceki sıralama kendi kayıt zamanında yeniden değerlendirilir. Güncel listeden çıkışlarda bozulan nakit/büyüme/borç/ucuzluk, eksik/eski veri, sektör sınırı veya evrenden çıkma ayrı açıklanır. Bu otomatik satış talimatı değildir. Kayıtlar aynı model sürümüyle yeniden hesaplanır; uzun vadeli değişmez performans günlüğü değildir.

## Tamamlanmamış profesyonel doğrulama

Bu sürüm çok yıllı bilanço tarihi, şirketin kendi geçmişine göre ucuzluk, marj seyri, düzenli nakit üretimi, sulandırma, kurumsal yönetişim veya doğrulanmış adil değer aralığı hesaplamaz. Kaynakta bunlar yokken varmış gibi puan üretmez. BIST nominal büyümesi enflasyon ve muhasebe etkilerinden arındırılmış değildir.

1/3/5/10 yıl kazanma oranı ve beklenen getirisi hesaplanmamıştır. Gerekli sonraki veri sözleşmesi:

1. Her finansal kalemde bilanço dönemi, ilk yayımlanma zamanı, revizyon zamanı ve o tarihte bilinen değer.
2. Tarihsel üyelik, IPO/delist/iflas kayıtları ve delist getirileri dahil yatırım evreni.
3. Bölünme/temettü/sulandırma olayları ve para birimleri tutarlı toplam getiri serileri.
4. BIST için TRY/USD ve fiyat endeksi serileri; nominal TL, reel TL ve USD sonuçların ayrı ölçümü.
5. Likidite, işlem maliyeti ve yeniden dengeleme kuralları.

Bu veriler sağlandığında yürüyen ileri dönem testi uygulanmalı; ağırlık seçimi yalnız eğitim diliminde yapılmalı, sonraki test dilimine bakılarak değiştirilmemelidir. Basit eşit ağırlıklı model ve piyasa endeksleriyle karşılaştırılmalı. 1/3/5/10 yıllık sonuçlar için olgunlaşmış dönem sayısı, zarar sıklığı, en kötü kayıp, maksimum düşüş, endeksi geçme oranı ve maliyet sonrası sonuçlar birlikte raporlanmalı. 10 yıllık örnek yoksa rapor yok. Bugünkü şirketleri ve bugünkü bilançoları geçmişe taşımak bu testi geçersiz kılar.

## Araştırma dayanakları

- [MSCI USA Enhanced Value](https://www.msci.com/indexes/index/705973/msci-usa-enhanced-value-index): sektör içi değerleme fikri.
- [MSCI Quality](https://www.msci.com/indexes/group/quality-indexes): kârlılık, istikrar ve bilanço kalitesini birlikte değerlendirme fikri.
- [AQR Value](https://funds.aqr.com/Insights/Strategies/Value-Factor): değer tuzakları ve değer/kalite/momentum bileşimi.
- [TradingView screener](https://www.tradingview.com/support/solutions/43000718866-tradingview-stock-screener-trade-smarter-not-harder/): kaynak veri kategorileri.

Bu model bu endeksleri kopyalamaz. Bu araştırmalar modelin veya tek bir şirketin gelecekte kazandıracağının kanıtı değildir.
