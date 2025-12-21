import { useEffect, useRef } from 'react';
import { RealDataAdapter } from '@/adapters/exchangeAdapter';
import { DEFAULT_STRATEGY } from '@/config/defaults';
import { generateSignals, timeframeSeconds } from '@/services/signalEngine';
import { notifySignal } from '@/services/alerting';
import { computeAutoMuteDecision } from '@/services/autoMute';
import { loadMetaModel, predictWithMetaModel } from '@/services/metaModel';
import { useMarketStore } from '@/store/useMarketStore';
import { QualityGateConfig, Signal, Timeframe } from '@/types';
import { adx, atr, bollingerBandwidth, ema } from '@/utils/indicators';

const webhookUrl = import.meta.env.VITE_DISCORD_WEBHOOK_URL;

export function useLiveData() {
  const {
    role,
    symbol,
    timeframe,
    dataSource,
    gateMode,
    gate,
    candles,
    htfCandles,
    setCandles,
    setHtfCandles,
    clearHtfCandles,
    setOrderBook,
    setTicker,
    pushSignals,
    signals,
    candles: currentCandles,
    setDiagnostics,
    setFeedInfo,
    trendMode,
    autoMuteEnabled,
    mlFilterEnabled
  } = useMarketStore();
  const signalsRef = useRef(signals);
  const candlesRef = useRef(currentCandles);
  const candlesKeyRef = useRef<string>('');
  const adapterRef = useRef<RealDataAdapter>();
  useEffect(() => {
    signalsRef.current = signals;
  }, [signals]);
  useEffect(() => {
    candlesRef.current = currentCandles;
  }, [currentCandles]);

  useEffect(() => {
    adapterRef.current = new RealDataAdapter({ source: dataSource });
  }, [dataSource]);

  useEffect(() => {
    let cancelled = false;
    const expectedKey = `${symbol}|${timeframe}|${dataSource}`;
    // Clear stale state immediately so we don't evaluate signals with old candles/HTF.
    candlesKeyRef.current = '';
    candlesRef.current = [];
    setCandles([]);
    setDiagnostics(undefined);
    const load = async () => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      try {
        const data = await adapter.getOHLCV({ symbol, timeframe, limit: 2000 });
        if (cancelled) return;
        // Ignore late responses after symbol/timeframe/source changed.
        if (`${useMarketStore.getState().symbol}|${useMarketStore.getState().timeframe}|${useMarketStore.getState().dataSource}` !== expectedKey) {
          return;
        }
        if (!cancelled) {
          candlesKeyRef.current = expectedKey;
          candlesRef.current = data;
          setCandles(data);
          if (data.length) evaluateSignals(data);
          setFeedInfo(adapter.getLastSources());
        }
      } catch (err) {
        console.error('OHLCV fetch failed', err);
      }
    };
    load();
    const interval = setInterval(load, timeframeSeconds(timeframe) * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, dataSource]);

  useEffect(() => {
    const tfList: Timeframe[] = DEFAULT_STRATEGY.htfTimeframes;
    let cancelled = false;
    const expectedSymbol = symbol;
    clearHtfCandles();
    tfList.forEach((tf) => {
      adapterRef.current
        ?.getOHLCV({ symbol: expectedSymbol, timeframe: tf, limit: 800 })
        .then((data) => {
          if (cancelled) return;
          if (useMarketStore.getState().symbol !== expectedSymbol) return;
          setHtfCandles(tf, data);
          setFeedInfo(adapterRef.current?.getLastSources());
        })
        .catch((err) => console.error('HTF fetch failed', err));
    });
    return () => {
      cancelled = true;
    };
  }, [symbol, setHtfCandles, dataSource]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    setTicker(undefined);
    setOrderBook(undefined, 'loading…');
    const unsubTicker = adapter.subscribeTicker({
      symbol,
      cb: (t) => {
        setTicker(t);
        setFeedInfo(adapter.getLastSources());
      }
    });
    const unsubBook = adapter.subscribeOrderBook({
      symbol,
      depth: 25,
      cb: (ob, status) => {
        setOrderBook(ob, status);
        setFeedInfo(adapter.getLastSources());
      }
    });
    return () => {
      unsubTicker();
      unsubBook();
    };
  }, [symbol, setOrderBook, setTicker, dataSource]);

  useEffect(() => {
    const expectedKey = `${symbol}|${timeframe}|${dataSource}`;
    if (candlesKeyRef.current !== expectedKey) return;
    if (!candlesRef.current.length) return;
    evaluateSignals(candlesRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htfCandles, symbol, timeframe, dataSource]);

  const evaluateSignals = (latest: typeof candles) => {
    const diag = buildDiagnostics(latest, htfCandles, timeframe, signalsRef.current, symbol, gate);
    const newSignals = generateSignals({
      symbol,
      timeframe,
      candles: latest,
      htfCandles,
      history: signalsRef.current,
      gate,
      trendMode,
      settings: DEFAULT_STRATEGY
    });
    if (newSignals.length) {
      const enriched = newSignals.map((s) => ({ ...s, gateMode, dataSource }));
      pushSignals(enriched);
      let mutedByStats = false;
      if (role === 'admin' && autoMuteEnabled) {
        const decision = computeAutoMuteDecision({
          symbol,
          timeframe,
          dataSource,
          gateMode,
          signals: signalsRef.current,
          candles: latest
        });
        mutedByStats = decision.muted;
        if (mutedByStats) {
          console.info('[auto-mute]', decision.reason);
        }
      }

      const model = role === 'admin' && mlFilterEnabled ? loadMetaModel() : null;

      if (!mutedByStats) {
        enriched.forEach((s) => {
          if (model) {
            const pred = predictWithMetaModel({ model, signal: s, diagnostics: diag });
            const threshold = model.threshold;
            const passesProb = threshold === undefined ? true : (pred?.pTp1 ?? 0) >= threshold;
            const passesEv = (pred?.evR ?? 0) > 0;
            if (pred && passesProb && passesEv) notifySignal(s, webhookUrl);
            else if (!pred) notifySignal(s, webhookUrl);
          } else {
            notifySignal(s, webhookUrl);
          }
        });
      }
    }
    setDiagnostics(diag);
  };
}

