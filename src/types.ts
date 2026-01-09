export type Timeframe = '1m' | '3m' | '5m' | '15m' | '1H' | '4H' | 'D' | 'W';

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  last: number;
  change24h: number;
  bid: number;
  ask: number;
  timestamp: number;
}

export interface OrderBookEntry {
  price: number;
  size: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: number;
}

export type ZoneType = 'supply' | 'demand';

export interface SupplyDemandZone {
  id: string;
  type: ZoneType;
  startTime: number;
  endTime?: number;
  top: number;
  bottom: number;
  fresh: boolean;
  mitigated: boolean;
  pivotIndex: number;
  lastTouch?: number;
}

export type SignalSide = 'long' | 'short';

export interface Signal {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  side: SignalSide;
  entry: number;
  stop: number;
  tp1: number;
  rr: number;
  score: number;
  reasons: string[];
  timestamp: number;
  zoneType: ZoneType;
  gateMode?: 'default' | 'aggressive' | 'conservative';
  dataSource?: 'futures' | 'spot';
  outcome?: 'tp1' | 'stop' | 'timeout' | 'open';
  outcomeAt?: number;
  barsHeld?: number;
}

export interface SignalCandidate extends Omit<Signal, 'id'> {}

export interface QualityGateConfig {
  maxStopPct: number;
  minRR: number;
  atrPctMin: number;
  atrPctMax: number;
  requireFreshZone: boolean;
  cooldownBars: number;
  scoreMin: number;
  stopAtrMult: number;
}

export interface StrategySettings {
  atrPeriod: number;
  emaPeriod: number;
  adxPeriod: number;
  bbPeriod: number;
  zoneAtrMult: number;
  pivotLeft: number;
  pivotRight: number;
  donchianPeriod: number;
  minBandwidth: number;
  enableSqueeze: boolean;
  htfTimeframes: Timeframe[];
  rangeLookback: number;
  rangeLow: number;
  rangeHigh: number;
}

export interface SignalState {
  lastSignal?: Signal;
  history: Signal[];
}

export interface Opportunity extends Omit<Signal, 'id'> {}

export interface FuturesProData {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  lastFundingRate: number; // decimal (e.g. 0.0001 == 0.01%)
  nextFundingTime: number; // ms epoch
  openInterest: number;
  longShortRatio?: {
    longAccount: number;
    shortAccount: number;
    longShortRatio: number;
    timestamp: number; // ms epoch
    period: string;
  };
}
