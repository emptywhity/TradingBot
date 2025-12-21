import { Candle } from '@/types';

export interface VolumeProfileBin {
  price: number; // midpoint
  volume: number;
}

export interface VolumeProfile {
  bins: VolumeProfileBin[];
  poc: VolumeProfileBin;
  hvn: VolumeProfileBin[];
  lvn: VolumeProfileBin[];
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * Approximate a session volume profile (VPVR-like) from candle OHLCV.
 * - Uses the last candle's UTC date as "session".
 * - Distributes each candle's volume uniformly across its price range.
 *
 * This is NOT tick-level volume-at-price; it's an approximation from candle volume.
 */
export function computeSessionVolumeProfile(candles: Candle[], binsCount = 40): VolumeProfile | undefined {
  if (candles.length < 20 || binsCount < 5) return undefined;
  const last = candles.at(-1);
  if (!last) return undefined;

  const lastDate = new Date(last.time * 1000);
  const session = candles.filter((c) => {
    const d = new Date(c.time * 1000);
    return (
      d.getUTCFullYear() === lastDate.getUTCFullYear() &&
      d.getUTCMonth() === lastDate.getUTCMonth() &&
      d.getUTCDate() === lastDate.getUTCDate()
    );
  });
  if (session.length < 20) return undefined;

  const low = Math.min(...session.map((c) => c.low));
  const high = Math.max(...session.map((c) => c.high));
  const range = high - low;
  if (!Number.isFinite(range) || range <= 0) return undefined;

  const binSize = range / binsCount;
  const volumes = Array.from({ length: binsCount }, () => 0);

  for (const c of session) {
    const candleRange = c.high - c.low;
    if (!Number.isFinite(candleRange) || candleRange <= 0) {
      const idx = clampInt((c.close - low) / binSize, 0, binsCount - 1);
      volumes[idx] += c.volume;
      continue;
    }
    const startBin = clampInt((c.low - low) / binSize, 0, binsCount - 1);
    const endBin = clampInt((c.high - low) / binSize, 0, binsCount - 1);
    for (let b = startBin; b <= endBin; b += 1) {
      const binLow = low + b * binSize;
      const binHigh = binLow + binSize;
      const overlap = Math.max(0, Math.min(c.high, binHigh) - Math.max(c.low, binLow));
      if (overlap <= 0) continue;
      volumes[b] += c.volume * (overlap / candleRange);
    }
  }

  const bins: VolumeProfileBin[] = volumes.map((v, i) => ({
    price: low + (i + 0.5) * binSize,
    volume: v
  }));

  const poc = bins.reduce((best, cur) => (cur.volume > best.volume ? cur : best), bins[0]);
  const pocVol = poc.volume || 1;

  // "Nodes" as top/bottom bins by relative volume (simple & deterministic)
  const sorted = [...bins].sort((a, b) => b.volume - a.volume);
  const hvn = sorted.filter((b) => b.price !== poc.price && b.volume >= pocVol * 0.6).slice(0, 3);

  const lvn = [...bins]
    .filter((b) => b.volume > 0 && b.volume <= pocVol * 0.2)
    .sort((a, b) => a.volume - b.volume)
    .slice(0, 3);

  return { bins, poc, hvn, lvn };
}

