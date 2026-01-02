#!/usr/bin/env node
/**
 * Train a tiny logistic regression meta-model from exported signals JSON.
 *
 * Usage:
 *   node scripts/train-meta-model.mjs --in fsd-signals-YYYY-MM-DD.json --out fsd-model.json
 *   node scripts/train-meta-model.mjs --in fsd-signals.json --walkForwardFolds 4 --walkForwardTestFraction 0.15 --walkForwardMinTrainFraction 0.5 --driftWarnZ 0.5
 *
 * Notes:
 * - This script fetches candles from Binance (spot/futures) to label outcomes.
 * - It trains on the most common groups by default to keep runtime reasonable.
 */

import fs from 'node:fs/promises';

const args = parseArgs(process.argv.slice(2));
const inputPath = args.in;
const outputPath = args.out ?? 'fsd-model.json';
const maxGroups = num(args.maxGroups, 10);
const minSignalsPerGroup = num(args.minSignalsPerGroup, 20);
const maxHoldBars = num(args.maxHoldBars, 60);
const lookbackCandles = num(args.lookbackCandles, 260);
const sleepMs = num(args.sleepMs, 200);
const walkForwardFolds = num(args.walkForwardFolds, 4);
const walkForwardTestFraction = num(args.walkForwardTestFraction, 0.15);
const walkForwardMinTrainFraction = num(args.walkForwardMinTrainFraction, 0.5);
const driftWarnZ = num(args.driftWarnZ, 0.5);

const TRAINING = { iters: 2000, lr: 0.15, l2: 0.02 };

if (!inputPath) {
  console.error('Missing --in <signals.json>.');
  process.exit(1);
}

const FEATURES = ['score', 'rr', 'stopPct', 'atrPct', 'adx', 'bbBw', 'emaSlope', 'trend'];

const raw = await fs.readFile(inputPath, 'utf-8');
const signals = safeParseJson(raw);
if (!Array.isArray(signals)) {
  console.error('Input is not a JSON array.');
  process.exit(1);
}

const cleaned = signals
  .filter((s) => s && typeof s === 'object')
  .map((s) => normalizeSignal(s))
  .filter(Boolean);

if (!cleaned.length) {
  console.error('No valid signals found in input.');
  process.exit(1);
}

const groups = groupSignals(cleaned)
  .filter((g) => g.signals.length >= minSignalsPerGroup)
  .sort((a, b) => b.signals.length - a.signals.length)
  .slice(0, maxGroups);

if (!groups.length) {
  console.error('No groups meet --minSignalsPerGroup.');
  process.exit(1);
}

console.log(`Loaded ${cleaned.length} signals. Training on top ${groups.length} groups...`);

const rows = [];

