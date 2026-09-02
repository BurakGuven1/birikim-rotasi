import { ALLOCATION_CONSTRAINTS, ASSET_CLASSES, ASSET_LABELS, MONTHLY_TURNOVER_CAP, NEUTRAL_WEIGHTS } from "./config";
import type { AllocationResult, AssetClassRecord } from "./types";

interface AllocationInput {
  monthlyBudget: number;
  signals: AssetClassRecord;
  confidence: AssetClassRecord;
  currentWeights?: AssetClassRecord;
  previousWeights?: AssetClassRecord;
  generatedAt?: string;
}

interface HybridAllocationInput extends AllocationInput {
  balancedWeights: AssetClassRecord;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function normalizeWithinBounds(
  requested: AssetClassRecord,
  minimums: AssetClassRecord,
  maximums: AssetClassRecord,
): AssetClassRecord {
  const result = Object.fromEntries(
    ASSET_CLASSES.map((assetClass) => [assetClass, clamp(requested[assetClass], minimums[assetClass], maximums[assetClass])]),
  ) as AssetClassRecord;

  for (let pass = 0; pass < 12; pass += 1) {
    const total = ASSET_CLASSES.reduce((sum, assetClass) => sum + result[assetClass], 0);
    const gap = 1 - total;
    if (Math.abs(gap) < 1e-10) break;
    const capacities = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [
      assetClass,
      gap > 0 ? maximums[assetClass] - result[assetClass] : result[assetClass] - minimums[assetClass],
    ])) as AssetClassRecord;
    const capacity = ASSET_CLASSES.reduce((sum, assetClass) => sum + Math.max(0, capacities[assetClass]), 0);
    if (capacity <= 1e-12) throw new Error("Ağırlık sınırları toplam yüzde 100 dağılıma izin vermiyor.");
    ASSET_CLASSES.forEach((assetClass) => {
      const share = Math.max(0, capacities[assetClass]) / capacity;
      result[assetClass] = clamp(result[assetClass] + gap * share, minimums[assetClass], maximums[assetClass]);
    });
  }
  return result;
}

export function normalizeAllocationWeights(requested: AssetClassRecord): AssetClassRecord {
  const minimums = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, ALLOCATION_CONSTRAINTS[assetClass].min])) as AssetClassRecord;
  const maximums = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, ALLOCATION_CONSTRAINTS[assetClass].max])) as AssetClassRecord;
  return normalizeWithinBounds(requested, minimums, maximums);
}

export function averageAllocationWeights(weights: AssetClassRecord[]): AssetClassRecord {
  if (weights.length === 0) return { ...NEUTRAL_WEIGHTS };
  return Object.fromEntries(ASSET_CLASSES.map((assetClass) => [
    assetClass,
    Number((weights.reduce((sum, current) => sum + current[assetClass], 0) / weights.length).toFixed(6)),
  ])) as AssetClassRecord;
}

export function blendAllocationWeights(
  balanced: AssetClassRecord,
  dynamic: AssetClassRecord,
  dynamicShare = 0.3,
): AssetClassRecord {
  const share = clamp(dynamicShare, 0, 1);
  const requested = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [
    assetClass,
    balanced[assetClass] * (1 - share) + dynamic[assetClass] * share,
  ])) as AssetClassRecord;
  return normalizeAllocationWeights(requested);
}

export function buildAllocation(input: AllocationInput): AllocationResult {
  if (!Number.isFinite(input.monthlyBudget) || input.monthlyBudget <= 0) {
    throw new Error("Aylık yatırım tutarı sıfırdan büyük olmalı.");
  }
  const requested = {} as AssetClassRecord;
  const minimums = {} as AssetClassRecord;
  const maximums = {} as AssetClassRecord;

  ASSET_CLASSES.forEach((assetClass) => {
    const rule = ALLOCATION_CONSTRAINTS[assetClass];
    const signal = clamp(input.signals[assetClass], -1, 1);
    const confidence = clamp(input.confidence[assetClass], 0, 1);
    const portfolioCorrection = input.currentWeights
      ? (rule.neutral - input.currentWeights[assetClass]) * 0.35
      : 0;
    requested[assetClass] = rule.neutral + signal * rule.sensitivity * confidence + portfolioCorrection;
    minimums[assetClass] = input.previousWeights
      ? Math.max(rule.min, input.previousWeights[assetClass] - MONTHLY_TURNOVER_CAP)
      : rule.min;
    maximums[assetClass] = input.previousWeights
      ? Math.min(rule.max, input.previousWeights[assetClass] + MONTHLY_TURNOVER_CAP)
      : rule.max;
  });

  const weights = normalizeWithinBounds(requested, minimums, maximums);
  const roundedAmounts = ASSET_CLASSES.map((assetClass) => Math.round(input.monthlyBudget * weights[assetClass]));
  roundedAmounts[0] += input.monthlyBudget - roundedAmounts.reduce((sum, value) => sum + value, 0);

  const displayWeights = ASSET_CLASSES.map((assetClass) => Number(weights[assetClass].toFixed(6)));
  displayWeights[displayWeights.length - 1] = Number(
    (1 - displayWeights.slice(0, -1).reduce((sum, value) => sum + value, 0)).toFixed(6),
  );

  const items = ASSET_CLASSES.map((assetClass, index) => {
    const signal = clamp(input.signals[assetClass], -1, 1);
    const confidence = clamp(input.confidence[assetClass], 0, 1);
    const direction = weights[assetClass] > NEUTRAL_WEIGHTS[assetClass] + 0.005
      ? "nötr oranın üzerinde"
      : weights[assetClass] < NEUTRAL_WEIGHTS[assetClass] - 0.005
        ? "nötr oranın altında"
        : "nötr orana yakın";
    return {
      assetClass,
      label: ASSET_LABELS[assetClass],
      weight: displayWeights[index],
      neutralWeight: NEUTRAL_WEIGHTS[assetClass],
      amount: roundedAmounts[index],
      signal,
      confidence,
      explanation: `Sinyal ${signal.toFixed(2)}, veri güveni %${Math.round(confidence * 100)}; sonuç ${direction}.`,
    };
  });

  return {
    monthlyBudget: input.monthlyBudget,
    items,
    confidence: ASSET_CLASSES.reduce((sum, key) => sum + clamp(input.confidence[key], 0, 1), 0) / ASSET_CLASSES.length,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

export function buildHybridAllocation(input: HybridAllocationInput): AllocationResult & {
  balancedWeights: AssetClassRecord;
  dynamicWeights: AssetClassRecord;
} {
  const dynamic = buildAllocation(input);
  const dynamicWeights = Object.fromEntries(dynamic.items.map((item) => [item.assetClass, item.weight])) as AssetClassRecord;
  const blended = blendAllocationWeights(input.balancedWeights, dynamicWeights);
  const displayWeights = ASSET_CLASSES.map((assetClass) => Number(blended[assetClass].toFixed(6)));
  displayWeights[displayWeights.length - 1] = Number((1 - displayWeights.slice(0, -1).reduce((sum, value) => sum + value, 0)).toFixed(6));
  const amounts = displayWeights.map((weight) => Math.round(input.monthlyBudget * weight));
  amounts[0] += input.monthlyBudget - amounts.reduce((sum, value) => sum + value, 0);
  return {
    ...dynamic,
    items: dynamic.items.map((item, index) => ({ ...item, weight: displayWeights[index], amount: amounts[index] })),
    balancedWeights: input.balancedWeights,
    dynamicWeights,
  };
}
