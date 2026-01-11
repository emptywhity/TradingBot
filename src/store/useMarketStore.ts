import { create } from 'zustand';
import { Candle, FuturesProData, Opportunity, OrderBook, Signal, Ticker, Timeframe } from '@/types';
import { DEFAULT_GATE, DEFAULT_SYMBOLS, DEFAULT_TIMEFRAME, FREE_SYMBOLS, TIMEFRAMES } from '@/config/defaults';
import { QualityGateConfig } from '@/types';

export type DataSource = 'futures' | 'spot';

const SIGNALS_STORAGE_KEY = 'fsd.signals.v1';
const SIGNALS_CAP = 2000;
const PREFS_STORAGE_KEY = 'fsd.prefs.v1';

interface Diagnostics {
  reasons: string[];
  cooldownSecs?: number;
  atrPct?: number;
  adx?: number;
  bb?: number;
  trend?: string;
  emaSlope?: number;
  rangePos?: number;
}

function loadStoredSignals(): Signal[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SIGNALS_STORAGE_KEY);
    if (!raw) return [];
    const json = JSON.parse(raw);
    if (!Array.isArray(json)) return [];
    return json
      .filter((s: any) => s && typeof s === 'object' && typeof s.symbol === 'string' && typeof s.timeframe === 'string' && typeof s.side === 'string')
      .map((s: any) => s as Signal)
      .slice(-SIGNALS_CAP);
  } catch {
    return [];
  }
}

function persistSignals(signals: Signal[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SIGNALS_STORAGE_KEY, JSON.stringify(signals.slice(-SIGNALS_CAP)));
  } catch {
    // ignore (quota / privacy mode)
  }
}

type StoredPrefs = {
  autoMuteEnabled?: boolean;
  mlFilterEnabled?: boolean;
  noviceMode?: boolean;
};

function loadPrefs(): StoredPrefs {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return {};
    const json = JSON.parse(raw);
    if (!json || typeof json !== 'object') return {};
    return {
      autoMuteEnabled: typeof (json as any).autoMuteEnabled === 'boolean' ? (json as any).autoMuteEnabled : undefined,
      mlFilterEnabled: typeof (json as any).mlFilterEnabled === 'boolean' ? (json as any).mlFilterEnabled : undefined,
      noviceMode: typeof (json as any).noviceMode === 'boolean' ? (json as any).noviceMode : undefined
    };
  } catch {
    return {};
  }
}