function buildDiagnostics(
  candles: import('@/types').Candle[],
  htf: Record<Timeframe, any>,
  tf: Timeframe,
  history: Signal[],
  symbol: string,
  gate: QualityGateConfig
) {
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
  const trend = slope > 0 && last.close > (emaValues.at(-1) ?? last.close) ? 'up' : slope < 0 && last.close < (emaValues.at(-1) ?? last.close) ? 'down' : 'neutral';
  const lastSameSide = [...history].reverse().find((s) => s.timeframe === tf && s.symbol === symbol);
  const tfSec = timeframeSeconds(tf);
  const cooldownSecs = lastSameSide ? Math.max(0, gate.cooldownBars * tfSec - (last.time - lastSameSide.timestamp)) : 0;
  const reasons: string[] = [];
  if (atrPct < gate.atrPctMin || atrPct > gate.atrPctMax) reasons.push(`ATR% ${atrPct.toFixed(2)} outside gate`);
  if (adxVal < 15) reasons.push(`ADX low ${adxVal.toFixed(1)}`);
  if (cooldownSecs > 0) reasons.push(`Cooldown ${Math.round(cooldownSecs / 60)}m remaining`);
  if (trend === 'neutral') reasons.push('HTF not aligned');
  return { reasons, atrPct, adx: adxVal, bb, cooldownSecs, trend, emaSlope: slope };
}

function emaSlope(values: number[], lookback = 30): number {
  const slice = values.slice(-lookback).filter((v) => Number.isFinite(v));
  if (slice.length < 2) return 0;
  const first = slice[0];
  const last = slice[slice.length - 1];
  return ((last - first) / Math.abs(first || 1)) * 100;
}
