import { Candle, SupplyDemandZone, ZoneType } from '@/types';

export function pivotHigh(candles: Candle[], index: number, left: number, right: number): boolean {
  const curr = candles[index];
  if (!curr) return false;
  for (let i = index - left; i < index; i += 1) {
    if (i < 0) continue;
    if (candles[i].high >= curr.high) return false;
  }
  for (let i = index + 1; i <= index + right; i += 1) {
    if (i >= candles.length) continue;
    if (candles[i].high > curr.high) return false;
  }
  return true;
}

export function pivotLow(candles: Candle[], index: number, left: number, right: number): boolean {
  const curr = candles[index];
  if (!curr) return false;
  for (let i = index - left; i < index; i += 1) {
    if (i < 0) continue;
    if (candles[i].low <= curr.low) return false;
  }
  for (let i = index + 1; i <= index + right; i += 1) {
    if (i >= candles.length) continue;
    if (candles[i].low < curr.low) return false;
  }
  return true;
}

interface ZoneConfig {
  left: number;
  right: number;
  atrMult: number;
  invalidationBufferPct?: number;
}

export function detectSupplyDemandZones(candles: Candle[], atrValues: number[], cfg: ZoneConfig): SupplyDemandZone[] {
  const zones: SupplyDemandZone[] = [];
  const bufferPct = cfg.invalidationBufferPct ?? 0.001;
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    const atr = atrValues[i];
    if (!isFinite(atr)) continue;
    if (pivotHigh(candles, i, cfg.left, cfg.right)) {
      const top = candle.high;
      const bottom = candle.high - atr * cfg.atrMult;
      zones.push(makeZone('supply', i, candle.time, top, bottom));
    }
    if (pivotLow(candles, i, cfg.left, cfg.right)) {
      const bottom = candle.low;
      const top = candle.low + atr * cfg.atrMult;
      zones.push(makeZone('demand', i, candle.time, top, bottom));
    }
  }

  // Evaluate touches/invalidation
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    zones.forEach((zone) => {
      if (zone.mitigated) return;
      if (candle.time < zone.startTime) return;
      const touched = zone.type === 'demand'
        ? candle.low <= zone.top && candle.low >= zone.bottom
        : candle.high >= zone.bottom && candle.high <= zone.top;
      if (touched) {
        zone.fresh = false;
        zone.lastTouch = candle.time;
      }
      const invalidated =
        zone.type === 'demand'
          ? candle.close < zone.bottom * (1 - bufferPct)
          : candle.close > zone.top * (1 + bufferPct);
      if (invalidated) {
        zone.mitigated = true;
        zone.endTime = candle.time;
      }
    });
  }

  return zones;
}

function makeZone(type: ZoneType, pivotIndex: number, time: number, top: number, bottom: number): SupplyDemandZone {
  return {
    id: `${type}-${pivotIndex}-${time}`,
    type,
    pivotIndex,
    startTime: time,
    top,
    bottom,
    fresh: true,
    mitigated: false
  };
}