for (const g of groups) {
  const tfSec = timeframeSeconds(g.timeframe);
  const minTs = Math.min(...g.signals.map((s) => s.timestamp));
  const maxTs = Math.max(...g.signals.map((s) => s.timestamp));
  const startMs = (minTs - lookbackCandles * tfSec) * 1000;
  const endMs = (maxTs + (maxHoldBars + 5) * tfSec) * 1000;

  console.log(`\n[${g.dataSource}] ${g.symbol} ${g.timeframe} | signals=${g.signals.length} | fetching candles...`);
  const candles = await fetchKlinesRange({
    dataSource: g.dataSource,
    symbol: g.symbol,
    timeframe: g.timeframe,
    startTimeMs: startMs,
    endTimeMs: endMs,
    sleepMs
  });

  if (candles.length < lookbackCandles) {
    console.log(`  skipped (only ${candles.length} candles).`);
    continue;
  }

  const closes = candles.map((c) => c.close);
  const ema200 = ema(closes, 200);
  const atr14 = atr(candles, 14);
  const adx14 = adx(candles, 14);
  const bbBw = bollingerBandwidth(closes, 20);

  let added = 0;
  for (const s of g.signals) {
    const idx = firstIndexAtOrAfter(candles, s.timestamp);
    if (idx < 0 || idx >= candles.length) continue;

    const label = evaluateLabel(s, candles, idx, maxHoldBars);
    if (label === null) continue;

    const entry = s.entry;
    if (!isFiniteNumber(entry) || entry <= 0) continue;
    const stopPct = (Math.abs(entry - s.stop) / entry) * 100;

    const atrPct = isFiniteNumber(atr14[idx]) && isFiniteNumber(closes[idx]) && closes[idx] ? (atr14[idx] / closes[idx]) * 100 : NaN;
    const emaSlopeVal = emaSlopeAt(ema200, idx, 30);
    const trend =
      emaSlopeVal > 0 && isFiniteNumber(ema200[idx]) && closes[idx] > ema200[idx]
        ? 1
        : emaSlopeVal < 0 && isFiniteNumber(ema200[idx]) && closes[idx] < ema200[idx]
          ? -1
          : 0;

    const row = {
      score: s.score,
      rr: s.rr,
      stopPct,
      atrPct,
      adx: adx14[idx],
      bbBw: bbBw[idx],
      emaSlope: emaSlopeVal,
      trend
    };

    const vec = FEATURES.map((f) => row[f]);
    if (!vec.every(isFiniteNumber)) continue;

    rows.push({ x: vec, y: label, ts: s.timestamp });
    added += 1;
  }

  console.log(`  candles=${candles.length} | training rows added=${added}`);
}

const ordered = rows.sort((a, b) => a.ts - b.ts);
const X = ordered.map((r) => r.x);
const y = ordered.map((r) => r.y);

if (!X.length) {
  console.error('No training rows after filtering.');
  process.exit(1);
}

if (X.length < 100) {
  console.warn(`\nWarning: only ${X.length} training rows. Results may be unstable.`);
}

if (walkForwardFolds > 0) {
  const wf = runWalkForward(ordered, {
    folds: walkForwardFolds,
    testFraction: walkForwardTestFraction,
    minTrainFraction: walkForwardMinTrainFraction,
    driftWarnZ,
    training: TRAINING
  });
  if (!wf.length) {
    console.log('\nWalk-forward: skipped (not enough data for requested folds).');
  } else {
    console.log('\nWalk-forward validation:');
    for (const row of wf) {
      const driftFlag = row.driftAvgAbsZ >= driftWarnZ ? ' DRIFT' : '';
      console.log(
        `  fold ${row.fold} | train=${row.trainSize} test=${row.testSize}` +
          ` | acc=${(row.accuracy * 100).toFixed(1)}%` +
          ` | logloss=${row.logLoss.toFixed(4)}` +
          ` | baseRate=${(row.baseRate * 100).toFixed(1)}%` +
          ` | driftAvgZ=${row.driftAvgAbsZ.toFixed(2)}` +
          ` | driftMaxZ=${row.driftMaxAbsZ.toFixed(2)}${driftFlag}`
      );
    }
  }
}

console.log(`\nTraining logistic regression: rows=${X.length}, features=${FEATURES.length}`);

const { means, stds, Xn } = standardize(X);
const { weights, bias } = trainLogReg(Xn, y, TRAINING);
const report = evaluateModel(Xn, y, weights, bias);

console.log(`Accuracy ${(report.accuracy * 100).toFixed(1)}% | LogLoss ${report.logLoss.toFixed(4)} | BaseRate ${(report.baseRate * 100).toFixed(1)}%`);

const model = {
  version: 'fsd-meta-v1',
  features: FEATURES,
  weights,
  bias,
  means,
  stds,
  threshold: 0.55
};

