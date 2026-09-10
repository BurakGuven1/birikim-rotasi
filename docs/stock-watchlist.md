# Hisse takip ekranı

Adres: `/takip-listesi` — menüde **Hisse takip**.

- ABD: ABD merkezli şirketlerin birincil hisse kotasyonları arasından piyasa değerine göre ilk 100 hisse. S&P 100 üyeliği değildir; farklı hisse sınıfları ayrı satırlardır.
- Türkiye: BIST 100 bileşenleri. Bu liste yalnız piyasa değeri sıralamasına göre oluşturulmaz.
- Fiyat, değişim, FD/FVAÖK (TTM), F/K (TTM), PD/DD (son çeyrek), haftalık SMA200 ve SMA uzaklığı gösterilir. Negatif/anlamsız/eksik çarpanlar sıfır yerine boş gösterilir. Finans sektöründe FD/FVAÖK gösterilmez.

Sayfa açılışı, sekme değişimi, arama ve filtreleme dış veri isteği yapmaz. **Güncelle** iki piyasa için iki POST isteği başlatır. Son sonuçlar tarayıcıdaki yerel önbellekte saklanır. Başarısız piyasanın önceki kaydı korunur. Aynı sunucuda eşzamanlı yenilemeler birleştirilir; 30 saniyelik tekrar koruması eski alınma saatini değiştirmez.

Veri kaynağı TradingView'in herkese açık hisse tarama ucudur; sözleşmeli API değildir. Alanlar canlı yanıtla doğrulandı. BIST üyelik sorgusu `SYML:BIST;XU100`; haftalık ortalama alanı `SMA200|1W`. Devam eden hafta ortalamaya dahil olabilir. Kaynak gecikmesi her satırda belirtilir; alınma saati son işlem saati olarak sunulmaz. Fiyat/bilanço zamanları her satır için sağlanmayabilir. Resmî veri dağıtım hizmeti veya kesintisiz erişim taahhüdü yoktur.

Statik katalog yalnız sembol/ad/sektör içerir; ilk açılışta fiyat üretmez. Başarılı yenilemede hem üyelik/sıralama hem metrikler kaynaktan alınır.

**+ / −** alış veya satış formunu açar. Kayıt, IndexedDB'deki mevcut portföye eklenir; aracı kuruma emir gönderilmez. Form gerçekleşen fiyat/adet/tarih/komisyon ister. Tarihsel adet kontrolü ve ekleme aynı veritabanı işlemi içinde yapılır. Aynı gün kayıtları mevcut FIFO sıralama sözleşmesine uygun sırada eklenir.

Canlı kontrol: her iki piyasada 100 satır; manuel iki istek; alış ve kısmi satış; sayfa yenilemede otomatik fiyat isteği olmaması; mobil sayfada taşma olmaması. Genel test paketi bu iş için genişletilmedi.

Kaynaklar: [TradingView tarayıcı](https://www.tradingview.com/screener/), [BIST 100](https://www.borsaistanbul.com/endeks/xu100).
