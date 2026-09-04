# Birikim Rotası — Çekirdek ve Taktik Yatırım Motoru Tasarımı

## 1. Amaç

Birikim Rotası, her ay varsayılan **1.000 USD** ve yılda bir varsayılan **3.750 USD** ek katkıyı yöneten; uzun vadeli birikim ile kurallı swing işlemlerini birbirinden ayıran kişisel karar destek sistemi olacaktır. Ana hedef, ABD enflasyonu sonrası yıllık `%10–11` reel USD getiriyi kovalamaktır. Bu oran bir vaat veya sabit planlama getirisi olarak gösterilmeyecek; gerçekleşen portföy sonucu, pasif kıyas ve risk maliyetiyle birlikte ölçülen iddialı bir hedef olacaktır.

Uygulama aracı kuruma bağlanmayacak ve otomatik emir vermeyecektir. Kullanıcıya uygulanabilir alış listesi, taktik kurulum, pozisyon büyüklüğü, geçersizleşme seviyesi ve ölçülebilir başarı durumu sunacaktır.

## 2. Değerlendirilen yaklaşımlar

### A. Tüm portföyü aktif yönetmek

Teorik getiri tavanı yüksektir; fakat karar hatası, vergi, spread, aşırı işlem ve çekirdek pozisyonları yanlış zamanda kaybetme riski de en yüksektir. Uzun vadeli birikim amacıyla uyumsuz olduğu için seçilmemiştir.

### B. Tamamen pasif ve sabit DCA

Basit, ucuz ve davranışsal olarak güçlüdür. Ancak kullanıcının taktik fırsatlardan yararlanma ve reel `%10–11` hedefini sistematik biçimde kovalama beklentisini karşılamaz. Yalnızca karşılaştırma portföyü olarak korunacaktır.

### C. Risk bütçeli çekirdek + taktik model — seçilen yaklaşım

Portföyün çoğu uzun vadeli çekirdekte kalır; sınırlı bir taktik bölüm yalnız kanıtlanan sinyallerle işlem görür. Taktik bölüm, masraf sonrası pasif kıyası geçemezse otomatik olarak küçülür. Bu yöntem hedef ile sermaye koruması arasındaki en iyi dengeyi sağlar.

## 3. Portföy katmanları

Varsayılan stratejik yapı aşağıdaki gibidir:

| Katman | Hedef | İzin verilen bant | İşlev |
| --- | ---: | ---: | --- |
| Çekirdek | `%70` | `%65–80` | Uzun vadeli büyüme ve enflasyon koruması |
| Taktik / swing | `%20` | `%0–25` | 2–12 haftalık kurallı fırsatlar |
| Fırsat rezervi | `%10` | `%5–20` | Kısa vadeli USD aracı, nakit veya yeni fırsat finansmanı |

Çekirdek içindeki başlangıç risk bütçesi varlık adı yerine ekonomik rol üzerinden tanımlanır:

- `%45` küresel/ABD hisse büyümesi,
- `%15` Bitcoin,
- `%10` altın ve reel varlık koruması.

Bu oranlar ürün önerisi değil model başlangıcıdır. Kullanıcının erişebildiği ETF, fon veya doğrudan varlık daha sonra aynı ekonomik role eşlenebilir. BIST ve faktör ETF'leri çekirdek veya taktik evrene eklenebilir; ancak tek ülke, işveren ve döviz yoğunlaşması sınırları uygulanır.

Rezerv, getirisiz boş nakit gibi modellenmeyecek; güvenilir veri varsa 0–3 aylık ABD Hazine bonosu vekiliyle ölçülecektir. Böylece taktik bölümün fırsat maliyeti doğru hesaplanır.

## 4. Katkı politikası

### Aylık katkı

Varsayılan 1.000 USD katkı şu sırayla dağıtılır:

1. Portföyün risk limitlerini ihlal eden eksik çekirdek ağırlıkları tamamlanır.
2. Onaylı taktik kurulum varsa risk bütçesi kadar taktik katkı ayrılır.
3. Uygun kurulum yoksa kullanılmayan taktik pay rezervde kalır; sırf bütçe var diye işlem açılmaz.
4. Satış yapmadan katkıyla dengeleme varsayılan davranıştır.

### Yıllık ek katkı

Varsayılan 3.750 USD tutar ve ay kullanıcı tarafından değiştirilebilir. Ek katkının `%50`si o ay eksik kalan çekirdek rollere hemen, `%50`si ise üç eşit aylık dilimde rezerv veya onaylı fırsatlara dağıtılır. Kullanıcı isterse 3.500–4.000 USD aralığında gerçekleşen tutarı işlem anında girebilir.

## 5. Taktik / swing motoru

Motor geleceği tahmin eden tek bir skor yerine beş bağımsız kanıt grubu kullanır:

