import { timeframeSeconds } from '@/services/signalEngine';
import { Candle, OrderBook, Ticker, Timeframe } from '@/types';

export type DataSource = 'futures' | 'spot';

export interface ExchangeAdapter {
  getOHLCV(params: { symbol: string; timeframe: Timeframe; limit?: number }): Promise<Candle[]>;
  subscribeTicker(params: { symbol: string; cb: (t: Ticker) => void }): () => void;
  subscribeOrderBook(params: { symbol: string; depth?: number; cb: (ob?: OrderBook, status?: string) => void }): () => void;
}

export class RealDataAdapter implements ExchangeAdapter {
  private binanceFutures = 'https://fapi.binance.com';
  private binanceSpot = 'https://api.binance.com';
  private source: DataSource;
  private ohlcvCache = new Map<string, { ts: number; data: Candle[] }>();
  private failUntil = new Map<string, number>();
  private lastSources: { ohlcvSource?: string; tickerSource?: string; orderBookSource?: string } = {};

  constructor(opts?: { source?: DataSource }) {
    this.source = opts?.source ?? 'futures';
  }

  async getOHLCV(params: { symbol: string; timeframe: Timeframe; limit?: number }): Promise<Candle[]> {
    const limit = params.limit ?? 400;
    const key = `${params.symbol}-${params.timeframe}`;
    const cached = this.ohlcvCache.get(key);
    const freshnessMs = timeframeSeconds(params.timeframe) * 750;
    if (cached && Date.now() - cached.ts < freshnessMs) {
      return cached.data;
    }

    for (const src of this.orderedSources()) {
      const keyName = `ohlcv-${src}`;
      if (this.shouldSkip(keyName)) continue;
      try {
        const data = await this.fetchOHLCVFrom(src, params.symbol, params.timeframe, limit);
        this.ohlcvCache.set(key, { ts: Date.now(), data });
        console.info('[ohlcv] source', src);
        this.lastSources.ohlcvSource = src;
        return data;
      } catch (err) {
        this.markFail(keyName);
        continue;
      }
    }
    return cached?.data ?? [];
  }

  subscribeTicker(params: { symbol: string; cb: (t: Ticker) => void }): () => void {
    let active = true;
    const poll = async () => {
      for (const src of this.orderedSources()) {
        try {
          const t = await this.fetchTickerFrom(src, params.symbol);
          params.cb(t);
          this.lastSources.tickerSource = src;
          break;
        } catch (err) {
          this.markFail(`ticker-${src}`);
          continue;
        }
      }
      // 1s updates feel "live" while still staying far under Binance REST limits for a single symbol.
      if (active) setTimeout(poll, 1_000);
    };
    poll();
    return () => {
      active = false;
    };
  }

  subscribeOrderBook(params: { symbol: string; depth?: number; cb: (ob?: OrderBook, status?: string) => void }): () => void {
    const depth = params.depth ?? 20;
    let active = true;
    const poll = async () => {
      let delivered = false;
      for (const src of this.orderedSources()) {
        try {
          const ob = await this.fetchOrderBookFrom(src, params.symbol, depth);
          params.cb(ob, undefined);
          console.info('[orderbook] source', src);
          this.lastSources.orderBookSource = src;
          delivered = true;
          break;
        } catch (err) {
          this.markFail(`orderbook-${src}`);
          continue;
        }
      }
      if (!delivered) {
        params.cb(undefined, 'depth unavailable (all sources failed)');
      }
      if (active) setTimeout(poll, 6_000);
    };
    poll();
    return () => {
      active = false;
    };
  }

  private orderedSources(): DataSource[] {
    if (this.source === 'futures') return ['futures', 'spot'];
    return ['spot', 'futures'];
  }

  private shouldSkip(name: string): boolean {
    const until = this.failUntil.get(name);
    return until !== undefined && until > Date.now();
  }

  private markFail(name: string) {
    const current = this.failUntil.get(name) ?? 0;
    const backoff = current > Date.now() ? (current - Date.now()) * 2 : 5_000;
    this.failUntil.set(name, Date.now() + Math.min(backoff, 60_000));
  }

  private async fetchTickerFrom(source: DataSource, symbol: string) {
    if (source === 'futures') return this.fetchBinanceFuturesTicker(symbol);
    return this.fetchBinanceSpotTicker(symbol);
  }

