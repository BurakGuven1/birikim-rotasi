import { afterEach, describe, expect, it, vi } from "vitest";
import { massiveProvider } from "./massive";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("massiveProvider", () => {
  it("pages aggregate history and only follows Massive next URLs", async () => {
    vi.stubEnv("MASSIVE_API_KEY", "secret-key");
    vi.stubEnv("MASSIVE_REQUESTS_PER_MINUTE", "1000");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input); calls.push(url);
      if (calls.length === 1) return new Response(JSON.stringify({ results: [{ t: 1_700_000_000_000, o: 1, h: 3, l: 1, c: 2, v: 10 }], next_url: "https://api.massive.com/v2/aggs/ticker/VTI/range/1/day/next" }));
      return new Response(JSON.stringify({ results: [{ t: 1_700_086_400_000, o: 2, h: 4, l: 2, c: 3, v: 11 }] }));
    });

    const points = await massiveProvider.getHistory("VTI", "1y");

    expect(points.map(point => point.close)).toEqual([2, 3]);
    expect(calls).toHaveLength(2);
    expect(calls.join(" ")).not.toContain("secret-key");
  });

  it("rejects an aggregate next URL on another host", async () => {
    vi.stubEnv("MASSIVE_API_KEY", "secret-key");
    vi.stubEnv("MASSIVE_REQUESTS_PER_MINUTE", "1000");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ results: [], next_url: "https://example.com/steal" })));
    await expect(massiveProvider.getHistory("IAU", "1y")).rejects.toThrow("host");
  });
});
