# Aylık yatırım merkezi uygulama planı

**Amaç:** Mevcut Next.js 16.3.4 / React 19 / Dexie uygulamasında 5 Ekim 2026 başlangıçlı aylık karar akışını tamamlamak.
**Tasarım:** ../specs/2026-09-07-monthly-investment-design.md
**Yürütme:** Mevcut çalışma dalında yerinde, kullanıcı geliştirme yetkisi kapsamında. Kullanıcı kayıtları korunur.

- [ ] `src/lib/domain/investment-policy.ts`, `monthly-investment.ts`, `investment-projection.ts`: önce tarih, eksik veri, sermaye, BTC tavanı, kuru geçmişe göre çevirme, kuruş korunumu ve reel formül testleri; sonra saf fonksiyonlar.
- [ ] `src/lib/data/investment-service.ts` ve `/api/market/investment`: mevcut sağlayıcılarla sınırlı paralel veri çekme; kısmi hata ve 60 saniye önbellek; kaynak ve zaman korunumu.
- [ ] `src/lib/storage/investment-repository.ts`: profil ve karar anı arşivi, gerçek kayıt hataları, doğrulama; mevcut `settings` tablosunda ayrı anahtarlar.
- [ ] `src/features/investment/*`: aylık katkı editörü, takvim, dağılım, profil formu, kaynak kartları, gerekçeler, karar kaydet/indir, etkileşimli senaryo grafiği.
- [ ] Ana sayfa ve navigasyonu bağla; ayarlardaki işlevsiz risk formunu değiştir; swing risk tabanını gerçek sermayeyle sınırla; günlük göstergelere günlük veri ver.
- [ ] Yeni regresyon testleri ve mevcut testler: `npm test`; `npm run lint`; `npm run build`; `npm run test:e2e`. 375 px ve masaüstü, koyu/açık tema, kalıcı profil, hata ve taslak akışını kontrol et. Veri erişimini ayrıca canlı API isteğiyle doğrula.
- [ ] README ve metodolojiyi güncelle; kod incelemesi ve `git diff --check` ile bitir.
