import {
  IExchange,
  Position,
  ClosedTrade,
  OrderParams,
  OrderResult,
} from "../types";
import { CONFIG } from "../config";
import { log } from "../utils/logger";

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function fail(id: string, ts: number, error: string): OrderResult {
  return {
    id,
    success: false,
    fillPrice: 0,
    fillSize: 0,
    costOrRevenue: 0,
    timestamp: ts,
    paper: true,
    error,
  };
}

export class MockExchange implements IExchange {
  private balance: number;
  private positions: Map<string, Position> = new Map();
  private closed: ClosedTrade[] = [];
  private dailyPnLValue = 0;
  private dailyResetDate: string = todayStr();

  constructor() {
    this.balance = CONFIG.PAPER.STARTING_BALANCE;
    log.info(`Paper Exchange | Starting balance: $${this.balance.toFixed(2)}`);
  }

  async createOrder(p: OrderParams): Promise<OrderResult> {
    const id = genId();
    const ts = Date.now();

    if (p.side === "BUY") return this.executeBuy(id, p, ts);
    return this.executeSell(id, p, ts);
  }

  private executeBuy(id: string, p: OrderParams, ts: number): OrderResult {
    const cost = p.price * p.size;

    if (cost > this.balance) {
      log.warn(
        `Insufficient balance: $${cost.toFixed(2)} > $${this.balance.toFixed(2)}`,
      );
      return fail(id, ts, "Insufficient balance");
    }

    this.balance -= cost;
    const posId = `${p.conditionId}-${p.tokenId}`;
    const existing = this.positions.get(posId);

    if (existing) {
      const totalShares = existing.shares + p.size;
      const totalCost = existing.costBasis + cost;
      existing.shares = totalShares;
      existing.costBasis = totalCost;
      existing.avgEntryPrice = totalCost / totalShares;
      existing.currentPrice = p.price;
    } else {
      this.positions.set(posId, {
        id: posId,
        conditionId: p.conditionId,
        tokenId: p.tokenId,
        outcome: p.outcome,
        question: p.question,
        shares: p.size,
        avgEntryPrice: p.price,
        costBasis: cost,
        currentPrice: p.price,
        unrealizedPnL: 0,
        unrealizedPnLPercent: 0,
        copiedFrom: p.copiedFrom,
        openedAt: ts,
      });
    }

    log.trade(
      `[PAPER] BUY ${p.size.toFixed(1)} x "${p.outcome}" @ $${p.price.toFixed(3)} | ` +
        `Cost: $${cost.toFixed(2)} | Cash: $${this.balance.toFixed(2)} | ${p.question.slice(0, 45)}`,
    );

    return {
      id,
      success: true,
      fillPrice: p.price,
      fillSize: p.size,
      costOrRevenue: cost,
      timestamp: ts,
      paper: true,
    };
  }

  private executeSell(id: string, p: OrderParams, ts: number): OrderResult {
    const posId = `${p.conditionId}-${p.tokenId}`;
    const pos = this.positions.get(posId);
    if (!pos || pos.shares <= 0) return fail(id, ts, "No position to sell");

    const sellShares = Math.min(p.size, pos.shares);
    const revenue = p.price * sellShares;
    const costSold = pos.avgEntryPrice * sellShares;
    const pnl = revenue - costSold;

    this.balance += revenue;
    this.addDailyPnL(pnl);

    this.closed.push({
      positionId: posId,
      conditionId: p.conditionId,
      tokenId: p.tokenId,
      outcome: p.outcome,
      question: p.question,
      shares: sellShares,
      entryPrice: pos.avgEntryPrice,
      exitPrice: p.price,
      costBasis: costSold,
      revenue,
      realizedPnL: pnl,
      realizedPnLPercent: costSold > 0 ? pnl / costSold : 0,
      copiedFrom: pos.copiedFrom,
      openedAt: pos.openedAt,
      closedAt: ts,
      reason: "copy_sell",
    });

    pos.shares -= sellShares;
    pos.costBasis -= costSold;
    if (pos.shares < 0.001) this.positions.delete(posId);

    const sign = pnl >= 0 ? "+" : "";
    log.trade(
      `[PAPER] SELL ${sellShares.toFixed(1)} x "${p.outcome}" @ $${p.price.toFixed(3)} | ` +
        `PnL: ${sign}$${pnl.toFixed(2)} | Cash: $${this.balance.toFixed(2)}`,
    );

    return {
      id,
      success: true,
      fillPrice: p.price,
      fillSize: sellShares,
      costOrRevenue: revenue,
      timestamp: ts,
      paper: true,
    };
  }

  async cancelOrder(_orderId: string): Promise<boolean> {
    return true;
  }

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getPosition(posId: string): Position | undefined {
    return this.positions.get(posId);
  }

  getBalance(): number {
    return this.balance;
  }

  getClosedTrades(): ClosedTrade[] {
    return [...this.closed];
  }

  getDailyPnL(): number {
    this.checkDailyReset();
    return this.dailyPnLValue;
  }

  getTotalExposure(): number {
    let total = 0;
    for (const p of this.positions.values()) total += p.costBasis;
    return total;
  }

  updatePositionPrice(posId: string, newPrice: number): void {
    const pos = this.positions.get(posId);
    if (!pos) return;
    pos.currentPrice = newPrice;
    pos.unrealizedPnL = (newPrice - pos.avgEntryPrice) * pos.shares;
    pos.unrealizedPnLPercent =
      pos.costBasis > 0 ? pos.unrealizedPnL / pos.costBasis : 0;
  }

  closePosition(
    posId: string,
    price: number,
    reason: ClosedTrade["reason"],
  ): ClosedTrade | null {
    const pos = this.positions.get(posId);
    if (!pos) return null;

    const revenue = price * pos.shares;
    const pnl = revenue - pos.costBasis;

    this.balance += revenue;
    this.addDailyPnL(pnl);

    const trade: ClosedTrade = {
      positionId: posId,
      conditionId: pos.conditionId,
      tokenId: pos.tokenId,
      outcome: pos.outcome,
      question: pos.question,
      shares: pos.shares,
      entryPrice: pos.avgEntryPrice,
      exitPrice: price,
      costBasis: pos.costBasis,
      revenue,
      realizedPnL: pnl,
      realizedPnLPercent: pos.costBasis > 0 ? pnl / pos.costBasis : 0,
      copiedFrom: pos.copiedFrom,
      openedAt: pos.openedAt,
      closedAt: Date.now(),
      reason,
    };

    this.closed.push(trade);
    this.positions.delete(posId);

    const sign = pnl >= 0 ? "+" : "";
    log.trade(
      `[PAPER] CLOSE (${reason}) "${pos.outcome}" | ` +
        `$${pos.avgEntryPrice.toFixed(3)} -> $${price.toFixed(3)} | ` +
        `PnL: ${sign}$${pnl.toFixed(2)} (${(trade.realizedPnLPercent * 100).toFixed(1)}%)`,
    );

    return trade;
  }

  private addDailyPnL(pnl: number): void {
    this.checkDailyReset();
    this.dailyPnLValue += pnl;
  }

  private checkDailyReset(): void {
    const today = todayStr();
    if (today !== this.dailyResetDate) {
      this.dailyResetDate = today;
      this.dailyPnLValue = 0;
    }
  }
}
