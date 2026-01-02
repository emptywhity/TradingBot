import { Candle, Signal, Timeframe } from '@/types';
import { DataSource } from '@/store/useMarketStore';
import { ExecutionCosts, evaluateSignal } from '@/services/performance';

export type AutoMuteDecision = {
  muted: boolean;
  evaluatedTrades: number;
  expectancyR: number | null;
  windowLabel: string;
  reason: string;
};

export function computeAutoMuteDecision(params: {
  symbol: string;
  timeframe: Timeframe;
  dataSource: DataSource;
  gateMode: 'default' | 'aggressive' | 'conservative';
  signals: Signal[];
  candles: Candle[];
  maxHoldBars?: number;
  windowTrades?: number;
  minTradesToDecide?: number;
  executionCosts?: ExecutionCosts;
}): AutoMuteDecision {
  const {
    symbol,
    timeframe,
    dataSource,
    gateMode,
    signals,
    candles,
    maxHoldBars = 60,
    windowTrades = 20,
    minTradesToDecide = 20,
    executionCosts
  } = params;

  const scoped = signals
    .filter((s) => s.symbol === symbol && s.timeframe === timeframe)
    .filter((s) => (s.dataSource ?? 'futures') === dataSource)
    .filter((s) => (s.gateMode ?? 'default') === gateMode)
    .sort((a, b) => a.timestamp - b.timestamp);

  const evaluated = scoped
    .map((s) => evaluateSignal(s, candles, { maxHoldBars, executionCosts }))
    .filter((t) => t.outcome !== 'open')
    .slice(-windowTrades);

  const windowLabel = `last ${windowTrades} trades`;

  if (evaluated.length < minTradesToDecide) {
    return {
      muted: false,
      evaluatedTrades: evaluated.length,
      expectancyR: null,
      windowLabel,
      reason: `Not enough trades to decide (${evaluated.length}/${minTradesToDecide}).`
    };
  }

  const expectancy = evaluated.reduce((acc, t) => acc + t.r, 0) / evaluated.length;
  const muted = expectancy < 0;
  return {
    muted,
    evaluatedTrades: evaluated.length,
    expectancyR: expectancy,
    windowLabel,
    reason: muted ? `Negative expectancy (${expectancy.toFixed(2)}R) over ${windowLabel}.` : `Expectancy ${expectancy.toFixed(2)}R over ${windowLabel}.`
  };
}

