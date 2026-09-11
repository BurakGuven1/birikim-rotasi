# Efloud kaynak envanteri ve kurala dönüşüm

Kontrol: 7 Eylül 2026. Tam arşiv taraması değildir. Transkript ve X zinciri erişimi sınırlıdır; görünmeyen içerik incelenmiş sayılmaz. Hiçbir kaynak bildirimi, uygulamanın veya Efloud'un doğrulanmış toplam performansı olarak sunulmaz.

## İncelenen birincil kaynaklar
- [OKX #44](https://tr.okx.com/en/learn/haftalik-arastirma-raporu-44): 27 Ağustos 2026; çoklu zaman dilimi, WO/MO/YO seviyeleri, kazanım/kayıp ve confirmation yaklaşımı.
- [OKX #5](https://tr.okx.com/en/learn/haftalik-arastirma-raporu-5): range high/low ve deviasyon; yeniden kazanılan bölge ve bir sonraki destek.
- [X ENS güncellemesi](https://x.com/Efloud/status/1745711433302540439): 12 Ocak 2024, indekslenmiş metin; kısmi kapatma ve düşük zaman dilimi onayı. Orijinal işlem zinciri ve tüm kayıplar görülmediğinden başarı örneklemi değildir.
- [Market Structure](https://www.youtube.com/watch?v=Teg2voqiOVk): 9 Temmuz 2021; başlık/açıklama bulunabildi, tam transkript alınamadı.
- [Confirmation eğitimi](https://www.youtube.com/watch?v=Z8721SXmRTU): #44 üzerinden doğrulanan bağlantı; tam transkript alınamadı.

## Arşiv keşfi
[OKX araştırma dizini](https://tr.okx.com/en/learn/category/arastirma-raporlari) 23 içerik listeliyordu. Haftalık raporlar: #44,43,42,41,40,39,38,26,25,24,23,22,21,20,19,18,17,16,15,14. Ayrıca Finansal Piyasalara Bakış #1–3. Bu liste başlık envanteridir; #44 dışındaki bu içeriklerin tam metni bu çalışmada incelenmedi. #5 arama yoluyla ayrıca incelendi. Dizindeki boş numaralar arşivin tam olduğunun varsayılamayacağını gösterir.

## Kaynak ile algoritma ayrımı
Seviye, market structure, geri kazanım ve kısmi yönetim yaklaşımı kaynaklarla ilişkilidir. 2+2 pivot, 0,25 ATR tampon, EMA/RSI/MACD hesapları, %35 fiyat konumu, %50 TP1 ve sayısal portföy sınırları uygulama tercihleridir; Efloud'un birebir stratejisi değildir.

Canlı ve backtest aynı sürümlü saf fonksiyonu kullanır. Geçmiş fiyatlara bugünkü açıklamalar, order book veya gelecekteki pivotlar taşınmaz. Eğitim/yorum bir işlem sonucu kaydı değildir. Kazanma sayıları sadece modelin tarihli kapanmış işlem defterinden üretilir.
