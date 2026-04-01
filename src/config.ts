import * as dotenv from 'dotenv';
import type { Config } from './core/types';

dotenv.config();

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  return v !== undefined ? Number(v) : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export function loadConfig(): Config {
  return {
    dryRun:           envBool('DRY_RUN', true),
    mockSignals:      envBool('MOCK_SIGNALS', true),
    logLevel:         env('LOG_LEVEL', 'INFO'),
    startingBalance:  envNum('STARTING_BALANCE', 1000),

    // Risk limits
    maxExposurePct:   envNum('MAX_EXPOSURE_PCT', 30),
    maxPositionPct:   envNum('MAX_POSITION_PCT', 15),
    maxPositions:     envNum('MAX_POSITIONS', 10),
    stopLossPct:      envNum('STOP_LOSS_PCT', 15),
    takeProfitPct:    envNum('TAKE_PROFIT_PCT', 50),
    dailyLossLimitPct:envNum('DAILY_LOSS_LIMIT_PCT', 10),
    drawdownHaltPct:  envNum('DRAWDOWN_HALT_PCT', 25),
    tradeCooldownMs:  envNum('TRADE_COOLDOWN_MS', 30_000),
    minPrice:         envNum('MIN_PRICE', 0.05),
    maxPrice:         envNum('MAX_PRICE', 0.95),
    minLiquidity:     envNum('MIN_LIQUIDITY', 1000),
    minTraderScore:   envNum('MIN_TRADER_SCORE', 40),

    // Intervals
    signalIntervalMs:       envNum('SIGNAL_INTERVAL_MS', 10_000),
    priceUpdateIntervalMs:  envNum('PRICE_UPDATE_INTERVAL_MS', 5_000),
    riskCheckIntervalMs:    envNum('RISK_CHECK_INTERVAL_MS', 3_000),
    reportIntervalMs:       envNum('REPORT_INTERVAL_MS', 60_000),
    persistIntervalMs:      envNum('PERSIST_INTERVAL_MS', 30_000),

    // Targets
    targetTraders: env('TARGET_TRADERS', '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),

    // API
    clobApiUrl: env('CLOB_API_URL', 'https://clob.polymarket.com'),
    gammaApiUrl: env('GAMMA_API_URL', 'https://gamma-api.polymarket.com'),
  };
}