import React, { useMemo } from 'react';
import { clsx } from 'clsx';
import { Candle, Signal, Timeframe } from '@/types';
import { DataSource } from '@/store/useMarketStore';
import { evaluateSignal } from '@/services/performance';

type Row = {
  label: string;
  trades: number;
  winRateTp1: number | null;
  expectancyR: number | null;
};

function fmtPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(0)}%`;
}

function fmtNum(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

export function ScoreCalibrationPanel({
  symbol,
  timeframe,
  dataSource,
  gateMode,
  signals,
  candles,
  maxHoldBars = 60
}: {
  symbol: string;
  timeframe: Timeframe;
  dataSource: DataSource;
  gateMode: 'default' | 'aggressive' | 'conservative';
  signals: Signal[];
  candles: Candle[];
  maxHoldBars?: number;
}) {
  const evaluated = useMemo(() => {
    const scoped = signals
      .filter((s) => s.symbol === symbol && s.timeframe === timeframe)
      .filter((s) => (s.dataSource ?? 'futures') === dataSource)
      .filter((s) => (s.gateMode ?? 'default') === gateMode)
      .sort((a, b) => a.timestamp - b.timestamp);

    const trades = scoped
      .map((s) => evaluateSignal(s, candles, { maxHoldBars }))
      .filter((t) => t.outcome !== 'open');

    // Keep the most recent evaluated trades to avoid skew from stale/out-of-range data.
    return trades.slice(-120);
  }, [candles, dataSource, gateMode, maxHoldBars, signals, symbol, timeframe]);

  const rows: Row[] = useMemo(() => {
    if (!evaluated.length) return [];

    const buckets = [
      { min: 0, max: 60, label: '<60' },
      { min: 60, max: 70, label: '60–69' },
      { min: 70, max: 80, label: '70–79' },
      { min: 80, max: 90, label: '80–89' },
      { min: 90, max: 101, label: '90–100' }
    ];

    return buckets.map((b) => {
      const bucket = evaluated.filter((t) => t.signal.score >= b.min && t.signal.score < b.max);
      if (!bucket.length) {
        return { label: b.label, trades: 0, winRateTp1: null, expectancyR: null };
      }
      const wins = bucket.filter((t) => t.outcome === 'tp1').length;
      const expectancy = bucket.reduce((acc, t) => acc + t.r, 0) / bucket.length;
      return {
        label: b.label,
        trades: bucket.length,
        winRateTp1: wins / bucket.length,
        expectancyR: expectancy
      };
    });
  }, [evaluated]);

  const best = useMemo(() => {
    if (!evaluated.length) return null;
    const thresholds = [50, 60, 65, 70, 75, 80, 85, 90, 95];
    const minTrades = 10;

    let bestRow: { thr: number; trades: number; expectancyR: number } | null = null;
    for (const thr of thresholds) {
      const bucket = evaluated.filter((t) => t.signal.score >= thr);
      if (bucket.length < minTrades) continue;
      const expectancy = bucket.reduce((acc, t) => acc + t.r, 0) / bucket.length;
      if (!bestRow || expectancy > bestRow.expectancyR) bestRow = { thr, trades: bucket.length, expectancyR: expectancy };
    }
    return bestRow;
  }, [evaluated]);

  if (!candles.length) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs uppercase text-slate-500">Score calibration</h4>
        <span className="text-[11px] text-slate-500">Recent {evaluated.length || 0} trades</span>
      </div>

      <div className="border border-slate-800 rounded bg-slate-900/20 overflow-hidden">
        <div className="grid grid-cols-4 gap-0 text-[11px] text-slate-400 border-b border-slate-800 bg-slate-950/40 whitespace-nowrap">
          <div className="px-2 py-1">Score</div>
          <div className="px-2 py-1">Trades</div>
          <div className="px-2 py-1">TP1%</div>
          <div className="px-2 py-1">ExpR</div>
        </div>
        {rows.length ? (
          rows.map((r) => (
            <div key={r.label} className="grid grid-cols-4 gap-0 text-[11px] text-slate-200 border-b border-slate-800 last:border-b-0">
              <div className="px-2 py-1 text-slate-300">{r.label}</div>
              <div className="px-2 py-1">{r.trades || '—'}</div>
              <div className="px-2 py-1">{fmtPct(r.winRateTp1)}</div>
              <div className={clsx('px-2 py-1', (r.expectancyR ?? 0) > 0 ? 'text-emerald-300' : (r.expectancyR ?? 0) < 0 ? 'text-rose-300' : '')}>
                {fmtNum(r.expectancyR, 2)}
              </div>
            </div>
          ))
        ) : (
          <div className="px-2 py-2 text-xs text-slate-500">No evaluated trades yet.</div>
        )}
      </div>

      <div className="mt-2 text-[11px] text-slate-500">
        Uses the last {evaluated.length || 0} evaluated trades (max {maxHoldBars} bars hold). Small sample sizes on low timeframes can be noisy.
      </div>

      {best ? (
        <div className="mt-2 text-[11px] text-slate-300">
          Suggested threshold: <span className="text-slate-100">score ≥ {best.thr}</span> • ExpR {best.expectancyR.toFixed(2)} on {best.trades} trades.
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-slate-500">Need more trades to suggest a threshold (≥10 evaluated).</div>
      )}
    </div>
  );
}

