import { afterEach, describe, expect, it, vi } from "vitest";
import { getFredMacroIndicators, getFredSeries } from "./fred";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("FRED authenticated data", () => {
  it("uses the official JSON API when a key is configured", async () => {
    vi.stubEnv("FRED_API_KEY", "test-fred-key");
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.startsWith("https://api.stlouisfed.org/fred/series/observations")) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ observations: [
        { date: "2026-07-01", value: "21945.2" },
        { date: "2026-08-01", value: "." },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const points = await getFredSeries("M2SL");

    expect(points).toEqual([{ date: "2026-07-01T00:00:00Z", close: 21945.2 }]);
  });

  it("builds M2, inflation and real-yield dashboard indicators", async () => {
    vi.stubEnv("FRED_API_KEY", "test-fred-key");
    const fixtures: Record<string, Array<{ date: string; value: string }>> = {
      M2SL: [{ date: "2025-08-01", value: "20000" }, { date: "2026-08-01", value: "22000" }],
      CPIAUCSL: [{ date: "2025-08-01", value: "300" }, { date: "2026-08-01", value: "330" }],
      DFII10: [{ date: "2025-09-01", value: "1.1" }, { date: "2026-09-01", value: "1.8" }],
    };
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const seriesId = new URL(String(input)).searchParams.get("series_id") ?? "";
      return new Response(JSON.stringify({ observations: fixtures[seriesId] }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const indicators = await getFredMacroIndicators();

    expect(indicators).toEqual([
      expect.objectContaining({ id: "M2SL", value: 22000, change: 0.1, unit: "Milyar $", source: "FRED API" }),
      expect.objectContaining({ id: "CPIAUCSL", value: 330, change: 0.1, unit: "Endeks", source: "FRED API" }),
      expect.objectContaining({ id: "DFII10", value: 1.8, change: 0.7, unit: "%", source: "FRED API" }),
    ]);
  });
});
