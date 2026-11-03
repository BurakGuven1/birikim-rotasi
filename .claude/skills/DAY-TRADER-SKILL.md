# Day Trader skill paketi

`trader-*` klasörleri [Jakeschincariol/day-trader-skill](https://github.com/Jakeschincariol/day-trader-skill)
deposundan (commit `3d0f4ef`) değiştirilmeden kopyalandı; MIT lisansı
`DAY-TRADER-SKILL-LICENSE` dosyasında. Bu depo Claude Code ile açıldığında `/trader-scanner`,
`/trader-entry`, `/trader-exit`, `/trader-timemachine` vb. komutlar doğrudan çalışır
(Python 3.8+, kurulum gerekmez). Çıktılar çalışma klasöründeki `trader/` dizinine yazılır.

Web panelindeki **Setuplar** sayfası (`ozgurluk-rotasi/src/setups.ts`) paketin tarama, giriş,
çıkış ve Zaman Makinesi kurallarını TypeScript'e taşıyarak sunucuda çalıştırır.

Emir yalnız `/trader-broker` ile, `/trader-risk` o emri geçirdikten ve siz açıkça "evet"
dedikten sonra gönderilebilir; varsayılan kâğıt (paper) hesaptır.
