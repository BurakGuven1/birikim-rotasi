import type { TacticalSetup } from "../domain/tactical";
import type { TacticalTrade } from "../domain/types";
import { investmentDb } from "./db";

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const requireDb = () => {
  if (!investmentDb) throw new Error("Yerel işlem günlüğü yalnızca tarayıcıda kullanılabilir.");
  return investmentDb;
};

export function createPlannedTrade(setup: TacticalSetup, id = crypto.randomUUID(), now = new Date()): TacticalTrade {
  if (setup.action !== "long") throw new Error("Yalnızca geçerli long kurulumu günlüğe eklenebilir.");
  if (!Number.isFinite(Date.parse(setup.expiresAt)) || Date.parse(setup.expiresAt) <= now.getTime() || !Number.isFinite(Date.parse(setup.generatedAt)) || Date.parse(setup.generatedAt) > now.getTime()) throw new Error("Sinyalin zamanı geçersiz veya süresi doldu; yeniden hesapla.");
  if (!Number.isFinite(setup.positionSizeUsd) || setup.positionSizeUsd <= 0) throw new Error("Gerçek sermaye üzerinden pozisyon büyüklüğü gerekli.");
  return {
    id,
    setupId: setup.id,
    symbol: setup.symbol,
    name: setup.name,
    status: "planned",
    plannedAt: now.toISOString(),
    plannedEntry: roundMoney((setup.entryZone[0] + setup.entryZone[1]) / 2),
    invalidation: setup.invalidation,
    targets: [...setup.targetZones],
    plannedSizeUsd: setup.positionSizeUsd,
    setupSnapshot: JSON.stringify(setup),
  };
}

export function openTacticalTrade(trade: TacticalTrade, actualEntry: number, openedAt = new Date().toISOString()): TacticalTrade {
  if (trade.status !== "planned") throw new Error("Yalnızca planlanmış işlem açılabilir.");
  if (!Number.isFinite(actualEntry) || actualEntry <= 0) throw new Error("Gerçekleşen giriş fiyatı sıfırdan büyük olmalı.");
  return { ...trade, status: "open", actualEntry, openedAt };
}

export function closeTacticalTrade(trade: TacticalTrade, actualExit: number, closedAt = new Date().toISOString()): TacticalTrade {
  if (trade.status !== "open" || !trade.actualEntry) throw new Error("Yalnızca açık işlem kapatılabilir.");
  if (!Number.isFinite(actualExit) || actualExit <= 0) throw new Error("Gerçekleşen çıkış fiyatı sıfırdan büyük olmalı.");
  const units = trade.plannedSizeUsd / trade.actualEntry;
  const realizedPnlUsd = roundMoney(units * (actualExit - trade.actualEntry));
  return { ...trade, status: "closed", actualExit, closedAt, realizedPnlUsd };
}

export const tacticalTradeRepository = {
  list: async () => (await requireDb().tacticalTrades.toArray()).sort((a, b) => b.plannedAt.localeCompare(a.plannedAt)),
  add: (trade: TacticalTrade) => requireDb().tacticalTrades.add(trade),
  update: (trade: TacticalTrade) => requireDb().tacticalTrades.put(trade),
  remove: (id: string) => requireDb().tacticalTrades.delete(id),
};
