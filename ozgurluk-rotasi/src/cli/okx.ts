import { parseArgs } from "node:util";
import { fetchFundingRate, privateRequest } from "../data/okx.ts";
import { loadEnv } from "../env.ts";
import { credentials, executeOrder, liveEnabled } from "../live/orders.ts";

loadEnv();
const [cmd, ...rest] = process.argv.slice(2);
const HELP = `Kullanım:
  npm run okx -- bakiye                         Hesap bakiyeleri (Read yetkisi yeterli)
  npm run okx -- pozisyon                       Açık perp pozisyonları
  npm run okx -- fonlama BTC-USDT-SWAP ...      Anlık fonlama oranı
  npm run okx -- emir --inst BTC-USDT-SWAP --yon buy --usd 300 --stop 80000 [--hedef 95000] [--azalt] [--canli]
    Varsayılan ÖNİZLEMEDİR. Gerçek emir için .env'de OKX_LIVE=1 VE --canli gerekir.`;

function needCreds() {
  const c = credentials();
  if (!c) {
    console.error("OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE .env dosyasında tanımlı değil.");
    process.exit(1);
  }
  return c;
}

switch (cmd) {
  case "bakiye": {
    const [acc] = await privateRequest<{ totalEq: string; details: { ccy: string; eq: string; eqUsd: string; availBal: string }[] }[]>(needCreds(), "GET", "/api/v5/account/balance");
    console.log(`Toplam (USD): ${Number(acc.totalEq).toFixed(2)}`);
    for (const d of acc.details.filter((x) => Number(x.eqUsd) > 1)) console.log(`  ${d.ccy.padEnd(8)} ${Number(d.eq).toFixed(6).padStart(18)}  ≈ $${Number(d.eqUsd).toFixed(2)}`);
    const [fund] = [await privateRequest<{ ccy: string; bal: string }[]>(needCreds(), "GET", "/api/v5/asset/balances")];
    const f = fund.filter((x) => Number(x.bal) > 0);
    if (f.length) console.log(`Funding hesabı: ${f.map((x) => `${x.ccy} ${x.bal}`).join(", ")}`);
    break;
  }
  case "pozisyon": {
    const pos = await privateRequest<{ instId: string; pos: string; avgPx: string; upl: string; lever: string; liqPx: string; notionalUsd: string }[]>(needCreds(), "GET", "/api/v5/account/positions");
    if (!pos.length) console.log("Açık pozisyon yok.");
    for (const p of pos) console.log(`${p.instId.padEnd(18)} adet ${p.pos} ort ${p.avgPx} nominal $${Number(p.notionalUsd).toFixed(0)} K/Z ${Number(p.upl).toFixed(2)} kaldıraç ${p.lever}x likidasyon ${p.liqPx || "—"}`);
    break;
  }
  case "fonlama": {
    const ids = rest.length ? rest : ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "XAU-USDT-SWAP", "US500-USDT-SWAP", "US100-USDT-SWAP"];
    for (const id of ids) {
      const f = await fetchFundingRate(id);
      console.log(`${id.padEnd(18)} ${(f.fundingRate * 100).toFixed(4)}% / periyot  ≈ ${(f.fundingRate * 3 * 365 * 100).toFixed(1)}% yıllık (8 saatlik varsayımla)`);
    }
    break;
  }
  case "emir": {
    const { values } = parseArgs({
      args: rest,
      options: {
        inst: { type: "string" },
        yon: { type: "string" },
        usd: { type: "string" },
        stop: { type: "string" },
        hedef: { type: "string" },
        azalt: { type: "boolean", default: false },
        canli: { type: "boolean", default: false },
      },
    });
    if (!values.inst || !values.yon || !values.usd || !["buy", "sell"].includes(values.yon)) {
      console.log(HELP);
      process.exit(1);
    }
    const res = await executeOrder(
      {
        instId: values.inst,
        side: values.yon as "buy" | "sell",
        usd: Number(values.usd),
        stopLoss: values.stop ? Number(values.stop) : undefined,
        takeProfit: values.hedef ? Number(values.hedef) : undefined,
        reduceOnly: values.azalt,
      },
      values.canli,
    );
    console.log(`Fiyat: ${res.plan.price} · Adet/kontrat: ${res.plan.size} · Nominal: $${res.plan.notionalUsd.toFixed(2)}`);
    console.log(`Gövde: ${JSON.stringify(res.plan.body)}`);
    res.plan.warnings.forEach((w) => console.log(`⚠️  ${w}`));
    if (res.sent) console.log(`✅ GÖNDERİLDİ: ${JSON.stringify(res.response)}`);
    else console.log(`ℹ️  ÖNİZLEME — gönderilmedi${liveEnabled() ? " (--canli bayrağı yok)" : " (OKX_LIVE=1 değil)"}.`);
    break;
  }
  default:
    console.log(HELP);
}
