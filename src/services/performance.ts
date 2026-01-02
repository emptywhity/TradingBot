import { Candle, Signal } from '@/types';

export type TradeOutcome = 'tp1' | 'stop' | 'timeout' | 'open';

export type EvaluatedTrade = {
  signal: Signal;
  outcome: TradeOutcome;
  r: number; // profit in R (risk units), stop == -1, TP1 == +rr
  barsHeld: number;
};

export type ExecutionCosts = {
  feeBps: number;
  slippageBps: number;
};

export type PerformanceSummary = {
  totalSignals: number;
  evaluatedTrades: number;
  tp1: number;
  stop: number;
  timeout: number;
  open: number;
  winRateTp1: number | null; // tp1 / evaluatedTrades
  expectancyR: number | null; // avg R per evaluated trade
  avgWinR: number | null;
  avgLossR: number | null;
  profitFactor: number | null; // gross profit / gross loss
  maxDrawdownR: number | null;
  avgBarsHeld: number | null;
};

function firstIndexAtOrAfter(times: number[], ts: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = times[mid];
    if (v < ts) lo = mid + 1;
    else hi = mid - 1;
  }
  return lo;
}

export function evaluateSignal(
  signal: Signal,
  candles: Candle[],
  opts?: { maxHoldBars?: number; executionCosts?: ExecutionCosts }
): EvaluatedTrade {
  const maxHoldBars = Math.max(1, Math.floor(opts?.maxHoldBars ?? 60));
  const executionCosts = opts?.executionCosts;
  if (candles.length === 0) return { signal, outcome: 'open', r: 0, barsHeld: 0 };

  const times = candles.map((c) => c.time);
  const firstTime = times[0];
  const lastTime = times[times.length - 1];
  if (!Number.isFinite(signal.timestamp) || signal.timestamp < firstTime || signal.timestamp > lastTime) {
    // We don't have candles covering the signal time.
    return { signal, outcome: 'open', r: 0, barsHeld: 0 };
  }

  const startIdx = firstIndexAtOrAfter(times, signal.timestamp);
  const start = Math.min(startIdx, candles.length - 1);
  const endIdx = Math.min(candles.length - 1, start + maxHoldBars);
  const entry = signal.entry;
  const stop = signal.stop;
  const tp1 = signal.tp1;
  const risk = Math.abs(entry - stop);
  const isLong = signal.side === 'long';

  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop) || !Number.isFinite(tp1) || risk <= 0) {
    return { signal, outcome: 'open', r: 0, barsHeld: 0 };
  }

  // Evaluate from the next bar (entry is assumed at/after signal candle close).
  for (let i = start + 1; i <= endIdx; i += 1) {
    const c = candles[i];
    const stopHit = isLong ? c.low <= stop : c.high >= stop;
    const tpHit = isLong ? c.high >= tp1 : c.low <= tp1;
    // Conservative: if both hit within the same candle, assume stop first.
    if (stopHit) {
      const costR = costInR(entry, stop, risk, executionCosts);
      return { signal, outcome: 'stop', r: -1 - costR, barsHeld: i - start };
    }
    if (tpHit) {
      const costR = costInR(entry, tp1, risk, executionCosts);
      return { signal, outcome: 'tp1', r: signal.rr - costR, barsHeld: i - start };
    }
  }

  // Time-based exit: close at endIdx close.
  if (endIdx > start) {
    const exit = candles[endIdx].close;
    const move = isLong ? exit - entry : entry - exit;
    const costR = costInR(entry, exit, risk, executionCosts);
    const r = move / (risk || 1) - costR;
    return { signal, outcome: endIdx === candles.length - 1 ? 'open' : 'timeout', r, barsHeld: endIdx - start };
  }

  return { signal, outcome: 'open', r: 0, barsHeld: 0 };
}

export function summarizePerformance(
  signals: Signal[],
  candles: Candle[],
  opts?: { maxHoldBars?: number; executionCosts?: ExecutionCosts }
): PerformanceSummary {
  const maxHoldBars = opts?.maxHoldBars ?? 60;
  const sorted = [...signals].sort((a, b) => a.timestamp - b.timestamp);
  const evaluated: EvaluatedTrade[] = sorted.map((s) => evaluateSignal(s, candles, opts));

  const counts = { tp1: 0, stop: 0, timeout: 0, open: 0 };
  let grossProfit = 0;
  let grossLoss = 0;
  let sumR = 0;
  let sumBars = 0;
  let winsR: number[] = [];
  let lossesR: number[] = [];
  let equity = 0;
  let peak = 0;
  let maxDd = 0;

  for (const t of evaluated) {
    counts[t.outcome] += 1;
    if (t.outcome !== 'open') {
      sumR += t.r;
      sumBars += t.barsHeld;
      equity += t.r;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDd) maxDd = dd;

      if (t.r > 0) {
        grossProfit += t.r;
        winsR.push(t.r);
      } else if (t.r < 0) {
        grossLoss += Math.abs(t.r);
        lossesR.push(t.r);
      }
    }
  }

  const evaluatedTrades = evaluated.length - counts.open;
  const expectancyR = evaluatedTrades ? sumR / evaluatedTrades : null;
  const winRateTp1 = evaluatedTrades ? counts.tp1 / evaluatedTrades : null;

  return {
    totalSignals: signals.length,
    evaluatedTrades,
    tp1: counts.tp1,
    stop: counts.stop,
    timeout: counts.timeout,
    open: counts.open,
    winRateTp1,
    expectancyR,
    avgWinR: winsR.length ? winsR.reduce((a, b) => a + b, 0) / winsR.length : null,
    avgLossR: lossesR.length ? lossesR.reduce((a, b) => a + b, 0) / lossesR.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdownR: evaluatedTrades ? maxDd : null,
    avgBarsHeld: evaluatedTrades ? sumBars / evaluatedTrades : null
  };
}

function costInR(entry: number, exit: number, risk: number, costs?: ExecutionCosts): number {
  if (!costs) return 0;
  const feeBps = Number.isFinite(costs.feeBps) ? costs.feeBps : 0;
  const slippageBps = Number.isFinite(costs.slippageBps) ? costs.slippageBps : 0;
  const totalBps = feeBps + slippageBps;
  if (totalBps <= 0 || !Number.isFinite(entry) || !Number.isFinite(exit) || risk <= 0) return 0;
  const costAbs = (entry + exit) * (totalBps / 10000);
  return costAbs / risk;
}
