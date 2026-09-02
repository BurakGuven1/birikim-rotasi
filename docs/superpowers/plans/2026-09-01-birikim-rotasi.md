# Birikim Rotası Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Yerelde çalışan; ücretsiz piyasa verilerini kullanan; yatırılan para, güncel değer, kâr/zarar ve aylık dağılım önerilerini grafiklerle gösteren eksiksiz bir kişisel yatırım paneli oluşturmak.

**Architecture:** Next.js App Router uygulaması, sunucu tarafı ücretsiz veri adaptörleri ile tarayıcıdaki yerel portföy deposunu birleştirir. Saf TypeScript finans modülleri portföy muhasebesi, indikatörler, dağıtım ve backtest hesaplarını yapar; sayfalar aynı sözleşmeleri kullanır.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, Recharts, Lightweight Charts, Dexie/IndexedDB, Zod, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-01-birikim-rotasi-design.md`

## Global Constraints

- Ücretli servis, kullanıcı hesabı veya otomatik emir entegrasyonu yoktur.
- Portföy işlemleri yalnızca tarayıcının IndexedDB deposunda saklanır.
- API anahtarları `.env.local` içinde sunucu tarafında kalır.
- Eksik veya başarısız verinin yerine uydurma canlı değer gösterilmez.
- Her piyasa değeri kaynak, veri zamanı ve güncellik durumu taşır.
- Aylık sınıf ağırlıkları yapılandırılmış minimum/maksimum sınırlar içinde toplam yüzde 100 olur.
- Varsayılan aylık katkı 50.000 TL, aylık değişim sınırı 10 yüzde puandır.

---

### Task 1: Uygulama iskeleti ve tasarım sistemi

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Create: `src/components/app-shell.tsx`, `src/components/theme-provider.tsx`

**Interfaces:**
- Produces: Next.js App Router yapısı, ortak navigasyon ve tema tokenları.

- [ ] Next.js/TypeScript bağımlılıklarını ve `dev`, `build`, `test`, `lint` scriptlerini tanımla.
- [ ] Açık/koyu tema tokenlarını, responsive içerik genişliğini ve finansal sayı tipografisini ekle.
- [ ] Klavye erişilebilir masaüstü yan menü ve mobil alt navigasyon oluştur.
- [ ] `npm install` ve boş uygulama production build çalıştır.
- [ ] İskeleti commit et.

### Task 2: Finansal domain modelleri ve indikatörler

**Files:**
- Create: `src/lib/domain/types.ts`, `src/lib/domain/config.ts`
- Create: `src/lib/domain/indicators.ts`, `src/lib/domain/indicators.test.ts`
- Create: `src/lib/domain/allocation.ts`, `src/lib/domain/allocation.test.ts`

**Interfaces:**
- Produces: `PricePoint`, `MarketSnapshot`, `AssetClass`, `AllocationResult` tipleri.
- Produces: `simpleMovingAverage(values, period)`, `volatilityNormalizedDistance(points, period)`, `percentileRank(values, value)`.
- Produces: `buildAllocation(input): AllocationResult`.

- [ ] SMA, yüzdelik ve volatilite-normalize uzaklık için bilinen küçük veri setleriyle başarısız testler yaz.
- [ ] Testleri çalıştırıp eksik modüller nedeniyle başarısız olduklarını doğrula.
- [ ] Saf indikatör fonksiyonlarını uygula ve testleri geçir.
- [ ] Min/maks sınır, yüzde 100 normalizasyon, 50.000 TL dağıtımı, güven azaltımı ve turnover cap testlerini yaz.
- [ ] Deterministik dağıtım motorunu uygula ve hedefli testleri geçir.
- [ ] Domain motorunu commit et.

### Task 3: Portföy muhasebesi ve yerel depo

**Files:**
- Create: `src/lib/domain/portfolio.ts`, `src/lib/domain/portfolio.test.ts`
- Create: `src/lib/storage/db.ts`, `src/lib/storage/portfolio-repository.ts`
- Create: `src/lib/storage/export-import.ts`, `src/lib/storage/export-import.test.ts`

**Interfaces:**
- Produces: `calculatePortfolio(transactions, quotes, fxRates): PortfolioSummary`.
- Produces: `portfolioRepository.list/add/update/remove/seedExample`.
- Produces: `exportPortfolioJson`, `exportTransactionsCsv`, `parsePortfolioJson`.

- [ ] FIFO alış/satış, komisyon, kalan maliyet ve gerçekleşmiş kâr testlerini yaz ve başarısızlığını gör.
- [ ] Portföy özetini ve varlık/sınıf kırılımlarını uygula.
- [ ] IndexedDB şemasını ve örnek portföy tohumunu ekle.
- [ ] JSON/CSV dışa aktarma ve doğrulamalı JSON içe alma testlerini yazıp geçir.
- [ ] Portföy katmanını commit et.

### Task 4: Ücretsiz piyasa veri adaptörleri ve önbellek

**Files:**
- Create: `src/lib/data/provider.ts`, `src/lib/data/cache.ts`
- Create: `src/lib/data/binance.ts`, `src/lib/data/coingecko.ts`
- Create: `src/lib/data/yahoo.ts`, `src/lib/data/stooq.ts`, `src/lib/data/tcmb.ts`, `src/lib/data/fred.ts`
- Create: `src/lib/data/market-service.ts`, `src/lib/data/market-service.test.ts`
- Create: `src/app/api/market/quotes/route.ts`, `src/app/api/market/history/route.ts`, `src/app/api/market/status/route.ts`

**Interfaces:**
- Produces: `getQuote(symbol)`, `getHistory(symbol, range)`, `getProviderStatus()` sunucu servisleri.
- Consumes: `MarketSnapshot` ve `PricePoint` domain tipleri.

- [ ] Sağlayıcı sırası, timeout, bozuk cevap ve eski önbellek davranışı için sahte fetch testleri yaz.
- [x] Binance BTC adaptörü ve EODHD anahtarlı yedeği ile quote/history akışını uygula.
- [x] EODHD, Alpha Vantage, Yahoo-compatible, Stooq ve FRED adaptörlerini ekle.
- [ ] Kaynak önceliği, son başarılı bellek önbelleği ve güncellik sınıflandırmasını uygula.
- [ ] Zod doğrulamalı API route'larını ekle ve servis testlerini geçir.
- [ ] Veri katmanını commit et.

### Task 5: Portföyüm ekranı ve grafikler

**Files:**
- Create: `src/app/portfoyum/page.tsx`
- Create: `src/features/portfolio/portfolio-dashboard.tsx`
- Create: `src/features/portfolio/transaction-form.tsx`, `src/features/portfolio/transaction-table.tsx`
- Create: `src/features/portfolio/portfolio-charts.tsx`, `src/features/portfolio/summary-cards.tsx`
- Create: `src/components/data-state.tsx`, `src/components/chart-card.tsx`

**Interfaces:**
- Consumes: portfolio repository, `calculatePortfolio`, `/api/market/quotes`.

- [ ] İşlem ekleme/düzenleme/silme ve örnek portföy yükleme akışını kur.
- [ ] Toplam yatırılan, net katkı, güncel değer ve toplam/gerçekleşmiş/gerçekleşmemiş kâr kartlarını ekle.
- [ ] Yatırılan para–portföy değeri, varlık getirisi, kâr bileşimi ve dağılım grafiklerini ekle.
- [ ] Grafiklerin yanında okunabilir tablo/etiket ve boş/eski veri durumlarını göster.
- [ ] JSON/CSV yedek düğmelerini bağla ve ekranı commit et.

### Task 6: Aylık plan, piyasa ve varlık detayı

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/piyasa/page.tsx`, `src/app/varlik/[symbol]/page.tsx`
- Create: `src/features/allocation/monthly-plan.tsx`, `src/features/market/market-grid.tsx`
- Create: `src/features/market/asset-detail.tsx`, `src/features/market/candlestick-chart.tsx`