1. **Rejim:** fiyatın 40 ve 200 haftalık/işlem günlük ortalamalara göre konumu; uzun trend aşağıysa long işlemler küçülür.
2. **Momentum:** 12–1 ve 6–1 aylık göreli momentum; son ay dışarıda bırakılarak kısa dönem tersine dönüş gürültüsü azaltılır.
3. **Değer / geri çekilme:** volatiliteye göre normalize edilmiş uzun ortalama uzaklığı ve zirveden düşüş. Tek başına alım sinyali değildir.
4. **Makro ve likidite:** ABD reel faiz, enflasyon eğilimi ve para arzı; yayımlanma gecikmeleriyle point-in-time kullanılır.
5. **Risk iştahı:** oynaklık rejimi, korelasyon, kriptoda BTC hakimiyeti, kaldıraç ve duygu göstergeleri. Opsiyonel CoinMarketCap verisi yoksa bu grup güven puanını düşürür, sonuç uydurmaz.

Her kurulum aşağıdaki alanları üretir:

- `direction`: ilk sürümde yalnız long veya bekle,
- `entryZone`: tek fiyat değil giriş aralığı,
- `invalidation`: ATR veya yapı tabanlı geçersizleşme seviyesi,
- `targetZones`: en az iki kâr alma bölgesi,
- `holdingWindow`: beklenen 2–12 hafta,
- `riskReward`: maliyet sonrası beklenen oran,
- `confidence`: veri kalitesi ve kanıt uzlaşısı,
- `reasons`: kararı açıklayan kısa maddeler.

İlk sürüm kaldıraç, short, opsiyon ve otomatik emir içermez.

## 6. Risk motoru

Taktik işlem açılabilmesi için bütün kurallar sağlanmalıdır:

- tek işlemde portföyün en fazla `%0,50`si riske edilir,
- aynı ekonomik temadaki eşzamanlı işlemlerin toplam riski `%1,50`yi geçmez,
- toplam taktik katman `%25`i geçmez,
- beklenen maliyet sonrası risk/getiri en az `2,0`dır,
- veri güveni `%60`ın altındaysa yeni işlem açılmaz,
- strateji zirveden `%12` düşerse taktik bütçe yarıya iner,
- strateji zirveden `%18` düşerse yeni taktik işlem durur ve yalnız çekirdek DCA sürer.

Pozisyon büyüklüğü `risk bütçesi / giriş-geçersizleşme mesafesi` ile hesaplanır ve likidite/bant sınırıyla küçültülür. Zarar büyürken plansız ekleme yapılmaz. Stop seviyesi çıktıktan sonra daha uzağa taşınamaz; kâra geçen işlemde kademeli çıkış veya trend takibi kullanılabilir.

## 7. Taktik bütçenin başarıya göre değişmesi

Taktik motorun başarısı toplam portföy getirisinden ayrı tutulacaktır. Son 12 tamamlanmış işlem ve en az 12 aylık gözlem olmadan bütçe büyütülmez.

Masraf sonrası taktik sonuç:

- pasif kıyası geçiyor ve maksimum düşüş sınır içindeyse `%20` bütçe korunur,
- kıyasın gerisinde veya düşüş sınırı dışındaysa `%10`a indirilir,
- iki ardışık değerlendirme döneminde başarısızsa yeni işlem bütçesi `%0` olur,
- yeniden etkinleştirme yalnız sonraki walk-forward doğrulamasında mümkündür.

Bu kural geçmiş veriye en iyi uyan parametreleri canlı portföyde sınırsız kullanmayı engeller.

## 8. Veri mimarisi

Mevcut `MarketDataProvider` sözleşmesi genişletilecek; sağlayıcılar ortak ve kaynaklı veri nesneleri döndürecektir.

Öncelik sırası:

- hisse, ETF, BIST, emtia, kur: EODHD → Alpha Vantage → Yahoo-compatible/Stooq → son başarılı önbellek,
- kripto fiyatı: Binance public → EODHD → son başarılı önbellek,
- makro: FRED API → resmî FRED CSV → son başarılı önbellek,
- opsiyonel kripto rejimi: CoinMarketCap adaptörü → güven puanı azaltılmış fiyat rejimi,
- araştırma doğrulaması: Bigdata.com ve Financial Datasets çıktıları uygulamaya otomatik emir/sinyal olarak alınmaz; tarih ve kaynakla araştırma notuna eklenebilir.

API anahtarları yalnız sunucu ortamında kalır. Her veri noktası `source`, `observedAt`, `fetchedAt`, `freshness`, `currency` ve mümkünse `adjusted` bilgisi taşır. Sağlayıcılar çelişirse son değer sessizce seçilmez; tolerans dışı fark veri kalite uyarısı üretir.

## 9. Backtest ve doğrulama

Backtest altyapısı iki zaman ölçeğini birlikte destekleyecektir:

- çekirdek katkı ve dengeleme aylık,
- taktik sinyal ve çıkışlar haftalık.

Zorunlu kurallar:

- yalnız sinyal tarihinde bilinen veri kullanılacak,
- FRED ve temel veriler yayımlanma gecikmesiyle erişilebilir sayılacak,
- temettü/bölünme için düzeltilmiş seri tercih edilecek,
- spread, komisyon ve kullanıcı tarafından ayarlanabilir vergi sürtünmesi uygulanacak,
- aylık 1.000 USD ve yıllık ek katkı nakit akışı olarak modellenecek,
- parametre seçimi eğitim döneminde, raporlama doğrulama döneminde yapılacak,
- sonuçlar 1/3/5/10 yıl ve mümkünse farklı piyasa rejimleri için verilecek.

