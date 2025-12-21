import { DEFAULT_ALERT_DEDUPE_MINUTES } from '@/config/defaults';
import { Signal } from '@/types';

const recentSignals = new Map<string, number>();

export async function notifySignal(signal: Signal, webhookUrl?: string) {
  const key = `${signal.symbol}-${signal.timeframe}-${signal.side}`;
  const now = Date.now();
  const last = recentSignals.get(key) ?? 0;
  if ((now - last) / 60000 < DEFAULT_ALERT_DEDUPE_MINUTES) return;
  recentSignals.set(key, now);

  const message = formatMessage(signal);
  toast(message);
  notifyBrowser(signal);

  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message })
      });
    } catch (err) {
      console.error('Discord webhook failed', err);
    }
  }
}

function toast(text: string) {
  const id = `toast-${Date.now()}`;
  const div = document.createElement('div');
  div.id = id;
  div.textContent = text;
  div.className = 'fixed bottom-4 right-4 max-w-sm bg-panel border border-slate-800 text-sm p-3 rounded shadow-lg z-50';
  document.body.appendChild(div);
  setTimeout(() => document.getElementById(id)?.remove(), 5000);
}

function notifyBrowser(signal: Signal) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    new Notification(`Signal ${signal.side.toUpperCase()} ${signal.symbol}`, {
      body: `Entry ${signal.entry} Stop ${signal.stop} RR ${signal.rr.toFixed(2)} | no financial advice`
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
}

function formatMessage(signal: Signal): string {
  return [
    `Signal ${signal.side.toUpperCase()} ${signal.symbol} ${signal.timeframe}`,
    `Entry ${signal.entry.toFixed(4)} Stop ${signal.stop.toFixed(4)} TP1 ${signal.tp1.toFixed(4)} RR ${signal.rr.toFixed(2)}`,
    `Score ${signal.score} Reasons: ${signal.reasons.join('; ')}`,
    'no financial advice'
  ].join(' | ');
}

