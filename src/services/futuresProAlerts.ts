import { FuturesProSample, premiumPct, sampleAtOrBefore } from '@/services/futuresProHistory';

const recentAlerts = new Map<string, number>();

const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

// Conservative defaults (tune later).
const OI_SPIKE_1H_PCT = 5;
const PREMIUM_SPIKE_1H_PCT_POINTS = 0.2;
const FUNDING_SPIKE_1H_PCT_POINTS = 0.02;

export async function maybeAlertFuturesProSpikes(params: {
  symbol: string;
  samples: FuturesProSample[];
  webhookUrl?: string;
}) {
  const { symbol, samples, webhookUrl } = params;
  if (!samples.length) return;

  const now = Date.now();
  const last = samples.at(-1)!;
  const past = sampleAtOrBefore(samples, now - ONE_HOUR_MS);
  if (!past) return;

  const oiPct = past.openInterest > 0 ? ((last.openInterest - past.openInterest) / past.openInterest) * 100 : 0;
  const premDelta = premiumPct(last) - premiumPct(past);
  const fundingDelta = last.lastFundingRate * 100 - past.lastFundingRate * 100;

  const events: Array<{ key: string; text: string }> = [];

  if (Math.abs(oiPct) >= OI_SPIKE_1H_PCT) {
    events.push({ key: 'oi', text: `OI 1h ${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(1)}%` });
  }
  if (Math.abs(premDelta) >= PREMIUM_SPIKE_1H_PCT_POINTS) {
    events.push({ key: 'premium', text: `Premium 1h ${premDelta >= 0 ? '+' : ''}${premDelta.toFixed(2)}pp` });
  }
  if (Math.abs(fundingDelta) >= FUNDING_SPIKE_1H_PCT_POINTS) {
    events.push({ key: 'funding', text: `Funding 1h ${fundingDelta >= 0 ? '+' : ''}${fundingDelta.toFixed(3)}pp` });
  }

  for (const e of events) {
    const dedupeKey = `${symbol}:${e.key}`;
    const lastTs = recentAlerts.get(dedupeKey) ?? 0;
    if (now - lastTs < ALERT_COOLDOWN_MS) continue;
    recentAlerts.set(dedupeKey, now);
    const message = `[FuturesPro] ${symbol} ${e.text} | informational only`;
    toast(message);
    if (webhookUrl) await postDiscord(webhookUrl, message);
  }
}

function toast(text: string) {
  const id = `toast-${Date.now()}`;
  const div = document.createElement('div');
  div.id = id;
  div.textContent = text;
  div.className = 'fixed bottom-4 right-4 max-w-sm bg-panel border border-slate-800 text-sm p-3 rounded shadow-lg z-50';
  document.body.appendChild(div);
  setTimeout(() => document.getElementById(id)?.remove(), 6000);
}

async function postDiscord(webhookUrl: string, message: string) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
  } catch {
    // ignore
  }
}

