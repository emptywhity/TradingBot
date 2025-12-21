import { describe, it, expect } from 'vitest';
import { pivotHigh, pivotLow, detectSupplyDemandZones } from '@/utils/pivots';
import { Candle } from '@/types';

const candles: Candle[] = [
  { time: 1, open: 100, high: 102, low: 99, close: 101, volume: 10 },
  { time: 2, open: 101, high: 103, low: 100, close: 102, volume: 11 },
  { time: 3, open: 102, high: 104, low: 101, close: 103, volume: 9 },
  { time: 4, open: 103, high: 109, low: 102, close: 108, volume: 10 },
  { time: 5, open: 108, high: 110, low: 105, close: 106, volume: 12 },
  { time: 6, open: 106, high: 107, low: 101, close: 102, volume: 14 },
  { time: 7, open: 102, high: 103, low: 100, close: 101, volume: 13 }
];

describe('pivots and zones', () => {
  it('detects pivot high/low', () => {
    expect(pivotHigh(candles, 4, 1, 1)).toBe(true);
    expect(pivotLow(candles, 6, 1, 0)).toBe(true);
  });

  it('builds zones', () => {
    const atrValues = candles.map(() => 2);
    const zones = detectSupplyDemandZones(candles, atrValues, { left: 1, right: 1, atrMult: 1 });
    const demand = zones.find((z) => z.type === 'demand');
    const supply = zones.find((z) => z.type === 'supply');
    expect(demand).toBeDefined();
    expect(supply).toBeDefined();
  });
});
