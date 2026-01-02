import React, { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { RealDataAdapter } from '@/adapters/exchangeAdapter';
import { timeframeSeconds } from '@/services/signalEngine';
import { summarizePerformance } from '@/services/performance';
import { getExecutionCosts } from '@/config/executionCosts';
import { DataSource, useMarketStore } from '@/store/useMarketStore';
import { Signal, Timeframe } from '@/types';

type Group = {
  symbol: string;
  timeframe: Timeframe;
  dataSource: DataSource;
  signals: Signal[];
};

type Row = {
  key: string;
  symbol: string;
  timeframe: Timeframe;
  dataSource: DataSource;
  evaluatedTrades: number;
  totalSignals: number;
  winRateTp1: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  maxDrawdownR: number | null;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  let active = 0;
  return new Promise((resolve, reject) => {
    const next = () => {
      if (index >= items.length && active === 0) return resolve(results);
      while (active < limit && index < items.length) {
        const item = items[index++];
        active += 1;
        fn(item)
          .then((r) => results.push(r))
          .catch(reject)
          .finally(() => {
            active -= 1;
            next();
          });
      }
    };
    next();
  });
}

function fmtPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(0)}%`;
}

function fmtNum(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

export function GlobalPerformancePanel({ signals }: { signals: Signal[] }) {
  const { role, symbol, timeframe, dataSource, setSymbol, setTimeframe, setDataSource } = useMarketStore((s) => ({
    role: s.role,
    symbol: s.symbol,
    timeframe: s.timeframe,
    dataSource: s.dataSource,
    setSymbol: s.setSymbol,
    setTimeframe: s.setTimeframe,
    setDataSource: s.setDataSource
  }));

  const [windowDays, setWindowDays] = useState<7 | 30>(7);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [refreshId, setRefreshId] = useState(0);
  const executionCosts = useMemo(() => getExecutionCosts(), []);

  const maxHoldBars = 60;
  const maxGroups = 20;
  const windowStart = useMemo(
    () => Math.floor(Date.now() / 1000) - windowDays * 86400,
    [refreshId, windowDays]
  );

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const s of signals) {
      if (s.timestamp < windowStart) continue;
      const ds: DataSource = s.dataSource === 'spot' ? 'spot' : 'futures';
      const tf = s.timeframe;
      const key = `${ds}|${s.symbol}|${tf}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { symbol: s.symbol, timeframe: tf, dataSource: ds, signals: [s] });
      } else {
        existing.signals.push(s);
      }
    }
    return [...map.values()].sort((a, b) => b.signals.length - a.signals.length).slice(0, maxGroups);
  }, [signals, windowStart]);

  useEffect(() => {
    if (role === 'standard') return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const adapterFutures = new RealDataAdapter({ source: 'futures' });
        const adapterSpot = new RealDataAdapter({ source: 'spot' });
        const getAdapter = (ds: DataSource) => (ds === 'spot' ? adapterSpot : adapterFutures);

        const computed = await mapLimit(groups, 3, async (g) => {
          const desired = Math.ceil((windowDays * 86400) / timeframeSeconds(g.timeframe) + maxHoldBars + 10);
          const candles = await getAdapter(g.dataSource).getOHLCV({ symbol: g.symbol, timeframe: g.timeframe, limit: desired });
          const summary = summarizePerformance(g.signals, candles, { maxHoldBars, executionCosts });
          return {
            key: `${g.dataSource}|${g.symbol}|${g.timeframe}`,
            symbol: g.symbol,
            timeframe: g.timeframe,
            dataSource: g.dataSource,
            evaluatedTrades: summary.evaluatedTrades,
            totalSignals: summary.totalSignals,
            winRateTp1: summary.winRateTp1,
            expectancyR: summary.expectancyR,
            profitFactor: summary.profitFactor,
            maxDrawdownR: summary.maxDrawdownR
          } satisfies Row;
        });

        if (!cancelled) setRows(computed);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ? String(e.message) : 'Failed to build global stats.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [executionCosts, groups, maxHoldBars, role, windowDays, refreshId]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toUpperCase();
    const base = q ? rows.filter((r) => r.symbol.includes(q) || `${r.symbol}${r.timeframe}`.includes(q)) : rows;
    return [...base].sort((a, b) => (b.expectancyR ?? -999) - (a.expectancyR ?? -999) || b.evaluatedTrades - a.evaluatedTrades);
  }, [query, rows]);

  if (role === 'standard') return null;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-1 gap-2">
        <h4 className="text-xs uppercase text-slate-500">Global performance</h4>
        <div className="flex items-center gap-1">
          {[7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindowDays(d as 7 | 30)}
              className={clsx(
                'px-2 py-1 rounded text-[11px] border transition',
                windowDays === d
                  ? 'bg-slate-800 text-white border-slate-700'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600'
              )}
            >
              {d}d
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRefreshId((n) => n + 1)}
            className="px-2 py-1 rounded text-[11px] border border-slate-800 bg-slate-900 text-slate-200 hover:border-slate-600"
            title="Refresh stats"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mb-2">
        <input
          className="w-full bg-slate-900/50 border border-slate-800 rounded px-2 py-1 text-xs text-slate-100"
          placeholder="Filter symbol (e.g. BTC)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error ? <div className="text-xs text-rose-300 mb-2">{error}</div> : null}
      {loading ? <div className="text-xs text-slate-500 mb-2">Computing…</div> : null}

      <div className="border border-slate-800 rounded bg-slate-900/20 overflow-hidden">
        <div className="grid grid-cols-7 gap-0 text-[11px] text-slate-400 border-b border-slate-800 bg-slate-950/40 whitespace-nowrap">
          <div className="px-2 py-1 col-span-2">Symbol/TF</div>
          <div className="px-2 py-1">DS</div>
          <div className="px-2 py-1">Trades</div>
          <div className="px-2 py-1">TP1%</div>
          <div className="px-2 py-1">ExpR</div>
          <div className="px-2 py-1">MaxDD</div>
        </div>
        {filteredRows.length ? (
          filteredRows.map((r) => {
            const active = r.symbol === symbol && r.timeframe === timeframe && r.dataSource === dataSource;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => {
                  setDataSource(r.dataSource);
                  setSymbol(r.symbol);
                  setTimeframe(r.timeframe);
                }}
                className={clsx(
                  'w-full text-left grid grid-cols-7 gap-0 text-[11px] border-b border-slate-800 last:border-b-0 whitespace-nowrap',
                  active ? 'bg-slate-800/50' : 'hover:bg-slate-900/60'
                )}
                title="Jump to chart"
              >
                <div className="px-2 py-1 text-slate-200 col-span-2">{r.symbol} {r.timeframe}</div>
                <div className="px-2 py-1 text-slate-400">{r.dataSource === 'spot' ? 'spot' : 'fut'}</div>
                <div className="px-2 py-1 text-slate-200">
                  {r.evaluatedTrades}/{r.totalSignals}
                </div>
                <div className="px-2 py-1 text-slate-200">{fmtPct(r.winRateTp1)}</div>
                <div className="px-2 py-1 text-slate-200">{fmtNum(r.expectancyR)}</div>
                <div className="px-2 py-1 text-slate-200">{fmtNum(r.maxDrawdownR)}</div>
              </button>
            );
          })
        ) : (
          <div className="px-2 py-2 text-xs text-slate-500">
            No rows yet. Generate some signals first.
          </div>
        )}
      </div>

      <div className="mt-2 text-[11px] text-slate-500">
        Top {maxGroups} symbol/timeframe combos by signal count. Trades show evaluated/total; older signals may be out of candle coverage.
      </div>
    </div>
  );
}
