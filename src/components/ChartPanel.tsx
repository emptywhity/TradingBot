import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickData,
  ColorType,
  CrosshairMode,
  LineStyle,
  LineType,
  createChart,
  IChartApi,
  ISeriesApi,
  SeriesMarker,
  Time,
  LogicalRange
} from 'lightweight-charts';
import { DEFAULT_STRATEGY } from '@/config/defaults';
import { useMarketStore } from '@/store/useMarketStore';
import { heikinAshi, ema } from '@/utils/indicators';
import { computeSessionVolumeProfile } from '@/utils/volumeProfile';
import { Signal, Timeframe } from '@/types';
import { timeframeSeconds } from '@/services/signalEngine';
import { simulateTradePlan } from '@/services/tradePlan';
import { filterStoppedSignals } from '@/services/signalVisibility';

export function ChartPanel() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const supplySeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const demandSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const entrySeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const stopSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const tpSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lastPriceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);
  const [countdown, setCountdown] = useState<string>('');
  const hoverTextRef = useRef<HTMLSpanElement | null>(null);
  const hoverActiveRef = useRef(false);
  const timeframeRef = useRef<Timeframe>('1m');
  const latestHoverSnapshotRef = useRef<HoverLineSnapshot | null>(null);
  const [followRealtime, setFollowRealtime] = useState(true);
  const followRealtimeRef = useRef(true);
  const pausedRangeRef = useRef<LogicalRange | null>(null);
  const lastCandleTimeRef = useRef<number | null>(null);
  const liveBarRef = useRef<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null>(null);

  const { candles, ticker, heikin, symbol, timeframe, dataSource, signals, showVwap, showKeyLevels, showVolumeProfile, noviceMode } = useMarketStore((s) => ({
    candles: s.candles,
    ticker: s.ticker,
    heikin: s.heikin,
    symbol: s.symbol,
    timeframe: s.timeframe,
    dataSource: s.dataSource,
    signals: s.signals,
    showVwap: s.showVwap,
    showKeyLevels: s.showKeyLevels,
    showVolumeProfile: s.showVolumeProfile,
    noviceMode: s.noviceMode
  }));

  const showVwapEnabled = showVwap && !noviceMode;
  const showKeyLevelsEnabled = showKeyLevels && !noviceMode;
  const showVolumeProfileEnabled = showVolumeProfile && !noviceMode;

  const signalsForView = useMemo(
    () => {
      const scoped = signals.filter(
        (s) => s.symbol === symbol && s.timeframe === timeframe && (s.dataSource ?? 'futures') === dataSource
      );
      const refPrice = candles.at(-1)?.close ?? ticker?.last;
      if (!refPrice || !Number.isFinite(refPrice)) return scoped;
      const sane = scoped.filter((s) => isSignalSane(s, refPrice));
      return filterStoppedSignals(sane, candles);
    },
    [signals, symbol, timeframe, dataSource, candles, ticker]
  );
  const lastSignal = useMemo(
    () => signalsForView.at(-1),
    [signalsForView]
  );

  const writeHoverText = useCallback((text: string) => {
    const el = hoverTextRef.current;
    if (!el) return;
    el.textContent = text;
  }, []);

  useEffect(() => {
    followRealtimeRef.current = followRealtime;
  }, [followRealtime]);

  const pauseFollowRealtime = useCallback(() => {
    if (!followRealtimeRef.current) return;
    followRealtimeRef.current = false;
    setFollowRealtime(false);
    const range = chartRef.current?.timeScale().getVisibleLogicalRange();
    if (range) pausedRangeRef.current = range;
  }, []);

  const resumeFollowRealtime = useCallback(() => {
    followRealtimeRef.current = true;
    setFollowRealtime(true);
    pausedRangeRef.current = null;
    chartRef.current?.timeScale().scrollToRealTime();
  }, []);

  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  useEffect(() => {
    if (!containerRef.current) return;
    chartRef.current = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#cbd5f5' },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' }
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: '#475569', labelBackgroundColor: '#0ea5e9' },
        horzLine: { color: '#475569', labelBackgroundColor: '#0ea5e9' }
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: shouldShowSeconds(timeframe)
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight
    });
    const timeScale = chartRef.current.timeScale();
    const onVisibleRangeChange = (range: LogicalRange | null) => {
      if (!followRealtimeRef.current && range) {
        pausedRangeRef.current = range;
      }
    };
    timeScale.subscribeVisibleLogicalRangeChange(onVisibleRangeChange);
    const onCrosshairMove = (param: any) => {
      const candleSeries = candleSeriesRef.current;
      if (!candleSeries) return;

      if (!param?.time || !param?.seriesData?.size) {
        hoverActiveRef.current = false;
        const snap = latestHoverSnapshotRef.current;
        if (!snap) {
          writeHoverText('');
          return;
        }
        writeHoverText(formatHoverLine(snap, timeframeRef.current));
        return;
      }

      const candle = param.seriesData.get(candleSeries as any) as CandlestickData | undefined;
      if (!candle) return;

      hoverActiveRef.current = true;

      const timeSec = typeof param.time === 'number' ? param.time : (candle.time as number);
      const volumePoint = volumeSeriesRef.current
        ? (param.seriesData.get(volumeSeriesRef.current as any) as { value?: number } | undefined)
        : undefined;
      const emaPoint = emaSeriesRef.current
        ? (param.seriesData.get(emaSeriesRef.current as any) as { value?: number } | undefined)
        : undefined;
      const vwapPoint = vwapSeriesRef.current
        ? (param.seriesData.get(vwapSeriesRef.current as any) as { value?: number } | undefined)
        : undefined;

      writeHoverText(
        formatHoverLine(
          {
            timeSec,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: volumePoint?.value,
            ema: emaPoint?.value,
            vwap: vwapPoint?.value
          },
          timeframeRef.current
        )
      );
    };

    chartRef.current.subscribeCrosshairMove(onCrosshairMove);
    candleSeriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#16a34a',
      downColor: '#ef4444',
      wickUpColor: '#16a34a',
      wickDownColor: '#ef4444',
      borderVisible: false
    });
    volumeSeriesRef.current = chartRef.current.addHistogramSeries({
      color: 'rgba(148,163,184,0.6)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      priceLineVisible: false
    });
    emaSeriesRef.current = chartRef.current.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2
    });
    vwapSeriesRef.current = chartRef.current.addLineSeries({
      color: '#22d3ee',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      title: 'VWAP'
    });
    supplySeriesRef.current = chartRef.current.addLineSeries({
      color: 'rgba(239,68,68,0.35)',
      lineWidth: 2,
      lineStyle: LineStyle.SparseDotted,
      lineType: LineType.WithSteps,
      lastValueVisible: false,
      priceLineVisible: false
    });
    demandSeriesRef.current = chartRef.current.addLineSeries({
      color: 'rgba(22,163,74,0.35)',
      lineWidth: 2,
      lineStyle: LineStyle.SparseDotted,
      lineType: LineType.WithSteps,
      lastValueVisible: false,
      priceLineVisible: false
    });
    entrySeriesRef.current = chartRef.current.addLineSeries({
      color: '#38bdf8',
      lineWidth: 1,
      lineStyle: LineStyle.LargeDashed,
      lastValueVisible: false,
      priceLineVisible: false
    });
    stopSeriesRef.current = chartRef.current.addLineSeries({
      color: '#ef4444',
      lineWidth: 1,
      lineStyle: LineStyle.LargeDashed,
      lastValueVisible: false,
      priceLineVisible: false
    });
    tpSeriesRef.current = chartRef.current.addLineSeries({
      color: '#16a34a',
      lineWidth: 1,
      lineStyle: LineStyle.LargeDashed,
      lastValueVisible: false,
      priceLineVisible: false
    });
    const resize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
      }
    };
    window.addEventListener('resize', resize);
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange);
      window.removeEventListener('resize', resize);
      chartRef.current?.unsubscribeCrosshairMove(onCrosshairMove);
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        timeScale: {
          timeVisible: true,
          secondsVisible: shouldShowSeconds(timeframe)
        }
      });
    }
  }, [timeframe]);

  useEffect(() => {
    if (!candleSeriesRef.current) return;
    if (candles.length === 0) {
      candleSeriesRef.current.setData([]);
      candleSeriesRef.current.setMarkers([]);
      emaSeriesRef.current?.setData([]);
      volumeSeriesRef.current?.setData([]);
      vwapSeriesRef.current?.setData([]);
      supplySeriesRef.current?.setData([]);
      demandSeriesRef.current?.setData([]);
      entrySeriesRef.current?.setData([]);
      stopSeriesRef.current?.setData([]);
      tpSeriesRef.current?.setData([]);
      keyLinesRef.current.forEach((line) => candleSeriesRef.current?.removePriceLine(line));
      keyLinesRef.current = [];
      vpLinesRef.current.forEach((line) => candleSeriesRef.current?.removePriceLine(line));
      vpLinesRef.current = [];
      if (lastPriceLineRef.current) {
        candleSeriesRef.current.removePriceLine(lastPriceLineRef.current);
        lastPriceLineRef.current = null;
      }
      setCountdown('');
      writeHoverText('');
      latestHoverSnapshotRef.current = null;
      liveBarRef.current = null;
      lastCandleTimeRef.current = null;
      pausedRangeRef.current = null;
      return;
    }

    const timeScale = chartRef.current?.timeScale();
    const restoreRange = !followRealtimeRef.current;
    const priorLogicalRange = restoreRange ? pausedRangeRef.current ?? timeScale?.getVisibleLogicalRange() : null;

    const viewCandles = heikin ? heikinAshi(candles) : candles;
    const seriesData = viewCandles.map<CandlestickData>((c) => ({
      time: c.time as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));
    candleSeriesRef.current.setData(seriesData);
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(
        candles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)'
        }))
      );
      volumeSeriesRef.current.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 }
      });
    }
    const emaValues = ema(viewCandles.map((c) => c.close), DEFAULT_STRATEGY.emaPeriod);
    let prevColor = '#fbbf24';
    const emaData = emaValues.map((v, i) => {
      const prev = emaValues[i - 1];
      if (Number.isFinite(v) && Number.isFinite(prev)) {
        prevColor = v >= prev ? '#fbbf24' : '#ef4444';
      }
      return { time: viewCandles[i].time, value: v, color: prevColor };
    });
    emaSeriesRef.current?.setData(emaData);
    plotVWAP(candles);
    plotKeyLevels(candles);
    plotVolumeProfile(candles);
    plotMarkers(viewCandles, signalsForView, emaValues);
    plotSignalLevels(lastSignal, candles);
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(
        candles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'
        }))
      );
    }
    applyLastPriceLine(candles);

    const prevLast = lastCandleTimeRef.current;
    const nextLast = candles.at(-1)?.time ?? null;
    const appendedNewBar = prevLast != null && nextLast != null && nextLast > prevLast;
    lastCandleTimeRef.current = nextLast;

    if (restoreRange && priorLogicalRange) {
      try {
        timeScale?.setVisibleLogicalRange(priorLogicalRange);
        pausedRangeRef.current = priorLogicalRange;
      } catch {
        // ignore invalid ranges (e.g., symbol/timeframe switch)
      }
    } else if (followRealtimeRef.current && (appendedNewBar || prevLast == null)) {
      timeScale?.scrollToRealTime();
    }

    const lastCandle = candles.at(-1);
    liveBarRef.current = lastCandle
      ? {
          time: lastCandle.time,
          open: lastCandle.open,
          high: lastCandle.high,
          low: lastCandle.low,
          close: lastCandle.close,
          volume: lastCandle.volume
        }
      : null;
    const lastDisplay = seriesData.at(-1);
    if (lastDisplay && lastCandle) {
      latestHoverSnapshotRef.current = {
        timeSec: lastDisplay.time as number,
        open: lastDisplay.open,
        high: lastDisplay.high,
        low: lastDisplay.low,
        close: lastDisplay.close,
        volume: lastCandle.volume
      };
      if (!hoverActiveRef.current) {
        writeHoverText(formatHoverLine(latestHoverSnapshotRef.current, timeframeRef.current));
      }
    }
  }, [candles, heikin, lastSignal, signalsForView, showVwapEnabled, showKeyLevelsEnabled, showVolumeProfileEnabled]);

  useEffect(() => {
    if (!ticker || !Number.isFinite(ticker.last)) return;
    if (!candleSeriesRef.current) return;
    if (!candles.length) return;

    const timeScale = chartRef.current?.timeScale();
    const priorLogicalRange = !followRealtimeRef.current ? pausedRangeRef.current ?? timeScale?.getVisibleLogicalRange() : null;

    const price = ticker.last;

    if (lastPriceLineRef.current) {
      try {
        lastPriceLineRef.current.applyOptions({ price });
      } catch {
        // ignore (depends on library version)
      }
    }

    // For Heikin Ashi, keep candles as-is (derived from OHLCV) and just move the last price line.
    if (heikin) return;

    const tfSec = timeframeSeconds(timeframe);
    const nowSec = Math.floor(Date.now() / 1000);
    const bucketTime = Math.floor(nowSec / tfSec) * tfSec;

    const last = candles.at(-1);
    if (!last) return;

    // If our OHLCV is stale by > 1 bar, don't synthesize missing candles (it creates big "teleport" bars).
    // We'll just move the last price line and wait for the next OHLCV refresh.
    if (bucketTime < last.time || bucketTime > last.time + tfSec) return;

    const allowNewBar = tfSec < 86400; // don't synthesize daily/weekly bars
    const nextTime = allowNewBar && bucketTime === last.time + tfSec ? bucketTime : last.time;

    const base =
      liveBarRef.current && liveBarRef.current.time === nextTime
        ? liveBarRef.current
        : nextTime === last.time
          ? { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume }
          : { time: nextTime, open: price, high: price, low: price, close: price, volume: 0 };

    const next = {
      ...base,
      high: Math.max(base.high, price),
      low: Math.min(base.low, price),
      close: price
    };

    const isNewBar = next.time !== last.time;

    candleSeriesRef.current.update({
      time: next.time as Time,
      open: next.open,
      high: next.high,
      low: next.low,
      close: next.close
    });

    // Only update volume for the real last candle we fetched (we don't have true live volume).
    if (volumeSeriesRef.current && next.time === last.time) {
      volumeSeriesRef.current.update({
        time: next.time as Time,
        value: last.volume,
        color: next.close >= next.open ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'
      });
    }

    liveBarRef.current = next;
    if (!hoverActiveRef.current) {
      latestHoverSnapshotRef.current = {
        timeSec: next.time,
        open: next.open,
        high: next.high,
        low: next.low,
        close: next.close,
        volume: next.volume
      };
      writeHoverText(formatHoverLine(latestHoverSnapshotRef.current, timeframeRef.current));
    }

    if (priorLogicalRange) {
      try {
        timeScale?.setVisibleLogicalRange(priorLogicalRange);
        pausedRangeRef.current = priorLogicalRange;
      } catch {
        // ignore
      }
    } else if (followRealtimeRef.current && isNewBar) {
      timeScale?.scrollToRealTime();
    }
  }, [candles, heikin, ticker, timeframe]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!candles.length) return;
      const lastTime = candles.at(-1)!.time;
      const tfSec = timeframeSeconds(timeframe);
      const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - lastTime));
      const remaining = Math.max(0, tfSec - elapsed);
      setCountdown(formatRemaining(remaining));
    }, 1000);
    return () => clearInterval(interval);
  }, [candles, timeframe]);

  const buildTradeManagementMarkers = (
    signal: Signal,
    data: typeof candles,
    emaValues?: number[]
  ): SeriesMarker<Time | number>[] => {
    const plan = simulateTradePlan(signal, data, {
      emaValues,
      tpMultipliers: timeframeRef.current === '1m' || timeframeRef.current === '3m' ? [1.5, 3, 5, 8] : [1, 2, 3, 4],
      confirmBars: 2,
      maxHoldBars: 240,
      requireTpForExit: true
    });

    const isLong = signal.side === 'long';
    return plan.events.map((e) => {
      if (e.type === 'stop') {
        return {
          time: e.time,
          position: isLong ? 'belowBar' : 'aboveBar',
          color: '#ef4444',
          shape: 'square',
          text: e.label
        };
      }
      if (e.type === 'exit') {
        return {
          time: e.time,
          position: isLong ? 'aboveBar' : 'belowBar',
          color: '#a78bfa',
          shape: 'circle',
          text: e.label
        };
      }
      return {
        time: e.time,
        position: isLong ? 'aboveBar' : 'belowBar',
        color: '#60a5fa',
        shape: 'circle',
        text: e.label
      };
    });
  };

  const formatMarkerPrice = (value: number): string => {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    const decimals = abs >= 1000 ? 0 : abs >= 100 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
    return value.toFixed(decimals);
  };

  const plotMarkers = (data: typeof candles, sigs: Signal[], emaValues?: number[]) => {
    if (!candleSeriesRef.current) return;
    if (!sigs.length) {
      candleSeriesRef.current.setMarkers([]);
      return;
    }

    const recentSignals = sigs.slice(-2);
    const last = sigs.at(-1);
    const markers: SeriesMarker<Time | number>[] = [];

    recentSignals.forEach((s) => {
      const isLast = last?.id === s.id;
      const dir = s.side === 'long' ? 'Buy' : 'Short';
      markers.push({
        time: s.timestamp,
        position: 'inBar',
        color: s.side === 'long' ? '#16a34a' : '#ef4444',
        shape: s.side === 'long' ? 'arrowUp' : 'arrowDown',
        text: isLast ? `${dir} Signal: ${formatMarkerPrice(s.entry)}` : dir
      });
    });

    if (last) {
      markers.push(...buildTradeManagementMarkers(last, data, emaValues));
    }

    candleSeriesRef.current.setMarkers(markers.sort((a, b) => Number(a.time) - Number(b.time)).slice(-120));
  };

  const plotSignalLevels = (signal: Signal | undefined, data: typeof candles) => {
    if (!entrySeriesRef.current || !stopSeriesRef.current || !tpSeriesRef.current) return;
    if (!signal || data.length === 0) {
      entrySeriesRef.current.setData([]);
      stopSeriesRef.current.setData([]);
      tpSeriesRef.current.setData([]);
      return;
    }
    const lastTime = data.at(-1)?.time ?? signal.timestamp;
    const startTime = data.length > 10 ? data[data.length - 10].time : data[0].time;
    const lineData = (price: number) => [
      { time: startTime, value: price },
      { time: lastTime, value: price }
    ];
    entrySeriesRef.current.setData(lineData(signal.entry));
    stopSeriesRef.current.setData(lineData(signal.stop));
    // TP is managed dynamically (partials + trend change). Don't draw a fixed TP1 line.
    tpSeriesRef.current.setData([]);
  };


  const applyLastPriceLine = (data: typeof candles) => {
    if (!candleSeriesRef.current || data.length === 0) return;
    const last = data.at(-1)!;
    if (lastPriceLineRef.current) {
      candleSeriesRef.current.removePriceLine(lastPriceLineRef.current);
      lastPriceLineRef.current = null;
    }
    candleSeriesRef.current.applyOptions({
      lastValueVisible: true,
      priceLineVisible: true,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
    });
    lastPriceLineRef.current = candleSeriesRef.current.createPriceLine({
      price: last.close,
      color: '#38bdf8',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: 'Last'
    });
  };

  const plotVWAP = (data: typeof candles) => {
    if (!vwapSeriesRef.current) return;
    if (!showVwapEnabled || data.length === 0) {
      vwapSeriesRef.current.setData([]);
      return;
    }
    const lastDay = new Date((data.at(-1)?.time ?? 0) * 1000).getUTCDate();
    let cumPV = 0;
    let cumV = 0;
    const vwapData = data
      .filter((c) => new Date(c.time * 1000).getUTCDate() === lastDay)
      .map((c) => {
        const tp = (c.high + c.low + c.close) / 3;
        cumPV += tp * c.volume;
        cumV += c.volume;
        const v = cumV > 0 ? cumPV / cumV : tp;
        return { time: c.time, value: v };
      });
    vwapSeriesRef.current.setData(vwapData);
  };

  const keyLinesRef = useRef<Array<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>>([]);
  const vpLinesRef = useRef<Array<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>>([]);

  const plotKeyLevels = (data: typeof candles) => {
    if (!candleSeriesRef.current) return;
    keyLinesRef.current.forEach((line) => candleSeriesRef.current?.removePriceLine(line));
    keyLinesRef.current = [];
    if (!showKeyLevelsEnabled || data.length === 0) return;
    const last = data.at(-1)!;
    const lastDate = new Date(last.time * 1000);
    const lastWeek = getWeekNumber(lastDate);
    const dayCandles = data.filter((c) => {
      const d = new Date(c.time * 1000);
      return d.getUTCFullYear() === lastDate.getUTCFullYear() && d.getUTCMonth() === lastDate.getUTCMonth() && d.getUTCDate() === lastDate.getUTCDate();
    });
    const weekCandles = data.filter((c) => getWeekNumber(new Date(c.time * 1000)) === lastWeek);
    const dayOpen = dayCandles[0]?.open;
    const weekOpen = weekCandles[0]?.open;
    if (Number.isFinite(dayOpen)) {
      const line = candleSeriesRef.current.createPriceLine({
        price: dayOpen!,
        color: '#a855f7',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: 'Daily Open'
      });
      keyLinesRef.current.push(line);
    }
    if (Number.isFinite(weekOpen)) {
      const line = candleSeriesRef.current.createPriceLine({
        price: weekOpen!,
        color: '#f59e0b',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: 'Weekly Open'
      });
      keyLinesRef.current.push(line);
    }
  };

  const plotVolumeProfile = (data: typeof candles) => {
    if (!candleSeriesRef.current) return;
    vpLinesRef.current.forEach((line) => candleSeriesRef.current?.removePriceLine(line));
    vpLinesRef.current = [];
    if (!showVolumeProfileEnabled || data.length === 0) return;

    const profile = computeSessionVolumeProfile(data, 40);
    if (!profile) return;

    const addLine = (price: number, color: string, style: LineStyle, title: string) => {
      const line = candleSeriesRef.current!.createPriceLine({
        price,
        color,
        lineStyle: style,
        lineWidth: 1,
        axisLabelVisible: false,
        title
      });
      vpLinesRef.current.push(line);
    };

    addLine(profile.poc.price, '#f97316', LineStyle.Solid, 'POC');
    profile.hvn.forEach((b) => addLine(b.price, 'rgba(34,197,94,0.85)', LineStyle.Dashed, 'HVN'));
    profile.lvn.forEach((b) => addLine(b.price, 'rgba(251,191,36,0.85)', LineStyle.Dashed, 'LVN'));
  };

  const getWeekNumber = (date: Date) => {
    const temp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = temp.getUTCDay() || 7;
    temp.setUTCDate(temp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
    return Math.ceil(((+temp - +yearStart) / 86400000 + 1) / 7);
  };

  return (
    <div className="glass-panel p-2 h-full">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-1 text-xs text-slate-400">
        <span>
          Candles {heikin ? 'Heikin Ashi' : 'OHLC'} · Close in {countdown || '—'}
        </span>
        <span ref={hoverTextRef} className="min-w-0 truncate text-slate-300 tabular-nums justify-self-center" />
        <span>
          Last signal:{' '}
          {lastSignal
            ? `${lastSignal.side.toUpperCase()} ${((Date.now() / 1000 - lastSignal.timestamp) / 60).toFixed(1)}m ago`
            : 'None'}
        </span>
      </div>
      <div className="relative">
        {!followRealtime && (
          <button
            type="button"
            onClick={resumeFollowRealtime}
            className="absolute top-3 right-3 z-10 rounded-md border border-slate-700/60 bg-slate-900/70 px-3 py-1 text-xs text-slate-200 shadow hover:bg-slate-900/90"
          >
            Go to realtime
          </button>
        )}
        <div
          ref={containerRef}
          className="h-[560px]"
          onWheel={pauseFollowRealtime}
          onMouseDown={pauseFollowRealtime}
          onTouchStart={pauseFollowRealtime}
        />
      </div>
      <p className="text-[10px] mt-2 text-slate-500">
        Signals are informational only. No financial advice; trading futures carries real risk.
      </p>
    </div>
  );
}

