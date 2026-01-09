import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_ALERT_DEDUPE_MINUTES } from '@/config/defaults';
import { evaluateSignal } from '@/services/performance';
import { bollingerBandwidth, donchian, ema, atr as atrFn, adx as adxFn } from '@/utils/indicators';
import { detectSupplyDemandZones } from '@/utils/pivots';
import { Candle, QualityGateConfig, Signal, SignalCandidate, StrategySettings, Timeframe, ZoneType } from '@/types';

// Minimal UUID fallback to avoid extra deps if tree-shaken
function simpleId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface SignalEngineInput {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  htfCandles: Record<Timeframe, Candle[]>;
  history: Signal[];
  gate: QualityGateConfig;
  settings: StrategySettings;
  now?: number;
  trendMode?: boolean;
}

export function generateSignals(input: SignalEngineInput): Signal[] {
  const { candles, settings } = input;
  if (candles.length < settings.emaPeriod + 5) return [];
  const rangePos = rangePosition(candles, settings.rangeLookback);
  if (input.trendMode) {
    return generateTrendSignal(input, rangePos);
  }
  const atrValues = atrFn(candles, settings.atrPeriod);
  const emaValues = ema(candles.map((c) => c.close), settings.emaPeriod);
  const adxValues = adxFn(candles, settings.adxPeriod);
  const bandwidth = bollingerBandwidth(
    candles.map((c) => c.close),
    settings.bbPeriod
  );
  const donchianBands = donchian(candles, settings.donchianPeriod);
  const zones = detectSupplyDemandZones(candles, atrValues, {
    left: settings.pivotLeft,
    right: settings.pivotRight,
    atrMult: settings.zoneAtrMult
  }).filter((z) => !z.mitigated);

  const lastIdx = candles.length - 1;
  const last = candles[lastIdx];
  const atr = atrValues[lastIdx];
  const adx = adxValues[lastIdx];
  const ema200 = emaValues[lastIdx];
  const trend = trendDirection(input.htfCandles, settings.emaPeriod);
  const candidates: SignalCandidate[] = [];

  zones.forEach((zone) => {
    const inZone =
      zone.type === 'demand'
        ? last.low <= zone.top && last.low >= zone.bottom
        : last.high >= zone.bottom && last.high <= zone.top;
    if (!inZone) return;
    const rejection = hasRejectionWick(last, zone.type);
    // Strict alignment: only trade with HTF trend unless at range extremes.
    const aligned = zone.type === 'demand' ? trend === 'long' : trend === 'short';
    const allowCounter =
      rangePos !== null &&
      ((zone.type === 'demand' && rangePos <= settings.rangeLow) ||
        (zone.type === 'supply' && rangePos >= settings.rangeHigh));
    if (!rejection || (!aligned && !allowCounter)) return;
    const side = zone.type === 'demand' ? 'long' : 'short';
    if (!rangeAllowsSide(side, rangePos, settings)) return;
    const { entry, stop, tp1, rr, stopDistancePct } = buildStops(last, zone, atr, input.gate.stopAtrMult);
    const reasons = buildReasons({
      side,
      trend,
      zoneType: zone.type,
      rr,
      stopDistancePct,
      adx,
      emaSlope: emaSlope(emaValues, settings.emaPeriod),
      rangePos
    });
    const candidate: SignalCandidate = {
      symbol: input.symbol,
      timeframe: input.timeframe,
      side,
      entry,
      stop,
      tp1,
      rr,
      score: scoreSignal({ trendAligned: aligned, rr, stopDistancePct, adx }),
      reasons,
      timestamp: last.time,
      zoneType: zone.type
    };
    if (passesQualityGate(candidate, last, atr, zone, input)) {
      candidates.push(candidate);
    }
  });

  if (settings.enableSqueeze) {
    const squeeze = bandwidth[lastIdx];
    const bandOk = squeeze < settings.minBandwidth * 100;
    const dc = donchianBands[lastIdx];
    const breakoutLong = bandOk && last.close > dc.upper;
    const breakoutShort = bandOk && last.close < dc.lower;
    if (breakoutLong || breakoutShort) {
      const side = breakoutLong ? 'long' : 'short';
      if (rangeAllowsSide(side, rangePos, settings)) {
        const stop =
          side === 'long'
            ? Math.min(last.low, dc.mid) - atr * input.gate.stopAtrMult
            : Math.max(last.high, dc.mid) + atr * input.gate.stopAtrMult;
        const entry = last.close;
        const distance = Math.abs(entry - stop);
        const tp1 = side === 'long' ? entry + distance * 2 : entry - distance * 2;
        const candidate: SignalCandidate = {
          symbol: input.symbol,
          timeframe: input.timeframe,
          side,
          entry,
          stop,
          tp1,
          rr: 2,
          score: scoreSignal({
            trendAligned: trend === (side === 'long' ? 'long' : 'short'),
            rr: 2,
            stopDistancePct: (distance / entry) * 100,
            adx
          }),
          reasons: [
            'Squeeze + Donchian breakout',
            `Bandwidth ${squeeze.toFixed(2)}%`,
            rangePos === null ? 'Range pos n/a' : `Range pos ${(rangePos * 100).toFixed(0)}%`
          ],
          timestamp: last.time,
          zoneType: breakoutLong ? 'demand' : 'supply'
        };
        if (passesQualityGate(candidate, last, atr, undefined, input)) {
          candidates.push(candidate);
        }
      }
    }
  }

  return dedupeNewSignals(candidates, input.history);
}

