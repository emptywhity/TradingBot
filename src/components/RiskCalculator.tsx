import React, { useEffect, useMemo, useState } from 'react';
import { Signal } from '@/types';

type RiskInputs = {
  accountUsd: number;
  riskPct: number;
  leverage: number;
  feePct: number;
};

const STORAGE_KEY = 'fsd.risk.v1';

function readStored(): RiskInputs | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const json = JSON.parse(raw) as Partial<RiskInputs>;
    if (!json || typeof json !== 'object') return undefined;
    return {
      accountUsd: num(json.accountUsd, 1000),
      riskPct: num(json.riskPct, 1),
      leverage: num(json.leverage, 10),
      feePct: num(json.feePct, 0.08)
    };
  } catch {
    return undefined;
  }
}

function writeStored(value: RiskInputs) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return value.toFixed(decimals);
}

function baseAsset(symbol: string): string {
  if (symbol.endsWith('USDT')) return symbol.slice(0, -4);
  if (symbol.endsWith('USD')) return symbol.slice(0, -3);
  return symbol;
}

export function RiskCalculator({ signal }: { signal?: Signal }) {
  const stored = useMemo(() => readStored(), []);
  const [inputs, setInputs] = useState<RiskInputs>(
    stored ?? {
      accountUsd: 1000,
      riskPct: 1,
      leverage: 10,
      feePct: 0.08
    }
  );

  useEffect(() => {
    writeStored(inputs);
  }, [inputs]);

  const computed = useMemo(() => {
    if (!signal) return { ok: false as const, reason: 'No signal.' };
    const entry = signal.entry;
    const stop = signal.stop;
    const tp1 = signal.tp1;
    if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry <= 0) return { ok: false as const, reason: 'Invalid prices.' };
    const stopDist = Math.abs(entry - stop);
    if (stopDist <= 0) return { ok: false as const, reason: 'Stop distance is 0.' };

    const accountUsd = clamp(inputs.accountUsd, 0, 1e12);
    const riskPct = clamp(inputs.riskPct, 0, 100);
    const leverage = clamp(inputs.leverage, 1, 250);
    const feePct = clamp(inputs.feePct, 0, 5);
    const feeRate = feePct / 100;

    const riskUsd = (accountUsd * riskPct) / 100;
    const qty = riskUsd > 0 ? riskUsd / stopDist : 0;
    const notionalUsd = qty * entry;
    const marginUsd = leverage > 0 ? notionalUsd / leverage : notionalUsd;
    const rewardDist = Math.abs(tp1 - entry);
    const tpProfitUsd = qty * rewardDist;
    const roundTripFeesUsd = notionalUsd * feeRate * 2;
    const lossWithFeesUsd = riskUsd + roundTripFeesUsd;
    const rrNetApprox = stopDist > 0 ? (tpProfitUsd - roundTripFeesUsd) / (riskUsd || 1) : 0;

    const liqApprox =
      signal.side === 'long'
        ? entry * (1 - 1 / leverage)
        : signal.side === 'short'
          ? entry * (1 + 1 / leverage)
          : undefined;

    return {
      ok: true as const,
      entry,
      stop,
      tp1,
      stopDist,
      riskUsd,
      qty,
      notionalUsd,
      marginUsd,
      tpProfitUsd,
      roundTripFeesUsd,
      lossWithFeesUsd,
      liqApprox,
      rrNetApprox
    };
  }, [inputs, signal]);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs uppercase text-slate-500">Risk</h4>
        <span className="text-[11px] text-slate-500">Sizing is approximate</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field label="Account (USD)">
          <input
            type="number"
            className="w-full bg-slate-900/50 border border-slate-800 rounded px-2 py-1 text-slate-100"
            value={inputs.accountUsd}
            onChange={(e) => setInputs((s) => ({ ...s, accountUsd: Number(e.target.value) }))}
            min={0}
          />
        </Field>
        <Field label="Risk %">
          <input
            type="number"
            className="w-full bg-slate-900/50 border border-slate-800 rounded px-2 py-1 text-slate-100"
            value={inputs.riskPct}
            onChange={(e) => setInputs((s) => ({ ...s, riskPct: Number(e.target.value) }))}
            min={0}
            max={100}
            step={0.1}
          />
        </Field>
        <Field label="Leverage (x)">
          <input
            type="number"
            className="w-full bg-slate-900/50 border border-slate-800 rounded px-2 py-1 text-slate-100"
            value={inputs.leverage}
            onChange={(e) => setInputs((s) => ({ ...s, leverage: Number(e.target.value) }))}
            min={1}
            max={250}
            step={1}
          />
        </Field>
        <Field label="Fees % (round-trip)">
          <input
            type="number"
            className="w-full bg-slate-900/50 border border-slate-800 rounded px-2 py-1 text-slate-100"
            value={inputs.feePct}
            onChange={(e) => setInputs((s) => ({ ...s, feePct: Number(e.target.value) }))}
            min={0}
            max={5}
            step={0.01}
          />
        </Field>
      </div>

      <div className="mt-2 border border-slate-800 rounded bg-slate-900/30 p-2 text-xs">
        {!computed.ok ? (
          <div className="text-slate-500">{computed.reason}</div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Risk $" value={formatUsd(computed.riskUsd)} />
            <Metric label="Loss+fees $" value={formatUsd(computed.lossWithFeesUsd)} />
            <Metric label={`Qty (${baseAsset(signal!.symbol)})`} value={formatQty(computed.qty)} />
            <Metric label="Notional $" value={formatUsd(computed.notionalUsd)} />
            <Metric label="Margin $" value={formatUsd(computed.marginUsd)} />
            <Metric label="TP (2R) profit $" value={formatUsd(computed.tpProfitUsd - computed.roundTripFeesUsd)} />
            <Metric label="Fees $" value={formatUsd(computed.roundTripFeesUsd)} />
            <Metric label="Liq (approx)" value={computed.liqApprox ? computed.liqApprox.toFixed(2) : '—'} />
            <Metric label="RR (to 2R)" value={signal!.rr.toFixed(2)} />
            <Metric label="RR net (approx)" value={Number.isFinite(computed.rrNetApprox) ? computed.rrNetApprox.toFixed(2) : '—'} />
          </div>
        )}
      </div>

      <p className="text-[10px] text-slate-500 mt-2">
        Liquidation is a rough estimate and depends on exchange rules, maintenance margin, fees, and margin mode.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-slate-400">{label}</span>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col bg-slate-900/50 border border-slate-800 rounded px-2 py-1">
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className="text-slate-100">{value}</span>
    </div>
  );
}