  private async fetchOHLCVFrom(source: DataSource, symbol: string, timeframe: Timeframe, limit: number) {
    if (source === 'futures') return this.fetchBinanceFuturesOHLCV(symbol, timeframe, limit);
    return this.fetchBinanceSpotOHLCV(symbol, timeframe, limit);
  }

  getLastSources() {
    return { ...this.lastSources };
  }

  private async fetchOrderBookFrom(source: DataSource, symbol: string, depth: number) {
    if (source === 'futures') return this.fetchBinanceFuturesOrderBook(symbol, depth);
    return this.fetchBinanceSpotOrderBook(symbol, depth);
  }

  private async fetchBinanceFuturesOHLCV(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const interval = binanceInterval(timeframe);
    // Binance Futures max limit is 1500
    const clamped = Math.max(1, Math.min(limit, 1500));
    const url = `${this.binanceFutures}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${clamped}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance futures OHLCV ${res.status}`);
    const data: any[] = await res.json();
    return data.map((row) => ({
      time: Math.floor(row[0] / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5])
    }));
  }

  private async fetchBinanceSpotOHLCV(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const interval = binanceInterval(timeframe);
    // Binance Spot max limit is 1000
    const clamped = Math.max(1, Math.min(limit, 1000));
    const url = `${this.binanceSpot}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${clamped}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance spot OHLCV ${res.status}`);
    const data: any[] = await res.json();
    return data.map((row) => ({
      time: Math.floor(row[0] / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5])
    }));
  }

  private async fetchBinanceFuturesTicker(symbol: string): Promise<Ticker> {
    const res = await fetch(`${this.binanceFutures}/fapi/v1/ticker/bookTicker?symbol=${symbol}`);
    if (!res.ok) throw new Error(`Binance futures ticker ${res.status}`);
    const data = await res.json();
    const bid = Number(data?.bidPrice);
    const ask = Number(data?.askPrice);
    const last = (bid + ask) / 2;
    return { last, bid, ask, change24h: 0, timestamp: Date.now() };
  }

  private async fetchBinanceSpotTicker(symbol: string): Promise<Ticker> {
    const res = await fetch(`${this.binanceSpot}/api/v3/ticker/bookTicker?symbol=${symbol}`);
    if (!res.ok) throw new Error(`Binance spot ticker ${res.status}`);
    const data = await res.json();
    const bid = Number(data?.bidPrice);
    const ask = Number(data?.askPrice);
    const last = (bid + ask) / 2;
    return { last, bid, ask, change24h: 0, timestamp: Date.now() };
  }

  private async fetchBinanceFuturesOrderBook(symbol: string, depth: number): Promise<OrderBook> {
    const requested = Math.max(1, Math.min(depth, 100));
    const limit = binanceDepthLimit(requested);
    const res = await fetch(`${this.binanceFutures}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`);
    if (!res.ok) throw new Error(`Binance futures depth ${res.status}`);
    const data = await res.json();
    return {
      bids: (data.bids ?? []).slice(0, requested).map((b: any[]) => ({ price: Number(b[0]), size: Number(b[1]) })),
      asks: (data.asks ?? []).slice(0, requested).map((a: any[]) => ({ price: Number(a[0]), size: Number(a[1]) })),
      timestamp: Date.now()
    };
  }

  private async fetchBinanceSpotOrderBook(symbol: string, depth: number): Promise<OrderBook> {
    const requested = Math.max(1, Math.min(depth, 100));
    const limit = binanceDepthLimit(requested);
    const res = await fetch(`${this.binanceSpot}/api/v3/depth?symbol=${symbol}&limit=${limit}`);
    if (!res.ok) throw new Error(`Binance spot depth ${res.status}`);
    const data = await res.json();
    return {
      bids: (data.bids ?? []).slice(0, requested).map((b: any[]) => ({ price: Number(b[0]), size: Number(b[1]) })),
      asks: (data.asks ?? []).slice(0, requested).map((a: any[]) => ({ price: Number(a[0]), size: Number(a[1]) })),
      timestamp: Date.now()
    };
  }
}

function binanceDepthLimit(requested: number): number {
  // Binance supports specific depth limits.
  if (requested <= 5) return 5;
  if (requested <= 10) return 10;
  if (requested <= 20) return 20;
  if (requested <= 50) return 50;
  if (requested <= 100) return 100;
  if (requested <= 500) return 500;
  return 1000;
}

function binanceInterval(tf: Timeframe): string {
  const map: Record<Timeframe, string> = {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '1H': '1h',
    '4H': '4h',
    D: '1d',
    W: '1w'
  };
  return map[tf];
}
