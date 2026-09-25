/**
 * Tüm stratejik varsayımlar burada. Parametreler literatürdeki varsayılanlardır
 * (Faber 10 ay SMA, 12 ay TSMOM, Connors RSI(2), Turtle 55/20 Donchian) ve
 * geçmiş veriye göre OPTİMİZE EDİLMEMİŞTİR — aşırı uyumu (overfitting) önlemek için.
 */

export type AssetId = "SPY" | "QQQ" | "GLD" | "BIST" | "BTC" | "ETH" | "DBC";

export interface AssetDef {
  id: AssetId;
  name: string;
  yahoo: string;
  /** Yahoo sembolü TRY cinsindeyse, USD'ye bu kur serisiyle bölünür. */
  fxDivisor?: string;
  eodhd?: string;
  /** Uygulamada nereden alınır (çekirdek + swing) */
  venue: string;
  /** Aylık katkının alınacağı yer (uzun vadeli çekirdek) */
  coreVenue: string;
  /** Tek yön işlem maliyeti (komisyon + kayma), baz puan */
  costBps: number;
  /** Swing tarafında perp uzun pozisyon fonlama maliyeti, yıllık. OKX 2026-09 gözlemi:
   *  BTC ~%7, ETH ~%6, XAU ~%11, SPY ~%3, US100 ~%4, US500 ~%33 (!), CL çok değişken. */
  carryAnnual: number;
}

export const ASSETS: Record<AssetId, AssetDef> = {
  SPY: { id: "SPY", name: "S&P 500", yahoo: "SPY", eodhd: "SPY.US", venue: "OKX US500-USDT-SWAP / SPY-USDT-SWAP (swing) · ABD aracı kurumda SPY/VOO (çekirdek)", coreVenue: "ABD aracı kurum: VOO/SPY ETF · yalnız OKX: US500-USDT-SWAP 1x (fonlamayı izleyin)", costBps: 5, carryAnnual: 0.06 },
  QQQ: { id: "QQQ", name: "Nasdaq 100 (US100)", yahoo: "QQQ", eodhd: "QQQ.US", venue: "OKX US100-USDT-SWAP / QQQ-USDT-SWAP (swing) · ABD aracı kurumda QQQ/QQQM (çekirdek)", coreVenue: "ABD aracı kurum: QQQM/QQQ ETF · yalnız OKX: US100-USDT-SWAP 1x", costBps: 5, carryAnnual: 0.06 },
  GLD: { id: "GLD", name: "Altın", yahoo: "GLD", eodhd: "GLD.US", venue: "OKX XAUT-USDT / PAXG-USDT spot (çekirdek) · XAU-USDT-SWAP (swing)", coreVenue: "OKX spot: XAUT-USDT veya PAXG-USDT", costBps: 10, carryAnnual: 0.1 },
  BIST: { id: "BIST", name: "BIST 100 (USD)", yahoo: "XU100.IS", fxDivisor: "TRY=X", eodhd: "XU100.INDX", venue: "Banka: BIST 100/30 endeks fonu veya BYF (TL); değerlendirme USD bazlı", coreVenue: "Banka: BIST 100/30 endeks fonu veya BYF (TL)", costBps: 20, carryAnnual: 0.0 },
  BTC: { id: "BTC", name: "Bitcoin", yahoo: "BTC-USD", eodhd: "BTC-USD.CC", venue: "OKX BTC-USDT spot (çekirdek) · BTC-USDT-SWAP (swing/hedge)", coreVenue: "OKX spot: BTC-USDT (uzun vadede kendi cüzdanınız)", costBps: 10, carryAnnual: 0.1 },
  ETH: { id: "ETH", name: "Ethereum (altcoin vekili)", yahoo: "ETH-USD", eodhd: "ETH-USD.CC", venue: "OKX ETH-USDT spot + güçlü altcoin sepeti (bkz. sinyal raporu)", coreVenue: "OKX spot: ETH-USDT (+ radardaki en fazla 3 güçlü altcoin)", costBps: 10, carryAnnual: 0.1 },
  DBC: { id: "DBC", name: "Emtia sepeti", yahoo: "DBC", eodhd: "DBC.US", venue: "OKX CL-USDT-SWAP (petrol), XAG-USDT-SWAP (gümüş), NG (doğalgaz) — swing", coreVenue: "ABD aracı kurum: DBC/PDBC ETF · yalnız OKX: XAG (gümüş) spot/perp 1x", costBps: 10, carryAnnual: 0.06 },
};

export const ASSET_IDS = Object.keys(ASSETS) as AssetId[];

/** Stratejik (nötr) ağırlıklar. Büyüme ağırlıklı, kripto toplamı %20 ile sınırlı. */
export const STRATEGIC_WEIGHTS: Record<AssetId, number> = {
  SPY: 0.3,
  QQQ: 0.2,
  GLD: 0.15,
  BIST: 0.1,
  BTC: 0.15,
  ETH: 0.05,
  DBC: 0.05,
};

export const MACRO = {
  /** ABD TÜFE (FRED) — reel getiri hesabı için */
  cpi: "CPIAUCSL",
  /** 13 haftalık hazine bonosu faizi (yıllık %), nakit getirisi */
  tbillYahoo: "^IRX",
};

export const PLAN = {
  monthlyUsd: 1000,
  annualExtraUsd: 3500,
  /** Yıllık ek katkının yatırıldığı ay (1 = Ocak) */
  annualMonth: 1,
  targetRealReturn: 0.15,
  /** Finansal özgürlük: bugünün doları ile aylık harcama */
  monthlySpendingReal: 5000,
  /** Güvenli çekim oranı */
  safeWithdrawalRate: 0.04,
};