function generateTrendSignal(input: SignalEngineInput, rangePos: number | null): Signal[] {
  const { candles, htfCandles, history, gate, settings } = input;
  const trend = trendDirection(htfCandles, settings.emaPeriod);
  if (trend === 'neutral') return [];
  const last = candles.at(-1)!;
  const firstTime = candles[0]?.time ?? last.time;
  const lastTime = last.time;
  const maxHoldBars = 60;
  const atrArray = atrFn(candles, settings.atrPeriod);
  const adxVal = adxFn(candles, settings.adxPeriod).at(-1) ?? 0;
  // Evita operar sin régimen direccional mínimo
  if (adxVal < 12) return [];
  const atr = atrArray.at(-1) ?? 0;
  const side: 'long' | 'short' = trend === 'long' ? 'long' : 'short';
  if (!rangeAllowsSide(side, rangePos, settings)) return [];
  const stopAtrMult = 2.2; // wider than 1.5 to avoid noise on small TFs
  const tpAtrMult = stopAtrMult * 2; // keep RR ~2 for the first partial
  const stop = side === 'long' ? last.close - atr * stopAtrMult : last.close + atr * stopAtrMult;
  const tp1 = side === 'long' ? last.close + atr * tpAtrMult : last.close - atr * tpAtrMult;
  const entry = last.close;
  const rr = Math.abs(tp1 - entry) / Math.abs(entry - stop || 1);
  const distancePct = (Math.abs(entry - stop) / entry) * 100;
  const lastAny = [...history]
    .reverse()
    .find(
      (s) =>
        s.symbol === input.symbol &&
        s.timeframe === input.timeframe &&
        s.timestamp >= firstTime &&
        s.timestamp <= lastTime
    );
  if (lastAny) {
    const barsSince = (last.time - lastAny.timestamp) / timeframeSeconds(input.timeframe);
    if (lastAny.side === side) {
      // Don't open another same-direction signal while the previous is still "open" (within evaluation window).
      // If it already resolved (stop/tp/timeout), allow re-entry after cooldown.
      const outcome = evaluateSignal(lastAny, candles, { maxHoldBars }).outcome;
      if (outcome === 'open') return [];
      if (barsSince < gate.cooldownBars) return [];
    }
    if (barsSince < gate.cooldownBars) {
      // Cambio de sesgo demasiado reciente
      return [];
    }
  }
  const candidate: SignalCandidate = {
    symbol: input.symbol,
    timeframe: input.timeframe,
    side,
    entry,
    stop,
    tp1,
    rr,
    score: scoreSignal({
      trendAligned: true,
      rr,
      stopDistancePct: distancePct,
      adx: adxVal
    }),
    reasons: [
      `Trend ${trend}`,
      `ATR stop ${distancePct.toFixed(2)}%`,
      `RR ${rr.toFixed(2)}`,
      rangePos === null ? 'Range pos n/a' : `Range pos ${(rangePos * 100).toFixed(0)}%`
    ],
    timestamp: last.time,
    zoneType: side === 'long' ? 'demand' : 'supply'
  };
  // Evita duplicar si ya hay una señal reciente del mismo lado
  const lastSame = [...history]
    .reverse()
    .find((s) => s.symbol === input.symbol && s.side === side && s.timeframe === input.timeframe);
  if (lastSame) {
    const barsSince = (candidate.timestamp - lastSame.timestamp) / timeframeSeconds(input.timeframe);
    if (barsSince < gate.cooldownBars) return [];
  }
  const atrPct = (atr / entry) * 100;
  const gatesOk = distancePct <= gate.maxStopPct && rr >= gate.minRR && atrPct >= gate.atrPctMin && atrPct <= gate.atrPctMax;
  if (!gatesOk) return [];
  return dedupeNewSignals([candidate], history);
}

