import { RealDataAdapter } from '@/adapters/exchangeAdapter';
import { DEFAULT_STRATEGY } from '@/config/defaults';
import { MetaModelV1, predictWithMetaModel } from '@/services/metaModel';
import { generateSignals, timeframeSeconds } from '@/services/signalEngine';
import { buildDynamicGate } from '@/services/dynamicGate';
import { evaluateSignal } from '@/services/performance';
import { adx, atr, bollingerBandwidth, ema } from '@/utils/indicators';
import { Candle, QualityGateConfig, Signal, Timeframe } from '@/types';
import { BackendConfig } from './config';
import { MetaModelManager } from './metaModel';
import { persistState, StoredState } from './storage';

type Diagnostics = {
  reasons: string[];
  cooldownSecs?: number;
  atrPct?: number;
  adx?: number;
  bb?: number;
  trend?: string;
  emaSlope?: number;
  rangePos?: number;
};

export type EvaluatedSignal = Signal & {
  probability?: number;
  evR?: number;
  diagnostics?: Diagnostics;
};

export type WorkerSnapshot = {
  signals: EvaluatedSignal[];
  lastRun: number;
  runMs: number;
  status: 'ok' | 'error';
  error?: string;
};

export class SignalWorker {
  private adapter: RealDataAdapter;
  private history: Signal[];
  private latest: WorkerSnapshot | null = null;

  constructor(
    private readonly config: BackendConfig,
    private readonly metaModel: MetaModelManager,
    initialState: StoredState
  ) {
    this.adapter = new RealDataAdapter({ source: config.dataSource });
    this.history = [...initialState.history].sort((a, b) => a.timestamp - b.timestamp);
  }

  getSnapshot(): WorkerSnapshot | null {
    return this.latest;
  }

  getHistory(limit?: number): EvaluatedSignal[] {
    const list = this.history as EvaluatedSignal[];
    if (limit && limit > 0) return list.slice(-limit);
    return [...list];
  }

  async run(): Promise<WorkerSnapshot> {
    const started = Date.now();
    const collected: EvaluatedSignal[] = [];
    const errors: string[] = [];

    const model = await this.metaModel.getModel();
    for (const symbol of this.config.symbols) {
      const htfCandles = await this.fetchHtfCandles(symbol);
      for (const timeframe of this.config.timeframes) {
        try {
          const signals = await this.evaluateSymbolTimeframe(symbol, timeframe, htfCandles, model);
          collected.push(...signals);
        } catch (err: any) {
          const message = err?.message ?? String(err);
          errors.push(`${symbol} ${timeframe}: ${message}`);
          console.error('[worker] eval failed', symbol, timeframe, err);
        }
      }
    }

    try {
      await persistState(this.config.persistPath, {
        history: this.history.slice(-this.config.historyCap),
        lastRun: started
      });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      errors.push(`persist: ${message}`);
      console.error('[worker] persist failed', err);
    }

    const snapshot: WorkerSnapshot = {
      signals: collected,
      lastRun: started,
      runMs: Date.now() - started,
      status: errors.length ? 'error' : 'ok',
      error: errors.length ? errors[0] : undefined
    };
    this.latest = snapshot;
    return snapshot;
  }

