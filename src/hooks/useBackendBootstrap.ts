import { useEffect } from 'react';
import { useMarketStore } from '@/store/useMarketStore';
import { Signal } from '@/types';
import { apiFetch, getBackendUrl } from '@/services/authClient';

export function useBackendBootstrap() {
  const upsertSignals = useMarketStore((s) => s.upsertSignals);

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
        if (fetched.length) upsertSignals(fetched);
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
  }, [upsertSignals]);
}
