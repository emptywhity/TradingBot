import { QualityGateConfig, StrategySettings, Timeframe } from '@/types';

export const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'TAOUSDT'];
export const FREE_SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
export const DEFAULT_TIMEFRAME: Timeframe = '15m';
export const TIMEFRAMES: Timeframe[] = ['1m', '3m', '5m', '15m', '1H', '4H', 'D', 'W'];

export const DEFAULT_GATE: QualityGateConfig = {
  // Stricter by default to prioritize hit rate over frequency.
  maxStopPct: 0.6,
  minRR: 1.6,
  atrPctMin: 0.06,
  atrPctMax: 1.2,
  requireFreshZone: true,
  cooldownBars: 6,
  scoreMin: 86,
  stopAtrMult: 1.2
};

export const DEFAULT_STRATEGY: StrategySettings = {
  atrPeriod: 14,
  emaPeriod: 200,
  adxPeriod: 14,
  bbPeriod: 20,
  zoneAtrMult: 1.0,
  pivotLeft: 3,
  pivotRight: 3,
  donchianPeriod: 25,
  minBandwidth: 0.06,
  enableSqueeze: true,
  htfTimeframes: ['1H', '4H'],
  rangeLookback: 240,
  rangeLow: 0.2,
  rangeHigh: 0.8
};

export const DEFAULT_ALERT_DEDUPE_MINUTES = 15;
