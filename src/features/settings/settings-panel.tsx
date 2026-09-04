"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, Save, ShieldAlert } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { normalizeUserSettings, settingsRepository, type UserSettings } from "@/lib/storage/settings-repository";
import { formatMoney } from "@/lib/format";

interface ProviderStatus { name: string; active: boolean; keyRequired: boolean; enhanced?: boolean; coverage: string }
const keyLinks = [
  { name: "EODHD", env: "EODHD_API_KEY", href: "https://eodhd.com/developer/api-keys" },
  { name: "FRED", env: "FRED_API_KEY", href: "https://fredaccount.stlouisfed.org/apikeys" },
  { name: "Alpha Vantage", env: "ALPHA_VANTAGE_API_KEY", href: "https://www.alphavantage.co/support/#api-key" },
];

interface StrategySettingsFieldsProps {
  settings: UserSettings;
  onChange: (settings: UserSettings) => void;
}

export function StrategySettingsFields({ settings, onChange }: StrategySettingsFieldsProps) {
  const update = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => onChange({ ...settings, [key]: value });
  return <Card><div className="card-title"><div><h2>Katkı ve strateji bütçesi</h2><p>Aylık birikim, yıllık ekleme ve swing risk sınırları</p></div></div>
    <div className="settings-grid">
      <div className="field"><label htmlFor="monthly-budget">Aylık katkı (USD)</label><input id="monthly-budget" className="input" type="number" min="1" step="50" value={settings.monthlyBudgetUsd} onChange={(event) => update("monthlyBudgetUsd", Number(event.target.value))} /></div>
      <div className="field"><label htmlFor="annual-contribution">Yıllık ek katkı (USD)</label><input id="annual-contribution" className="input" type="number" min="0" step="250" value={settings.annualContributionUsd} onChange={(event) => update("annualContributionUsd", Number(event.target.value))} /></div>
      <div className="field"><label htmlFor="annual-month">Yıllık ek katkı ayı</label><input id="annual-month" className="input" type="number" min="1" max="12" step="1" value={settings.annualContributionMonth} onChange={(event) => update("annualContributionMonth", Number(event.target.value))} /></div>
      <div className="field"><label htmlFor="target-usd">Bugünün alım gücüyle hedef (USD)</label><input id="target-usd" className="input" type="number" min="1000" step="10000" value={settings.targetUsd} onChange={(event) => update("targetUsd", Number(event.target.value))} /></div>
      <div className="field"><label htmlFor="tactical-share">Taktik bütçe (%)</label><input id="tactical-share" className="input" type="number" min="0" max="25" step="1" value={settings.tacticalShare * 100} onChange={(event) => update("tacticalShare", Number(event.target.value) / 100)} /></div>
      <div className="field"><label htmlFor="per-trade-risk">İşlem başına risk (%)</label><input id="per-trade-risk" className="input" type="number" min="0.1" max="1" step="0.1" value={settings.perTradeRisk * 100} onChange={(event) => update("perTradeRisk", Number(event.target.value) / 100)} /></div>
      <div className="field"><label htmlFor="min-risk-reward">Minimum getiri / risk</label><input id="min-risk-reward" className="input" type="number" min="2" max="4" step="0.25" value={settings.minRiskReward} onChange={(event) => update("minRiskReward", Number(event.target.value))} /></div>
      <div className="field"><label htmlFor="min-confidence">Minimum sinyal güveni (%)</label><input id="min-confidence" className="input" type="number" min="60" max="90" step="5" value={settings.minConfidence * 100} onChange={(event) => update("minConfidence", Number(event.target.value) / 100)} /></div>
    </div>
    <p className="metric-value">{formatMoney(settings.monthlyBudgetUsd, "USD")} / ay</p>
    <p className="muted">Yıllık ek: {formatMoney(settings.annualContributionUsd, "USD")} · Reel hedef bandı %10–11; garanti değildir.</p>
  </Card>;
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<UserSettings>(() => normalizeUserSettings());
  const [providers, setProviders] = useState<ProviderStatus[]>([]); const [saved, setSaved] = useState(false);
  useEffect(() => { void settingsRepository.get().then(setSettings); void fetch("/api/market/status").then((response) => response.json()).then(setProviders); }, []);
  const save = async () => { await settingsRepository.save(settings); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  return <div>
    <PageHeader eyebrow="Yerel yapılandırma" title="Ayarlar ve veri kaynakları" description="Aylık katkını belirle, kişisel risk kontrolünü tamamla ve ücretsiz API kapsamını gör." actions={<button className="button primary" onClick={() => void save()}><Save size={17} />{saved ? "Kaydedildi" : "Kaydet"}</button>} />
    <div className="grid grid-2">
      <StrategySettingsFields settings={settings} onChange={setSettings} />
      <Card><div className="card-title"><div><h2>Kişisel risk kontrolü</h2><p>Acil durum fonu portföyden ayrı tutulmalıdır</p></div></div>{["3–6 aylık temel gider kadar acil durum fonum var.", "Bu para en az beş yıl kullanılmayacak.", "%40–50 geçici düşüşü tolere edebilirim.", "Düzenli borç ödemelerimi ayrıca planladım."].map((label) => <label key={label} style={{ display: "flex", gap: 10, marginBottom: 12 }}><input type="checkbox" onChange={() => {}} /> <span>{label}</span></label>)}<button className="button secondary" onClick={() => setSettings((current) => ({ ...current, riskAnswersCompleted: true }))}><ShieldAlert size={17} />Kontrolü tamamladım</button></Card>
    </div>
    <Card className="section-gap"><div className="card-title"><div><h2>Aktif veri katmanı</h2><p>Anahtarlar hiçbir zaman tarayıcıya gönderilmez</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Kaynak</th><th>Durum</th><th>Kapsam</th></tr></thead><tbody>{providers.map((provider) => <tr key={provider.name}><td><strong>{provider.name}</strong></td><td><span className={`status-badge ${provider.active ? "fresh" : "delayed"}`}>{provider.active ? <Check size={13} /> : null}{provider.active ? (provider.enhanced ? "Anahtarlı" : "Aktif") : "İsteğe bağlı"}</span></td><td>{provider.coverage}</td></tr>)}</tbody></table></div></Card>
    <Card className="section-gap"><div className="card-title"><div><h2>Ücretsiz API anahtarları</h2><p>Linkten anahtarı al, proje kökündeki `.env.local` dosyasına değişken adıyla ekle ve uygulamayı yeniden başlat</p></div></div><div className="grid grid-2">{keyLinks.map((item) => <a className="card market-card" href={item.href} target="_blank" rel="noreferrer" key={item.name}><strong>{item.name}</strong><p className="muted"><code>{item.env}</code></p><span className="positive">Resmî sayfayı aç <ExternalLink size={14} style={{ display: "inline" }} /></span></a>)}</div><div className="notice section-gap"><p>API anahtarını uygulama ekranına veya kaynak koda yazma. `.env.local` Git tarafından yok sayılır.</p></div></Card>
  </div>;
}