  private async evaluateSymbolTimeframe(
    symbol: string,
    timeframe: Timeframe,
    htfCandles: Record<Timeframe, Candle[]>,
    model: MetaModelV1 | null
  ): Promise<EvaluatedSignal[]> {
    const candles = await this.adapter.getOHLCV({ symbol, timeframe, limit: this.config.ohlcvLimit });
    if (!candles.length) return [];

    this.updateSignalOutcomes(symbol, timeframe, candles);

    const { gate: effectiveGate } = buildDynamicGate({
      candles,
      baseGate: this.config.gate,
      atrPeriod: DEFAULT_STRATEGY.atrPeriod,
      enabled: this.config.dynamicGate
    });

    const diagnostics = buildDiagnostics(
      candles,
      htfCandles,
      timeframe,
      this.history,
      symbol,
      effectiveGate
    );

    const generated = generateSignals({
      symbol,
      timeframe,
      candles,
      htfCandles,
      history: this.history,
      gate: effectiveGate,
      trendMode: this.config.trendMode,
      settings: DEFAULT_STRATEGY
    });

    if (!generated.length) return [];

    const enriched = generated.map((s) => {
      const prediction = model
        ? predictWithMetaModel({ model, signal: s, diagnostics })
        : null;
      const signal: EvaluatedSignal = {
        ...s,
        gateMode: this.config.gateMode,
        dataSource: this.config.dataSource,
        probability: prediction?.pTp1,
        evR: prediction?.evR,
        diagnostics
      };
      return signal;
    });

    if (this.config.discordWebhook && enriched.length) {
      for (const sig of enriched) {
        this.notify(sig).catch((err) => console.warn('[worker] webhook failed', err));
      }
    }

    this.history = [...this.history, ...enriched].slice(-this.config.historyCap);
    return enriched;
  }

  private updateSignalOutcomes(symbol: string, timeframe: Timeframe, candles: Candle[]) {
    if (!candles.length) return;
    const tfSec = timeframeSeconds(timeframe);
    const firstTime = candles[0]?.time ?? 0;
    const lastTime = candles[candles.length - 1]?.time ?? 0;
    let changed = false;

    const nextHistory = this.history.map((s) => {
      if (s.symbol !== symbol || s.timeframe !== timeframe) return s;
      if (s.outcome && s.outcome !== 'open') return s;

      const evaluation = evaluateSignal(s, candles, { maxHoldBars: this.config.maxHoldBars });
      if (evaluation.outcome !== 'open') {
        changed = true;
        return {
          ...s,
          outcome: evaluation.outcome,
          barsHeld: evaluation.barsHeld,
          outcomeAt: resolveOutcomeTime(s.timestamp, candles, evaluation.barsHeld)
        };
      }

      if (Number.isFinite(s.timestamp) && s.timestamp < firstTime) {
        const barsSince = Math.floor((lastTime - s.timestamp) / tfSec);
        if (barsSince >= this.config.maxHoldBars) {
          changed = true;
          return {
            ...s,
            outcome: 'timeout',
            barsHeld: barsSince,
            outcomeAt: lastTime
          };
        }
      }

      return s;
    });

    if (changed) this.history = nextHistory;
  }

  private async fetchHtfCandles(symbol: string): Promise<Record<Timeframe, Candle[]>> {
    const result: Record<Timeframe, Candle[]> = {};
    for (const tf of DEFAULT_STRATEGY.htfTimeframes) {
      try {
        const data = await this.adapter.getOHLCV({ symbol, timeframe: tf, limit: 800 });
        result[tf] = data;
      } catch (err) {
        console.warn(`[worker] HTF fetch failed ${symbol} ${tf}`, err);
      }
    }
    return result;
  }

