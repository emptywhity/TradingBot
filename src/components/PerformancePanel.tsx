import React, { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Candle, Signal } from '@/types';
import { summarizePerformance } from '@/services/performance';
import { getExecutionCosts } from '@/config/executionCosts';

type GateKey = 'default' | 'aggressive' | 'conservative' | 'unknown';

const GATES: GateKey[] = ['default', 'aggressive', 'conservative', 'unknown'];

function gateLabel(gate: GateKey): string {
  return gate === 'unknown' ? 'unknown' : gate;
}

function fmtPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(0)}%`;
}

function fmtNum(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

function fmtInt(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}`;
}

export function PerformancePanel({
  symbol,
  timeframe,
  signals,
  candles
}: {
  symbol: string;
  timeframe: string;
  signals: Signal[];
  candles: Candle[];
}) {
  const [windowDays, setWindowDays] = useState<7 | 30>(7);
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - windowDays * 86400;
  const maxHoldBars = 60;
  const executionCosts = useMemo(() => getExecutionCosts(), []);

  const rows = useMemo(() => {
    const scoped = signals.filter((s) => s.symbol === symbol && s.timeframe === timeframe && s.timestamp >= windowStart);
    return GATES.map((gate) => {
      const bucket = scoped.filter((s) => (gate === 'unknown' ? !s.gateMode : s.gateMode === gate));
      const summary = summarizePerformance(bucket, candles, { maxHoldBars, executionCosts });
      return { gate, summary };
    });
  }, [candles, executionCosts, signals, symbol, timeframe, windowStart]);

  const total = useMemo(() => {
    const scoped = signals.filter((s) => s.symbol === symbol && s.timeframe === timeframe && s.timestamp >= windowStart);
    return summarizePerformance(scoped, candles, { maxHoldBars, executionCosts });
  }, [candles, executionCosts, signals, symbol, timeframe, windowStart]);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs uppercase text-slate-500">Performance</h4>
        <div className="flex items-center gap-1">
          {[7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindowDays(d as 7 | 30)}
              className={clsx(
                'px-2 py-1 rounded text-[11px] border transition',
                windowDays === d ? 'bg-slate-800 text-white border-slate-700' : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600'
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="border border-slate-800 rounded bg-slate-900/20 overflow-hidden">
        <div className="grid grid-cols-[1.9fr_1.1fr_1fr_1fr_1fr_1fr] gap-0 text-[11px] text-slate-400 border-b border-slate-800 bg-slate-950/40 whitespace-nowrap">
          <div className="px-2 py-1 min-w-0">Gate</div>
          <div className="px-2 py-1 min-w-0">Trades</div>
          <div className="px-2 py-1 min-w-0">TP1%</div>
          <div className="px-2 py-1 min-w-0">ExpR</div>
          <div className="px-2 py-1 min-w-0">PF</div>
          <div className="px-2 py-1 min-w-0">MaxDD</div>
        </div>
        {rows.map(({ gate, summary }) => (
          <div
            key={gate}
            className="grid grid-cols-[1.9fr_1.1fr_1fr_1fr_1fr_1fr] gap-0 text-[11px] text-slate-200 border-b border-slate-800 last:border-b-0 whitespace-nowrap"
          >
            <div className="px-2 py-1 text-slate-300 min-w-0 truncate">{gateLabel(gate)}</div>
            <div className="px-2 py-1 text-slate-200 min-w-0">
              {summary.evaluatedTrades}/{summary.totalSignals}
            </div>
            <div className="px-2 py-1 min-w-0">{fmtPct(summary.winRateTp1)}</div>
            <div className="px-2 py-1 min-w-0">{fmtNum(summary.expectancyR)}</div>
            <div className="px-2 py-1 min-w-0">{fmtNum(summary.profitFactor)}</div>
            <div className="px-2 py-1 min-w-0">{fmtNum(summary.maxDrawdownR)}</div>
          </div>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-slate-500">
        Total: {total.evaluatedTrades}/{total.totalSignals} · Avg bars held: {fmtInt(total.avgBarsHeld)} · Time exit at {maxHoldBars} bars (close).
      </div>
    </div>
  );
}
