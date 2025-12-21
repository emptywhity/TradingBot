import React from 'react';
import { useMarketStore } from '@/store/useMarketStore';

export function OrderBookPanel() {
  const { orderBook, orderBookStatus } = useMarketStore((s) => ({
    orderBook: s.orderBook,
    orderBookStatus: s.orderBookStatus
  }));
  const ts = orderBook?.timestamp;
  const tsLabel = Number.isFinite(ts) ? new Date(ts as number).toLocaleTimeString() : '—';
  const asks = normalize(orderBook?.asks ?? [], 'asc');
  const bids = normalize(orderBook?.bids ?? [], 'desc');

  return (
    <div className="glass-panel p-2 h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-200">Order Book</h3>
        <span className="text-xs text-slate-500">{tsLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] overflow-y-auto flex-1 pl-1 pr-1">
        <SideColumn side="Ask" color="text-bear" rows={asks} emptyMsg={orderBookStatus} align="left" />
        <SideColumn side="Bid" color="text-bull" rows={bids} emptyMsg={orderBookStatus} align="right" />
      </div>
    </div>
  );
}

type Row = { price: number; size: number; cumulative: number };

function normalize(entries: { price: number; size: number }[], direction: 'asc' | 'desc'): Row[] {
  const sorted = [...entries].filter((e) => Number.isFinite(e.price) && Number.isFinite(e.size));
  sorted.sort((a, b) => (direction === 'asc' ? a.price - b.price : b.price - a.price));
  let acc = 0;
  return sorted.slice(0, 20).map((e) => {
    acc += e.size;
    return { ...e, cumulative: acc };
  });
}

function SideColumn({
  side,
  color,
  rows,
  emptyMsg,
  align
}: {
  side: 'Ask' | 'Bid';
  color: string;
  rows: Row[];
  emptyMsg?: string;
  align?: 'left' | 'right';
}) {
  const colTemplate = 'grid grid-cols-[72px_58px]';
  const priceAlign = align === 'right' ? 'text-left' : 'text-right';
  const sizeAlign = 'text-right';
  return (
    <div>
      <div className={`${colTemplate} text-slate-400 mb-1 font-medium tracking-tight`}>
        <span className={`${priceAlign}`}>{side}</span>
        <span className={`${sizeAlign}`}>Sz</span>
      </div>
      <div className="space-y-1">
        {rows.length ? (
          rows.map((r, idx) => (
            <div
              key={`${side}-${idx}`}
              className={`${colTemplate} ${color} font-mono tracking-tighter whitespace-nowrap leading-tight`}
            >
              <span className={`${priceAlign}`}>{r.price.toFixed(2)}</span>
              <span className={`${sizeAlign}`}>{formatSize(r.size)}</span>
            </div>
          ))
        ) : (
          <p className="text-slate-500">{emptyMsg ?? 'No data'}</p>
        )}
      </div>
    </div>
  );
}

function formatSize(size: number): string {
  const abs = Math.abs(size);
  if (abs >= 1_000_000) return `${(size / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(size / 1_000).toFixed(2)}K`;
  if (abs >= 1) return size.toFixed(2);
  if (abs >= 0.01) return size.toFixed(3);
  return size.toFixed(4);
}
