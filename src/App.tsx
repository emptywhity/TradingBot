import React from 'react';
import { Header } from '@/components/Header';
import { Toolbar } from '@/components/Toolbar';
import { OrderBookPanel } from '@/components/OrderBookPanel';
import { ChartPanel } from '@/components/ChartPanel';
import { SignalPanel } from '@/components/SignalPanel';
import { useLiveData } from '@/hooks/useLiveData';
import { useScanner } from '@/hooks/useScanner';
import { useFuturesProData } from '@/hooks/useFuturesProData';
import { useBackendBootstrap } from '@/hooks/useBackendBootstrap';
import { useAuth } from '@/hooks/useAuth';
import { useMarketStore } from '@/store/useMarketStore';

export default function App() {
  useAuth();
  useBackendBootstrap();
  useLiveData();
  useScanner();
  useFuturesProData();
  const noviceMode = useMarketStore((s) => s.noviceMode);
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-4">
      <Header />
      <Toolbar />
      <div className={noviceMode ? 'grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-4' : 'grid grid-cols-1 lg:grid-cols-[320px,1fr,320px] gap-4'}>
        {!noviceMode ? <OrderBookPanel /> : null}
        <ChartPanel />
        <SignalPanel />
      </div>
      <div className="mt-3 text-[11px] text-slate-400 leading-relaxed">
        <p>
          Gate modes: <strong className="text-slate-200">aggressive</strong> lowers RR/stop constraints and cooldown to surface more
          setups; <strong className="text-slate-200">default</strong> keeps balanced risk filters;{' '}
          <strong className="text-slate-200">conservative</strong> tightens max stop, raises min RR/score, and enforces fresh zones.
          Signals remain informational-only; no execution and trading futures carries real risk.
        </p>
      </div>
    </div>
  );
}
