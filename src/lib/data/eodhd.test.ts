import { afterEach, expect, it, vi } from "vitest";
import { eodhdProvider } from "./eodhd";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("labels BIST prices in TRY rather than inflating their USD portfolio value", async () => {
  vi.stubEnv("EODHD_API_KEY", "fixture-key");
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ close: 12000, timestamp: Date.now() / 1000 })));
  expect((await eodhdProvider.getQuote("BIST100")).currency).toBe("TRY");
});
it("rejects prices with missing exchange timestamps", async () => {
  vi.stubEnv("EODHD_API_KEY", "fixture-key");
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ close: 100 })));
  await expect(eodhdProvider.getQuote("VTI")).rejects.toThrow();
});
