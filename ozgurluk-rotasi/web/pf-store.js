/*
 * Portföy bu cihazdaki tarayıcıda (localStorage) saklanır; sunucuda tutulmaz.
 * Aynı paneli kullanan başka biri sizin işlemlerinizi göremez; siz de onunkileri.
 * Başka cihaza taşımak için Portföyüm sayfasındaki "Dışa aktar / İçe aktar"ı kullanın.
 */
window.PfStore = (() => {
  const KEY = "pf.transactions.v1";
  const load = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(j) ? j : []; } catch { return []; } };
  const save = (txs) => { try { localStorage.setItem(KEY, JSON.stringify(txs)); } catch { /* gizli sekme vb. */ } };
  /** Sunucuya cihazdaki işlemleri (+ eklenecekleri) gönderip değerlemeyi alır; güncel listeyi kaydeder. */
  async function sync({ add, transactions, refresh } = {}) {
    const r = await fetch("/api/portfolio", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactions: transactions ?? load(), add, refresh }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    save(j.transactions.slice().reverse()); // yanıt yeniden eskiye; eskiden yeniye sakla
    return j;
  }
  /** Eski sürümde sunucu dosyasında (data/portfoy.json) duran işlemleri bir kez bu tarayıcıya taşır. */
  async function migrate() {
    try {
      if (localStorage.getItem("pf.migrated") || load().length) return;
      const r = await fetch("/api/portfolio/legacy", { cache: "no-store" });
      const j = r.ok ? await r.json() : { transactions: [] };
      if (j.transactions?.length) save(j.transactions);
      localStorage.setItem("pf.migrated", "1");
    } catch { /* yok say */ }
  }
  return { load, save, sync, migrate };
})();
