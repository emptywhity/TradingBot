import { evaluateSignal } from '@/services/performance';
import { Candle, Signal } from '@/types';

export function filterStoppedSignals(signals: Signal[], candles?: Candle[], maxHoldBars = 240): Signal[] {
  if (!signals.length) return signals;
  return signals.filter((s) => {
    if (s.outcome === 'stop' || s.outcome === 'timeout') return false;
    if (!candles || candles.length < 2) return true;
    const outcome = evaluateSignal(s, candles, { maxHoldBars }).outcome;
    return outcome !== 'stop' && outcome !== 'timeout';
  });
}