await fs.writeFile(outputPath, JSON.stringify(model, null, 2), 'utf-8');
console.log(`\nSaved model -> ${outputPath}`);
console.log('Load it in the app: Signal -> Stats -> Model -> paste the JSON and Save model.');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[key] = val;
  }
  return out;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function normalizeSignal(s) {
  const symbol = typeof s.symbol === 'string' ? s.symbol : null;
  const timeframe = typeof s.timeframe === 'string' ? s.timeframe : null;
  const side = s.side === 'long' || s.side === 'short' ? s.side : null;
  const entry = Number(s.entry);
  const stop = Number(s.stop);
  const tp1 = Number(s.tp1);
  const rr = Number(s.rr);
  const score = Number(s.score);
  const timestamp = Number(s.timestamp);
  const dataSource = s.dataSource === 'spot' ? 'spot' : 'futures';

  if (!symbol || !timeframe || !side) return null;
  if (![entry, stop, tp1, rr, score, timestamp].every(Number.isFinite)) return null;
  return { symbol, timeframe, side, entry, stop, tp1, rr, score, timestamp, dataSource };
}

function groupSignals(signals) {
  const map = new Map();
  for (const s of signals) {
    const key = `${s.dataSource}|${s.symbol}|${s.timeframe}`;
    const existing = map.get(key);
    if (!existing) map.set(key, { key, dataSource: s.dataSource, symbol: s.symbol, timeframe: s.timeframe, signals: [s] });
    else existing.signals.push(s);
  }
  return [...map.values()];
}

function timeframeSeconds(tf) {
  const map = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '1H': 3600, '4H': 14400, D: 86400, W: 604800 };
  return map[tf] ?? 60;
}

function intervalStr(tf) {
  const map = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '1H': '1h', '4H': '4h', D: '1d', W: '1w' };
  return map[tf] ?? '1m';
}

async function fetchKlinesRange({ dataSource, symbol, timeframe, startTimeMs, endTimeMs, sleepMs }) {
  const base = dataSource === 'spot' ? 'https://api.binance.com' : 'https://fapi.binance.com';
  const path = dataSource === 'spot' ? '/api/v3/klines' : '/fapi/v1/klines';
  const limit = dataSource === 'spot' ? 1000 : 1500;
  const interval = intervalStr(timeframe);
  const tfMs = timeframeSeconds(timeframe) * 1000;

  let start = Math.max(0, Math.floor(startTimeMs));
  const end = Math.floor(endTimeMs);
  const out = [];

  while (start < end) {
    const url =
      `${base}${path}?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}` +
      `&startTime=${start}&endTime=${end}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`klines ${dataSource} ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const r of rows) {
      out.push({
        time: Math.floor(r[0] / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5])
      });
    }

    const lastOpenTime = rows[rows.length - 1][0];
    start = lastOpenTime + tfMs;
    if (rows.length < limit) break;
    if (sleepMs > 0) await sleep(sleepMs);
  }

  // Deduplicate by time (in case of overlaps) and sort.
  const byTime = new Map();
  for (const c of out) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function firstIndexAtOrAfter(candles, tsSec) {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = candles[mid].time;
    if (v < tsSec) lo = mid + 1;
    else hi = mid - 1;
  }
  return lo;
}

function evaluateLabel(signal, candles, startIdx, maxHoldBars) {
  const entry = signal.entry;
  const stop = signal.stop;
  const tp1 = signal.tp1;
  const isLong = signal.side === 'long';

  if (![entry, stop, tp1].every(Number.isFinite) || entry <= 0) return null;
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;

  const endIdx = Math.min(candles.length - 1, startIdx + maxHoldBars);
  for (let i = startIdx + 1; i <= endIdx; i += 1) {
    const c = candles[i];
    const stopHit = isLong ? c.low <= stop : c.high >= stop;
    const tpHit = isLong ? c.high >= tp1 : c.low <= tp1;
    if (stopHit) return 0;
    if (tpHit) return 1;
  }

  // timeout/open treated as 0 (did not reach TP1 in time).
  return 0;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function ema(values, period) {
  if (period <= 0) return [];
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const result = [];
  let prev = NaN;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    if (i === period - 1) {
      prev = average(values.slice(0, period));
      result.push(prev);
      continue;
    }
    if (!Number.isFinite(prev)) {
      prev = value;
      result.push(prev);
      continue;
    }
    const next = value * k + prev * (1 - k);
    result.push(next);
    prev = next;
  }
  return result;
}