function passesQualityGate(
  candidate: SignalCandidate,
  candle: Candle,
  atr: number,
  zone: ZoneType extends never ? never : undefined | { fresh?: boolean; id: string },
  input: SignalEngineInput
): boolean {
  const { gate, history, timeframe } = input;
  const stopDistancePct = (Math.abs(candidate.entry - candidate.stop) / candidate.entry) * 100;
  if (stopDistancePct > gate.maxStopPct) return false;
  if (candidate.rr < gate.minRR) return false;
  const atrPct = (atr / candle.close) * 100;
  if (atrPct < gate.atrPctMin || atrPct > gate.atrPctMax) return false;
  if (gate.requireFreshZone && zone && zone.fresh === false) return false;
  const lastSameSide = [...history]
    .reverse()
    .find((s) => s.symbol === candidate.symbol && s.timeframe === timeframe && s.side === candidate.side);
  if (lastSameSide) {
    const tfSeconds = timeframeSeconds(timeframe);
    const barsSince = (candidate.timestamp - lastSameSide.timestamp) / tfSeconds;
    if (barsSince < gate.cooldownBars) return false;
  }
  if (candidate.score < gate.scoreMin) return false;
  return true;
}

function hasRejectionWick(candle: Candle, zoneType: ZoneType): boolean {
  const range = candle.high - candle.low;
  if (range === 0) return false;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  if (zoneType === 'demand') {
    return lowerWick / range > 0.35 && candle.close > candle.open;
  }
  return upperWick / range > 0.35 && candle.close < candle.open;
}

function buildStops(
  candle: Candle,
  zone: { type: ZoneType; top: number; bottom: number },
  atr: number,
  stopAtrMult: number
) {
  const entry = candle.close;
  const stop =
    zone.type === 'demand'
      ? zone.bottom - atr * stopAtrMult
      : zone.top + atr * stopAtrMult;
  const distance = Math.abs(entry - stop);
  const tp1 = zone.type === 'demand' ? entry + distance * 2 : entry - distance * 2;
  const rr = Math.abs(tp1 - entry) / distance;
  const stopDistancePct = (distance / entry) * 100;
  return { entry, stop, tp1, rr, stopDistancePct };
}

