import { useEffect } from 'react';
import { useMarketStore } from '@/store/useMarketStore';
import { Signal } from '@/types';
import { apiFetch, getBackendUrl } from '@/services/authClient';

export function useBackendBootstrap() {
  const pushSignals = useMarketStore((s) => s.pushSignals);

  useEffect(() => {
    if (!getBackendUrl()) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await apiFetch('/signals?limit=500');
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
