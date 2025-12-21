import fs from 'fs/promises';
import path from 'path';
import { Signal } from '@/types';

export type StoredState = {
  history: Signal[];
  lastRun?: number;
};

export async function loadStoredState(file: string): Promise<StoredState> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const json = JSON.parse(raw);
    if (!json || typeof json !== 'object') return { history: [] };
    if (!Array.isArray((json as any).history)) return { history: [] };
    return {
      history: (json as any).history as Signal[],
      lastRun: typeof (json as any).lastRun === 'number' ? (json as any).lastRun : undefined
    };
  } catch {
    return { history: [] };
  }
}

export async function persistState(file: string, state: StoredState): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const payload: StoredState = { history: state.history, lastRun: state.lastRun };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf-8');
}
