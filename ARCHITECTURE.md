# Architecture

## Module Dependency Graph
index.ts
└── bot.ts (CopyTradingBot)
├── config.ts
├── core/events.ts (BotEmitter)
├── exchange/paper.ts (PaperExchange)
├── signals/mock.ts ──────────┐
├── signals/polymarket.ts ────┘ both implement ISignalSource
├── risk/engine.ts (RiskEngine)
├── scoring/tracker.ts (TraderTracker)
├── persistence/store.ts (StateStore)
├── reporting/reporter.ts (Reporter)
└── utils/{logger,helpers}.ts

text


No circular dependencies. All imports point downward.

## State Machine
text

 ┌──────────┐
 │   INIT   │  load config, restore state from JSON
 └────┬─────┘
      │ start()
      ▼
 ┌──────────┐       daily loss / drawdown exceeded
┌───→│ ACTIVE │ ────────────────────────────────┐
│ └────┬─────┘ │
│ │ signal loop ▼
│ │ monitor loop ┌──────────┐
│ │ report loop │ HALTED │ rejects new trades
│ │ │ (still │ still monitors SL/TP
│ │ daily reset │ monitors│ still generates reports
│ │ │ exits) │
│ ┌────┘ └────┬─────┘
│ │ │
│ └───── next day, PnL resets ───────────────┘
│ │
│ │ SIGINT / SIGTERM
│ │
│ ┌────────────────────────────────┘
│ ▼
│ ┌──────────┐
│ │ SHUTDOWN │ persist state, final report, exit
│ └──────────┘
└──────────────────────────────────────────────────────┘

text


## Risk Check Composition

Each check is a pure function:

```typescript
type RiskCheck = (ctx: RiskContext) => RiskCheckResult;
The engine runs them sequentially with short-circuit evaluation:

TypeScript

for (const check of ALL_CHECKS) {
  const result = check(ctx);
  if (!result.passed) return { approved: false, checks: results };
}
return { approved: true, checks: results };
Adding a new check = write a function, add to array. No class hierarchies, no inheritance.

Scoring Algorithm
Normalization Strategy
Raw metrics have different scales:

Win rate: 0–1
ROI: can be -100% to +1000%+
Sharpe: typically -2 to +3
Recency: days since last trade
Sigmoid normalization (1 / (1 + exp(-x))) maps unbounded values to (0, 1) smoothly, handling outliers without clipping.

Weight Rationale
Component	Weight	Why
Win Rate	30%	Most intuitive, but can be gamed with tiny positions
ROI	30%	Accounts for position sizing quality
Sharpe	25%	Rewards consistency over lucky streaks
Recency	15%	Stale traders lose relevance, prevents copying inactive wallets
Score Range
text

raw ∈ [~0.15, ~1.0]
final = (raw - 0.15) / 0.85 × 100
final ∈ [0, 100]
Persistence Schema
JSON

{
  "version": 1,
  "savedAt": 1700000000000,
  "portfolio": {
    "balance": 984.97,
    "startingBalance": 1000,
    "peakEquity": 1002.50,
    "positions": [["pos_abc123", { ... }]],
    "orders": [{ ... }],
    "trades": [{ ... }],
    "dailyPnl": [["2025-01-15", -4.20]]
  },
  "traders": [["trader_alpha", { ... }]],
  "marketPrices": [["btc-100k-2025", {"Yes": 0.62, "No": 0.38}]]
}
Maps serialize as [key, value][] arrays for JSON compatibility. Writes use temp file + rename for atomicity.

Extension Points
What	How
New signal source	Implement ISignalSource interface
New risk check	Add function to ALL_CHECKS array
New exchange	Match PaperExchange public API
Notifications	Listen on BotEmitter typed events
Web dashboard	Consume PerformanceReport from report:generated event
Database	Replace StateStore with SQLite/Postgres adapter