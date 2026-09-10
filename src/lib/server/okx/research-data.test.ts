import { describe, expect, it } from 'vitest';
import { OkxClient } from './client';
import { parseFundingRates, mapFundingMarks, requireCandleCoverage, loadResearchData } from './research-data';
const reply = (data: unknown[]) => new Response(JSON.stringify({ code: '0', data }));
describe('public research data', () => {
  it('preserves explicit zero realized funding, rejects missing and future rates, never invents mark prices', () => {
    const rates = parseFundingRates([
      { fundingTime: '900000', realizedRate: '0', fundingRate: '0.1' },
      { fundingTime: '1800000', realizedRate: '', fundingRate: '-0.001' },
      { fundingTime: '2700000', realizedRate: '', fundingRate: '' },
      { fundingTime: '3600000', realizedRate: '0.001' },
    ], 0, 2700000);
    expect(rates).toEqual([{ time: 900000, rate: 0 }, { time: 1800000, rate: -0.001 }]);
    const mapped = mapFundingMarks(rates, [['900000','100','102','99','101','1'],['1800000','100','102','99','101','0']]);
    expect(mapped).toEqual({ funding: [{ time: 900000, rate: 0, markPrice: 100 }], complete: false });
    expect(mapFundingMarks([], []).complete).toBe(false);
  });
  it('rejects an OHLC gap and missing range boundary instead of silently truncating', () => {
    const candle = (time: number) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 });
    expect(() => requireCandleCoverage([candle(0), candle(1800000)], 0, 1800000, '15m')).toThrow('ohlc_coverage_15m');
    expect(() => requireCandleCoverage([candle(900000), candle(1800000)], 0, 1800000, '15m')).toThrow('ohlc_coverage_15m');
    expect(() => requireCandleCoverage([candle(0), candle(900000), candle(1800000)], 0, 1800000, '15m')).not.toThrow();
  });
  it('loads UTC warmups using exchange clock and explicitly reports absent funding', async () => {
    const server = Date.UTC(2026, 4, 4, 12);
    const from = server - 86400000;
    const requests: string[] = [];
    const client = new OkxClient({ mode: 'public', env: {}, fetch: async (url) => {
      const parsed = new URL(String(url)); requests.push(parsed.pathname);
      if (parsed.pathname.endsWith('/time')) return reply([{ ts: String(server) }]);
      if (parsed.pathname.endsWith('/funding-rate-history')) return reply([]);
      const interval = parsed.searchParams.get('bar')!;
      const duration = { '15m': 900000, '1H': 3600000, '4H': 14400000, '1Dutc': 86400000, '1Wutc': 604800000 }[interval]!;
      const offset = interval === '1Wutc' ? 345600000 : 0;
      const cursor = Number(parsed.searchParams.get('after'));
      const newest = Math.floor((Math.min(cursor - 1, server - duration) - offset) / duration) * duration + offset;
      return reply(Array.from({ length: 100 }, (_, index) => [String(newest - index * duration),'100','102','99','101','10','1','101','1']));
    } });
    const result = await loadResearchData(client, 'BTC-USDT-SWAP', { from, to: server + 86400000, cache: false });
    expect(result.frames['15m'].at(-1)!.time + 900000).toBe(server);
    expect(result.frames.bias!.daily.length).toBeGreaterThanOrEqual(80);
    expect(result.frames.bias!.weekly.length).toBeGreaterThanOrEqual(60);
    expect(result.fundingComplete).toBe(false);
    expect(result.warnings).toContain('requested_end_clamped_to_okx_server_time');
    expect(result.warnings).toContain('funding_history_incomplete');
    expect(requests.every((path) => path.startsWith('/api/v5/public/') || path.startsWith('/api/v5/market/'))).toBe(true);
  });
});