**Interfaces:**
- Consumes: market routes, portfolio summary ve `buildAllocation`.

- [ ] Ana sayfada 50.000 TL aylık plan, dört sınıf, güven, nötr sapma ve “Neden?” açıklamalarını göster.
- [ ] Uygulanabilir alış listesini ve mevcut/hedef dağılım kıyasını ekle.
- [ ] Piyasa sayfasında takip evrenini kaynak ve güncellik rozetleriyle göster.
- [ ] Varlık detayında fiyat, SMA40/SMA200, ATH düşüşü, performans dönemleri ve sinyal kırılımını göster.
- [ ] Haftalık OHLC varsa mum; yoksa erişilebilir çizgi grafik kullan.
- [ ] Aylık plan ve piyasa ekranlarını commit et.

### Task 7: Backtest, araştırma ve ayarlar

**Files:**
- Create: `src/lib/domain/backtest.ts`, `src/lib/domain/backtest.test.ts`
- Create: `src/app/backtest/page.tsx`, `src/features/backtest/backtest-dashboard.tsx`
- Create: `src/app/arastirma/page.tsx`, `src/app/ayarlar/page.tsx`
- Create: `src/features/settings/settings-panel.tsx`, `src/lib/storage/settings-repository.ts`

**Interfaces:**
- Produces: `runDcaBacktest(input): BacktestResult` point-in-time fiyat dilimleriyle çalışır.

- [ ] Gelecek fiyatın kullanılamadığı aylık DCA testi, maksimum düşüş ve volatilite testleri yaz.
- [ ] Sabit dağılım, SMA dinamik ve tek varlık kıyaslarını uygula.
- [ ] Backtest sonuç kartları, portföy/equity eğrisi ve kıyas tablosunu ekle.
- [ ] Metodoloji/araştırma sayfasını proje belgelerinin özeti ve sınırlama uyarılarıyla oluştur.
- [ ] Aylık tutar, gelişmiş katsayılar, risk korumaları ve API durum ekranını ekle.
- [ ] Backtest ve ayarları commit et.

### Task 8: Belgeler, başlatıcılar ve teslim doğrulaması

**Files:**
- Create: `README.md`, `RESEARCH.md`, `METHODOLOGY.md`, `DATA_SOURCES.md`, `.env.example`
- Create: `start-windows.bat`, `start.sh`
- Create: `.gitignore`

**Interfaces:**
- Documents: kurulum, API anahtarları, aktif kaynaklar, metodoloji, sınırlamalar ve ücretsiz çalışma tablosu.

- [ ] Resmi kaynak bağlantıları ve erişim tarihi 2026-09-01 ile araştırma/veri belgelerini yaz.
- [ ] API anahtarsız ve isteğe bağlı anahtarlı özellik tablosunu README'ye ekle.
- [ ] Windows ve macOS/Linux tek komut başlatıcılarını ekle.
- [ ] `npm test`, `npm run lint` ve `npm run build` çalıştır; yalnızca gerçek sonuçları kaydet.
- [ ] Ana sayfa, Portföyüm, Backtest, Ayarlar ve varlık detayını 375/1440 pikselde kısa görsel kontrolden geçir.
- [ ] Konsol/ağ hatalarını düzelt, `git diff --check` çalıştır ve teslimatı commit et.
