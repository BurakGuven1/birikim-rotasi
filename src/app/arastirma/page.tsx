import Link from "next/link";
import { BookOpenCheck, Database, Gauge, Scale } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";

export default function ResearchPage() {
  return <div>
    <PageHeader eyebrow="Şeffaf karar motoru" title="Araştırma ve metodoloji" description="Aynı veri aynı sonucu üretir. Haber duygusu veya yapay zekâ yorumu aylık tutarı doğrudan belirlemez." />
    <div className="grid grid-4">
      {[{ icon: Scale, title: "Nötr dağılım", text: "%35 yabancı, %25 emtia, %20 BTC, %20 Türk hisse." }, { icon: Gauge, title: "Sinyal aralığı", text: "Her sınıf -1 ile +1 arasında normalize edilir." }, { icon: Database, title: "Veri güveni", text: "Eksik/eski veri nötrden sapmayı küçültür." }, { icon: BookOpenCheck, title: "Tam açıklama", text: "Katsayı, sınır ve gerekçeler görünür kalır." }].map(({ icon: Icon, title, text }) => <Card key={title}><Icon size={22} color="var(--primary)" /><h3>{title}</h3><p className="muted">{text}</p></Card>)}
    </div>
    <div className="grid grid-2 section-gap">
      <Card><div className="card-title"><div><h2>Karar sırası</h2><p>Aylık katkı önce yeni alımlarla dengelenir</p></div></div><ol><li>Nötr ağırlıkları ve sınıf sınırlarını yükle.</li><li>Fiyatın haftalık SMA200 uzaklığı, SMA40 eğimi ve ATH düşüşünü hesapla.</li><li>Volatilite farkını normalize et; BTC ile altına aynı ham eşiği uygulama.</li><li>Veri güveni ve mevcut portföy sapmasını ekle.</li><li>Min/maks ve aylık 10 puan turnover sınırını uygula.</li><li>Ağırlıkları yüzde 100’e ve aylık tutara dönüştür.</li></ol></Card>
      <Card><div className="card-title"><div><h2>Satış koruması</h2><p>“Alımı azalt” ile “satış düşün” farklıdır</p></div></div><p>Varsayılan strateji satış yapmadan yeni katkıyla dengelemedir. Otomatik satış veya aracı kurum bağlantısı yoktur. Ağırlık maksimumun üzerinde, hedeften en az beş puan uzak ve değerleme tarihsel aşırı bölgedeyse yalnızca kullanıcı onayına bağlı azaltma düşüncesi gösterilebilir.</p><div className="notice"><p>Bu araç yatırım danışmanlığı değildir. Kesin getiri iddiası üretmez.</p></div></Card>
    </div>
    <Card className="section-gap"><div className="card-title"><div><h2>Belgeler</h2><p>Kaynak kodla birlikte ayrıntılı metodoloji ve veri envanteri</p></div></div><p><code>RESEARCH.md</code>, <code>METHODOLOGY.md</code> ve <code>DATA_SOURCES.md</code> proje kökünde bulunur. Veri adaptörlerinin sınırlamaları ve erişim tarihleri bu dosyalarda açıkça kaydedilir.</p><Link className="button primary" href="/backtest">Backtest sonuçlarını gör</Link></Card>
  </div>;
}