  private async notify(signal: EvaluatedSignal) {
    if (!this.config.discordWebhook) return;
    const message = formatMessage(signal);
    await fetch(this.config.discordWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
  }
}

function buildDiagnostics(
  candles: Candle[],
  htf: Record<Timeframe, any>,
  tf: Timeframe,
  history: Signal[],
  symbol: string,
  gate: QualityGateConfig
): Diagnostics | undefined {
  if (!candles.length) return undefined;
  const last = candles.at(-1)!;
  const atrArray = atr(candles, DEFAULT_STRATEGY.atrPeriod);
  const adxArray = adx(candles, DEFAULT_STRATEGY.adxPeriod);
  const bbArray = bollingerBandwidth(candles.map((c) => c.close), DEFAULT_STRATEGY.bbPeriod);
  const emaValues = ema(candles.map((c) => c.close), DEFAULT_STRATEGY.emaPeriod);
  const atrPct = ((atrArray.at(-1) ?? 0) / last.close) * 100;
  const adxVal = adxArray.at(-1) ?? 0;
  const bb = bbArray.at(-1) ?? 0;
  const slope = emaSlope(emaValues);
  const trend =
    slope > 0 && last.close > (emaValues.at(-1) ?? last.close)
      ? 'up'
      : slope < 0 && last.close < (emaValues.at(-1) ?? last.close)
      ? 'down'
      : 'neutral';
  const rangePos = rangePosition(candles, DEFAULT_STRATEGY.rangeLookback);
  const lastSameSide = [...history].reverse().find((s) => s.timeframe === tf && s.symbol === symbol);
  const tfSec = timeframeSeconds(tf);
  const cooldownSecs = lastSameSide ? Math.max(0, gate.cooldownBars * tfSec - (last.time - lastSameSide.timestamp)) : 0;
  const reasons: string[] = [];
  if (atrPct < gate.atrPctMin || atrPct > gate.atrPctMax) reasons.push(`ATR% ${atrPct.toFixed(2)} outside gate`);
  if (adxVal < 15) reasons.push(`ADX low ${adxVal.toFixed(1)}`);
  if (cooldownSecs > 0) reasons.push(`Cooldown ${Math.round(cooldownSecs / 60)}m remaining`);
  if (trend === 'neutral') reasons.push('HTF not aligned');
  if (rangePos !== null) {
    const rangePct = rangePos * 100;
    if (rangePos <= DEFAULT_STRATEGY.rangeLow) reasons.push(`Range pos low ${rangePct.toFixed(0)}%`);
    if (rangePos >= DEFAULT_STRATEGY.rangeHigh) reasons.push(`Range pos high ${rangePct.toFixed(0)}%`);
  }
  return { reasons, atrPct, adx: adxVal, bb, cooldownSecs, trend, emaSlope: slope, rangePos: rangePos ?? undefined };
}

function emaSlope(values: number[], lookback = 30): number {
  const slice = values.slice(-lookback).filter((v) => Number.isFinite(v));
  if (slice.length < 2) return 0;
  const first = slice[0];
  const last = slice[slice.length - 1];
  return ((last - first) / Math.abs(first || 1)) * 100;
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

function resolveOutcomeTime(signalTs: number, candles: Candle[], barsHeld: number): number | undefined {
  if (!Number.isFinite(signalTs) || !Number.isFinite(barsHeld) || barsHeld < 0) return undefined;
  if (!candles.length) return undefined;
  const times = candles.map((c) => c.time);
  const startIdx = firstIndexAtOrAfter(times, signalTs);
  const exitIdx = Math.min(startIdx + Math.max(0, Math.floor(barsHeld)), candles.length - 1);
  return candles[exitIdx]?.time;
}

function firstIndexAtOrAfter(times: number[], ts: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = times[mid];
    if (v < ts) lo = mid + 1;
    else hi = mid - 1;
  }
  return lo;
}

function formatMessage(signal: EvaluatedSignal): string {
  const prob = signal.probability !== undefined ? ` P(TP1) ${(signal.probability * 100).toFixed(1)}%` : '';
  const ev = signal.evR !== undefined ? ` EV ${signal.evR.toFixed(2)}R` : '';
  return [
    `Signal ${signal.side.toUpperCase()} ${signal.symbol} ${signal.timeframe}`,
    `Entry ${signal.entry.toFixed(4)} Stop ${signal.stop.toFixed(4)} TP1 ${signal.tp1.toFixed(4)} RR ${signal.rr.toFixed(2)}`,
    `Score ${signal.score}${prob}${ev}`,
    `Gate ${signal.gateMode ?? 'default'} Source ${signal.dataSource ?? 'futures'}`,
    `Reasons: ${signal.reasons.join('; ')}`,
    'no financial advice'
  ].join(' | ');
}
