# MPA 1.0.0 — gerçek OKX geçmiş veri sonucu

Son sürüm sonucu: **başarı eşiği doğrulanmadı; gerçek para işlemleri kapalı.**

Dönem 11 Haziran 2026 07:15 UTC – 9 Eylül 2026 07:15 UTC, 90 gün. Ayrılmış test başlangıcı 10 Ağustos 2026 07:15 UTC. Parametreler sonucun %60'a ulaşması için optimize edilmedi. Veri kesintisi sonrası indirme devam ettirildi; son tablo aynı dönemi kullanan beş coinin tamamını içerir.

| Sözleşme | Ham sinyal değerlendirmesi | Açılan işlem | Son 30 gün işlem | Kazanma oranı |
|---|---:|---:|---:|---|
| BTC-USDT-SWAP | 8 | 0 | 0 | Hesaplanamaz |
| ETH-USDT-SWAP | 6 | 0 | 0 | Hesaplanamaz |
| SOL-USDT-SWAP | 4 | 0 | 0 | Hesaplanamaz |
| XRP-USDT-SWAP | 9 | 0 | 0 | Hesaplanamaz |
| ADA-USDT-SWAP | 7 | 0 | 0 | Hesaplanamaz |

Toplam 34 sinyal değerlendirmesinin 29'u maliyet sonrası 2:1 RR eşiğini, 4'ü gerçekleşebilir girişe göre TP yönü/fiyat kontrolünü, 1'i minimum kontrat adımıyla %80–90 TP1 dağılımını geçemedi. Reddedilen bir yapı sonraki mumda yeniden değerlendirilebilir; sayı benzersiz işlem sayısı değildir.

Bu sonuç **%0 kazanma oranı** veya stratejinin güvenli olduğu anlamına gelmez. İşlem örneklemi oluşmadı; kârlılık, düşüş ve ileri performans için kanıt yok. Her coin için net gerçekleşen K/Z 0 USDT, sanal bakiye 200 USDT; beş tablo tek ortak portföy sonucu olarak toplanmaz.

OHLC ve funding kapsamı beş coinde de doğrulandı. Funding mark fiyatı 15m mark mumunun açılışıyla yaklaşık alınır. Varsayılanlar: 5×, işlem riski %0,5, TP1 yaklaşık %85, her yönde 5 baz puan komisyon ve 5 baz puan kayma, 3 baz puan funding risk tamponu. Ayrılmış test kabulü ≥100 işlem, ≥%60 kazanma, pozitif net beklenti, kâr faktörü ≥1,30 ve düşüş ≤%10 gerektirir. Hiçbir coin bu koşulları geçmedi.

Yorum: dosyadaki takdire dayalı tekniğin bu ihtiyatlı, ölçülebilir yorumu fazla seyrek sinyal üretti ve hedef mesafesi risk/maliyet bütçesini karşılamadı. Veri sonucunu iyi göstermek için RR düşürülmedi, hedef uzaklaştırılmadı veya kaybeden coin çıkarılmadı. Sonraki strateji revizyonu yeni sürüm ve yeni bağımsız doğrulama gerektirir; bu sürüm paper gözlem için kullanılabilir.

Kurallar: [MPA strateji belgesi](mpa-strategy.md). Ham raporlar: `artifacts/bot-research/summary.json` ve coin bazlı JSON dosyaları. Yeniden hesaplama halka açık önbellekten `npm run bot:research` ile yapılır.

Uygulama kontrolleri: 22 çekirdek/MPA, 6 kontrol servisi/worker, 3 veri yükleme testi geçti. TypeScript, ilgili ESLint ve üretim derlemesi geçti. Gerçek localhost panel durumu HTTP 200; tarayıcı JavaScript hatası ve mobil yatay taşma görülmedi. Gerçek hesap emri veya transfer yapılmadı.
