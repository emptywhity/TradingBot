import { useEffect } from 'react';
import { useMarketStore } from '@/store/useMarketStore';
import { Signal } from '@/types';

const backendUrl = import.meta.env.VITE_BACKEND_URL;

export function useBackendBootstrap() {
  const pushSignals = useMarketStore((s) => s.pushSignals);

  useEffect(() => {
    if (!backendUrl) return;
    let cancelled = false;
    const base = backendUrl.replace(/\/$/, '');

    const load = async () => {
      try {
        const res = await fetch(`${base}/signals?limit=500`);
        if (!res.ok) throw new Error(`backend ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const fetched = Array.isArray(json?.signals) ? (json.signals as Signal[]) : [];
        if (!fetched.length) return;
        const existingKeys = new Set(
          useMarketStore
            .getState()
            .signals.map((s) => `${s.symbol}-${s.timeframe}-${s.side}-${s.timestamp}`)
        );
        const fresh = fetched.filter((s) => !existingKeys.has(`${s.symbol}-${s.timeframe}-${s.side}-${s.timestamp}`));
        if (fresh.length) pushSignals(fresh);
      } catch (err) {
        console.warn('[backend] failed to load signals', err);
      }
    };

    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pushSignals]);
}
