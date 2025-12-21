import { QualityGateConfig, StrategySettings, Timeframe } from '@/types';

export const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'TAOUSDT'];
export const DEFAULT_TIMEFRAME: Timeframe = '15m';
export const TIMEFRAMES: Timeframe[] = ['1m', '3m', '5m', '15m', '1H', '4H', 'D', 'W'];

export const DEFAULT_GATE: QualityGateConfig = {
  // Moderately permissive to avoid spam but still allow more setups than the initial strict config
  maxStopPct: 0.8,
  minRR: 1.4,
  atrPctMin: 0.05,
  atrPctMax: 1.6,
  requireFreshZone: false,
  cooldownBars: 4,
  scoreMin: 80,
  stopAtrMult: 1.1
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
  htfTimeframes: ['1H', '4H']
};

export const DEFAULT_ALERT_DEDUPE_MINUTES = 15;