function atr(candles, period) {
  if (!candles.length) return [];
  const trs = [];
  for (let i = 0; i < candles.length; i += 1) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const prevClose = prev?.close ?? curr.close;
    const tr = Math.max(curr.high - curr.low, Math.abs(curr.high - prevClose), Math.abs(curr.low - prevClose));
    trs.push(tr);
  }
  const result = [];
  trs.forEach((tr, idx) => {
    if (idx < period) {
      result.push(NaN);
      return;
    }
    if (idx === period) {
      result.push(average(trs.slice(1, period + 1)));
      return;
    }
    const prevAtr = result[idx - 1];
    const next = ((prevAtr ?? tr) * (period - 1) + tr) / period;
    result.push(next);
  });
  return result;
}

function rma(values, period) {
  const result = [];
  const cleaned = values.map((v) => (Number.isFinite(v) ? v : 0));
  let prev = NaN;
  cleaned.forEach((v, i) => {
    if (i < period - 1) {
      result.push(NaN);
      return;
    }
    if (i === period - 1) {
      prev = average(cleaned.slice(0, period));
      result.push(prev);
      return;
    }
    const base = Number.isFinite(prev) ? prev : cleaned[i];
    const next = ((base ?? 0) * (period - 1) + v) / period;
    result.push(next);
    prev = next;
  });
  return result;
}

function adx(candles, period) {
  if (!candles.length) return [];
  const dmPlus = [NaN];
  const dmMinus = [NaN];
  const trs = [NaN];
  for (let i = 1; i < candles.length; i += 1) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close)));
  }
  const trRma = rma(trs, period);
  const dmPlusRma = rma(dmPlus, period);
  const dmMinusRma = rma(dmMinus, period);
  const diPlus = dmPlusRma.map((v, i) => (trRma[i] ? (v / trRma[i]) * 100 : NaN));
  const diMinus = dmMinusRma.map((v, i) => (trRma[i] ? (v / trRma[i]) * 100 : NaN));
  const dx = diPlus.map((v, i) => {
    const minus = diMinus[i];
    if (!Number.isFinite(v) || !Number.isFinite(minus)) return NaN;
    return (Math.abs(v - minus) / (v + minus)) * 100;
  });
  return rma(dx, period);
}

function bollingerBandwidth(values, period, mult = 2) {
  if (!values.length) return [];
  const result = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    const mean = average(slice);
    const std = Math.sqrt(average(slice.map((v) => (v - mean) ** 2)));
    const upper = mean + mult * std;
    const lower = mean - mult * std;
    const bw = ((upper - lower) / mean) * 100;
    result.push(bw);
  }
  return result;
}

function emaSlopeAt(values, idx, lookback) {
  const start = Math.max(0, idx - lookback + 1);
  const slice = values.slice(start, idx + 1).filter((v) => Number.isFinite(v));
  if (slice.length < 2) return NaN;
  const first = slice[0];
  const last = slice[slice.length - 1];
  return ((last - first) / Math.abs(first || 1)) * 100;
}

function standardize(X) {
  if (!X.length) return { means: [], stds: [], Xn: [] };
  const d = X[0].length;
  const means = Array(d).fill(0);
  const stds = Array(d).fill(0);
  for (let j = 0; j < d; j += 1) {
    means[j] = average(X.map((r) => r[j]));
    const v = average(X.map((r) => (r[j] - means[j]) ** 2));
    stds[j] = Math.sqrt(v) || 1;
  }
  const Xn = X.map((r) => r.map((v, j) => (v - means[j]) / stds[j]));
  return { means, stds, Xn };
}

function standardizeWith(X, means, stds) {
  if (!X.length) return [];
  return X.map((r) => r.map((v, j) => (v - means[j]) / (stds[j] || 1)));
}

