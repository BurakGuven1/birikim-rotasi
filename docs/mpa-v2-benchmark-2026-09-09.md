# MPA v2 karşılaştırma kıyaslaması — 2026-09-09

Kaynak: `npm run bot:research` (OKX public geçmiş veri, tek veri seti başına üç giriş zaman dilimi).
Dönem: 2026-06-11 → 2026-09-09 (90 gün). Ayarlar: 200 USDT sermaye, %0,5 işlem riski, 5× kaldıraç,
asgari net getiri/risk 2, komisyon 5 bp, kayma 5 bp, fonlama tamponu 3 bp.

| Coin | Giriş | İşlem | Kazanma % | Net K/Z (USDT) | PF | Azami düşüş % | Geliştirme (işlem/net) | Ayrılmış test (işlem/net) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTC | 15m | 28 | 17,9 | -13,19 | 0,24 | 6,7 | 22 / -9,34 | 6 / -4,06 |
| BTC | 1H | 25 | 28,0 | -8,79 | 0,44 | 6,4 | 23 / -9,04 | 2 / +0,25 |
| BTC | 4H | 6 | 16,7 | -2,88 | 0,29 | 2,2 | 4 / -3,19 | 2 / +0,32 |
| ETH | 15m | 43 | 34,9 | -13,72 | 0,40 | 7,1 | 32 / -10,00 | 11 / -3,92 |
| ETH | 1H | 25 | 32,0 | -8,22 | 0,44 | 4,7 | 20 / -6,06 | 5 / -2,24 |
| ETH | 4H | 2 | 0,0 | -1,87 | 0,00 | 1,0 | 1 / -0,95 | 1 / -0,93 |
| SOL | 15m | 53 | 34,0 | -19,85 | 0,30 | 11,2 | 40 / -13,28 | 13 / -7,03 |
| SOL | 1H | 25 | 16,0 | -15,54 | 0,15 | 8,2 | 19 / -11,73 | 6 / -4,06 |
| SOL | 4H | 4 | 0,0 | -3,71 | 0,00 | 1,9 | 4 / -3,71 | 0 / 0,00 |
| XRP | 15m | 52 | 26,9 | -17,44 | 0,43 | 9,5 | 36 / -13,26 | 16 / -4,54 |
| XRP | 1H | 22 | 31,8 | -10,17 | 0,24 | 5,2 | 19 / -10,23 | 3 / +0,07 |
| XRP | 4H | 3 | 33,3 | -0,56 | 0,62 | 0,9 | 2 / +0,38 | 1 / -0,95 |
| ADA | 15m | 64 | 39,1 | -8,86 | 0,74 | 9,6 | 41 / -15,03 | 23 / +6,78 |
| ADA | 1H | 20 | 35,0 | -5,27 | 0,56 | 3,6 | 16 / -4,08 | 4 / -1,16 |
| ADA | 4H | 12 | 16,7 | -7,11 | 0,23 | 4,2 | 7 / -4,54 | 5 / -2,64 |

## Okuma

- On beş varyantın tamamı bu 90 günlük pencerede zarar etti; hiçbir kâr faktörü 1'in üzerine çıkmadı.
  Motor, karşılaştırma ve pozisyon yönetimi çalışıyor — kârlı olduğu **gösterilmedi**.
- 4H varyantları 2–12 işlem üretiyor; bu örneklem hiçbir sonucu ne olumlu ne olumsuz kanıtlar.
- Tek başına 90 gün ve tek bir rejim (bu pencere) genellenemez; ADA 15m'in ayrılmış testte +6,78 olması
  geliştirmedeki -15,03'ten sonra gelen tek pencerelik bir gözlemdir, seçim gerekçesi değildir.
- `selectedInterval` yalnızca geliştirme beklentisi pozitif olan satırları kabul ediyor; bu veri setinde
  hiçbir coin eşiği geçmediği için otomatik seçim 15m varsayılanına düşüyor. Varsayılan 15m de bu
  pencerede en çok zarar eden varyant — otomatik mod, kanıt yokken en kötü varyanta düşmemeli.
- Gerçek emirler kilitli kalmalı. Canlıya geçiş için önce ileri paper doğrulaması ve pozitif beklenti şart.
