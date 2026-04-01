// ════════════════════════════════════════════════════════════
// Core Domain Types
// Every type in the system defined in one place.
// ════════════════════════════════════════════════════════════

export type Side = 'BUY' | 'SELL';
export type OrderStatus = 'FILLED' | 'REJECTED';

// ─── Market ───────────────────────────────────────────────
export interface Market {
  id: string;
  slug: string;
  question: string;
  outcomes: [string, string];
  endDate: string;
  active: boolean;
  volume: number;
  liquidity: number;
  prices: Record<string, number>;
}

// ─── Signal ───────────────────────────────────────────────
export interface Signal {
  id: string;
  timestamp: number;
  traderId: string;
  marketId: string;
  marketSlug: string;
  question: string;
  outcome: string;
  side: Side;
  price: number;
  size: number;          // shares requested
  confidence: number;    // 0–1
}

// ─── Position ─────────────────────────────────────────────
export interface Position {
  id: string;
  marketId: string;
  question: string;
  outcome: string;
  side: Side;
  entryPrice: number;
  currentPrice: number;
  size: number;
  cost: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  openedAt: number;
  updatedAt: number;
  signalId: string;
  traderId: string;
}

// ─── Order ────────────────────────────────────────────────
export interface Order {
  id: string;
  signalId: string;
  traderId: string;
  marketId: string;
  question: string;
  outcome: string;
  side: Side;
  price: number;
  size: number;
  cost: number;
  status: OrderStatus;
  filledAt?: number;
  createdAt: number;
  reason?: string;
}

// ─── Trade (completed round-trip) ───────────────────────
export interface Trade {
  id: string;
  orderId: string;
  signalId: string;
  traderId: string;
  marketId: string;
  question: string;
  outcome: string;
  side: Side;
  entryPrice: number;
  exitPrice: number;
  size: number;
  cost: number;
  proceeds: number;
  pnl: number;
  pnlPct: number;
  holdTimeMs: number;
  openedAt: number;
  closedAt: number;
}

// ─── Trader Scoring ─────────────────────────────────────
export interface TraderStats {
  id: string;
  alias: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  totalInvested: number;
  roi: number;
  avgReturn: number;
  returnStdDev: number;
  sharpeRatio: number;
  compositeScore: number;
  lastActive: number;
  returns: number[];
}

// ─── Portfolio ──────────────────────────────────────────
export interface Portfolio {
  balance: number;
  startingBalance: number;
  equity: number;
  positions: Map<string, Position>;
  orders: Order[];
  trades: Trade[];
  dailyPnl: Map<string, number>;
  peakEquity: number;
}

// ─── Risk Engine ────────────────────────────────────────
export interface RiskContext {
  signal: Signal;
  portfolio: Portfolio;
  config: Config;
  traderStats: TraderStats | null;
  lastTradeTime: number;
  marketPrices: Map<string, Record<string, number>>;
}

export interface RiskCheckResult {
  name: string;
  passed: boolean;
  reason: string;
  meta?: Record<string, unknown>;
}

export interface RiskVerdict {
  approved: boolean;
  checks: RiskCheckResult[];
  adjustedSize: number;
  originalSize: number;
}

// ─── Performance Report ────────────────────────────────
export interface PerformanceReport {
  timestamp: number;
  uptimeMs: number;
  balance: number;
  equity: number;
  totalReturn: number;
  totalReturnPct: number;
  dayPnl: number;
  winRate: number;
  totalTrades: number;
  openPositions: number;
  totalExposure: number;
  exposurePct: number;
  maxDrawdownPct: number;
  currentDrawdownPct: number;
  profitFactor: number;
  sharpeRatio: number;
  bestTrade: number;
  worstTrade: number;
  avgHoldTimeMs: number;
  positions: Position[];
  topTraders: TraderStats[];
  riskStatus: 'ACTIVE' | 'HALTED';
}

// ─── Persistence ────────────────────────────────────────
export interface BotState {
  version: number;
  savedAt: number;
  portfolio: {
    balance: number;
    startingBalance: number;
    peakEquity: number;
    positions: [string, Position][];
    orders: Order[];
    trades: Trade[];
    dailyPnl: [string, number][];
  };
  traders: [string, TraderStats][];
  marketPrices: [string, Record<string, number>][];
}

// ─── Configuration ─────────────────────────────────────
export interface Config {
  dryRun: boolean;
  mockSignals: boolean;
  logLevel: string;
  startingBalance: number;

  maxExposurePct: number;
  maxPositionPct: number;
  maxPositions: number;
  stopLossPct: number;
  takeProfitPct: number;
  dailyLossLimitPct: number;
  drawdownHaltPct: number;
  tradeCooldownMs: number;
  minPrice: number;
  maxPrice: number;
  minLiquidity: number;
  minTraderScore: number;

  signalIntervalMs: number;
  priceUpdateIntervalMs: number;
  riskCheckIntervalMs: number;
  reportIntervalMs: number;
  persistIntervalMs: number;

  targetTraders: string[];
  clobApiUrl: string;
  gammaApiUrl: string;
}

// ─── Signal Source Interface ────────────────────────────
export interface ISignalSource {
  poll(): Promise<Signal[]>;
  getMarketPrices(): Map<string, Record<string, number>>;
  getMarkets(): Market[];
}