function runWalkForward(rows, opts) {
  const total = rows.length;
  if (!total) return [];
  const testSize = Math.max(50, Math.floor(total * opts.testFraction));
  const minTrain = Math.max(Math.floor(total * opts.minTrainFraction), testSize);

  const results = [];
  let trainEnd = minTrain;
  let fold = 1;
  while (trainEnd + testSize <= total && fold <= opts.folds) {
    const trainRows = rows.slice(0, trainEnd);
    const testRows = rows.slice(trainEnd, trainEnd + testSize);

    const trainX = trainRows.map((r) => r.x);
    const trainY = trainRows.map((r) => r.y);
    const testX = testRows.map((r) => r.x);
    const testY = testRows.map((r) => r.y);

    const { means, stds, Xn } = standardize(trainX);
    if (!Xn.length || !testX.length) break;

    const { weights, bias } = trainLogReg(Xn, trainY, opts.training);
    const testXn = standardizeWith(testX, means, stds);
    const metrics = evaluateModel(testXn, testY, weights, bias);
    const drift = driftStats(testX, means, stds);

    results.push({
      fold,
      trainSize: trainRows.length,
      testSize: testRows.length,
      accuracy: metrics.accuracy,
      logLoss: metrics.logLoss,
      baseRate: metrics.baseRate,
      driftAvgAbsZ: drift.avgAbsZ,
      driftMaxAbsZ: drift.maxAbsZ
    });

    trainEnd += testSize;
    fold += 1;
  }

  return results;
}

function driftStats(X, means, stds) {
  if (!X.length) return { avgAbsZ: 0, maxAbsZ: 0, zMeans: [] };
  const d = means.length;
  const sums = Array(d).fill(0);
  const n = X.length;
  for (const row of X) {
    for (let j = 0; j < d; j += 1) {
      const std = stds[j] || 1;
      sums[j] += (row[j] - means[j]) / std;
    }
  }
  const zMeans = sums.map((s) => s / n);
  const absMeans = zMeans.map((v) => Math.abs(v));
  const avgAbsZ = average(absMeans);
  const maxAbsZ = absMeans.length ? Math.max(...absMeans) : 0;
  return { avgAbsZ, maxAbsZ, zMeans };
}

function sigmoid(z) {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

function trainLogReg(X, y, { iters, lr, l2 }) {
  const n = X.length;
  const d = X[0].length;
  let bias = 0;
  const w = Array(d).fill(0);

  for (let iter = 0; iter < iters; iter += 1) {
    const gradW = Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i += 1) {
      const xi = X[i];
      let z = bias;
      for (let j = 0; j < d; j += 1) z += w[j] * xi[j];
      const p = sigmoid(z);
      const err = p - y[i];
      gradB += err;
      for (let j = 0; j < d; j += 1) gradW[j] += err * xi[j];
    }
    gradB /= n;
    for (let j = 0; j < d; j += 1) {
      gradW[j] = gradW[j] / n + l2 * w[j];
      w[j] -= lr * gradW[j];
    }
    bias -= lr * gradB;
  }

  return { weights: w, bias };
}

function evaluateModel(X, y, w, b) {
  const n = X.length;
  let correct = 0;
  let logLoss = 0;
  let positives = 0;
  for (let i = 0; i < n; i += 1) {
    const xi = X[i];
    let z = b;
    for (let j = 0; j < w.length; j += 1) z += w[j] * xi[j];
    const p = sigmoid(z);
    const pred = p >= 0.5 ? 1 : 0;
    if (pred === y[i]) correct += 1;
    positives += y[i] ? 1 : 0;
    const yy = y[i];
    logLoss += -(yy * Math.log(p + 1e-9) + (1 - yy) * Math.log(1 - p + 1e-9));
  }
  return { accuracy: correct / n, logLoss: logLoss / n, baseRate: positives / n };
}

