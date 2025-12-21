import { Candle, Signal } from '@/types';

export type TradePlanEvent =
  | {
      type: 'tp';
      time: number;
      tpFrom: number;
      tpTo: number;
      label: string;
    }
  | {
      type: 'stop';
      time: number;
      label: 'STOP';
    }
  | {
      type: 'exit';
      time: number;
      label: 'EXIT';
    };

export type TradePlanResult = {
  risk: number;
  targets: Array<{ r: number; price: number }>;
  tpsHit: number;
  status: 'open' | 'stop' | 'exit';
  events: TradePlanEvent[];
};

export function computeRTargets(signal: Signal, tpMultipliers: number[] = [1, 2, 3, 4]): Array<{ r: number; price: number }> {
  if (!Number.isFinite(signal.entry) || !Number.isFinite(signal.stop)) return [];
  const risk = Math.abs(signal.entry - signal.stop);
  if (!Number.isFinite(risk) || risk <= 0) return [];
  const isLong = signal.side === 'long';
  return tpMultipliers.map((r) => ({
    r,
    price: isLong ? signal.entry + risk * r : signal.entry - risk * r
  }));
}

export function simulateTradePlan(
  signal: Signal,
  candles: Candle[],
  opts?: {
    emaValues?: number[];
    tpMultipliers?: number[];
    confirmBars?: number;
    maxHoldBars?: number;
    requireTpForExit?: boolean;
  }
): TradePlanResult {
  const tpMultipliers = opts?.tpMultipliers ?? [1, 2, 3, 4];
  const confirmBars = Math.max(1, Math.floor(opts?.confirmBars ?? 2));
  const maxHoldBars = Math.max(1, Math.floor(opts?.maxHoldBars ?? 240));
  const requireTpForExit = opts?.requireTpForExit ?? true;
  const emaValues = opts?.emaValues;

  const entry = signal.entry;
  const stop = signal.stop;
  const risk = Math.abs(entry - stop);
  const targets = computeRTargets(signal, tpMultipliers);

  if (!candles.length || !Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(risk) || risk <= 0) {
    return { risk: Number.isFinite(risk) ? risk : 0, targets, tpsHit: 0, status: 'open', events: [] };
  }

  const isLong = signal.side === 'long';
  const entryIdx = candles.findIndex((c) => c.time >= signal.timestamp);
  if (entryIdx < 0 || entryIdx >= candles.length - 1) {
    return { risk, targets, tpsHit: 0, status: 'open', events: [] };
  }

  const targetPrices = targets.map((t) => t.price);
  const events: TradePlanEvent[] = [];

  let nextTargetIdx = 0;
  let tpsHit = 0;
  let trendViolations = 0;
  let lastTpIndex = -1;
  let status: TradePlanResult['status'] = 'open';

  const end = Math.min(candles.length - 1, entryIdx + maxHoldBars);
  for (let i = entryIdx + 1; i <= end; i += 1) {
    const c = candles[i];
    const stopHit = isLong ? c.low <= stop : c.high >= stop;
    if (stopHit) {
      events.push({ type: 'stop', time: c.time, label: 'STOP' });
      status = 'stop';
      break;
    }

    let hitCount = 0;
    while (nextTargetIdx < targetPrices.length) {
      const target = targetPrices[nextTargetIdx];
      const hit = isLong ? c.high >= target : c.low <= target;
      if (!hit) break;
      hitCount += 1;
      nextTargetIdx += 1;
    }

    if (hitCount > 0) {
      const prev = tpsHit;
      tpsHit += hitCount;
      lastTpIndex = i;
      const label = hitCount === 1 ? `TP${tpsHit}` : `TP${prev + 1}-TP${tpsHit}`;
      events.push({
        type: 'tp',
        time: c.time,
        tpFrom: prev + 1,
        tpTo: tpsHit,
        label
      });
    }

    if (requireTpForExit && tpsHit === 0) continue;
    if (!emaValues || !Number.isFinite(emaValues[i])) continue;

    const emaVal = emaValues[i];
    const trendOk = isLong ? c.close >= emaVal : c.close <= emaVal;
    trendViolations = trendOk ? 0 : trendViolations + 1;

    // Don't EXIT on the same bar as the latest TP marker.
    if (trendViolations >= confirmBars && i > lastTpIndex) {
      events.push({ type: 'exit', time: c.time, label: 'EXIT' });
      status = 'exit';
      break;
    }
  }

  return { risk, targets, tpsHit, status, events };
}

