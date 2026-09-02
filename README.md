# Birikim Rotası

Yerelde çalışan, portföy işlemlerini yalnızca tarayıcıdaki IndexedDB deposunda saklayan yatırım takip ve aylık dağılım karar destek uygulaması.

## Hızlı başlangıç

Windows'ta `start-windows.bat` dosyasına çift tıklayın. Terminal açıldıktan sonra tarayıcıda [http://localhost:3000](http://localhost:3000) adresine gidin.

PowerShell alternatifi:

```powershell
npm install --cache .npm-cache
npm run dev
```

macOS/Linux:

```sh
chmod +x start.sh
./start.sh
```

Production çalıştırma:

```sh
npm run build
npm start
```

## Portföy kullanımı

1. **Portföyüm** sayfasını açın.
2. Sembol, varlık adı, sınıf, alış/satış, adet, birim fiyat, para birimi, komisyon ve tarihi girin.
3. Üst kartlarda net yatırılan para, güncel değer ve toplam kâr/zararı görün.
4. Grafiklerden portföy değeri–yatırılan para ilişkisini, varlık getirilerini ve dağılımı inceleyin.
5. JSON ile tam yedek; CSV ile işlem tablosu alın. JSON yedeği daha sonra içeri aktarılabilir.

Uygulamayı denemek için **DEMO portföyü yükle** seçeneği kullanılabilir. Bu kayıtlar açıkça `DEMO VERİ` olarak işaretlenir ve silinebilir.

## Ücretsiz çalışma durumu

| Özellik | API anahtarı olmadan | Ücretsiz anahtarla |
| --- | --- | --- |
| BTC güncel fiyatı | Binance Public | EODHD yedeği |
| Hisse/ETF/BIST/emtia fiyatları | Yahoo-compatible uç ve Stooq yedeği | EODHD ana kaynak, Alpha Vantage ABD yedeği |
| USD/TRY | Yahoo-compatible uç | EODHD döviz yedeği |
| FRED makro serileri | Resmî grafik CSV indirmesi | Resmî API üzerinden M2, CPI ve reel faiz |
| Portföy takibi, kâr/zarar ve grafikler | Tam çalışır | Değişmez |
| Fiyat/SMA backtesti | Tam çalışır | Değişmez |

Ücretsiz ABD ve BIST fiyatları lisanslı tick-by-tick gerçek zaman verisi değildir. Her kart kaynak, veri zamanı ve `Güncel/Gecikmeli/Veri eski` durumunu gösterir. Veri alınamazsa uydurma fiyat kullanılmaz.

## İsteğe bağlı API anahtarları

`.env.example` dosyasını `.env.local` adıyla kopyalayın ve ücretsiz anahtarlarınızı girin:

- [FRED API Keys](https://fredaccount.stlouisfed.org/apikeys)
- [Alpha Vantage Free API Key](https://www.alphavantage.co/support/#api-key)
- [EODHD API Keys](https://eodhd.com/developer/api-keys)

Anahtarları sohbet, Git veya uygulama ekranına göndermeyin. `.env.local` Git tarafından yok sayılır. Değişiklikten sonra geliştirme sunucusunu yeniden başlatın.

## Sayfalar

- **Aylık Plan:** dört ana sınıfın tutarı, yüzdesi, güveni ve gerekçesi.
- **Piyasa:** ücretsiz güncel/gecikmeli fiyatlar ve kaynak durumu.
- **Portföyüm:** FIFO maliyet, komisyon, gerçekleşmiş/gerçekleşmemiş kâr ve grafikler.
- **Backtest:** 1/3/5/10 yıl DCA; sabit nötr, dinamik SMA ve tek-varlık kıyasları.
- **Varlık Detayı:** mum/çizgi, SMA40, SMA200, ATH düşüşü, sinyal ve dönemsel performans.
- **Metodoloji:** karar sırası, satış koruması ve sınırlamalar.
- **Ayarlar:** aylık tutar, risk kontrolü ve veri kaynağı durumu.

## Komutlar

```sh
npm test
npm run lint
npm run build
npm run dev
```

## Gizlilik ve kapsam

Portföy işlemleri uzak bir veritabanına gönderilmez. Uygulama otomatik emir oluşturmaz ve aracı kuruma bağlanmaz. Bu yazılım yatırım danışmanlığı değildir; geçmiş performans geleceği garanti etmez.

Ayrıntılar: [RESEARCH.md](RESEARCH.md), [METHODOLOGY.md](METHODOLOGY.md), [DATA_SOURCES.md](DATA_SOURCES.md).
