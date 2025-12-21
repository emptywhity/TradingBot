import path from 'path';
import dotenv from 'dotenv';
import { DEFAULT_GATE, DEFAULT_SYMBOLS, TIMEFRAMES } from '@/config/defaults';
import { DataSource } from '@/adapters/exchangeAdapter';
import { QualityGateConfig, Timeframe } from '@/types';

dotenv.config();

export type BackendConfig = {
  port: number;
  symbols: string[];
  timeframes: Timeframe[];
  dataSource: DataSource;
  gateMode: 'default' | 'aggressive' | 'conservative';
  gate: QualityGateConfig;
  pollSeconds: number;
  historyCap: number;
  persistPath: string;
  discordWebhook?: string;
  metaModelPath?: string;
  metaModelJson?: string;
  trendMode: boolean;
  maxHoldBars: number;
  ohlcvLimit: number;
};

export function loadConfig(): BackendConfig {
  const port = intFromEnv('BACKEND_PORT', 4000);
  const symbols = listFromEnv('BACKEND_SYMBOLS', DEFAULT_SYMBOLS);
  const timeframes = parseTimeframes(process.env.BACKEND_TIMEFRAMES) ?? (['5m', '15m', '1H', '4H'] as Timeframe[]);
  const dataSource = (process.env.BACKEND_DATA_SOURCE as DataSource) ?? 'futures';
  const gateMode = (process.env.BACKEND_GATE_MODE as BackendConfig['gateMode']) ?? 'default';
  const pollSeconds = Math.max(5, intFromEnv('BACKEND_POLL_SECONDS', 60));
  const historyCap = Math.max(100, intFromEnv('BACKEND_HISTORY_CAP', 2000));
  const persistPath = path.resolve(process.cwd(), optionalEnv('BACKEND_SIGNAL_STORE') ?? 'backend/data/signals.json');
  const discordWebhook = optionalEnv('BACKEND_DISCORD_WEBHOOK_URL') ?? optionalEnv('VITE_DISCORD_WEBHOOK_URL');
  const metaModelPath = optionalEnv('BACKEND_META_MODEL_PATH');
  const metaModelJson = optionalEnv('BACKEND_META_MODEL_JSON');
  const trendModeEnv = optionalEnv('BACKEND_TREND_MODE');
  const trendMode = !trendModeEnv || trendModeEnv !== 'false';
  const maxHoldBars = Math.max(10, intFromEnv('BACKEND_MAX_HOLD_BARS', 60));
  const ohlcvLimit = Math.max(400, intFromEnv('BACKEND_OHLCV_LIMIT', 2000));

  return {
    port,
    symbols,
    timeframes,
    dataSource,
    gateMode,
    gate: gateForMode(gateMode),
    pollSeconds,
    historyCap,
    persistPath,
    discordWebhook,
    metaModelPath,
    metaModelJson,
    trendMode,
    maxHoldBars,
    ohlcvLimit
  };
}

function listFromEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parts = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return parts.length ? parts : fallback;
}

function parseTimeframes(raw?: string | null): Timeframe[] | null {
  if (!raw) return null;
  const allowed = new Set<string>(TIMEFRAMES);
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = items.filter((tf) => allowed.has(tf));
  return valid.length ? (valid as Timeframe[]) : null;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function gateForMode(mode: BackendConfig['gateMode']): QualityGateConfig {
  if (mode === 'aggressive') {
    return {
      ...DEFAULT_GATE,
      maxStopPct: 1.0,
      minRR: 1.2,
      atrPctMin: 0.04,
      atrPctMax: 2,
      cooldownBars: 2,
      requireFreshZone: false,
      scoreMin: 70
    };
  }
  if (mode === 'conservative') {
    return {
      ...DEFAULT_GATE,
      maxStopPct: 0.5,
      minRR: 2.0,
      atrPctMin: 0.08,
      atrPctMax: 1.0,
      cooldownBars: 10,
      requireFreshZone: true,
      scoreMin: 90
    };
  }
  return DEFAULT_GATE;
}
