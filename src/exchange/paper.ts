// ════════════════════════════════════════════════════════════
// Paper Trading Exchange
// Simulates order fills, tracks positions & PnL in memory.
// ════════════════════════════════════════════════════════════

import type { Signal, Position, Order, Trade, Portfolio, Config } from '../core/types';
import { rid, todayKey } from '../utils/helpers';
import { log } from '../utils/logger';

export class PaperExchange {
  private balance: number;
  private readonly startingBalance: number;
  private positions = new Map<string, Position>();
  private orders: Order[] = [];
  private trades: Trade[] = [];
  private dailyPnl = new Map<string, number>();
  private peakEquity: number;

  constructor(config: Config, restored?: {
    balance: number;
    peakEquity: number;
    positions: Map<string, Position>;
    orders: Order[];
    trades: Trade[];
    dailyPnl: Map<string, number>;
  }) {
    this.startingBalance = config.startingBalance;
    if (restored) {
      this.balance = restored.balance;
      this.peakEquity = restored.peakEquity;
      this.positions = restored.positions;
      this.orders = restored.orders;
      this.trades = restored.trades;
      this.dailyPnl = restored.dailyPnl;
    } else {
      this.balance = config.startingBalance;
      this.peakEquity = config.startingBalance;
    }
  }

  // ─── Order Execution ─────────────────────────────────────

  /**
   * Execute a BUY order — deduct cost, create position.
   * Fills instantly at `price` (paper-trade simplification).
   */
  buy(signal: Signal, size: number, price: number): Order {
    const cost = size * price;
    const orderId = `ord_${rid()}`;

    if (cost > this.balance) {
      const order: Order = {
        id: orderId,
        signalId: signal.id,
        traderId: signal.traderId,
        marketId: signal.marketId,
        question: signal.question,
        outcome: signal.outcome,
        side: 'BUY',
        price,
        size,
        cost,
        status: 'REJECTED',
        createdAt: Date.now(),
        reason: 'Insufficient balance',
      };
      this.orders.push(order);
      return order;
    }

    this.balance -= cost;

    const posId = `pos_${rid()}`;
    const now = Date.now();
    const position: Position = {
      id: posId,
      marketId: signal.marketId,
      question: signal.question,
      outcome: signal.outcome,
      side: 'BUY',
      entryPrice: price,
      currentPrice: price,
      size,
      cost,
      currentValue: cost,
      pnl: 0,
      pnlPct: 0,
      openedAt: now,
      updatedAt: now,
      signalId: signal.id,
      traderId: signal.traderId,
    };
    this.positions.set(posId, position);

    const order: Order = {
      id: orderId,
      signalId: signal.id,
      traderId: signal.traderId,
      marketId: signal.marketId,
      question: signal.question,
      outcome: signal.outcome,
      side: 'BUY',
      price,
      size,
      cost,
      status: 'FILLED',
      filledAt: now,
      createdAt: now,
    };
    this.orders.push(order);

    log.debug('Exchange', `Position opened: ${posId}`, {
      market: signal.question, price, size, cost: cost.toFixed(2)
    });

    return order;
  }

  /**
   * Close an existing position at `exitPrice`.
   * Returns the completed Trade, or null if position not found.
   */
  sell(positionId: string, exitPrice?: number): Trade | null {
    const pos = this.positions.get(positionId);
    if (!pos) return null;

    const price = exitPrice ?? pos.currentPrice;
    const proceeds = pos.size * price;
    const pnl = proceeds - pos.cost;
    const pnlPct = (price - pos.entryPrice) / pos.entryPrice * 100;
    const now = Date.now();

    this.balance += proceeds;
    this.positions.delete(positionId);

    // Record daily PnL
    const day = todayKey();
    this.dailyPnl.set(day, (this.dailyPnl.get(day) ?? 0) + pnl);

    const trade: Trade = {
      id: `trd_${rid()}`,
      orderId: '',
      signalId: pos.signalId,
      traderId: pos.traderId,
      marketId: pos.marketId,
      question: pos.question,
      outcome: pos.outcome,
      side: 'SELL',
      entryPrice: pos.entryPrice,
      exitPrice: price,
      size: pos.size,
      cost: pos.cost,
      proceeds,
      pnl,
      pnlPct,
      holdTimeMs: now - pos.openedAt,
      openedAt: pos.openedAt,
      closedAt: now,
    };
    this.trades.push(trade);

    return trade;
  }

  // ─── Price Updates ────────────────────────────────────────

  /** Update current price for all positions matching the market+outcome */
  updateMarketPrice(marketId: string, outcome: string, newPrice: number): void {
    for (const pos of this.positions.values()) {
      if (pos.marketId === marketId && pos.outcome === outcome) {
        pos.currentPrice = newPrice;
        pos.currentValue = pos.size * newPrice;
        pos.pnl = pos.currentValue - pos.cost;
        pos.pnlPct = (newPrice - pos.entryPrice) / pos.entryPrice * 100;
        pos.updatedAt = Date.now();
      }
    }
    // Update peak equity
    const eq = this.getEquity();
    if (eq > this.peakEquity) this.peakEquity = eq;
  }

  // ─── Getters ──────────────────────────────────────────────

  getBalance(): number { return this.balance; }
  getStartingBalance(): number { return this.startingBalance; }

  getEquity(): number {
    let posValue = 0;
    for (const p of this.positions.values()) posValue += p.currentValue;
    return this.balance + posValue;
  }

  getPositions(): Position[] { return [...this.positions.values()]; }
  getPosition(id: string): Position | undefined { return this.positions.get(id); }
  getOrders(): Order[] { return [...this.orders]; }
  getTrades(): Trade[] { return [...this.trades]; }
  getDailyPnl(): Map<string, number> { return new Map(this.dailyPnl); }
  getPeakEquity(): number { return this.peakEquity; }
  getTodayPnl(): number { return this.dailyPnl.get(todayKey()) ?? 0; }

  getTotalExposure(): number {
    let total = 0;
    for (const p of this.positions.values()) total += p.currentValue;
    return total;
  }

  getPortfolio(): Portfolio {
    return {
      balance: this.balance,
      startingBalance: this.startingBalance,
      equity: this.getEquity(),
      positions: new Map(this.positions),
      orders: [...this.orders],
      trades: [...this.trades],
      dailyPnl: new Map(this.dailyPnl),
      peakEquity: this.peakEquity,
    };
  }
}