import React from 'react';
import { useMarketStore } from '@/store/useMarketStore';

export function Header() {
  const { symbol, timeframe, ticker, dataSource, lastCandleTs, orderBook, feedInfo, gateMode, noviceMode } = useMarketStore((s) => ({
    symbol: s.symbol,
    timeframe: s.timeframe,
    ticker: s.ticker,
    dataSource: s.dataSource,
    lastCandleTs: s.lastCandleTs,
    orderBook: s.orderBook,
    feedInfo: s.feedInfo,
    gateMode: s.gateMode,
    noviceMode: s.noviceMode
  }));
  const last = ticker?.last;
  const spread = ticker ? ticker.ask - ticker.bid : undefined;
  const lastCandleLabel = lastCandleTs ? new Date(lastCandleTs * 1000).toLocaleTimeString() : '—';
  const obLabel = orderBook?.timestamp ? new Date(orderBook.timestamp).toLocaleTimeString() : '—';
  const sourceLine = [feedInfo?.ohlcvSource, feedInfo?.tickerSource, feedInfo?.orderBookSource]
    .filter(Boolean)
    .join(' / ');

  return (
    <header className="flex flex-wrap items-center justify-between mb-3 gap-3">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Futures Signal Dashboard</h1>
        <p className="text-xs text-slate-500">Signal-only. No financial advice; trading futures carries real risk.</p>
      </div>
      <div className="glass-panel px-3 py-2 text-sm flex items-center gap-4">
        <Info label="Symbol" value={symbol} />
        <Info label="Timeframe" value={timeframe} />
        <Info label="Exchange" value={dataSource} />
        <Info label="Gate" value={gateMode} />
        <Info label="Last" value={last !== undefined ? last.toFixed(2) : '—'} />
        <Info label="Spread" value={spread !== undefined ? spread.toFixed(2) : '—'} />
        <Info label="Last candle" value={lastCandleLabel} />
        {!noviceMode ? <Info label="Order book" value={obLabel} /> : null}
        <Info label="Sources" value={sourceLine || '—'} />
      </div>
    </header>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-slate-200">{value}</div>
    </div>
  );
}
