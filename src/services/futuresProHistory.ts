import { FuturesProData } from '@/types';

export type FuturesProSample = {
  ts: number; // ms epoch
  markPrice: number;
  indexPrice: number;
  lastFundingRate: number; // decimal
  openInterest: number;
};

const KEY_PREFIX = 'fsd.futuresProHistory.v1.';
const MAX_AGE_MS = 26 * 60 * 60 * 1000; // keep a bit more than 24h for delta calc
const MIN_SAMPLE_INTERVAL_MS = 60 * 1000;
const MAX_POINTS = 2000;

export function loadFuturesProHistory(symbol: string): FuturesProSample[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY_PREFIX + symbol);
    if (!raw) return [];
    const json = JSON.parse(raw);
    if (!Array.isArray(json)) return [];
    return json
      .filter((p: any) => p && typeof p === 'object' && typeof p.ts === 'number')
      .map((p: any) => p as FuturesProSample);
  } catch {
    return [];
  }
}

export function recordFuturesProSample(data: FuturesProData, nowMs = Date.now()): FuturesProSample[] {
  const symbol = data.symbol;
  const prev = loadFuturesProHistory(symbol);
  const last = prev.at(-1);

  const sample: FuturesProSample = {
    ts: last && nowMs - last.ts < MIN_SAMPLE_INTERVAL_MS ? last.ts : nowMs,
    markPrice: data.markPrice,
    indexPrice: data.indexPrice,
    lastFundingRate: data.lastFundingRate,
    openInterest: data.openInterest
  };

  const next = last && nowMs - last.ts < MIN_SAMPLE_INTERVAL_MS ? [...prev.slice(0, -1), sample] : [...prev, sample];
  const pruned = prune(next, nowMs);
  persist(symbol, pruned);
  return pruned;
}

function prune(samples: FuturesProSample[], nowMs: number): FuturesProSample[] {
  const minTs = nowMs - MAX_AGE_MS;
  const filtered = samples.filter((p) => Number.isFinite(p.ts) && p.ts >= minTs);
  return filtered.slice(-MAX_POINTS);
}

function persist(symbol: string, samples: FuturesProSample[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY_PREFIX + symbol, JSON.stringify(samples));
  } catch {
    // ignore
  }
}

export function sampleAtOrBefore(samples: FuturesProSample[], ts: number): FuturesProSample | undefined {
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    if (samples[i].ts <= ts) return samples[i];
  }
  return undefined;
}

export function premiumPct(sample: FuturesProSample): number {
  return ((sample.markPrice - sample.indexPrice) / (sample.indexPrice || 1)) * 100;
}