function trendDirection(htf: Record<Timeframe, Candle[]>, emaPeriod: number): 'long' | 'short' | 'neutral' {
  const oneH = htf['1H'] ?? [];
  const fourH = htf['4H'] ?? [];
  if (!oneH.length || !fourH.length) return 'neutral';
  const ema1 = ema(oneH.map((c) => c.close), emaPeriod);
  const ema4 = ema(fourH.map((c) => c.close), emaPeriod);
  const last1 = ema1.at(-1) ?? 0;
  const last4 = ema4.at(-1) ?? 0;
  const slope1 = emaSlope(ema1, emaPeriod);
  const slope4 = emaSlope(ema4, emaPeriod);
  const close1 = oneH.at(-1)?.close ?? 0;
  const close4 = fourH.at(-1)?.close ?? 0;
  const longBias = close1 > last1 && close4 > last4 && slope1 >= 0 && slope4 >= 0;
  const shortBias = close1 < last1 && close4 < last4 && slope1 <= 0 && slope4 <= 0;
  if (longBias) return 'long';
  if (shortBias) return 'short';
  return 'neutral';
}

function emaSlope(values: number[], lookback: number): number {
  const recent = values.slice(-lookback);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  return ((last - first) / Math.abs(first || 1)) * 100;
}

function scoreSignal(params: { trendAligned: boolean; rr: number; stopDistancePct: number; adx: number }): number {
  let score = 0;
  if (params.trendAligned) score += 40;
  if (params.rr >= 2) score += 15;
  if (params.stopDistancePct < 0.4) score += 15;
  if (params.adx > 20) score += 10;
  return Math.min(100, score + 20);
}

function buildReasons(input: {
  side: 'long' | 'short';
  trend: string;
  zoneType: ZoneType;
  rr: number;
  stopDistancePct: number;
  adx: number;
  emaSlope: number;
  rangePos: number | null;
}): string[] {
  const reasons = [
    `HTF trend ${input.trend}`,
    `Zone ${input.zoneType}`,
    `RR ${input.rr.toFixed(2)}`,
    `Stop ${input.stopDistancePct.toFixed(2)}%`,
    `ADX ${input.adx.toFixed(1)}`,
    `EMA slope ${input.emaSlope.toFixed(2)}%`,
    input.rangePos === null ? 'Range pos n/a' : `Range pos ${(input.rangePos * 100).toFixed(0)}%`
  ];
  if (input.side === 'long') reasons.push('Rejection wick at demand');
  if (input.side === 'short') reasons.push('Rejection wick at supply');
  return reasons;
}

function dedupeNewSignals(candidates: SignalCandidate[], history: Signal[]): Signal[] {
  const deduped: Signal[] = [];
  candidates.forEach((c) => {
    const exists = history.find(
      (s) =>
        s.symbol === c.symbol &&
        s.timeframe === c.timeframe &&
        s.side === c.side &&
        Math.abs(s.timestamp - c.timestamp) < DEFAULT_ALERT_DEDUPE_MINUTES * 60
    );
    if (exists) return;
    deduped.push({
      ...c,
      id: typeof uuidv4 === 'function' ? uuidv4() : simpleId()
    });
  });
  return deduped;
}

export function timeframeSeconds(tf: Timeframe): number {
  const map: Record<Timeframe, number> = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '1H': 3600,
    '4H': 14400,
    D: 86400,
    W: 604800
  };
  return map[tf];
}

function rangePosition(candles: Candle[], lookback: number): number | null {
  if (!Number.isFinite(lookback) || lookback <= 1) return null;
  const slice = candles.slice(-lookback);
  if (slice.length < 2) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const c of slice) {
    if (Number.isFinite(c.low)) low = Math.min(low, c.low);
    if (Number.isFinite(c.high)) high = Math.max(high, c.high);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
  const last = candles.at(-1);
  if (!last || !Number.isFinite(last.close)) return null;
  return (last.close - low) / (high - low);
}

function rangeAllowsSide(
  side: 'long' | 'short',
  rangePos: number | null,
  settings: StrategySettings
): boolean {
  if (rangePos === null) return true;
  if (side === 'long' && rangePos >= settings.rangeHigh) return false;
  if (side === 'short' && rangePos <= settings.rangeLow) return false;
  return true;
}
