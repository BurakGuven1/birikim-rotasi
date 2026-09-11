import Dexie, { type EntityTable } from "dexie";
import type { TacticalTrade, Transaction } from "../domain/types";

export interface SettingRow { key: string; value: unknown }

class InvestmentDatabase extends Dexie {
  transactions!: EntityTable<Transaction, "id">;
  settings!: EntityTable<SettingRow, "key">;
  tacticalTrades!: EntityTable<TacticalTrade, "id">;

  constructor() {
    super("birikim-rotasi");
    this.version(1).stores({
      transactions: "id, date, symbol, assetClass, type",
      settings: "key",
    });
    this.version(2).stores({
      transactions: "id, date, symbol, assetClass, type",
      settings: "key",
      tacticalTrades: "id, status, symbol, openedAt, closedAt",
    });
  }
}

export const investmentDb = typeof window === "undefined" ? null : new InvestmentDatabase();
