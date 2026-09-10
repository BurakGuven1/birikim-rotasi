export function realReturn(nominal: number, inflation: number, fxDepreciation = 0) {
  return (1 + nominal) * (1 + fxDepreciation) / (1 + inflation) - 1;
}

export interface ProjectionInput { monthlyUsd: number; initialUsd: number; years: number; nominalReturn: number; usInflation: number; trInflation: number; fxDepreciation: number; usdTry?: number; startDate?: string; annualUsd?: number; annualMonth?: number; firstAnnualYear?: number }

export function projectInvestment(input: ProjectionInput) {
  const { monthlyUsd, initialUsd, years, nominalReturn, usInflation, trInflation, fxDepreciation, usdTry } = input;
  if (Object.entries(input).some(([k,v]) => k !== "startDate" && v !== undefined && !Number.isFinite(v)) || !Number.isInteger(years) || years < 1 || years > 40 || monthlyUsd < 0 || initialUsd < 0 || [nominalReturn, usInflation, trInflation, fxDepreciation].some(v => v <= -1)) throw new Error("Geçersiz senaryo varsayımı.");
  const start = new Date(`${input.startDate ?? "2026-12-05"}T00:00:00Z`);
  const annualUsd = input.annualUsd ?? 0, annualMonth = input.annualMonth ?? 4;
  if (!Number.isFinite(start.getTime()) || annualUsd < 0 || !Number.isInteger(annualMonth) || annualMonth < 1 || annualMonth > 12) throw new Error("Geçersiz katkı takvimi.");
  const monthlyRate = (1 + nominalReturn) ** (1 / 12) - 1;
  let balance = initialUsd;
  let contributedUsd = initialUsd, realContributedUsd = initialUsd;
  const rows = [{ year: 0, contributedUsd, realContributedUsd, nominalUsd: balance, realUsd: balance, realTry: usdTry ? balance * usdTry : null }];
  for (let month = 1; month <= years * 12; month++) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month - 1, 1));
    const extra = date.getUTCMonth() + 1 === annualMonth && date.getUTCFullYear() >= (input.firstAnnualYear ?? start.getUTCFullYear()) ? annualUsd : 0;
    const contribution = monthlyUsd + extra;
    contributedUsd += contribution;
    realContributedUsd += contribution / (1 + usInflation) ** ((month - 1) / 12);
    balance = (balance + contribution) * (1 + monthlyRate);
    if (month % 12 === 0) {
      const year = month / 12;
      rows.push({ year, contributedUsd, realContributedUsd, nominalUsd: balance, realUsd: balance / (1 + usInflation) ** year, realTry: usdTry ? balance * usdTry * (1 + fxDepreciation) ** year / (1 + trInflation) ** year : null });
    }
  }
  return rows;
}
