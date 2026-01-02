import { useEffect, useRef } from 'react';
import { RealDataAdapter } from '@/adapters/exchangeAdapter';
import { DEFAULT_STRATEGY } from '@/config/defaults';
import { generateSignals } from '@/services/signalEngine';
import { buildDynamicGate } from '@/services/dynamicGate';
import { useMarketStore } from '@/store/useMarketStore';
import { Candle, Opportunity, Timeframe } from '@/types';

const SCAN_TIMEFRAMES: Timeframe[] = ['1m', '3m', '5m', '15m'];
const HTF_TIMEFRAMES: Timeframe[] = ['1H', '4H'];
const dynamicGateEnabled = import.meta.env.VITE_DYNAMIC_GATE !== 'false';

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

function signalToOpportunity(s: any): Opportunity {
  // Keep only the fields we want to show in the opportunity feed.
  const { id: _id, ...rest } = s;
  return rest as Opportunity;
}

export function useScanner() {
  const {
    role,
    scannerEnabled,
    scannerRequestId,
    symbols,
    dataSource,
    gate,
    trendMode,
    setOpportunities,
    setScannerStatus
  } = useMarketStore((s) => ({
    role: s.role,
    scannerEnabled: s.scannerEnabled,
    scannerRequestId: s.scannerRequestId,
    symbols: s.symbols,
    dataSource: s.dataSource,
    gate: s.gate,
    trendMode: s.trendMode,
    setOpportunities: s.setOpportunities,
    setScannerStatus: s.setScannerStatus
  }));

  const adapterRef = useRef<RealDataAdapter>();
  useEffect(() => {
    adapterRef.current = new RealDataAdapter({ source: dataSource });
  }, [dataSource]);

  useEffect(() => {
    if (role === 'standard' || !scannerEnabled) {
      setOpportunities([]);
      setScannerStatus(undefined);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const runScan = async () => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      setScannerStatus({ running: true, lastRun: Date.now() });

      let scanned = 0;
      let errors = 0;
      const opportunities: Opportunity[] = [];

      const scanSymbol = async (symbol: string) => {
        if (cancelled) return;
        try {
          const htfEntries = await Promise.all(
            HTF_TIMEFRAMES.map(async (tf) => [tf, await adapter.getOHLCV({ symbol, timeframe: tf, limit: 400 })] as const)
          );
          const htfCandles = Object.fromEntries(htfEntries) as Record<Timeframe, Candle[]>;

          for (const tf of SCAN_TIMEFRAMES) {
            if (cancelled) return;
            const candles = await adapter.getOHLCV({ symbol, timeframe: tf, limit: 350 });
            scanned += 1;
            if (candles.length === 0) continue;
            const { gate: effectiveGate } = buildDynamicGate({
              candles,
              baseGate: gate,
              atrPeriod: DEFAULT_STRATEGY.atrPeriod,
              enabled: dynamicGateEnabled
            });
            const sigs = generateSignals({
              symbol,
              timeframe: tf,
              candles,
              htfCandles,
              history: [],
              gate: effectiveGate,
              settings: DEFAULT_STRATEGY,
              trendMode
            });
            const last = sigs.at(-1);
            if (last) opportunities.push(signalToOpportunity(last));
          }
        } catch (err) {
          errors += 1;
        }
      };

      try {
        // Hard cap to avoid accidental 500-symbol scans from UI config
        const watchlist = symbols.slice(0, 100);
        await mapLimit(watchlist, 3, scanSymbol);
      } finally {
        if (cancelled) return;
        // Deduplicate by symbol+tf+side keeping latest timestamp
        const byKey = new Map<string, Opportunity>();
        for (const o of opportunities) {
          const key = `${o.symbol}-${o.timeframe}-${o.side}`;
          const prev = byKey.get(key);
          if (!prev || o.timestamp > prev.timestamp) byKey.set(key, o);
        }
        const top = [...byKey.values()]
          .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
          .slice(0, 10);

        setOpportunities(top);
        setScannerStatus({ running: false, lastRun: Date.now(), scanned, errors });
      }
    };

    // Run immediately and then refresh periodically
    runScan();
    timer = window.setInterval(runScan, 60_000);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, scannerEnabled, scannerRequestId, symbols, dataSource, gate, trendMode]);
}
