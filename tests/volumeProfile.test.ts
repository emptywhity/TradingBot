import { describe, expect, it } from 'vitest';
import { computeSessionVolumeProfile } from '@/utils/volumeProfile';
import { Candle } from '@/types';

describe('volume profile', () => {
  it('computes a session profile with poc/hvn/lvn', () => {
    // Align to UTC midnight so the generated candles stay in the same UTC session.
    const baseTs = 1_700_006_400;
    const candles: Candle[] = [];
    for (let i = 0; i < 120; i += 1) {
      // Same UTC day (increment seconds but keep within 24h)
      const t = baseTs + i * 60;
      const mid = 100 + Math.sin(i / 10) * 2;
      const open = mid - 0.2;
      const close = mid + 0.2;
      const high = mid + 0.6;
      const low = mid - 0.6;
      // Add a "high volume" cluster around ~101 to force a stable POC
      const vol = Math.abs(mid - 101) < 0.4 ? 10_000 : 1_000;
      candles.push({ time: t, open, high, low, close, volume: vol });
    }

    const profile = computeSessionVolumeProfile(candles, 40);
    expect(profile).toBeTruthy();
    expect(profile!.bins.length).toBe(40);
    expect(profile!.poc.volume).toBeGreaterThan(0);
    expect(profile!.poc.price).toBeGreaterThanOrEqual(0);
    expect(profile!.hvn.length).toBeGreaterThanOrEqual(0);
    expect(profile!.lvn.length).toBeGreaterThanOrEqual(0);
  });
});
