import { ExecutionCosts } from '@/services/performance';

const DEFAULT_EXECUTION_COSTS: ExecutionCosts = {
  feeBps: 2,
  slippageBps: 1
};

export function getExecutionCosts(): ExecutionCosts {
  const feeBps = parseBps(import.meta.env.VITE_EXECUTION_FEE_BPS, DEFAULT_EXECUTION_COSTS.feeBps);
  const slippageBps = parseBps(import.meta.env.VITE_EXECUTION_SLIPPAGE_BPS, DEFAULT_EXECUTION_COSTS.slippageBps);
  return { feeBps, slippageBps };
}

function parseBps(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
