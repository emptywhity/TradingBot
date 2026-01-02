import React, { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { DEFAULT_STRATEGY } from '@/config/defaults';
import { RiskCalculator } from '@/components/RiskCalculator';
import { PerformancePanel } from '@/components/PerformancePanel';
import { GlobalPerformancePanel } from '@/components/GlobalPerformancePanel';
import { FuturesProContext } from '@/components/FuturesProContext';
import { ScoreCalibrationPanel } from '@/components/ScoreCalibrationPanel';
import { MetaModelManager } from '@/components/MetaModelManager';
import { useMarketStore } from '@/store/useMarketStore';
import { Signal, Timeframe } from '@/types';
import { ema, heikinAshi } from '@/utils/indicators';
import { computeAutoMuteDecision } from '@/services/autoMute';
import { loadMetaModel, predictWithMetaModel } from '@/services/metaModel';
import { computeRTargets, simulateTradePlan } from '@/services/tradePlan';
import { loadFuturesProHistory, premiumPct as historyPremiumPct, sampleAtOrBefore } from '@/services/futuresProHistory';
import { getExecutionCosts } from '@/config/executionCosts';

type TabKey = 'overview' | 'plan' | 'stats' | 'scanner' | 'futures' | 'recent';

const TABS: Array<{ key: TabKey; label: string; vip?: boolean }> = [
  { key: 'overview', label: 'Signal' },
  { key: 'plan', label: 'Trade' },
  { key: 'stats', label: 'Performance', vip: true },
  { key: 'scanner', label: 'Scanner', vip: true },
  { key: 'futures', label: 'Futures Pro', vip: true },
  { key: 'recent', label: 'History' }
];

export function SignalPanel() {
  const {
    role,
    symbol,
    timeframe,
    dataSource,
    gateMode,
    autoMuteEnabled,
    setAutoMuteEnabled,
    mlFilterEnabled,
    setMlFilterEnabled,
    candles,
    htfCandles,
    ticker,
    signals,
    diagnostics,
    opportunities,
    scannerEnabled,
    scannerStatus,
    requestScannerRun,
    setScannerEnabled,
    setSymbol,
    setTimeframe,
    setDataSource,
    futuresPro,
    heikin,
    symbols
  } = useMarketStore((s) => ({
    role: s.role,
    symbol: s.symbol,
    timeframe: s.timeframe,
    dataSource: s.dataSource,
    gateMode: s.gateMode,
    autoMuteEnabled: s.autoMuteEnabled,
    setAutoMuteEnabled: s.setAutoMuteEnabled,
    mlFilterEnabled: s.mlFilterEnabled,
    setMlFilterEnabled: s.setMlFilterEnabled,
    candles: s.candles,
    htfCandles: s.htfCandles,
    ticker: s.ticker,
    signals: s.signals,
    diagnostics: s.diagnostics,
    opportunities: s.opportunities,
    scannerEnabled: s.scannerEnabled,
    scannerStatus: s.scannerStatus,
    requestScannerRun: s.requestScannerRun,
    setScannerEnabled: s.setScannerEnabled,
    setSymbol: s.setSymbol,
    setTimeframe: s.setTimeframe,
    setDataSource: s.setDataSource,
    futuresPro: s.futuresPro,
    heikin: s.heikin,
    symbols: s.symbols
  }));

  const hasVip = role !== 'standard';
  const isAdmin = role === 'admin';
  const [tab, setTab] = useState<TabKey>('overview');
  const [modelOpen, setModelOpen] = useState(false);
  const [modelRev, setModelRev] = useState(0);
  const executionCosts = useMemo(() => getExecutionCosts(), []);

  useEffect(() => {
    if (!hasVip && (tab === 'stats' || tab === 'scanner' || tab === 'futures')) setTab('overview');
  }, [hasVip, tab]);

  const signalsForView = useMemo(() => {
    const scoped = signals.filter(
      (s) =>
        s.symbol === symbol &&
        s.timeframe === timeframe &&
        (s.dataSource ?? 'futures') === dataSource
    );
    const refPrice = candles.at(-1)?.close ?? ticker?.last;
    if (!refPrice || !Number.isFinite(refPrice)) return scoped;
    return scoped.filter((s) => isSignalSane(s, refPrice));
  }, [candles, dataSource, signals, symbol, ticker, timeframe]);

  const lastSignal = useMemo(() => signalsForView.at(-1), [signalsForView]);

  const htfBias = useMemo(() => buildHtfBias(htfCandles), [htfCandles]);
  const cooldownLabel = useMemo(() => formatCooldown(diagnostics?.cooldownSecs), [diagnostics?.cooldownSecs]);
  const whyNot = diagnostics?.reasons ?? [];

  const autoMuteDecision = useMemo(() => {
    if (!isAdmin || !autoMuteEnabled || !candles.length) return null;
    return computeAutoMuteDecision({
      symbol,
      timeframe,
      dataSource,
      gateMode,
      signals,
      candles,
      executionCosts
    });
  }, [autoMuteEnabled, candles, dataSource, executionCosts, gateMode, isAdmin, signals, symbol, timeframe]);

  const metaModel = useMemo(() => (isAdmin ? loadMetaModel() : null), [isAdmin, modelRev]);
  const modelPred = useMemo(() => {
    if (!metaModel || !lastSignal) return null;
    return predictWithMetaModel({ model: metaModel, signal: lastSignal, diagnostics });
  }, [diagnostics, lastSignal, metaModel]);

  return (
    <div className="glass-panel p-2 h-full lg:h-[640px] min-h-0 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-200">Signal</h3>
        <span className="text-xs text-slate-500">Informational only</span>
      </div>

      <div className="flex items-center gap-1 flex-wrap mb-2">
        {TABS.map((t) => {
          const disabled = Boolean(t.vip) && !hasVip;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => !disabled && setTab(t.key)}
              className={clsx(
                'px-2 py-1 rounded text-[11px] border transition select-none',
                tab === t.key ? 'bg-slate-800 text-white border-slate-700' : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600',
                disabled && 'opacity-40 cursor-not-allowed hover:border-slate-800'
              )}
              title={disabled ? 'VIP only' : undefined}
            >
              {t.label}
              {t.vip ? <span className="ml-1 text-[10px] text-slate-400">(PRO)</span> : null}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {tab === 'overview' ? (
          <Overview
            symbol={symbol}
            timeframe={timeframe}
            lastSignal={lastSignal}
            whyNot={whyNot}
            diagnostics={diagnostics}
            cooldownLabel={cooldownLabel}
            htfBias={htfBias}
          />
        ) : null}

        {tab === 'plan' ? (
          <TradeTab isVip={hasVip} heikin={heikin} candles={candles} lastSignal={lastSignal} />
        ) : null}

        {tab === 'stats' ? (
          hasVip ? (
            <div>
              {isAdmin ? (
                <div className="border border-slate-800 rounded bg-slate-900/20 p-2 text-xs text-slate-300">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-slate-200">Admin filters</div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-[11px] text-slate-300">
                        <input type="checkbox" checked={autoMuteEnabled} onChange={(e) => setAutoMuteEnabled(e.target.checked)} />
                        Auto-mute
                      </label>
                      <label className="flex items-center gap-2 text-[11px] text-slate-300">
                        <input type="checkbox" checked={mlFilterEnabled} onChange={(e) => setMlFilterEnabled(e.target.checked)} />
                        ML filter
                      </label>
                      <button
                        type="button"
                        onClick={() => setModelOpen(true)}
                        className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 hover:border-slate-600"
                        title="Manage model JSON"
                      >
                        Model…
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {autoMuteEnabled ? (autoMuteDecision ? autoMuteDecision.reason : 'Computing…') : 'Auto-mute disabled.'}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Model: {metaModel ? 'loaded' : 'not loaded'}
                    {modelPred ? ` • pTP1 ${(modelPred.pTp1 * 100).toFixed(0)}% • EV ${modelPred.evR.toFixed(2)}R` : ''}
                  </div>
                </div>
              ) : null}

              <PerformancePanel symbol={symbol} timeframe={timeframe} signals={signals} candles={candles} />
              {isAdmin ? (
                <ScoreCalibrationPanel
                  symbol={symbol}
                  timeframe={timeframe}
                  dataSource={dataSource}
                  gateMode={gateMode}
                  signals={signals}
                  candles={candles}
                />
              ) : null}
              <GlobalPerformancePanel signals={signals} />
            </div>
          ) : (
            <VipUpsell />
          )
        ) : null}

        {tab === 'scanner' ? (
          hasVip ? (
            <ScannerTab
              enabled={scannerEnabled}
              status={scannerStatus}
              opportunities={opportunities}
              onEnable={() => setScannerEnabled(true)}
              onRefresh={() => requestScannerRun()}
              onPick={(o) => {
                setSymbol(o.symbol);
                setTimeframe(o.timeframe);
              }}
            />
          ) : (
            <VipUpsell />
          )
        ) : null}

        {tab === 'futures' ? (
          hasVip ? (
            <FuturesTab
              dataSource={dataSource}
              onSwitchToFutures={() => setDataSource('futures')}
              symbol={symbol}
              futuresPro={futuresPro}
              lastSignal={lastSignal}
              htfBias={htfBias}
            />
          ) : (
            <VipUpsell />
          )
        ) : null}

        {tab === 'recent' ? (
          <RecentTab
            signals={signals}
            allowedSymbols={symbols}
            onPick={(s) => {
              setDataSource(s.dataSource ?? 'futures');
              setSymbol(s.symbol);
              setTimeframe(s.timeframe);
            }}
          />
        ) : null}
      </div>

      <p className="text-[10px] mt-2 text-slate-500">
        Signals are informational only. No execution. No financial advice; trading futures carries real risk.
      </p>

      {isAdmin ? (
        <MetaModelManager
          open={modelOpen}
          onClose={() => setModelOpen(false)}
          onChanged={() => setModelRev((n) => n + 1)}
          signals={signals}
        />
      ) : null}
    </div>
  );
}

function Overview({
  symbol,
  timeframe,
  lastSignal,
  whyNot,
  diagnostics,
  cooldownLabel,
  htfBias
}: {
  symbol: string;
  timeframe: Timeframe;
  lastSignal?: Signal;
  whyNot: string[];
  diagnostics?: {
    atrPct?: number;
    adx?: number;
    bb?: number;
    emaSlope?: number;
    trend?: string;
    cooldownSecs?: number;
  };
  cooldownLabel: string;
  htfBias: Record<Timeframe, 'up' | 'down' | 'neutral' | 'unknown'>;
}) {
  const stopPct = useMemo(() => {
    if (!lastSignal) return NaN;
    const entry = lastSignal.entry;
    const stop = lastSignal.stop;
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop)) return NaN;
    return (Math.abs(entry - stop) / entry) * 100;
  }, [lastSignal]);

  return (
    <div>
      <div className="border border-slate-800 rounded bg-slate-900/20 p-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-slate-400">
              {symbol} {timeframe}
            </div>
            <div className={clsx('text-sm font-semibold mt-0.5', lastSignal ? (lastSignal.side === 'long' ? 'text-bull' : 'text-bear') : 'text-slate-300')}>
              {lastSignal ? lastSignal.side.toUpperCase() : 'No signal'}
            </div>
          </div>
          <div className="text-[11px] text-slate-500">
            {lastSignal ? `${ageLabel(lastSignal.timestamp)} ago` : 'No signal yet. The gate is strict to avoid noise.'}
          </div>
        </div>

        {lastSignal ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <Metric label="Entry" value={fmtPrice(lastSignal.entry)} />
              <Metric label="Stop" value={fmtPrice(lastSignal.stop)} />
              <Metric label="Stop %" value={Number.isFinite(stopPct) ? `${stopPct.toFixed(2)}%` : '—'} />
              <Metric label="RR (to 2R)" value={fmtNum(lastSignal.rr, 2)} />
              <Metric label="Score" value={fmtNum(lastSignal.score, 0)} />
              <Metric label="Gate" value={(lastSignal.gateMode ?? 'default').toString()} />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Trade plan: scale out at TP1-TP4 (R-multiples) and exit on EMA flip after TP1.
            </div>

            {lastSignal.reasons?.length ? (
              <div className="mt-2">
                <div className="text-xs uppercase text-slate-500 mb-1">Reasons</div>
                <ul className="space-y-1 text-xs text-slate-300">
                  {lastSignal.reasons.map((r, i) => (
                    <li key={`${i}-${r}`} className="flex gap-2">
                      <span className="text-slate-500">•</span>
                      <span className="min-w-0">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : whyNot.length ? (
          <div className="mt-2">
            <div className="text-xs uppercase text-slate-500 mb-1">Why not?</div>
            <ul className="space-y-1 text-xs text-slate-300">
              {whyNot.map((r, i) => (
                <li key={`${i}-${r}`} className="flex gap-2">
                  <span className="text-slate-500">•</span>
                  <span className="min-w-0">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-2 text-xs text-slate-500">No signal yet.</div>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-slate-500 mb-1">Quick metrics</h4>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="ATR%" value={Number.isFinite(diagnostics?.atrPct) ? `${diagnostics!.atrPct!.toFixed(2)}%` : '—'} />
          <Metric label="ADX" value={Number.isFinite(diagnostics?.adx) ? diagnostics!.adx!.toFixed(2) : '—'} />
          <Metric label="BB bw" value={Number.isFinite(diagnostics?.bb) ? `${diagnostics!.bb!.toFixed(2)}%` : '—'} />
          <Metric label="EMA slope" value={Number.isFinite(diagnostics?.emaSlope) ? `${signed(diagnostics!.emaSlope!, 2)}%` : '—'} />
          <Metric label="Cooldown" value={cooldownLabel} />
          <Metric label="Trend" value={diagnostics?.trend ? diagnostics.trend : '—'} />
        </div>
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-slate-500 mb-1">HTF bias</h4>
        <div className="flex items-center gap-2 flex-wrap">
          {DEFAULT_STRATEGY.htfTimeframes.map((tf) => (
            <BiasPill key={tf} tf={tf} bias={htfBias[tf] ?? 'unknown'} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TradeTab({
  isVip,
  heikin,
  candles,
  lastSignal
}: {
  isVip: boolean;
  heikin: boolean;
  candles: import('@/types').Candle[];
  lastSignal?: Signal;
}) {
  const viewCandles = useMemo(() => (heikin ? heikinAshi(candles) : candles), [candles, heikin]);
  const emaValues = useMemo(() => ema(viewCandles.map((c) => c.close), DEFAULT_STRATEGY.emaPeriod), [viewCandles]);
  const tpMultipliers = useMemo(
    () => ((lastSignal?.timeframe === '1m' || lastSignal?.timeframe === '3m') ? [1.5, 3, 5, 8] : [1, 2, 3, 4]),
    [lastSignal?.timeframe]
  );
  const targets = useMemo(() => (lastSignal ? computeRTargets(lastSignal, tpMultipliers) : []), [lastSignal, tpMultipliers]);
  const plan = useMemo(() => {
    if (!lastSignal) return null;
    return simulateTradePlan(lastSignal, viewCandles, {
      emaValues,
      tpMultipliers,
      confirmBars: 2,
      maxHoldBars: 240,
      requireTpForExit: true
    });
  }, [emaValues, lastSignal, tpMultipliers, viewCandles]);

  const stopPct = useMemo(() => {
    if (!lastSignal) return NaN;
    const entry = lastSignal.entry;
    const stop = lastSignal.stop;
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop)) return NaN;
    return (Math.abs(entry - stop) / entry) * 100;
  }, [lastSignal]);

  const statusLabel = useMemo(() => {
    if (!lastSignal || !plan) return '-';
    if (plan.status === 'stop') return 'STOP';
    if (plan.status === 'exit') return 'EXIT';
    if (plan.tpsHit > 0) return `TP${plan.tpsHit}/${plan.targets.length}`;
    return 'OPEN';
  }, [lastSignal, plan]);

  return (
    <div>
      <div className="border border-slate-800 rounded bg-slate-900/20 p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs uppercase text-slate-500">Trade plan</div>
          <span className="text-[11px] text-slate-400">
            {heikin ? 'Heikin view' : 'OHLC view'}
          </span>
        </div>

        {!lastSignal ? (
          <div className="mt-2 text-xs text-slate-500">No signal yet.</div>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <Metric label="Entry" value={fmtPrice(lastSignal.entry)} />
              <Metric label="Stop" value={fmtPrice(lastSignal.stop)} />
              <Metric label="Stop %" value={Number.isFinite(stopPct) ? `${stopPct.toFixed(2)}%` : '—'} />
              <Metric label="Status" value={statusLabel} />
            </div>

            <div className="mt-3">
              <div className="text-xs uppercase text-slate-500 mb-1">Targets (R-multiples)</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {targets.map((t) => (
                  <Metric key={t.r} label={`TP${t.r} (${t.r}R)`} value={fmtPrice(t.price)} />
                ))}
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                EXIT rule: after TP1, if close flips across EMA{DEFAULT_STRATEGY.emaPeriod} for 2 bars.
              </div>
            </div>

            {plan?.events?.length ? (
              <div className="mt-3">
                <div className="text-xs uppercase text-slate-500 mb-1">Events</div>
                <div className="space-y-1 text-xs text-slate-300">
                  {plan.events.map((e, idx) => (
                    <div key={`${e.type}-${e.time}-${idx}`} className="flex items-center justify-between gap-2">
                      <span className="text-slate-300">{e.label}</span>
                      <span className="text-[11px] text-slate-500">{new Date(e.time * 1000).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-[11px] text-slate-500">
                No TP/STOP/EXIT events yet (or not enough candle coverage).
              </div>
            )}
          </>
        )}
      </div>

      {isVip ? (
        <RiskCalculator signal={lastSignal} />
      ) : (
        <div className="mt-4 border border-slate-800 rounded bg-slate-900/20 p-2 text-xs text-slate-400">
          VIP unlocks position sizing, performance stats, scanner opportunities, and futures pro context.
        </div>
      )}
    </div>
  );
}

function ScannerTab({
  enabled,
  status,
  opportunities,
  onEnable,
  onRefresh,
  onPick
}: {
  enabled: boolean;
  status?: { running: boolean; lastRun?: number; scanned?: number; errors?: number };
  opportunities: Array<{ symbol: string; timeframe: Timeframe; side: string; rr: number; score: number; timestamp: number }>;
  onEnable: () => void;
  onRefresh: () => void;
  onPick: (o: { symbol: string; timeframe: Timeframe }) => void;
}) {
  const running = status?.running;
  const lastRun = status?.lastRun ? new Date(status.lastRun).toLocaleTimeString() : '—';
  const scanned = Number.isFinite(status?.scanned) ? String(status?.scanned) : '—';
  const errors = Number.isFinite(status?.errors) ? String(status?.errors) : '—';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs uppercase text-slate-500">Opportunities</h4>
        <div className="flex items-center gap-1">
          {!enabled ? (
            <button
              type="button"
              onClick={onEnable}
              className="px-2 py-1 rounded text-[11px] border border-slate-800 bg-slate-900 text-slate-200 hover:border-slate-600"
            >
              Enable
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            className="px-2 py-1 rounded text-[11px] border border-slate-800 bg-slate-900 text-slate-200 hover:border-slate-600"
            title="Run scan now"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="text-[11px] text-slate-500 mb-2">
        {running ? 'Scanning…' : 'Scanner idle'} • Last: {lastRun} • Scanned: {scanned} • Errors: {errors}
      </div>

      {!enabled ? (
        <div className="border border-slate-800 rounded bg-slate-900/20 p-2 text-xs text-slate-400">
          Enable Scanner (VIP) to scan your watchlist across timeframes and surface only a few top candidates.
        </div>
      ) : opportunities.length ? (
        <div className="space-y-2">
          {opportunities.map((o) => (
            <button
              key={`${o.symbol}-${o.timeframe}-${o.side}-${o.timestamp}`}
              type="button"
              onClick={() => onPick(o)}
              className="w-full text-left border border-slate-800 rounded bg-slate-900/20 hover:bg-slate-900/40 px-2 py-2"
              title="Jump to chart"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-slate-200">
                  {o.symbol} <span className="text-slate-400">{o.timeframe}</span>
                </div>
                <span className={clsx('text-[11px] px-2 py-0.5 rounded border', o.side === 'long' ? 'text-bull border-emerald-900/60 bg-emerald-950/20' : 'text-bear border-rose-900/60 bg-rose-950/20')}>
                  {o.side.toUpperCase()}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Score {fmtNum(o.score, 0)} • RR {fmtNum(o.rr, 2)} • {ageLabel(o.timestamp)} ago
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="border border-slate-800 rounded bg-slate-900/20 p-2 text-xs text-slate-500">
          No opportunities right now.
        </div>
      )}
    </div>
  );
}

function FuturesTab({
  dataSource,
  onSwitchToFutures,
  symbol,
  futuresPro,
  lastSignal,
  htfBias
}: {
  dataSource: 'futures' | 'spot';
  onSwitchToFutures: () => void;
  symbol: string;
  futuresPro?: import('@/types').FuturesProData;
  lastSignal?: Signal;
  htfBias: Record<Timeframe, 'up' | 'down' | 'neutral' | 'unknown'>;
}) {
  if (dataSource !== 'futures') {
    return (
      <div className="border border-slate-800 rounded bg-slate-900/20 p-3 text-xs text-slate-400">
        <div className="text-slate-200 font-medium">Futures pro is futures-only</div>
        <div className="mt-1">Switch the exchange to futures to view funding, open interest, and premium context.</div>
        <button
          type="button"
          onClick={onSwitchToFutures}
          className="mt-3 px-2 py-1 rounded text-[11px] border border-slate-800 bg-slate-900 text-slate-200 hover:border-slate-600"
        >
          Switch to futures
        </button>
      </div>
    );
  }

  const fundingPct = futuresPro ? futuresPro.lastFundingRate * 100 : NaN;
  const oi = futuresPro?.openInterest ?? NaN;
  const mark = futuresPro?.markPrice ?? NaN;
  const index = futuresPro?.indexPrice ?? NaN;
  const premiumPct = Number.isFinite(mark) && Number.isFinite(index) && index !== 0 ? ((mark - index) / index) * 100 : NaN;
  const longPct = futuresPro?.longShortRatio?.longAccount;
  const shortPct = futuresPro?.longShortRatio?.shortAccount;

  const samples = useMemo(() => {
    // Re-read history when current values change.
    const _ = futuresPro?.markPrice ?? futuresPro?.openInterest ?? futuresPro?.lastFundingRate;
    void _;
    return loadFuturesProHistory(symbol);
  }, [futuresPro?.lastFundingRate, futuresPro?.markPrice, futuresPro?.openInterest, symbol]);

  const nowMs = Date.now();
  const past1h = useMemo(() => sampleAtOrBefore(samples, nowMs - 60 * 60 * 1000), [nowMs, samples]);
  const oi1hPct = useMemo(() => {
    if (!past1h || !Number.isFinite(futuresPro?.openInterest) || !Number.isFinite(past1h.openInterest) || past1h.openInterest === 0) return null;
    return ((futuresPro!.openInterest - past1h.openInterest) / past1h.openInterest) * 100;
  }, [futuresPro?.openInterest, past1h]);
  const premium1h = useMemo(() => {
    if (!past1h || !Number.isFinite(premiumPct)) return null;
    return premiumPct - historyPremiumPct(past1h);
  }, [past1h, premiumPct]);

  const insight = useMemo(
    () =>
      buildFuturesInsight({
        signal: lastSignal,
        htfBias,
        fundingPct,
        premiumPct,
        oi1hPct,
        longPct,
        shortPct
      }),
    [fundingPct, htfBias, lastSignal, longPct, oi1hPct, premiumPct, shortPct]
  );

  return (
    <div>
      <h4 className="text-xs uppercase text-slate-500 mb-2">Futures pro</h4>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Metric label="Funding" value={Number.isFinite(fundingPct) ? `${fundingPct.toFixed(3)}%` : '—'} />
        <Metric label="OI" value={formatCompact(oi)} />
        <Metric label="Mark" value={Number.isFinite(mark) ? mark.toFixed(2) : '—'} />
        <Metric label="Premium" value={Number.isFinite(premiumPct) ? `${signed(premiumPct, 3)}%` : '—'} />
        <Metric label="Long%" value={formatRatioPct(longPct)} />
        <Metric label="Short%" value={formatRatioPct(shortPct)} />
      </div>

      <FuturesProContext symbol={symbol} futuresPro={futuresPro} />

      {insight ? (
        <div className="mt-3 border border-slate-800 rounded bg-slate-900/30 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs uppercase text-slate-500">Bias</div>
            <span
              className={clsx(
                'text-[11px] px-2 py-0.5 rounded border',
                insight.tone === 'bearish' ? 'text-bear border-rose-900/60 bg-rose-950/20' : '',
                insight.tone === 'bullish' ? 'text-bull border-emerald-900/60 bg-emerald-950/20' : '',
                insight.tone === 'squeeze' ? 'text-amber-200 border-amber-900/60 bg-amber-950/20' : '',
                insight.tone === 'neutral' ? 'text-slate-300 border-slate-800 bg-slate-900/20' : ''
              )}
            >
              {insight.label}
            </span>
          </div>
          <ul className="mt-1 space-y-1 text-[11px] text-slate-200 list-disc list-inside">
            {insight.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function RecentTab({ signals, allowedSymbols, onPick }: { signals: Signal[]; allowedSymbols: string[]; onPick: (s: Signal) => void }) {
  const recent = useMemo(() => {
    const scoped = allowedSymbols.length ? signals.filter((s) => allowedSymbols.includes(s.symbol)) : signals;
    return [...scoped].slice(-30).reverse();
  }, [allowedSymbols, signals]);
  return (
    <div>
      <h4 className="text-xs uppercase text-slate-500 mb-2">Recent</h4>
      {recent.length ? (
        <div className="space-y-2">
          {recent.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s)}
              className="w-full text-left border border-slate-800 rounded bg-slate-900/20 hover:bg-slate-900/40 px-2 py-2"
              title="Jump to chart"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-slate-200">
                  {s.symbol} <span className="text-slate-400">{s.timeframe}</span>
                  <span className="text-slate-500"> • </span>
                  <span className="text-slate-400">{(s.dataSource ?? 'futures') === 'spot' ? 'spot' : 'fut'}</span>
                </div>
                <span className={clsx('text-[11px] px-2 py-0.5 rounded border', s.side === 'long' ? 'text-bull border-emerald-900/60 bg-emerald-950/20' : 'text-bear border-rose-900/60 bg-rose-950/20')}>
                  {s.side.toUpperCase()}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Score {fmtNum(s.score, 0)} • RR {fmtNum(s.rr, 2)} • {ageLabel(s.timestamp)} ago
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="border border-slate-800 rounded bg-slate-900/20 p-2 text-xs text-slate-500">
          No signals yet.
        </div>
      )}
    </div>
  );
}

function VipUpsell() {
  return (
    <div className="border border-slate-800 rounded bg-slate-900/20 p-3 text-xs text-slate-400">
      <div className="text-slate-200 font-medium">Pro feature</div>
      <div className="mt-1">Upgrade to Pro to unlock risk sizing, stats, scanner opportunities, and futures pro context.</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col bg-slate-900/40 border border-slate-800 rounded px-2 py-1">
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className="text-slate-100">{value}</span>
    </div>
  );
}

function BiasPill({ tf, bias }: { tf: Timeframe; bias: 'up' | 'down' | 'neutral' | 'unknown' }) {
  const label = bias === 'unknown' ? '—' : bias;
  return (
    <span
      className={clsx(
        'px-2 py-1 rounded text-[11px] border',
        bias === 'up'
          ? 'text-bull border-emerald-900/60 bg-emerald-950/20'
          : bias === 'down'
            ? 'text-bear border-rose-900/60 bg-rose-950/20'
            : 'text-slate-300 border-slate-800 bg-slate-900/30'
      )}
      title="Higher timeframe bias"
    >
      {tf}: {label}
    </span>
  );
}

function buildHtfBias(htfCandles: Record<Timeframe, import('@/types').Candle[]>): Record<Timeframe, 'up' | 'down' | 'neutral' | 'unknown'> {
  const out = {} as Record<Timeframe, 'up' | 'down' | 'neutral' | 'unknown'>;
  for (const tf of DEFAULT_STRATEGY.htfTimeframes) {
    const candles = htfCandles?.[tf] ?? [];
    if (!candles.length) {
      out[tf] = 'unknown';
      continue;
    }
    const closes = candles.map((c) => c.close);
    const emaValues = ema(closes, DEFAULT_STRATEGY.emaPeriod);
    const lastEma = emaValues.at(-1);
    const lastClose = closes.at(-1);
    if (!Number.isFinite(lastEma) || !Number.isFinite(lastClose)) {
      out[tf] = 'unknown';
      continue;
    }
    out[tf] = lastClose > lastEma ? 'up' : lastClose < lastEma ? 'down' : 'neutral';
  }
  return out;
}

function isSignalSane(signal: Signal, referencePrice: number): boolean {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return true;
  if (!Number.isFinite(signal.entry) || signal.entry <= 0) return false;
  const ratio = signal.entry / referencePrice;
  return ratio > 0.05 && ratio < 20;
}

function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 0 : abs >= 100 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : abs >= 0.0001 ? 6 : 8;
  return value.toFixed(decimals);
}

function fmtNum(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

function signed(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}`;
}

type FuturesInsightTone = 'bullish' | 'bearish' | 'neutral' | 'squeeze';
type FuturesInsight = { label: string; tone: FuturesInsightTone; bullets: string[] };

function buildFuturesInsight({
  signal,
  htfBias,
  fundingPct,
  premiumPct,
  oi1hPct,
  longPct,
  shortPct
}: {
  signal?: Signal;
  htfBias: Record<Timeframe, 'up' | 'down' | 'neutral' | 'unknown'>;
  fundingPct: number;
  premiumPct: number;
  oi1hPct: number | null;
  longPct?: number;
  shortPct?: number;
}): FuturesInsight | null {
  if (!Number.isFinite(fundingPct) && !Number.isFinite(premiumPct) && oi1hPct === null) return null;

  const side = signal?.side;
  const tfBias = signal?.timeframe ? htfBias[signal.timeframe] : 'unknown';
  const bullets: string[] = [];

  const fundingWarnLong = Number.isFinite(fundingPct) && fundingPct > 0.05;
  const fundingWarnShort = Number.isFinite(fundingPct) && fundingPct < -0.05;
  const premiumWarnLong = Number.isFinite(premiumPct) && premiumPct > 0.2;
  const premiumWarnShort = Number.isFinite(premiumPct) && premiumPct < -0.2;
  const oiExpanding = oi1hPct !== null && Number.isFinite(oi1hPct) && oi1hPct > 1;
  const longHeavy = Number.isFinite(longPct) && Number.isFinite(shortPct) && longPct! > 60 && shortPct! < 40;
  const shortHeavy = Number.isFinite(longPct) && Number.isFinite(shortPct) && shortPct! > 60 && longPct! < 40;

  if (Number.isFinite(fundingPct)) bullets.push(`Funding ${signed(fundingPct, 3)}% (${fundingPct >= 0 ? 'longs pay' : 'shorts pay'})`);
  if (Number.isFinite(premiumPct)) bullets.push(`Premium ${signed(premiumPct, 3)}% vs spot`);
  if (oi1hPct !== null && Number.isFinite(oi1hPct)) bullets.push(`OI ${signed(oi1hPct, 2)}% in 1h ${oi1hPct > 0 ? '(leverage coming in)' : '(leverage exiting)'}`);
  if (longHeavy) bullets.push(`Positioning: longs ${longPct!.toFixed(1)}% / shorts ${shortPct!.toFixed(1)}%`);
  if (shortHeavy) bullets.push(`Positioning: shorts ${shortPct!.toFixed(1)}% / longs ${longPct!.toFixed(1)}%`);
  if (side && tfBias && tfBias !== 'unknown') bullets.push(`HTF ${tfBias}, signal ${side.toUpperCase()}`);

  if (side === 'short' && (fundingWarnLong || premiumWarnLong) && oiExpanding) {
    return { label: 'Squeeze risk (longs crowded)', tone: 'squeeze', bullets };
  }
  if (side === 'long' && (fundingWarnShort || premiumWarnShort) && oiExpanding) {
    return { label: 'Contrarian long (shorts crowded)', tone: 'bullish', bullets };
  }
  if (side === 'long' && (fundingWarnLong || premiumWarnLong) && !oiExpanding) {
    return { label: 'Longs already crowded', tone: 'neutral', bullets };
  }
  if (side === 'short' && (fundingWarnShort || premiumWarnShort) && !oiExpanding) {
    return { label: 'Shorts already crowded', tone: 'neutral', bullets };
  }

  if (fundingWarnLong || premiumWarnLong) return { label: 'Long bias', tone: 'bullish', bullets };
  if (fundingWarnShort || premiumWarnShort) return { label: 'Short bias', tone: 'bearish', bullets };
  if (oiExpanding) return { label: 'OI rising (leverage in)', tone: 'neutral', bullets };

  return { label: 'Neutral', tone: 'neutral', bullets };
}

function ageLabel(timestampSec: number): string {
  const now = Date.now() / 1000;
  const d = Math.max(0, now - timestampSec);
  if (d < 60) return `${Math.round(d)}s`;
  const m = d / 60;
  if (m < 60) return `${m.toFixed(1)}m`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(1)}h`;
  const days = h / 24;
  return `${days.toFixed(1)}d`;
}

function formatCooldown(cooldownSecs?: number): string {
  const s = cooldownSecs ?? 0;
  if (!Number.isFinite(s) || s <= 0) return '0';
  if (s < 60) return `${Math.ceil(s)}s`;
  const m = Math.ceil(s / 60);
  return `${m}m`;
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '-';
  try {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function formatRatioPct(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(2)}%`;
}
