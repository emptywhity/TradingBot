import { useEffect, useRef } from 'react';
import { fetchFuturesProData } from '@/services/futuresPro';
import { maybeAlertFuturesProSpikes } from '@/services/futuresProAlerts';
import { recordFuturesProSample } from '@/services/futuresProHistory';
import { useMarketStore } from '@/store/useMarketStore';

const webhookUrl = import.meta.env.VITE_DISCORD_WEBHOOK_URL as string | undefined;

export function useFuturesProData() {
  const { role, dataSource, symbol, setFuturesPro } = useMarketStore((s) => ({
    role: s.role,
    dataSource: s.dataSource,
    symbol: s.symbol,
    setFuturesPro: s.setFuturesPro
  }));

  const backoffRef = useRef(15_000);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      if (cancelled) return;
      if (role === 'standard' || dataSource !== 'futures') {
        setFuturesPro(undefined);
        return;
      }
      try {
        const data = await fetchFuturesProData(symbol);
        if (!cancelled) {
          setFuturesPro(data);
          const samples = recordFuturesProSample(data);
          maybeAlertFuturesProSpikes({ symbol: data.symbol, samples, webhookUrl });
          backoffRef.current = 15_000;
        }
      } catch (err) {
        console.warn('Futures pro data failed', err);
        backoffRef.current = Math.min(backoffRef.current * 2, 120_000);
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(poll, backoffRef.current);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [role, dataSource, symbol, setFuturesPro]);
}
