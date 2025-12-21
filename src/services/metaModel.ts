import { Signal } from '@/types';

export type MetaModelV1 = {
  version: 'fsd-meta-v1';
  features: string[];
  weights: number[];
  bias: number;
  means?: number[];
  stds?: number[];
  threshold?: number;
};

export type MetaModelPrediction = {
  pTp1: number;
  evR: number;
};

const STORAGE_KEY = 'fsd.metaModel.v1';

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function loadMetaModel(): MetaModelV1 | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const json = JSON.parse(raw);
    const validated = validateMetaModel(json);
    return validated.ok ? validated.model : null;
  } catch {
    return null;
  }
}

export function saveMetaModel(model: MetaModelV1) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
}

export function clearMetaModel() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export function validateMetaModel(input: any): { ok: true; model: MetaModelV1 } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid JSON object.' };
  if (input.version !== 'fsd-meta-v1') return { ok: false, error: 'Unsupported model version.' };
  if (!Array.isArray(input.features) || !input.features.every((f: any) => typeof f === 'string')) return { ok: false, error: 'features must be string[].' };
  if (!Array.isArray(input.weights) || !input.weights.every((w: any) => isFiniteNumber(w))) return { ok: false, error: 'weights must be number[].' };
  if (!isFiniteNumber(input.bias)) return { ok: false, error: 'bias must be a number.' };
  if (input.weights.length !== input.features.length) return { ok: false, error: 'weights length must match features length.' };
  if (input.means && (!Array.isArray(input.means) || input.means.length !== input.features.length || !input.means.every((m: any) => isFiniteNumber(m)))) {
    return { ok: false, error: 'means must be number[] with same length as features.' };
  }
  if (input.stds && (!Array.isArray(input.stds) || input.stds.length !== input.features.length || !input.stds.every((s: any) => isFiniteNumber(s)))) {
    return { ok: false, error: 'stds must be number[] with same length as features.' };
  }
  if (input.threshold !== undefined && !isFiniteNumber(input.threshold)) return { ok: false, error: 'threshold must be a number.' };
  return { ok: true, model: input as MetaModelV1 };
}

export function tryParseMetaModel(text: string): { ok: true; model: MetaModelV1 } | { ok: false; error: string } {
  try {
    const json = JSON.parse(text);
    return validateMetaModel(json);
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : 'Failed to parse JSON.' };
  }
}

export function predictWithMetaModel(params: {
  model: MetaModelV1;
  signal: Signal;
  diagnostics?: {
    atrPct?: number;
    adx?: number;
    bb?: number;
    emaSlope?: number;
    trend?: string;
  };
}): MetaModelPrediction | null {
  const { model, signal, diagnostics } = params;
  const x = featureVector(model.features, signal, diagnostics);
  if (!x) return null;

  let z = model.bias;
  for (let i = 0; i < x.length; i += 1) {
    const mean = model.means?.[i] ?? 0;
    const std = model.stds?.[i] ?? 1;
    const norm = std ? (x[i] - mean) / std : x[i] - mean;
    z += model.weights[i] * norm;
  }

  const pTp1 = 1 / (1 + Math.exp(-z));
  const rr = Number.isFinite(signal.rr) ? signal.rr : 0;
  const evR = pTp1 * rr - (1 - pTp1);
  return { pTp1, evR };
}

function featureVector(features: string[], signal: Signal, diagnostics?: any): number[] | null {
  const stopPct = Number.isFinite(signal.entry) && signal.entry
    ? (Math.abs(signal.entry - signal.stop) / signal.entry) * 100
    : NaN;

  const map: Record<string, number> = {
    score: signal.score,
    rr: signal.rr,
    stopPct,
    atrPct: diagnostics?.atrPct,
    adx: diagnostics?.adx,
    bbBw: diagnostics?.bb,
    emaSlope: diagnostics?.emaSlope,
    trend:
      diagnostics?.trend === 'up' ? 1 : diagnostics?.trend === 'down' ? -1 : diagnostics?.trend === 'neutral' ? 0 : 0
  };

  const out: number[] = [];
  for (const f of features) {
    const v = map[f];
    if (!isFiniteNumber(v)) return null;
    out.push(v);
  }
  return out;
}