function persistPrefs(patch: Partial<StoredPrefs>) {
  if (typeof localStorage === 'undefined') return;
  try {
    const prev = loadPrefs();
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch {
    // ignore
  }
}

interface MarketState {
  user?: { id: string; email: string; role: 'standard' | 'vip' | 'admin'; vipExpiresAt?: number; createdAt: number };
  symbols: string[];
  timeframes: Timeframe[];
  symbol: string;
  timeframe: Timeframe;
  role: 'standard' | 'vip' | 'admin';
  noviceMode: boolean;
  autoMuteEnabled: boolean;
  mlFilterEnabled: boolean;
  showVwap: boolean;
  showKeyLevels: boolean;
  showVolumeProfile: boolean;
  trendMode: boolean;
  scannerEnabled: boolean;
  scannerRequestId: number;
  opportunities: Opportunity[];
  scannerStatus?: { running: boolean; lastRun?: number; scanned?: number; errors?: number };
  futuresPro?: FuturesProData;
  gateMode: 'default' | 'aggressive' | 'conservative';
  gate: QualityGateConfig;
  dataSource: DataSource;
  candles: Candle[];
  htfCandles: Record<Timeframe, Candle[]>;
  orderBook?: OrderBook;
  orderBookStatus?: string;
  ticker?: Ticker;
  heikin: boolean;
  signals: Signal[];
  lastSignal?: Signal;
  lastCandleTs?: number;
  diagnostics?: Diagnostics;
  feedInfo?: { ohlcvSource?: string; tickerSource?: string; orderBookSource?: string };
  setSymbol: (s: string) => void;
  setTimeframe: (tf: Timeframe) => void;
  setRole: (r: MarketState['role']) => void;
  setUser: (u: MarketState['user']) => void;
  setNoviceMode: (v: boolean) => void;
  setAutoMuteEnabled: (v: boolean) => void;
  setMlFilterEnabled: (v: boolean) => void;
  toggleVwap: () => void;
  toggleKeyLevels: () => void;
  toggleVolumeProfile: () => void;
  toggleTrendMode: () => void;
  setScannerEnabled: (v: boolean) => void;
  requestScannerRun: () => void;
  setOpportunities: (o: Opportunity[]) => void;
  setScannerStatus: (s: MarketState['scannerStatus']) => void;
  setFuturesPro: (d: FuturesProData | undefined) => void;
  setGateMode: (mode: MarketState['gateMode']) => void;
  setDataSource: (src: DataSource) => void;
  setCandles: (candles: Candle[]) => void;
  setHtfCandles: (tf: Timeframe, candles: Candle[]) => void;
  clearHtfCandles: () => void;
  setOrderBook: (ob: OrderBook | undefined, status?: string) => void;
  setTicker: (t: Ticker | undefined) => void;
  toggleHeikin: () => void;
  pushSignals: (s: Signal[]) => void;
  upsertSignals: (s: Signal[]) => void;
  setDiagnostics: (d: Diagnostics | undefined) => void;
  setFeedInfo: (info: MarketState['feedInfo']) => void;
}

const initialSignals = loadStoredSignals();
const initialPrefs = loadPrefs();

export const useMarketStore = create<MarketState>((set) => ({
  user: undefined,
  symbols: FREE_SYMBOLS,
  timeframes: TIMEFRAMES,
  symbol: FREE_SYMBOLS[0],
  timeframe: DEFAULT_TIMEFRAME,
  role: 'standard',
  noviceMode: initialPrefs.noviceMode ?? false,
  autoMuteEnabled: initialPrefs.autoMuteEnabled ?? true,
  mlFilterEnabled: initialPrefs.mlFilterEnabled ?? false,
  showVwap: false,
  showKeyLevels: false,
  showVolumeProfile: false,
  trendMode: true,
  scannerEnabled: false,
  scannerRequestId: 0,
  opportunities: [],
  scannerStatus: undefined,
  futuresPro: undefined,
  gateMode: 'default',
  gate: gateForMode('default'),
  dataSource: 'futures',
  candles: [],
  htfCandles: {},
  orderBook: undefined,
  orderBookStatus: undefined,
  ticker: undefined,
  heikin: false,
  signals: initialSignals,
  lastSignal: initialSignals.at(-1),
  lastCandleTs: undefined,
  diagnostics: undefined,
  feedInfo: undefined,
  setSymbol: (symbol) =>
    set((state) => {
      const allowed = state.symbols.includes(symbol);
      return allowed ? { symbol } : state;
    }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setGateMode: (mode) => set({ gateMode: mode, gate: gateForMode(mode) }),
  setRole: (role) =>
    set((state) => {
      const nextSymbols = role === 'standard' ? FREE_SYMBOLS : DEFAULT_SYMBOLS;
      const nextSymbol = nextSymbols.includes(state.symbol) ? state.symbol : nextSymbols[0];
      return { role, symbols: nextSymbols, symbol: nextSymbol };
    }),
  setUser: (user) =>
    set((state) => {
      const role = user?.role ?? 'standard';
      const nextSymbols = role === 'standard' ? FREE_SYMBOLS : DEFAULT_SYMBOLS;
      const nextSymbol = nextSymbols.includes(state.symbol) ? state.symbol : nextSymbols[0];
      return { user, role, symbols: nextSymbols, symbol: nextSymbol };
    }),
  setNoviceMode: (noviceMode) => {
    persistPrefs({ noviceMode });
    set({ noviceMode });
  },
  setAutoMuteEnabled: (autoMuteEnabled) => {
    persistPrefs({ autoMuteEnabled });
    set({ autoMuteEnabled });
  },
  setMlFilterEnabled: (mlFilterEnabled) => {
    persistPrefs({ mlFilterEnabled });
    set({ mlFilterEnabled });
  },
  toggleVwap: () => set((state) => ({ showVwap: !state.showVwap })),
  toggleKeyLevels: () => set((state) => ({ showKeyLevels: !state.showKeyLevels })),
  toggleTrendMode: () => set((state) => ({ trendMode: !state.trendMode })),
  toggleVolumeProfile: () => set((state) => ({ showVolumeProfile: !state.showVolumeProfile })),
  setScannerEnabled: (scannerEnabled) => set({ scannerEnabled }),
  requestScannerRun: () => set((state) => ({ scannerRequestId: state.scannerRequestId + 1 })),
  setOpportunities: (opportunities) => set({ opportunities }),
  setScannerStatus: (scannerStatus) => set({ scannerStatus }),
  setFuturesPro: (futuresPro) => set({ futuresPro }),
  setDataSource: (dataSource) => set({ dataSource }),
  setCandles: (candles) => set({ candles, lastCandleTs: candles.at(-1)?.time }),
  setHtfCandles: (tf, candles) => set((state) => ({ htfCandles: { ...state.htfCandles, [tf]: candles } })),
  clearHtfCandles: () => set({ htfCandles: {} }),
  setOrderBook: (orderBook, status) => set({ orderBook, orderBookStatus: status }),
  setTicker: (ticker) => set({ ticker }),
  toggleHeikin: () => set((state) => ({ heikin: !state.heikin })),
  pushSignals: (signals) =>
    set((state) => {
      const nextSignals = [...state.signals, ...signals].slice(-SIGNALS_CAP);
      persistSignals(nextSignals);
      return {
        signals: nextSignals,
        lastSignal: signals.at(-1) ?? state.lastSignal
      };
    }),
  upsertSignals: (signals) =>
    set((state) => {
      if (!signals.length) return state;
      const nextSignals = [...state.signals];
      const index = new Map(nextSignals.map((s, i) => [`${s.symbol}-${s.timeframe}-${s.side}-${s.timestamp}`, i]));
      let changed = false;
      for (const s of signals) {
        const key = `${s.symbol}-${s.timeframe}-${s.side}-${s.timestamp}`;
        const at = index.get(key);
        if (at === undefined) {
          index.set(key, nextSignals.length);
          nextSignals.push(s);
          changed = true;
        } else {
          const merged = { ...nextSignals[at], ...s };
          if (merged !== nextSignals[at]) {
            nextSignals[at] = merged;
            changed = true;
          }
        }
      }
      if (!changed) return state;
      const trimmed = nextSignals.slice(-SIGNALS_CAP);
      persistSignals(trimmed);
      return {
        signals: trimmed,
        lastSignal: trimmed.at(-1) ?? state.lastSignal
      };
    }),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setFeedInfo: (feedInfo) => set({ feedInfo })
}));

function gateForMode(mode: MarketState['gateMode']): QualityGateConfig {
  if (mode === 'aggressive') {
    return {
      ...DEFAULT_GATE,
      maxStopPct: 1.0,
      minRR: 1.2,
      atrPctMin: 0.04,
      atrPctMax: 2,
      cooldownBars: 2,
      requireFreshZone: false,
      scoreMin: 70
    };
  }
  if (mode === 'conservative') {
    return {
      ...DEFAULT_GATE,
      maxStopPct: 0.5,
      minRR: 2.0,
      atrPctMin: 0.08,
      atrPctMax: 1.0,
      cooldownBars: 10,
      requireFreshZone: true,
      scoreMin: 90
    };
  }
  return DEFAULT_GATE;
}