function shouldShowSeconds(tf: Timeframe): boolean {
  return tf === '1m' || tf === '3m' || tf === '5m';
}

function formatRemaining(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

type HoverLineSnapshot = {
  timeSec: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ema?: number;
  vwap?: number;
};

function formatHoverLine(s: HoverLineSnapshot, tf: Timeframe): string {
  const t = formatHoverTime(s.timeSec, tf);
  const o = formatPrice(s.open);
  const h = formatPrice(s.high);
  const l = formatPrice(s.low);
  const c = formatPrice(s.close);

  const diff = Number.isFinite(s.open) && s.open !== 0 ? s.close - s.open : NaN;
  const pct = Number.isFinite(s.open) && s.open !== 0 ? (diff / s.open) * 100 : NaN;
  const delta =
    Number.isFinite(diff) && Number.isFinite(pct)
      ? ` Δ ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`
      : '';

  const v = Number.isFinite(s.volume) ? ` V ${formatCompactNumber(s.volume!)}` : '';
  const ema = Number.isFinite(s.ema) ? ` EMA ${formatPrice(s.ema!)}` : '';
  const vwap = Number.isFinite(s.vwap) ? ` VWAP ${formatPrice(s.vwap!)}` : '';

  return `${t}  O ${o}  H ${h}  L ${l}  C ${c}${delta}${v}${ema}${vwap}`;
}

function formatHoverTime(timeSec: number, tf: Timeframe): string {
  const d = new Date(timeSec * 1000);
  if (tf === 'D' || tf === 'W') {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const showSeconds = shouldShowSeconds(tf);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: showSeconds ? '2-digit' : undefined,
    hour12: false
  });
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function isSignalSane(signal: Signal, referencePrice: number): boolean {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return true;
  if (!Number.isFinite(signal.entry) || signal.entry <= 0) return false;
  const ratio = signal.entry / referencePrice;
  // Hard guard against stale/mismatched state (e.g., BTC-level prices on XRP chart).
  return ratio > 0.05 && ratio < 20;
}
