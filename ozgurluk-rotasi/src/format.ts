export const pct = (x: number, d = 1): string => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "—");
export const num = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : "—");
export const usd = (x: number): string =>
  Number.isFinite(x) ? "$" + Math.round(x).toLocaleString("en-US") : "—";

export function mdTable(head: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}
