import { earnReserveSchema, EMPTY_EARN_RESERVE, reserveSummary, type EarnReserveState } from "../domain/earn-reserve";
import { investmentDb } from "./db";

export const earnRepository = {
  async get(): Promise<EarnReserveState> {
    const row = investmentDb ? await investmentDb.settings.get("earn-reserve-v1") : undefined;
    return row ? earnReserveSchema.parse(row.value) : structuredClone(EMPTY_EARN_RESERVE);
  },
  async save(value: EarnReserveState) {
    if (!investmentDb) throw new Error("Yerel depolama kullanılamıyor.");
    const state = earnReserveSchema.parse(value);
    reserveSummary(state);
    await investmentDb.settings.put({ key: "earn-reserve-v1", value: state });
    return state;
  },
};
