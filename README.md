# Futures Signal Dashboard (No-Execution)

Signal-only web dashboard for perpetual futures that feels like TradingView but runs on open components (Vite + React + TypeScript + Tailwind + lightweight-charts). It fetches public Binance data (spot + futures), draws candles (OHLC / Heikin Ashi), supply/demand zones, and emits selective signals that pass a quality gate. **No order execution. No financial advice; trading futures carries real risk and losses are possible.**

## Stack
- Vite + React + TypeScript
- TailwindCSS for styling
- Zustand for state
- lightweight-charts for the chart
- Vitest for unit tests

## Quickstart
```bash
npm install
npm run dev
```
Visit the URL printed by Vite. The UI defaults to BTCUSDT, 15m, Binance public data.

### Tests
```bash
npm test
```

## Backend (headless signals)
- Start a 24/7 signal worker: `npm run backend` (configure `.env` first).
- API (defaults to `http://localhost:4000`): `GET /signals?symbol=BTCUSDT&timeframe=15m&limit=200`, `POST /refresh`, `GET /status`, `GET /health`.
- Env keys: `BACKEND_SYMBOLS`, `BACKEND_TIMEFRAMES`, `BACKEND_DATA_SOURCE` (`futures|spot`), `BACKEND_GATE_MODE` (`default|aggressive|conservative`), `BACKEND_POLL_SECONDS`, `BACKEND_HISTORY_CAP`, `BACKEND_SIGNAL_STORE`, `BACKEND_DISCORD_WEBHOOK_URL`.
- Probabilidades/EV: set `BACKEND_META_MODEL_PATH` (or `BACKEND_META_MODEL_JSON`) with the same JSON the UI model uses to attach `probability` + `evR` to every signal and send them to the Discord webhook if configured.
- Persistencia: signals + metadata are saved to `backend/data/signals.json` (ignored by git).
- UI hydratation: set `VITE_BACKEND_URL` so the frontend seeds from the backend history (polls every 60s) while still running live scans in-browser.

## Configuración
- Symbols: change from the symbol dropdown (default BTCUSDT, ETHUSDT, SOLUSDT).
- Timeframes: 1m, 3m, 5m, 15m, 1H, 4H, D, W buttons on the toolbar. Default 15m.
- Heikin Ashi toggle: top-right of toolbar.
- Environment (.env): copy `.env.example` to `.env` if you want to add a Discord webhook.
  - `VITE_DISCORD_WEBHOOK_URL` to push external alerts (optional).

### Alertas
- In-app toast + optional browser notification (grant permission).
- Discord webhook supported if `VITE_DISCORD_WEBHOOK_URL` is set.
- Deduplication: no repeated side/symbol/timeframe within 15 minutes.
- Optional filters (VIP):
  - Auto-mute: suppress alerts when recent expectancy is negative.
  - Meta-model: filter alerts using a locally loaded logistic model JSON.

## Señales e Indicadores
- Indicators: Heikin Ashi, EMA200, ATR, ADX, Bollinger bandwidth, Donchian channels.
- Supply/Demand detection: pivot highs/lows with ATR-multiplied zones, freshness tracking, invalidation on breaks.
- Setups:
  1. Trend Pullback + Zone (main): HTF (1H/4H) EMA200 bias + rejection wick on fresh demand/supply. Stops buffered below/above zone with ATR, TP1 at 2R.
  2. Optional Squeeze Breakout: low BB bandwidth + Donchian break.
- Quality gate (strict by default):
  - `stop_distance_pct` <= 0.6%
  - `expected_RR` >= 1.8
  - ATR% within band to avoid chaos
  - Require fresh zone (configurable)
  - Cooldown bars to avoid over-alerting
  - Score >= 80 (confluence weighted: HTF align, wick rejection, ADX regime, RR, stop tightness)

## Persistencia
- Signals are stored locally in `localStorage` (no backend). History capped at the last 2000 entries.
- UI prefs are stored locally (auto-mute / ML filter toggles).

## Meta-model (opcional)
1. In the app: `Signal → Stats → Model… → Export signals JSON`.
2. Train a model from the exported file:
   ```bash
   npm run train:model -- --in fsd-signals-YYYY-MM-DD.json --out fsd-model.json
   ```
3. In the app: `Signal → Stats → Model…` and paste `fsd-model.json` contents, then **Save model**.

## Seguridad y Riesgo
- No keys are required for public data. If you add keys for other exchanges, never hardcode them; use environment variables.
- The app never executes orders — signals are informational only.
- Data can have gaps/outages; WebSocket subscriptions fall back to REST polling but may still miss ticks.
- Markets move fast; latency, slippage, and exchange-side throttling can change reality vs. the chart.
- Futures are leveraged products by default at most venues; this UI does **not** set leverage and does not manage positions.
- **Disclaimer:** This is not financial advice. Trading futures and derivatives carries significant risk, including loss of capital. Use at your own risk.

## Limitaciones
- Binance endpoints/CORS can fail from some regions; use a proxy/backend if needed.
- lightweight-charts does not natively render filled rectangles for zones; zones are approximated with stepped overlays.
- Walk-forward/performance metrics are not included; this is a live signal visualizer only.
- Quality gate is conservative; you may see long periods without alerts by design.

## Proyecto
- Frontend only. If you add a backend (e.g., to proxy data or persist signals server-side), keep API keys in the server environment and never expose them to the browser.
- Files of interest:
  - `src/services/signalEngine.ts` — signal logic and quality gate
  - `src/utils/indicators.ts` — indicators (EMA, ATR, ADX, BB bandwidth, Donchian, Heikin Ashi)
  - `src/utils/pivots.ts` — pivot/zones detection
  - `src/components/ChartPanel.tsx` — chart, zones, markers
  - `src/adapters/exchangeAdapter.ts` — Binance adapter (REST polling)
