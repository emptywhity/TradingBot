import { FuturesProData } from '@/types';

const BASE = 'https://fapi.binance.com';

const cache = new Map<string, { ts: number; data: FuturesProData }>();

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchFuturesProData(symbol: string): Promise<FuturesProData> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.ts < 25_000) return cached.data;

  const [premium, openInterest, ratio] = await Promise.all([
    fetchPremiumIndex(symbol),
    fetchOpenInterest(symbol),
    fetchLongShortRatio(symbol, '5m').catch(() => undefined)
  ]);

  const data: FuturesProData = {
    symbol,
    markPrice: premium.markPrice,
    indexPrice: premium.indexPrice,
    lastFundingRate: premium.lastFundingRate,
    nextFundingTime: premium.nextFundingTime,
    openInterest,
    longShortRatio: ratio
  };

  cache.set(symbol, { ts: Date.now(), data });
  return data;
}

async function fetchPremiumIndex(symbol: string) {
  const url = `${BASE}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`premiumIndex ${res.status}`);
  const json = await res.json();
  return {
    markPrice: num(json.markPrice),
    indexPrice: num(json.indexPrice),
    lastFundingRate: num(json.lastFundingRate),
    nextFundingTime: num(json.nextFundingTime)
  };
}

async function fetchOpenInterest(symbol: string): Promise<number> {
  const url = `${BASE}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`openInterest ${res.status}`);
  const json = await res.json();
  return num(json.openInterest);
}

async function fetchLongShortRatio(symbol: string, period: string) {
  const url = `${BASE}/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`longShortRatio ${res.status}`);
  const json = (await res.json()) as any[];
  const row = json?.[0];
  if (!row) throw new Error('longShortRatio empty');
  return {
    longAccount: num(row.longAccount),
    shortAccount: num(row.shortAccount),
    longShortRatio: num(row.longShortRatio),
    timestamp: num(row.timestamp),
    period
  };
}