Ana ölçüler: nominal USD CAGR/TWR, ABD TÜFE sonrası reel getiri, maksimum düşüş, volatilite, Sortino, katkılardan arındırılmış alfa, işlem başarı oranı, payoff ratio, profit factor, turnover ve maliyet etkisidir.

Karşılaştırmalar:

- sabit çekirdek DCA,
- mevcut `%70 dengeli + %30 dinamik` model,
- yeni çekirdek+taktik model,
- S&P 500 DCA,
- kullanıcının hiç taktik işlem yapmadığı eşlenmiş portföy.

## 10. Arayüz

Ana sayfa, ayrıntılı veriyi saklamadan tek bakışta bu ay ne yapılacağını göstermelidir:

1. **Bu ay yatırılacak:** 1.000 USD ve TL karşılığı.
2. **Çekirdek alışları:** tutar, hedef sapması ve kısa gerekçe.
3. **Swing masası:** yalnız geçerli kurulumlar; giriş, stop, hedef, risk ve son kullanma tarihi.
4. **Fırsat rezervi:** boşta kalan tutar ve neden beklediği.
5. **Hedef göstergesi:** reel `%10–11` hedef, gerçekleşen reel TWR ve pasif kıyas farkı.
6. **Risk konsolu:** portföy düşüşü, taktik risk bütçesi, yoğunlaşma ve veri güveni.

Yeni sayfa yapısı:

- `Rota`: aylık uygulama listesi ve yıllık ek katkı,
- `Portföy`: işlemler, maliyet ve dağılım,
- `Swing`: kurulumlar, açık/kapalı işlemler ve işlem günlüğü,
- `Analiz`: piyasa rejimi ve kaynak kalitesi,
- `Backtest`: strateji ve kıyas sonuçları,
- `Ayarlar`: katkı, risk, maliyet ve veri kaynakları.

Tasarım koyu mod öncelikli, ferah ve profesyonel olacaktır: derin lacivert yüzey, kırık beyaz metin, sınırlı turkuaz/kehribar vurgu, tabular sayılar, belirgin veri zamanları ve düşük hareket. Renk tek anlam taşıyıcı olmayacak; rozet, ikon ve metin de kullanılacaktır. Mobilde ilk ekran yalnız eylem, bütçe ve risk özetini gösterir.

## 11. Depolama ve durum modeli

IndexedDB şeması sürümlenecek ve mevcut işlemler kaybedilmeden migrate edilecektir. Yeni kayıtlar:

- katkı planı ve yıllık ekleme,
- strateji profili ve risk limitleri,
- taktik kurulum anlık görüntüsü,
- açık/kapalı taktik işlem günlüğü,
- aylık karar anlık görüntüsü,
- strateji kıyas serisi,
- veri kalite uyarıları.

Sinyal sonradan değişse bile geçmiş karar, o tarihteki veri ve gerekçeyle korunur. Böylece canlı performans geriye dönük yeniden yazılmaz.

## 12. Hata davranışı

Kritik veri eksikse taktik motor `bekle` üretir. Çekirdek plan, güven düşürülerek nötr ağırlıklara yaklaşabilir. Fiyatı olmayan varlığa sıfır değer atanmaz. API oran sınırı, sağlayıcı çelişkisi ve eski önbellek ayrı hata türleri olarak kullanıcıya gösterilir.

## 13. Test stratejisi

- Saf domain testleri: katkı bölme, risk bütçesi, pozisyon büyüklüğü, stop/target geçişleri, taktik bütçe küçültme, veri güveni ve sınırlar.
- Backtest testleri: look-ahead engeli, yıllık ek katkı tarihi, haftalık sinyal/aylık katkı hizalama, maliyetler ve kıyas eşitliği.
- Veri testleri: sağlayıcı fallback'i, çelişkili fiyat, stale veri ve opsiyonel kaynak yokluğu.
- Depolama testleri: IndexedDB migration ve geçmiş karar değişmezliği.
- E2E: aylık rota, swing kurulumu kaydetme, işlem kapatma, JSON yedek/içe aktarma ve responsive temel akış.
- Teslim öncesi `npm test`, `npm run lint`, `npm run build` ve 375/768/1440 piksel görsel kontrol.

## 14. Başarı ölçütleri

Sistem başarılı sayılırsa:

- aylık ve yıllık katkı tam olarak bütçeye eşit dağılır,
- taktik kurulum pozisyon büyüklüğü ve geçersizleşme olmadan gösterilmez,
- reel getiri ile nominal getiri açıkça ayrılır,
- hiçbir sonuç getiri garantisi gibi sunulmaz,
- taktik katmanın pasif kıyasa net katkısı ayrı ölçülür,
- veri kesilince uydurma sinyal yerine güvenli `bekle` durumu oluşur,
- mevcut portföy verileri migration sonrasında korunur.
