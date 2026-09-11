export const RESEARCH_REVIEW_DATE = "2026-09-07";
export const EFLOUD_SOURCES = [
  { title:"OKX haftalık rapor #44", url:"https://tr.okx.com/en/learn/haftalik-arastirma-raporu-44", status:"Metin incelendi", date:"2026-08-27", finding:"Hafta/ay/yıl açılışları, kazanılan ve kaybedilen seviyeler, yüksek ve düşük zaman dilimi ayrımı; onay yapısının ilgili zaman diliminde aranması." },
  { title:"OKX haftalık rapor #5", url:"https://tr.okx.com/en/learn/haftalik-arastirma-raporu-5", status:"Metin incelendi", date:"Sayfadaki yayın tarihi", finding:"Range high/low, sınır dışına taşma ve geri kazanım; destek kaybında sonraki bölgenin değerlendirilmesi." },
  { title:"Market Structure · Efloud", url:"https://www.youtube.com/watch?v=Teg2voqiOVk", status:"Başlık / açıklama doğrulandı; tam transkript alınamadı", date:"2021-07-09", finding:"Piyasa yapısı eğitimi bulundu. Videonun tamamı izlenmiş veya kuralları eksiksiz çıkarılmış sayılmıyor." },
  { title:"Confirmation · LTC ve SOL üzerinden anlatım", url:"https://www.youtube.com/watch?v=Z8721SXmRTU", status:"Raporun eğitim bağlantısı doğrulandı; transkript alınamadı", date:"Yayın tarihi doğrulanmadı", finding:"#44 raporunun yönlendirdiği onay eğitimi. Başlık tam içerik analizi yerine geçmez." },
  { title:"ENS işlem güncellemesi · X", url:"https://x.com/Efloud/status/1745711433302540439", status:"İndekslenmiş paylaşım metni incelendi; tam zincir yok", date:"2024-01-12", finding:"Kısmi kapatma ve yeniden giriş için düşük zaman dilimi teyidi örneği. Bildirilen kazanç bağımsız doğrulanmış performans olarak kullanılmıyor." },
];
export const EFLOUD_RULE_MAP = [
  { concept:"Seviye geri kazanımı ve çoklu zaman dilimi", source:"OKX #44", implementation:"Haftalık/günlük yön bağlamı ve kapanmış 4 saatlik mumda onay." },
  { concept:"Fiyat aralığı ve sınır dışına taşma", source:"OKX #5", implementation:"Süpürme–geri kazanım ve kırılım–yeniden test modelleri." },
  { concept:"Kısmi kâr alma", source:"X ENS örneği", implementation:"TP1 başlangıç miktarının %50’si; kalan tutar için maliyet dahil başabaş stop." },
  { concept:"Sayısal algoritma ve risk tercihleri", source:"Bu uygulamanın tasarım kararı", implementation:"2+2 pivot, 0,25 ATR stop tamponu, 1R/2R, ucuzluk %35, BTC %40, %0,5 stop riski Efloud’a atfedilmez." },
];
export const OKX_ARCHIVE_INVENTORY = [44,43,42,41,40,39,38,26,25,24,23,22,21,20,19,18,17,16,15,14];
