# Birikim Rotası

Yerelde çalışan, portföy işlemlerini yalnızca tarayıcıdaki IndexedDB deposunda saklayan; aylık birikimi çekirdek, kurallı swing ve fırsat rezervi olarak yöneten yatırım karar destek uygulaması.

Varsayılan rota ayda `$1.000` ve yılda bir `$3.750` ek katkıdır. Reel USD `%10–11` bir **hedef bandıdır**; vaat veya beklenen getiri değildir. Gerçekleşen sonuç portföy ve geçmişe dönük, maliyetli backtest ekranlarında ayrı ölçülür.

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
| Çekirdek + swing backtesti | Tam çalışır | Daha geniş fiyat geçmişi |

Ücretsiz ABD ve BIST fiyatları lisanslı tick-by-tick gerçek zaman verisi değildir. Her kart kaynak, veri zamanı ve `Güncel/Gecikmeli/Veri eski` durumunu gösterir. Veri alınamazsa uydurma fiyat kullanılmaz.

## İsteğe bağlı API anahtarları

`.env.example` dosyasını `.env.local` adıyla kopyalayın ve ücretsiz anahtarlarınızı girin:

- [FRED API Keys](https://fredaccount.stlouisfed.org/apikeys)
- [Alpha Vantage Free API Key](https://www.alphavantage.co/support/#api-key)
- [EODHD API Keys](https://eodhd.com/developer/api-keys)

Anahtarları sohbet, Git veya uygulama ekranına göndermeyin. `.env.local` Git tarafından yok sayılır. Değişiklikten sonra geliştirme sunucusunu yeniden başlatın.

## Sayfalar

- **Rota:** Varsayılan `%70 çekirdek / %20 taktik / %10 rezerv`; o ayın uygulanabilir alış tutarı, doğrulanmış swing kurulumu ve risk tabanı tek ekranda.
- **Swing:** 50/200 günlük trend, 6–1 ve 12–1 momentum, ATR, minimum güven ve minimum getiri/risk filtresi. Giriş, geçersizleşme, iki hedef ve risk bazlı pozisyon büyüklüğü üretilir. Planlanan/açılan/kapanan işlemler yerel günlükte tutulur.
- **Analiz:** ücretsiz güncel/gecikmeli fiyatlar ve kaynak durumu.
- **Portföyüm:** FIFO maliyet, komisyon, gerçekleşmiş/gerçekleşmemiş kâr ve grafikler.
- **Backtest:** Tam 12/36/60/120 ay boyunca aylık ve yıllık USD katkısını kullanır. Çekirdek + swing satırında sinyal gününde işlem açılmaz, en erken sonraki bar kullanılır; spread, komisyon ve stop-önce varsayımı uygulanır. USD toplam/reel getiri, ABD TÜFE koruma eşiği, walk-forward model ve tek-varlık kıyasları gösterilir.
- **Varlık Detayı:** mum/çizgi, SMA40, SMA200, ATH düşüşü, sinyal ve dönemsel performans.
- **Ayarlar:** aylık/yıllık katkı, yıllık katkı ayı, taktik tavan, işlem başına risk, minimum getiri/risk ve güven sınırı.

## Varsayılan risk çerçevesi

| Kural | Varsayılan |
| --- | ---: |
| Çekirdek / taktik / rezerv | `%70 / %20 / %10` |
| İşlem başına portföy riski | `%0,50` |
| Minimum getiri / risk | `2,0` |
| Minimum sinyal güveni | `%60` |
| Taktik katman üst sınırı | `%25` |
| Taktik düşüş freni | `-%12` yarıya indir, `-%18` durdur |

Kaldıraç, short ve otomatik emir yoktur. Geçersizleşme seviyesi zarar büyürken uzağa taşınmaz. Uygun kurulum yoksa taktik bütçe rezerve geçer; sırf nakit bulunduğu için işlem açılmaz.

## Komutlar

```sh
npm test
npm run lint
npm run build
npm run test:e2e
npm run dev
```

## Gizlilik ve kapsam

Portföy işlemleri uzak bir veritabanına gönderilmez. Uygulama otomatik emir oluşturmaz ve aracı kuruma bağlanmaz. Bu yazılım yatırım danışmanlığı değildir; geçmiş performans geleceği garanti etmez.

Ayrıntılar: [RESEARCH.md](RESEARCH.md), [METHODOLOGY.md](METHODOLOGY.md), [DATA_SOURCES.md](DATA_SOURCES.md).
