import { describe, it, expect } from 'vitest';
import { heikinAshi, ema, atr, adx, bollingerBandwidth, donchian } from '@/utils/indicators';
import { Candle } from '@/types';

const sample: Candle[] = [
  { time: 1, open: 100, high: 105, low: 95, close: 102, volume: 10 },
  { time: 2, open: 102, high: 108, low: 101, close: 107, volume: 12 },
  { time: 3, open: 107, high: 111, low: 106, close: 110, volume: 11 },
  { time: 4, open: 110, high: 115, low: 108, close: 114, volume: 13 },
  { time: 5, open: 114, high: 118, low: 112, close: 117, volume: 15 }
];

describe('indicators', () => {
  it('computes heikin ashi without gaps', () => {
    const ha = heikinAshi(sample);
    expect(ha).toHaveLength(sample.length);
    expect(ha[0].close).toBeCloseTo((100 + 105 + 95 + 102) / 4);
  });

  it('computes EMA', () => {
    const values = sample.map((c) => c.close);
    const result = ema(values, 3);
    expect(result).toHaveLength(values.length);
    expect(Number.isFinite(result.at(-1))).toBe(true);
  });

  it('computes ATR and ADX', () => {
    const atrValues = atr(sample, 3);
    const adxValues = adx(sample, 3);
    expect(Number.isFinite(atrValues.at(-1))).toBe(true);
    expect(Number.isFinite(adxValues.at(-1))).toBe(true);
  });

  it('computes Bollinger bandwidth and Donchian', () => {
    const bw = bollingerBandwidth(sample.map((c) => c.close), 3);
    expect(bw.at(-1)).toBeGreaterThan(0);
    const dc = donchian(sample, 3);
    expect(dc.at(-1)?.upper).toBeGreaterThan(dc.at(-1)?.lower ?? 0);
  });
});
