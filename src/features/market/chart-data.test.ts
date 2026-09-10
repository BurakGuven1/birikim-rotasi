import { expect, it } from "vitest";
import { prepareChartData } from "./chart-data";

it("keeps long histories and waits for full SMA periods", () => {
  const points = Array.from({ length: 700 }, (_, index) => ({ date: new Date(Date.UTC(2020, 0, index + 1)).toISOString(), close: index + 1 }));
  const data = prepareChartData(points, false);
  expect(data.bars).toHaveLength(700);
  expect(data.sma200[0]).toEqual({ time: "2020-07-18", value: 100.5 });
  expect(prepareChartData(points.slice(0, 20), false).sma40).toHaveLength(0);
  expect(prepareChartData(points.slice(0, 100), false).sma200).toHaveLength(0);
});

it("sorts and deduplicates bar times and excludes invalid prices", () => {
  const data = prepareChartData([{ date: "2026-01-02", close: 2 }, { date: "bad", close: 3 }, { date: "2026-01-01", close: 1 }, { date: "2026-01-02", close: 4 }, { date: "2026-01-03", close: NaN }], false);
  expect(data.bars.map(p => p.close)).toEqual([1, 4]);
});
