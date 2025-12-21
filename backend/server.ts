import express from 'express';
import cors from 'cors';
import { loadConfig } from './config';
import { MetaModelManager } from './metaModel';
import { loadStoredState } from './storage';
import { SignalWorker } from './worker';

async function main() {
  const config = loadConfig();
  const state = await loadStoredState(config.persistPath);
  const metaModel = new MetaModelManager({ path: config.metaModelPath, inlineJson: config.metaModelJson });
  const worker = new SignalWorker(config, metaModel, state);

  await worker.run();
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await worker.run();
    } catch (err) {
      console.error('[worker] scheduled run failed', err);
    } finally {
      running = false;
    }
  }, config.pollSeconds * 1000);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    const snap = worker.getSnapshot();
    res.json({ ok: true, lastRun: snap?.lastRun ?? null, status: snap?.status ?? 'unknown' });
  });

  app.get('/signals', (req, res) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined;
    const timeframe = typeof req.query.timeframe === 'string' ? (req.query.timeframe as any) : undefined;
    const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 200;
    const history = worker.getHistory(limit && Number.isFinite(limit) ? limit : undefined);
    const filtered = history.filter((s) => {
      const matchesSymbol = symbol ? s.symbol === symbol : true;
      const matchesTf = timeframe ? s.timeframe === timeframe : true;
      return matchesSymbol && matchesTf;
    });
    const snap = worker.getSnapshot();
    res.json({
      lastRun: snap?.lastRun ?? null,
      runMs: snap?.runMs ?? null,
      status: snap?.status ?? 'unknown',
      count: filtered.length,
      signals: filtered
    });
  });

  app.post('/refresh', async (_req, res) => {
    const snap = await worker.run();
    res.json(snap);
  });

  app.get('/status', (_req, res) => {
    res.json({
      symbols: config.symbols,
      timeframes: config.timeframes,
      dataSource: config.dataSource,
      gateMode: config.gateMode,
      pollSeconds: config.pollSeconds,
      persistPath: config.persistPath,
      trendMode: config.trendMode,
      historyCap: config.historyCap,
      webhookConfigured: Boolean(config.discordWebhook),
      metaModel: Boolean(config.metaModelPath || config.metaModelJson)
    });
  });

  app.listen(config.port, () => {
    console.log(`[backend] listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('[backend] fatal error', err);
  process.exit(1);
});
