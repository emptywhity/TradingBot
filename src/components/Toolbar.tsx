import React, { useState } from 'react';
import { clsx } from 'clsx';
import { useMarketStore } from '@/store/useMarketStore';

export function Toolbar() {
  const {
    symbols,
    symbol,
    setSymbol,
    timeframes,
    timeframe,
    setTimeframe,
    heikin,
    toggleHeikin,
    role,
    setRole,
    showVwap,
    toggleVwap,
    showKeyLevels,
    toggleKeyLevels,
    showVolumeProfile,
    toggleVolumeProfile,
    scannerEnabled,
    setScannerEnabled,
    dataSource,
    setDataSource,
    gateMode,
    setGateMode
  } = useMarketStore((s) => ({
    symbols: s.symbols,
    symbol: s.symbol,
    setSymbol: s.setSymbol,
    timeframes: s.timeframes,
    timeframe: s.timeframe,
    setTimeframe: s.setTimeframe,
    heikin: s.heikin,
    toggleHeikin: s.toggleHeikin,
    role: s.role,
    setRole: s.setRole,
    showVwap: s.showVwap,
    toggleVwap: s.toggleVwap,
    showKeyLevels: s.showKeyLevels,
    toggleKeyLevels: s.toggleKeyLevels,
    showVolumeProfile: s.showVolumeProfile,
    toggleVolumeProfile: s.toggleVolumeProfile,
    scannerEnabled: s.scannerEnabled,
    setScannerEnabled: s.setScannerEnabled,
    dataSource: s.dataSource,
    setDataSource: s.setDataSource,
    gateMode: s.gateMode,
    setGateMode: s.setGateMode
  }));

  const [vipInfoOpen, setVipInfoOpen] = useState(false);
  const showAdmin = import.meta.env.VITE_ENABLE_ADMIN_ROLE === '1';

  return (
    <>
      <div className="glass-panel p-3 mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Symbol</span>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-slate-900 text-slate-100 border border-slate-800 rounded px-2 py-1 text-sm"
          >
            {symbols.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Exchange</span>
          <select
            value={dataSource}
            onChange={(e) => setDataSource(e.target.value as any)}
            className="bg-slate-900 text-slate-100 border border-slate-800 rounded px-2 py-1 text-sm"
          >
            <option value="futures">Binance Futures</option>
            <option value="spot">Binance Spot</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Gate</span>
          <div className="flex gap-1">
            {(['default', 'aggressive', 'conservative'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setGateMode(mode)}
                className={clsx(
                  'px-2 py-1 rounded text-xs border border-slate-800 hover:border-slate-600 transition',
                  gateMode === mode ? 'bg-slate-800 text-white' : 'bg-slate-900 text-slate-300'
                )}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Role</span>
          <select
            value={role}
            onChange={(e) => {
              const next = e.target.value as any;
              const wasVip = role !== 'standard';
              setRole(next);
              if (next === 'vip' && !wasVip) setVipInfoOpen(true);
            }}
            className="bg-slate-900 text-slate-100 border border-slate-800 rounded px-2 py-1 text-sm"
          >
            <option value="standard">Standard</option>
            <option value="vip">VIP</option>
            {showAdmin ? <option value="admin">Admin</option> : null}
          </select>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={clsx(
                'px-2 py-1 rounded text-xs border border-slate-800 hover:border-slate-600 transition',
                tf === timeframe ? 'bg-slate-800 text-white' : 'bg-slate-900 text-slate-300'
              )}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {role !== 'standard' && (
            <>
              <label className="flex items-center gap-1 text-sm text-slate-300">
                <input type="checkbox" checked={showVwap} onChange={toggleVwap} />
                VWAP
              </label>
              <label className="flex items-center gap-1 text-sm text-slate-300">
                <input type="checkbox" checked={showKeyLevels} onChange={toggleKeyLevels} />
                Daily/Weekly open
              </label>
              <label className="flex items-center gap-1 text-sm text-slate-300">
                <input type="checkbox" checked={showVolumeProfile} onChange={toggleVolumeProfile} />
                VPVR (session)
              </label>
              <label className="flex items-center gap-1 text-sm text-slate-300">
                <input type="checkbox" checked={scannerEnabled} onChange={(e) => setScannerEnabled(e.target.checked)} />
                Scanner
              </label>
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={heikin} onChange={toggleHeikin} />
            Heikin Ashi
          </label>
        </div>
      </div>

      {vipInfoOpen ? <VipInfoModal onClose={() => setVipInfoOpen(false)} /> : null}
    </>
  );
}

function VipInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-950 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="VIP features"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">VIP features</h3>
            <p className="text-xs text-slate-400 mt-1">
              Decision support tools (sizing, stats, context). Informational only. No execution. No financial advice; trading futures carries real risk.
            </p>
          </div>
          <button
            className="shrink-0 rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-slate-600"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-4 text-sm text-slate-200">
          <div>
            <div className="font-medium">Risk calculator (position sizing)</div>
            <ul className="text-xs text-slate-400 list-disc list-inside space-y-1 mt-1">
              <li>Size trades from your account (USD) + risk %: qty, notional, margin, max loss.</li>
              <li>Fees-aware PnL view + a simple liquidation estimate (leveraged futures).</li>
            </ul>
          </div>

          <div>
            <div className="font-medium">Performance analytics (7d / 30d)</div>
            <ul className="text-xs text-slate-400 list-disc list-inside space-y-1 mt-1">
              <li>Win rate (TP1), expectancy (R), profit factor, max drawdown.</li>
              <li>Per-chart breakdown + global table by symbol/timeframe to spot what works lately (click to jump).</li>
            </ul>
          </div>

          <div>
            <div className="font-medium">Futures pro (context + deltas)</div>
            <ul className="text-xs text-slate-400 list-disc list-inside space-y-1 mt-1">
              <li>Funding, open interest, and mark vs index premium with 1h/24h deltas + mini charts.</li>
              <li>Spike alerts (toast + optional Discord) when OI/premium/funding move fast.</li>
            </ul>
          </div>

          <div>
            <div className="font-medium">Scanner + opportunities</div>
            <ul className="text-xs text-slate-400 list-disc list-inside space-y-1 mt-1">
              <li>Scans your watchlist across timeframes and surfaces only a few top candidates.</li>
              <li>Click an opportunity to jump straight to the chart.</li>
            </ul>
          </div>

          <div>
            <div className="font-medium">Chart tools</div>
            <ul className="text-xs text-slate-400 list-disc list-inside space-y-1 mt-1">
              <li>VWAP: session mean price to contextualize trend vs mean-reversion.</li>
              <li>Daily/Weekly open: common pivots and S/R references (UTC).</li>
              <li>VPVR (session): approximate volume profile (POC/HVN/LVN) from OHLCV.</li>
            </ul>
          </div>

          <div className="pt-2 text-xs text-slate-500 border-t border-slate-800">
            Note: VIP is a UI role toggle in this demo. A production version would add login + subscription gating on the backend.
          </div>
        </div>
      </div>
    </div>
  );
}
