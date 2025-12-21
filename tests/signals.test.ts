import { describe, it, expect } from 'vitest';
import { generateSignals } from '@/services/signalEngine';
import { DEFAULT_GATE, DEFAULT_STRATEGY } from '@/config/defaults';
import { Candle } from '@/types';
import { atr } from '@/utils/indicators';
import { detectSupplyDemandZones } from '@/utils/pivots';

function buildCandles(): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < 30; i += 1) {
    let base = 100 + i * 0.4;
    let low = base - 0.6;
    let high = base + 0.8;
    let open = base - 0.2;
    let close = base + 0.2;
    if (i === 20) {
      low = base - 5;
      open = base - 1;
      close = base - 0.5;
      high = base + 1;
    }
    if (i >= 25) {
      base = 112 - (i - 24) * 1.2;
      low = base - 0.6;
      high = base + 0.8;
      open = base - 0.3;
      close = base + 0.3;
    }
    if (i === 29) {
      low = base - 4; // deep wick into prospective demand
      open = base - 1;
      close = base + 0.5;
      high = base + 1;
    }
    candles.push({
      time: 1_700_000_000 + i * 900,
      open,
      high,
      low,
      close,
      volume: 1000 + i
    });
  }
  return candles;
}

function buildHtf(): Record<'1H' | '4H', Candle[]> {
  const make = (len: number, step: number): Candle[] =>
    Array.from({ length: len }, (_, i) => {
      const base = 100 + i * step;
      return {
        time: 1_700_000_000 + i * 3600,
        open: base - 0.5,
        high: base + 1,
        low: base - 1,
        close: base + 0.6,
        volume: 2000
      };
    });
  return { '1H': make(80, 0.3), '4H': make(80, 0.2) };
}

describe('signal engine', () => {
  it('emits a long signal when quality gate passes', () => {
    const candles = buildCandles();
    const settings = {
      ...DEFAULT_STRATEGY,
      emaPeriod: 20,
      atrPeriod: 10,
      pivotLeft: 2,
      pivotRight: 2,
      zoneAtrMult: 0.8,
      enableSqueeze: false
    };
    const gate = {
      ...DEFAULT_GATE,
      cooldownBars: 0,
      maxStopPct: 10,
      atrPctMax: 5,
      atrPctMin: 0,
      requireFreshZone: false,
      scoreMin: 0
    };
    const atrValues = atr(candles, settings.atrPeriod);
    const zones = detectSupplyDemandZones(candles, atrValues, {
      left: settings.pivotLeft,
      right: settings.pivotRight,
      atrMult: settings.zoneAtrMult
    });
    expect(zones.filter((z) => !z.mitigated).length).toBeGreaterThan(0);
    const signals = generateSignals({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      candles,
      htfCandles: buildHtf(),
      history: [],
      gate,
      settings
    });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].side).toBe('long');
  });
});
