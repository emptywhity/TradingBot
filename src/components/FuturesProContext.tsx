import React, { useMemo } from 'react';
import { FuturesProData } from '@/types';
import { FuturesProSample, loadFuturesProHistory, premiumPct, sampleAtOrBefore } from '@/services/futuresProHistory';

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function fmt(value: number | null, decimals = 2, suffix = ''): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}${suffix}`;
}

function percentChange(now: number, prev: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return null;
  return ((now - prev) / prev) * 100;
}

function downsample(values: number[], maxPoints = 80): number[] {
  if (values.length <= maxPoints) return values;
  const step = Math.ceil(values.length / maxPoints);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += step) out.push(values[i]);
  return out;
}

export function FuturesProContext({ symbol, futuresPro }: { symbol: string; futuresPro?: FuturesProData }) {
  const samples = useMemo(() => {
    // Re-read when current values change (history is updated by the polling hook).
    const _ = futuresPro?.markPrice ?? futuresPro?.openInterest ?? futuresPro?.lastFundingRate;
    void _;
    return loadFuturesProHistory(symbol);
  }, [symbol, futuresPro?.markPrice, futuresPro?.openInterest, futuresPro?.lastFundingRate]);

  const nowMs = Date.now();
  const last: FuturesProSample | undefined = samples.at(-1);
  const past1h = sampleAtOrBefore(samples, nowMs - 60 * 60 * 1000);
  const past24h = sampleAtOrBefore(samples, nowMs - 24 * 60 * 60 * 1000);

  const currentFundingPct = (futuresPro?.lastFundingRate ?? last?.lastFundingRate ?? 0) * 100;
  const currentOi = futuresPro?.openInterest ?? last?.openInterest ?? 0;
  const currentPremiumPct =
    futuresPro && Number.isFinite(futuresPro.indexPrice) && futuresPro.indexPrice
      ? ((futuresPro.markPrice - futuresPro.indexPrice) / futuresPro.indexPrice) * 100
      : last
        ? premiumPct(last)
        : 0;

  const funding1h = past1h ? currentFundingPct - past1h.lastFundingRate * 100 : null;
  const funding24h = past24h ? currentFundingPct - past24h.lastFundingRate * 100 : null;
  const oi1hPct = past1h ? percentChange(currentOi, past1h.openInterest) : null;
  const oi24hPct = past24h ? percentChange(currentOi, past24h.openInterest) : null;
  const premium1h = past1h ? currentPremiumPct - premiumPct(past1h) : null;
  const premium24h = past24h ? currentPremiumPct - premiumPct(past24h) : null;

  const fundingSeries = downsample(samples.map((s) => s.lastFundingRate * 100));
  const oiSeries = downsample(samples.map((s) => s.openInterest));
  const premiumSeries = downsample(samples.map((s) => premiumPct(s)));

  return (
    <div className="mt-2 space-y-2 text-xs">
      <ContextCard
        title="Funding"
        now={`${currentFundingPct.toFixed(3)}%`}
        d1h={fmt(funding1h, 3, 'pp')}
        d24h={fmt(funding24h, 3, 'pp')}
        series={fundingSeries}
        color="#38bdf8"
      />
      <ContextCard
        title="Open interest"
        now={formatCompact(currentOi)}
        d1h={oi1hPct === null ? '—' : fmt(oi1hPct, 2, '%')}
        d24h={oi24hPct === null ? '—' : fmt(oi24hPct, 2, '%')}
        series={oiSeries}
        color="#a855f7"
      />
      <ContextCard
        title="Premium"
        now={`${currentPremiumPct.toFixed(3)}%`}
        d1h={fmt(premium1h, 3, 'pp')}
        d24h={fmt(premium24h, 3, 'pp')}
        series={premiumSeries}
        color="#22c55e"
      />
      <div className="text-[11px] text-slate-500">
        Deltas use the nearest sample at/under 1h/24h ago (history stored locally, ~1 point/min).
      </div>
    </div>
  );
}

function ContextCard({
  title,
  now,
  d1h,
  d24h,
  series,
  color
}: {
  title: string;
  now: string;
  d1h: string;
  d24h: string;
  series: number[];
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 bg-slate-900/30 border border-slate-800 rounded px-2 py-2">
      <div className="min-w-0">
        <div className="text-[11px] text-slate-400">{title}</div>
        <div className="text-slate-100">{now}</div>
        <div className="text-[11px] text-slate-400">
          <span className="mr-2">1h: {d1h}</span>
          <span>24h: {d24h}</span>
        </div>
      </div>
      <div className="w-24 h-10 shrink-0">
        <Sparkline values={series} color={color} />
      </div>
    </div>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const pts = useMemo(() => {
    const clean = values.filter((v) => Number.isFinite(v));
    if (clean.length < 2) return '';
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;
    return clean
      .map((v, i) => {
        const x = (i / (clean.length - 1)) * 100;
        const y = 100 - ((v - min) / span) * 100;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [values]);

  if (!pts) return <div className="w-full h-full border border-slate-800 rounded bg-slate-950/30" />;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full border border-slate-800 rounded bg-slate-950/30">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

