import { Candle } from '@/types';

export function heikinAshi(candles: Candle[]): Candle[] {
  if (!candles.length) return [];
  const result: Candle[] = [];
  candles.forEach((candle, idx) => {
    const haClose = (candle.open + candle.high + candle.low + candle.close) / 4;
    const prev = result[idx - 1];
    const haOpen = idx === 0 ? (candle.open + candle.close) / 2 : (prev.open + prev.close) / 2;
    const haHigh = Math.max(candle.high, haOpen, haClose);
    const haLow = Math.min(candle.low, haOpen, haClose);
    result.push({
      time: candle.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: candle.volume
    });
  });
  return result;
}

export function ema(values: number[], period: number): number[] {
  if (period <= 0) throw new Error('Period must be positive');
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = NaN;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    if (i === period - 1) {
      prev = average(values.slice(0, period));
      result.push(prev);
      continue;
    }
    if (!isFinite(prev)) {
      prev = value;
      result.push(prev);
      continue;
    }
    const next = value * k + prev * (1 - k);
    result.push(next);
    prev = next;
  }
  return result;
}

export function atr(candles: Candle[], period: number): number[] {
  if (candles.length === 0) return [];
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const prevClose = prev?.close ?? curr.close;
    const tr = Math.max(curr.high - curr.low, Math.abs(curr.high - prevClose), Math.abs(curr.low - prevClose));
    trs.push(tr);
  }
  const result: number[] = [];
  trs.forEach((tr, idx) => {
    if (idx < period) {
      result.push(NaN);
      return;
    }
    if (idx === period) {
      result.push(average(trs.slice(1, period + 1)));
      return;
    }
    const prevAtr = result[idx - 1];
    const next = ((prevAtr ?? tr) * (period - 1) + tr) / period;
    result.push(next);
  });
  return result;
}

export function adx(candles: Candle[], period: number): number[] {
  if (candles.length === 0) return [];
  const dmPlus: number[] = [NaN];
  const dmMinus: number[] = [NaN];
  const trs: number[] = [NaN];

  for (let i = 1; i < candles.length; i += 1) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close)));
  }

  const trRma = rma(trs, period);
  const dmPlusRma = rma(dmPlus, period);
  const dmMinusRma = rma(dmMinus, period);

  const diPlus = dmPlusRma.map((v, i) => (trRma[i] ? (v / trRma[i]) * 100 : NaN));
  const diMinus = dmMinusRma.map((v, i) => (trRma[i] ? (v / trRma[i]) * 100 : NaN));
  const dx = diPlus.map((v, i) => {
    const minus = diMinus[i];
    if (!isFinite(v) || !isFinite(minus)) return NaN;
    return (Math.abs(v - minus) / (v + minus)) * 100;
  });
  return rma(dx, period);
}

export function bollingerBandwidth(values: number[], period: number, mult = 2): number[] {
  if (!values.length) return [];
  const result: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    const mean = average(slice);
    const std = Math.sqrt(average(slice.map((v) => (v - mean) ** 2)));
    const upper = mean + mult * std;
    const lower = mean - mult * std;
    const bandwidth = ((upper - lower) / mean) * 100;
    result.push(bandwidth);
  }
  return result;
}

export function donchian(candles: Candle[], period: number): { upper: number; lower: number; mid: number }[] {
  const result: { upper: number; lower: number; mid: number }[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    if (i < period - 1) {
      result.push({ upper: NaN, lower: NaN, mid: NaN });
      continue;
    }
    const window = candles.slice(i - period + 1, i + 1);
    const highs = window.map((c) => c.high);
    const lows = window.map((c) => c.low);
    const upper = Math.max(...highs);
    const lower = Math.min(...lows);
    result.push({ upper, lower, mid: (upper + lower) / 2 });
  }
  return result;
}

export function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function rma(values: number[], period: number): number[] {
  const result: number[] = [];
  const cleaned = values.map((v) => (Number.isFinite(v) ? v : 0));
  let prev = NaN;
  cleaned.forEach((v, i) => {
    if (i < period - 1) {
      result.push(NaN);
      return;
    }
    if (i === period - 1) {
      prev = average(cleaned.slice(0, period));
      result.push(prev);
      return;
    }
    const base = Number.isFinite(prev) ? prev : cleaned[i];
    const next = ((base ?? 0) * (period - 1) + v) / period;
    result.push(next);
    prev = next;
  });
  return result;
}
