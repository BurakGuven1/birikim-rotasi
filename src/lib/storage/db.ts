import Dexie, { type EntityTable } from "dexie";
import type { Transaction } from "../domain/types";

export interface SettingRow { key: string; value: unknown }

class InvestmentDatabase extends Dexie {
  transactions!: EntityTable<Transaction, "id">;
  settings!: EntityTable<SettingRow, "key">;

  constructor() {
    super("birikim-rotasi");
    this.version(1).stores({
      transactions: "id, date, symbol, assetClass, type",
      settings: "key",
    });
  }
}

export const investmentDb = typeof window === "undefined" ? null : new InvestmentDatabase();
