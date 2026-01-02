import express from 'express';
import cors from 'cors';
import { loadConfig } from './config';
import { MetaModelManager } from './metaModel';
import { loadStoredState } from './storage';
import { SignalWorker } from './worker';
import {
  authenticateUser,
  createSession,
  ensureAdminUser,
  getUserByToken,
  invalidateSession,
  listUsers,
  registerUser,
  updateUserRole
} from './auth';
import { UserRole } from './authStore';

async function main() {
  const config = loadConfig();
  const state = await loadStoredState(config.persistPath);
  const metaModel = new MetaModelManager({ path: config.metaModelPath, inlineJson: config.metaModelJson });
  const worker = new SignalWorker(config, metaModel, state);
  await ensureAdminUser(process.env.BACKEND_ADMIN_EMAIL, process.env.BACKEND_ADMIN_PASSWORD);

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
  app.use(async (req, _res, next) => {
    const token = parseAuthToken(req.headers.authorization);
    const user = await getUserByToken(token);
    (req as any).user = user;
    next();
  });

  app.get('/health', (_req, res) => {
    const snap = worker.getSnapshot();
    res.json({ ok: true, lastRun: snap?.lastRun ?? null, status: snap?.status ?? 'unknown' });
  });

  app.get('/signals', (req, res) => {
    const user = (req as any).user as { role: UserRole } | null;
    const role = user?.role ?? 'standard';
    const allowedSymbols = role === 'standard' ? ['BTCUSDT', 'ETHUSDT'] : null;
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined;
    const timeframe = typeof req.query.timeframe === 'string' ? (req.query.timeframe as any) : undefined;
    const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 200;
    const history = allowedSymbols
      ? worker.getHistory()
      : worker.getHistory(limit && Number.isFinite(limit) ? limit : undefined);
    const filtered = history.filter((s) => {
      const matchesSymbol = symbol ? s.symbol === symbol : true;
      const matchesTf = timeframe ? s.timeframe === timeframe : true;
      const allowed = allowedSymbols ? allowedSymbols.includes(s.symbol) : true;
      return matchesSymbol && matchesTf && allowed;
    });
    const trimmed = limit && Number.isFinite(limit) ? filtered.slice(-limit) : filtered;
    const snap = worker.getSnapshot();
    res.json({
      lastRun: snap?.lastRun ?? null,
      runMs: snap?.runMs ?? null,
      status: snap?.status ?? 'unknown',
      count: trimmed.length,
      signals: trimmed
    });
  });

  app.post('/refresh', async (_req, res) => {
    const snap = await worker.run();
    res.json(snap);
  });

  app.get('/payment-info', (_req, res) => {
    res.json({
      address: process.env.BACKEND_PAYMENT_ADDRESS ?? '',
      asset: process.env.BACKEND_PAYMENT_ASSET ?? 'USDT',
      network: process.env.BACKEND_PAYMENT_NETWORK ?? 'BSC'
    });
  });

  app.post('/auth/register', async (req, res) => {
    try {
      const email = String(req.body?.email ?? '');
      const password = String(req.body?.password ?? '');
      if (!email || password.length < 8) {
        return res.status(400).json({ error: 'Invalid email or password.' });
      }
      const user = await registerUser(email, password);
      const session = await createSession(user.id);
      return res.json({ token: session.token, user });
    } catch (err: any) {
      return res.status(409).json({ error: err?.message ?? 'Registration failed.' });
    }
  });

  app.post('/auth/login', async (req, res) => {
    const email = String(req.body?.email ?? '');
    const password = String(req.body?.password ?? '');
    const user = await authenticateUser(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
    const session = await createSession(user.id);
    return res.json({ token: session.token, user });
  });

  app.post('/auth/logout', async (req, res) => {
    const token = parseAuthToken(req.headers.authorization);
    if (token) await invalidateSession(token);
    res.json({ ok: true });
  });

  app.get('/auth/me', (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });
    return res.json({ user });
  });

  app.get('/admin/users', async (req, res) => {
    const user = (req as any).user as { role: UserRole } | null;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden.' });
    const users = await listUsers();
    return res.json({ users });
  });

  app.post('/admin/users/:id/role', async (req, res) => {
    const user = (req as any).user as { role: UserRole } | null;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden.' });
    const role = String(req.body?.role ?? '');
    if (!['standard', 'vip', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    const vipDaysRaw = req.body?.vipDays;
    const vipExpiresRaw = req.body?.vipExpiresAt;
    const vipDays = typeof vipDaysRaw === 'number' ? vipDaysRaw : Number.parseInt(String(vipDaysRaw ?? ''), 10);
    const vipExpiresAt = typeof vipExpiresRaw === 'number' ? vipExpiresRaw : Number.parseInt(String(vipExpiresRaw ?? ''), 10);
    const updated = await updateUserRole(String(req.params.id), role as UserRole, {
      vipDays: Number.isFinite(vipDays) ? vipDays : undefined,
      vipExpiresAt: Number.isFinite(vipExpiresAt) ? vipExpiresAt : undefined
    });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: updated });
  });

  app.get('/status', (_req, res) => {
    res.json({
      symbols: config.symbols,
      timeframes: config.timeframes,
      dataSource: config.dataSource,
      gateMode: config.gateMode,
      dynamicGate: config.dynamicGate,
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

function parseAuthToken(header?: string): string | undefined {
  if (!header) return undefined;
  const parts = header.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return undefined;
}
