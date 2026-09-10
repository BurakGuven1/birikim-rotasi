import { z } from "zod";
import type { PriceActionAccount, PriceActionSetup } from "../domain/price-action";
import { sizePriceActionTrade } from "../domain/price-action";

const positive = z.number().finite().positive();
const schema = z.object({
  id:z.string().min(1), version:z.literal(1), symbol:z.string().min(1), venue:z.string(),
  direction:z.enum(["long","short"]), status:z.enum(["planned","open","partial","closed"]),
  createdAt:z.iso.datetime(), expiresAt:z.iso.datetime(), openedAt:z.iso.datetime().optional(), closedAt:z.iso.datetime().optional(),
  entry:positive, stop:positive, tp1:positive, tp2:positive, sizeUsd:positive,
  leverage:z.union([z.literal(1),z.literal(2)]), feeRate:z.number().min(0).max(.05),
  remainingFraction:z.number().min(0).max(1), realizedPnlUsd:z.number().finite(),
  notes:z.array(z.string()), snapshot:z.string(),
});
export type SwingJournalEntry = z.infer<typeof schema>;
const KEY = "birikim-rotasi:swing-journal:v1";
function read():SwingJournalEntry[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try { return z.array(schema).parse(JSON.parse(raw)); }
  catch { throw new Error("Swing günlüğü okunamadı; açık risk sıfır kabul edilmedi. Yerel yedeği kontrol et."); }
}
function write(rows:SwingJournalEntry[]) { localStorage.setItem(KEY,JSON.stringify(z.array(schema).parse(rows))); }
function current(id:string) { const entry=read().find(t=>t.id===id);if(!entry)throw new Error("İşlem kaydı bulunamadı.");return entry; }
function positivePrice(value:number) { if(!Number.isFinite(value)||value<=0)throw new Error("Geçerli pozitif fiyat gir."); }
function slicePnl(t:SwingJournalEntry,exit:number,fraction:number) {
  positivePrice(exit);
  const quantity=t.sizeUsd*t.leverage/t.entry*fraction;
  return quantity*(exit-t.entry)*(t.direction==="long"?1:-1)-quantity*(t.entry+exit)*t.feeRate;
}
export function summarizeOpenSwingExposure(rows:SwingJournalEntry[],includePlanned=false) {
  return rows.filter(t=>t.status==="open"||t.status==="partial"||(includePlanned&&t.status==="planned"&&Date.parse(t.expiresAt)>Date.now())).reduce((sum,t)=>{
    const notional=t.sizeUsd*t.leverage*t.remainingFraction;
    sum.marginUsd+=t.sizeUsd*t.remainingFraction;
    const loss=Math.max(0,(t.entry-t.stop)*(t.direction==="long"?1:-1));
    sum.riskUsd+=(loss/t.entry+2*t.feeRate+.0015)*notional;
    if(/^BTC/i.test(t.symbol))sum.btcDerivativeExposureUsd+=notional;
    return sum;
  },{marginUsd:0,riskUsd:0,btcDerivativeExposureUsd:0});
}
function validateBudget(t:SwingJournalEntry,account:PriceActionAccount,rows:SwingJournalEntry[]) {
  const sign=t.direction==="long"?1:-1;
  if((t.entry-t.stop)*sign<=0||(t.tp1-t.entry)*sign<Math.abs(t.entry-t.stop)||(t.tp2-t.entry)*sign<2*Math.abs(t.entry-t.stop))throw new Error("Giriş, stop veya hedef sıralaması / getiri-risk oranı geçersiz.");
  const other=summarizeOpenSwingExposure(rows.filter(r=>r.id!==t.id),true);
  const allowed=sizePriceActionTrade({...account,symbol:t.symbol,leverage:t.leverage,
    availableUsd:Math.max(0,account.availableUsd-other.marginUsd),openMarginUsd:other.marginUsd,
    openRiskUsd:other.riskUsd,btcExposureUsd:(account.btcExposureUsd??0)+other.btcDerivativeExposureUsd},t.entry,t.stop);
  if(t.sizeUsd>allowed.marginUsd+.000001)throw new Error("Plan güncel teminat, BTC veya toplam stop riski sınırını aşıyor. Yeniden analiz et.");
}
export const priceActionJournal = {
  async list() { return read().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); },
  async plan(setup:PriceActionSetup,account:PriceActionAccount) {
    if(setup.action!=="ready"||!setup.direction||!setup.entry||!setup.stop||!setup.tp1||!setup.tp2||Date.parse(setup.expiresAt)<=Date.now())throw new Error("Geçerli güncel kurulum gerekli.");
    const rows=read();
    if(rows.some(t=>t.symbol===setup.symbol&&t.status!=="closed"&&(t.status!=="planned"||Date.parse(t.expiresAt)>Date.now())))throw new Error("Bu sembolde zaten aktif plan / işlem var.");
    const trade:SwingJournalEntry={id:crypto.randomUUID(),version:1,symbol:setup.symbol,venue:setup.source,direction:setup.direction,status:"planned",createdAt:new Date().toISOString(),expiresAt:setup.expiresAt,entry:setup.entry,stop:setup.stop,tp1:setup.tp1,tp2:setup.tp2,sizeUsd:setup.sizing.marginUsd,leverage:setup.sizing.leverage,feeRate:.001,remainingFraction:1,realizedPnlUsd:0,notes:setup.reasons,snapshot:JSON.stringify(setup)};
    validateBudget(trade,account,rows);write([...rows,trade]);return trade;
  },
  async open(id:string,entry:number,account:PriceActionAccount) {
    positivePrice(entry);const t=current(id);
    if(t.status!=="planned"||Date.parse(t.expiresAt)<=Date.now())throw new Error("Plan süresi dolmuş veya zaten açılmış.");
    const next={...t,entry,status:"open" as const,openedAt:new Date().toISOString()};
    validateBudget(next,account,read());write(read().map(r=>r.id===id?next:r));return next;
  },
  async takeTp1(id:string,exit:number) {
    const t=current(id);positivePrice(exit);
    if(t.status!=="open")throw new Error("TP1 yalnız bir kez uygulanabilir.");
    const sign=t.direction==="long"?1:-1;
    const impact=.00075;
    const breakeven=sign===1?t.entry*(1+t.feeRate)/((1-impact)*(1-t.feeRate)):t.entry*(1-t.feeRate)/((1+impact)*(1+t.feeRate));
    const next={...t,status:"partial" as const,remainingFraction:.5,stop:breakeven,realizedPnlUsd:t.realizedPnlUsd+slicePnl(t,exit,.5)};
    write(read().map(r=>r.id===id?next:r));return next;
  },
  async close(id:string,exit:number) {
    const t=current(id);positivePrice(exit);
    if(t.status!=="open"&&t.status!=="partial")throw new Error("Yalnız açık pozisyon kapatılır.");
    const next={...t,status:"closed" as const,closedAt:new Date().toISOString(),remainingFraction:0,realizedPnlUsd:t.realizedPnlUsd+slicePnl(t,exit,t.remainingFraction)};
    write(read().map(r=>r.id===id?next:r));return next;
  },
  async removePlan(id:string) {const t=current(id);if(t.status!=="planned")throw new Error("Açılmış işlem silinemez.");write(read().filter(t=>t.id!==id));},
  export() {return {schema:KEY,exportedAt:new Date().toISOString(),trades:read()};},
};
