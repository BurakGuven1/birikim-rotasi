# Uzun vade fırsatları uygulama planı

**Goal:** ABD ilk 100 ve BIST 100 evrenlerinde, verisi yeterli şirketleri kalite ve sektör içi değerleme ile en fazla 20 aday olarak sıralamak.

**Architecture:** Mevcut TradingView yanıtına doğrulanmış temel veri alanları eklenir. Saf domain motoru veri/kalite eşikleri, sektör yüzdelikleri ve eşit ağırlıklı başlangıç modelini hesaplar. Ayrı panel, güncel sıralamayı ve önceki kayıtla çıkış nedenlerini gösterir. Mevcut takip ve portföy akışları korunur.

**Tech Stack:** Next 16.3.4, React 19, TypeScript, Vitest, mevcut CSS değişkenleri.

**Spec:** Kullanıcının 8 Eylül 2026 tarihinde onayladığı sohbet tasarımı.

## Sınırlar

- Model optimize edilmiş veya geçmişte doğrulanmış değildir; ilk sürümde eşit ağırlıklı ve açıkça ön değerlendirme olarak etiketlenir.
- Tarihsel bilanço yüzdelikleri, kâr sürekliliği, sulandırma ve marj tarihçesi yoksa varmış gibi hesaplanmaz.
- Finans alt sektörlerinden bankalar ayrı model kullanır; diğer finans/GYO şirketleri uzman model olmadan sıralanmaz.
- En az 5 tam verili aynı sektör/model emsali olmadan puan yok. Eksik veriler sıfır veya nötr puana çevrilmez.
- Eski fiyat/kayıt, eski veya gelecekteki sonuç açıklama tarihi değerlendirmeyi durdurur. Tarihler kaynak bildirimidir, bilanço dönemi teyidi değildir.
- Sıralama puanı kazanma olasılığı değildir. 20 adayı doldurma zorunluluğu yok. SMA altında olma şartı yok.
- Geçmiş performans için gerçek point-in-time temel veri ve delist içeren evren gerekir; mevcut fiyat backtesti bu modelin kanıtı olarak sunulmaz.

## İşler

- [ ] Veri sözleşmesi: `stock-watchlist.ts`, cache schema ve service. Test: yeni alanların birim/dönem eşlemesi, sıfır/negatif/missing korunması, eski kayıt uyumu ve genişletilmiş alan hatasında temel liste yedeği.
- [ ] `stock-opportunities.ts` ve testleri: kalite tuzağı, sektör bağımsızlığı, banka ayrımı, minimum emsal, tarihler, eksik alan, momentum 6–1/12–1, sabit sıralama, maksimum 20, değişim nedenleri.
- [ ] `stock-opportunities-panel.tsx`: piyasa sekmeleriyle uyumlu aday tablosu, alt puanlar ve kaynak zamanı, toplu açıklama, veri kapsamı, model sınırları, listeden çıkışlar.
- [ ] Güncellemeler arasında önceki veri kaydını saklama; hatalı güncellemede geçmişi ilerletmeme.
- [ ] Geçmiş test gereksinimlerini ve model formüllerini `docs/stock-opportunities.md` içinde belgeleme; veriye dayanmayan getiri tablosu üretmeme.
- [ ] Domain/veri/cache testleri, panel render/etkileşim kontrolü, TypeScript/ESLint ve build. Canlı iki piyasa isteği, masaüstü ve mobil kontrol.

## Doğrulama komutları

`npm test -- src/lib/domain/stock-watchlist.test.ts src/lib/domain/stock-opportunities.test.ts src/lib/storage/watchlist-cache.test.ts src/lib/data/stock-watchlist-service.test.ts`

`npm run build`

`npx eslint src/lib/domain/stock-opportunities.ts src/lib/domain/stock-watchlist.ts src/lib/data/stock-watchlist-service.ts src/lib/storage/watchlist-cache.ts src/features/watchlist`
