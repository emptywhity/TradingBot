import React, { useState } from 'react';
import { clsx } from 'clsx';
import { useMarketStore } from '@/store/useMarketStore';
import { AccountModal } from '@/components/AccountModal';

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

  const [accountOpen, setAccountOpen] = useState(false);

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
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-slate-600"
          >
            Account
          </button>
        </div>
      </div>

      <AccountModal open={accountOpen} onClose={() => setAccountOpen(false)} />
    </>
  );
}
