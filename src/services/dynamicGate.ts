import { atr } from '@/utils/indicators';
import { Candle, QualityGateConfig } from '@/types';

export type DynamicGateInfo = {
  atrMedianPct: number;
  atrCurrentPct: number;
  ratio: number;
  lookback: number;
};

export function buildDynamicGate(params: {
  candles: Candle[];
  baseGate: QualityGateConfig;
  atrPeriod: number;
  lookback?: number;
  enabled?: boolean;
}): { gate: QualityGateConfig; info?: DynamicGateInfo } {
  const { candles, baseGate, atrPeriod, lookback = 200, enabled = true } = params;
  if (!enabled) return { gate: baseGate };
  if (candles.length < Math.min(80, lookback)) return { gate: baseGate };

  const atrValues = atr(candles, atrPeriod);
  const atrPctSeries: number[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const a = atrValues[i];
    if (!Number.isFinite(a) || !Number.isFinite(c.close) || c.close <= 0) continue;
    atrPctSeries.push((a / c.close) * 100);
  }

  const recent = atrPctSeries.filter(Number.isFinite).slice(-lookback);
  if (recent.length < Math.min(50, Math.floor(lookback / 2))) return { gate: baseGate };

  const atrMedian = median(recent);
  const atrCurrent = recent[recent.length - 1] ?? atrMedian;
  const baseMid = (baseGate.atrPctMin + baseGate.atrPctMax) / 2;
  if (!Number.isFinite(baseMid) || baseMid <= 0) return { gate: baseGate };

  const ratio = clamp(atrMedian / baseMid, 0.6, 1.6);

  let atrPctMin = clamp(baseGate.atrPctMin * ratio, 0.01, 10);
  let atrPctMax = clamp(baseGate.atrPctMax * ratio, 0.02, 20);
  if (atrPctMax < atrPctMin) atrPctMax = atrPctMin * 1.1;

  const maxStopPct = clamp(baseGate.maxStopPct * ratio, baseGate.maxStopPct * 0.6, baseGate.maxStopPct * 2);
  const stopAtrMult = clamp(baseGate.stopAtrMult * ratio, baseGate.stopAtrMult * 0.6, baseGate.stopAtrMult * 2);
  const minRR = clamp(baseGate.minRR * (ratio >= 1 ? 1.05 : 0.95), baseGate.minRR * 0.8, baseGate.minRR * 1.2);

  return {
    gate: { ...baseGate, atrPctMin, atrPctMax, maxStopPct, stopAtrMult, minRR },
    info: { atrMedianPct: atrMedian, atrCurrentPct: atrCurrent, ratio, lookback }
  };
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
