# Polymarket Copy-Trading Bot

Copy trades from top Polymarket traders with risk management and paper trading.

## Features

- Paper Trading (mock exchange, no real funds)
- 8-Layer Risk Engine (daily loss cap, exposure, SL/TP, volatility, cooldowns)
- Trader Scoring (win rate, ROI, composite score)
- Mock Signal Generator (5 simulated markets)
- Live Data API ready (Polymarket polling)
- Performance Reports (periodic dashboard)
- State Persistence (JSON)

## Quick Start

```bash
npm install
npm start
Configuration
Edit .env or src/config.ts:

Setting	Default	Description
DRY_RUN	true	Paper trading mode
MOCK_SIGNALS	true	Simulated signals
STARTING_BALANCE	1000	Paper USDC
MAX_EXPOSURE_PERCENT	30%	Max in positions
STOP_LOSS_PERCENT	-15%	Auto exit
TAKE_PROFIT_PERCENT	+50%	Lock profit
Risk Pipeline
Every BUY passes 8 checks:

Daily loss cap
Trade cooldown
Price sanity (0.05-0.95)
Volume/liquidity filter
Max positions (10)
Total exposure (30%)
Per-market limit (15%)
Position sizing formula
Going Live
Set DRY_RUN=false and MOCK_SIGNALS=false
Add private key + derive API creds
Add real target wallet addresses
Start with small amounts
```