export const CORE = {
  smaMonths: 10,
  momentumMonths: 12,
  /** "blend": 0.5·[fiyat > SMA10] + 0.5·[12a getiri > nakit] — tek sinyale bağımlılığı azaltır */
  rule: "blend" as TrendRule,
  /**
   * Trend kapalıyken korunan stratejik ağırlık payı. 0.5 = Faber "Trinity" tarzı:
   * portföyün yarısı hep al-tut, yarısı trend kuralına göre nakde geçer.
   * NOT: İlk kayıtlı plan 0 idi; backtest sonrası 0.5'e geçildi (bkz. docs/SONUCLAR.md).
   */
  trendFloor: 0.5,
  /** Kaldıraçlı varyant: hedef portföy oynaklığı ve brüt üst sınır */
  volTarget: 0.16,
  maxGross: 1.5,
  /** Kaldıraç finansman maliyeti = hazine bonosu + bu marj */
  borrowSpread: 0.02,
  /** Uydu (swing) kolunun toplam portföydeki payı */
  swingSleeve: 0.2,
};

export type TrendRule = "none" | "sma10" | "tsmom12" | "blend";

export const SWING = {
  riskPerTrade: 0.01,
  maxLeverage: 1.0,
  /** Önceden kayıtlı (pre-registered) uydu kombinasyonları — sonuçlara bakılarak seçilmedi */
  sleeve: [
    { strategy: "rsi2", asset: "SPY" },
    { strategy: "rsi2", asset: "QQQ" },
    { strategy: "rsi2", asset: "GLD" },
    { strategy: "donchian", asset: "BTC" },
    { strategy: "donchian", asset: "ETH" },
    { strategy: "donchian", asset: "GLD" },
    { strategy: "donchian", asset: "DBC" },
  ] as { strategy: SwingStrategyId; asset: AssetId }[],
};

export type SwingStrategyId = "rsi2" | "donchian" | "sweep";

/**
 * Panelde ve aylık dağılımda sunulan üç strateji. Hepsi aynı stratejik ağırlıkları kullanır;
 * farkları trend filtresinin gücü ve swing kolunun payıdır.
 */
export type StrategyKey = "static" | "hybrid" | "main";

export interface StrategyDef {
  key: StrategyKey;
  name: string;
  /** Tek cümlelik özet */
  summary: string;
  /** Ayrıntılı açıklama (panel) */
  how: string;
  forWhom: string;
  risk: string;
  rule: TrendRule;
  /** Trend kapalıyken korunan pay (1 = hiç satmaz) */
  trendFloor: number;
  /** Swing kolu payı */
  sleeve: number;
}

export const STRATEGIES: Record<StrategyKey, StrategyDef> = {
  static: {
    key: "static",
    name: "Al-tut çoklu",
    summary: "Yedi varlık sabit ağırlıkla, her zaman yatırımda.",
    how: "Katkının tamamı her ay aynı sabit ağırlıklarla yedi varlığa gider. Hiçbir zaman nakde geçilmez, hiçbir şey hedge edilmez. Portföy ağırlıklardan saptıkça yeni katkı geride kalan kalemlere yönlendirilir; böylece satış yapmadan dengelenir.",
    forWhom: "−%40'lık düşüşlerde satmadan bekleyebilen, en yüksek uzun vadeli getiriyi isteyen.",
    risk: "En derin düşüş (20 yılda −%43). Getirinin yaklaşık yarısı kriptodan geldi; bu tekrar etmeyebilir.",
    rule: "none",
    trendFloor: 1,
    sleeve: 0,
  },
  hybrid: {
    key: "hybrid",
    name: "Hibrit",
    summary: "Her varlığın yarısı hep tutulur, yarısı trend kuralına göre nakde geçer.",
    how: "Faber'in 'Trinity' yaklaşımı. Bir varlığın ay sonu fiyatı 10 aylık ortalamasının altına düşerse ya da 12 aylık getirisi nakit faizinin altında kalırsa o varlığın trend yarısı nakde (T-bill / USDT Earn) geçer. İki sinyal de olumsuzsa tam yarısı, biri olumsuzsa çeyreği nakde geçer. Trend dönünce ay sonunda geri alınır.",
    forWhom: "Getirinin çoğunu korurken düşüşü yarıya indirmek isteyen. Getiri/risk dengesi en iyi seçeneklerden biri.",
    risk: "Hızlı V-dönüşlerde (Covid, kripto) geç kalır. 20 yılda maksimum düşüş −%28.",
    rule: "blend",
    trendFloor: 0.5,
    sleeve: 0,
  },
  main: {
    key: "main",
    name: "Ana plan",
    summary: "Hibrit çekirdek %80 + OKX'te swing sistemleri %20.",
    how: "Katkının %80'i Hibrit kurallarıyla çekirdeğe, %20'si OKX'teki swing kasasına (USDT teminat) gider. Swing kasası yalnız sinyal geldiğinde işlem açar: RSI(2) geri çekilme (S&P, Nasdaq, altın) ve Donchian 55/20 kırılım (BTC, ETH, altın, emtia). İşlem başına kasanın %1–2'si risk edilir.",
    forWhom: "En düşük düşüşü isteyen ve günlük swing sinyallerini takip edebilen.",
    risk: "En düşük düşüş (−%16 ile −%22) ve en yüksek Sharpe. Ancak swing kolu bu backtestlerde getiriyi ~2–3 puan düşürdü; disiplin ve zaman gerektirir.",
    rule: "blend",
    trendFloor: 0.5,
    sleeve: 0.2,
  },
};

export const STRATEGY_KEYS = Object.keys(STRATEGIES) as StrategyKey[];
