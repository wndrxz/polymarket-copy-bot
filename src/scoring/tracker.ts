// ════════════════════════════════════════════════════════════
// Trader Scoring & Tracking System
// Maintains per-trader statistics with composite scoring
// based on win rate, ROI, Sharpe ratio, and recency.
// ════════════════════════════════════════════════════════════

import type { Trade, Signal, TraderStats } from '../core/types';
import { mean, stddev, sigmoid } from '../utils/helpers';
import { log } from '../utils/logger';

// Composite score weights
const W_WINRATE = 0.30;
const W_ROI     = 0.30;
const W_SHARPE  = 0.25;
const W_RECENCY = 0.15;

export class TraderTracker {
  private traders = new Map<string, TraderStats>();

  constructor(restored?: Map<string, TraderStats>) {
    if (restored) this.traders = restored;
  }

  /** Register a signal (track the trader even before trade completes) */
  registerTrader(traderId: string, alias?: string): void {
    if (this.traders.has(traderId)) return;
    this.traders.set(traderId, {
      id: traderId,
      alias: alias ?? traderId.slice(0, 12),
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      totalInvested: 0,
      roi: 0,
      avgReturn: 0,
      returnStdDev: 0,
      sharpeRatio: 0,
      compositeScore: 50, // neutral starting score
      lastActive: Date.now(),
      returns: [],
    });
  }

  /** Record a completed trade and recalculate scores */
  recordTrade(trade: Trade): void {
    this.registerTrader(trade.traderId);
    const stats = this.traders.get(trade.traderId)!;

    stats.totalTrades++;
    if (trade.pnl > 0) stats.wins++;
    else stats.losses++;

    stats.totalPnl += trade.pnl;
    stats.totalInvested += trade.cost;
    stats.lastActive = trade.closedAt;

    // Per-trade return rate
    const returnRate = trade.cost > 0 ? trade.pnl / trade.cost : 0;
    stats.returns.push(returnRate);

    // Keep last 200 returns for calculation efficiency
    if (stats.returns.length > 200) {
      stats.returns = stats.returns.slice(-200);
    }

    this.recalculate(stats);

    log.debug('Scoring',
      `${stats.alias}: trade #${stats.totalTrades} ` +
      `PnL ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)} → ` +
      `Score ${stats.compositeScore.toFixed(1)}`
    );
  }

  private recalculate(s: TraderStats): void {
    // Base metrics
    s.winRate = s.totalTrades > 0 ? s.wins / s.totalTrades : 0;
    s.roi = s.totalInvested > 0 ? s.totalPnl / s.totalInvested : 0;
    s.avgReturn = mean(s.returns);
    s.returnStdDev = stddev(s.returns);
    s.sharpeRatio = s.returnStdDev > 0.001 ? s.avgReturn / s.returnStdDev : 0;

    // ── Composite Score (0–100) ────────────────────────────
    //
    // 1. Win Rate (0–1): direct mapping
    const normWR = s.winRate;

    // 2. ROI: sigmoid-scaled to handle outliers
    //    sigmoid(roi * 5)  maps [-∞,+∞] → (0,1), centered at 0
    const normROI = sigmoid(s.roi * 5);

    // 3. Sharpe Ratio: sigmoid-scaled
    //    A Sharpe of 1.0 maps to ~0.73, 2.0 → 0.88
    const normSharpe = sigmoid(s.sharpeRatio * 1.5);

    // 4. Recency: exponential decay, halves every 14 days
    const daysSinceLast = (Date.now() - s.lastActive) / 86_400_000;
    const recency = Math.exp(-daysSinceLast / 20);

    const raw =
      W_WINRATE * normWR +
      W_ROI     * normROI +
      W_SHARPE  * normSharpe +
      W_RECENCY * recency;

    // Scale to 0–100
    // raw ranges from ~0.15 (worst) to ~1.0 (best)
    // Remap: (raw - 0.15) / 0.85 * 100
    s.compositeScore = Math.round(Math.max(0, Math.min(100,
      ((raw - 0.15) / 0.85) * 100
    )) * 10) / 10;
  }

  // ─── Getters ───────────────────────────────────────────────

  getStats(traderId: string): TraderStats | null {
    return this.traders.get(traderId) ?? null;
  }

  getTopTraders(n: number = 5): TraderStats[] {
    return [...this.traders.values()]
      .filter(t => t.totalTrades >= 1)
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, n);
  }

  getAll(): Map<string, TraderStats> {
    return new Map(this.traders);
  }

  getCount(): number {
    return this.traders.size;
  }
}