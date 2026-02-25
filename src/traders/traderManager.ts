import { CONFIG } from "../config";
import { TraderConfig, TraderStats, ClosedTrade } from "../types";
import { log } from "../utils/logger";

export class TraderManager {
  private stats: Map<string, TraderStats> = new Map();
  private wallets: TraderConfig[];

  constructor() {
    this.wallets = CONFIG.TARGET_WALLETS.filter((w) => w.enabled);

    for (const w of this.wallets) {
      this.stats.set(w.address, {
        address: w.address,
        label: w.label,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalPnL: 0,
        roi: 0,
        score: 0.5,
        lastActive: 0,
      });
    }

    log.info(
      `Tracking ${this.wallets.length} traders: ${this.wallets.map((w) => w.label).join(", ")}`,
    );
  }

  getEnabledWallets(): TraderConfig[] {
    return this.wallets;
  }

  getTraderWeight(addr: string): number {
    return this.wallets.find((w) => w.address === addr)?.weight ?? 0;
  }

  getTraderLabel(addr: string): string {
    return (
      this.wallets.find((w) => w.address === addr)?.label ?? addr.slice(0, 10)
    );
  }

  recordTrade(trade: ClosedTrade): void {
    const s = this.stats.get(trade.copiedFrom);
    if (!s) return;

    s.totalTrades++;
    s.totalPnL += trade.realizedPnL;
    s.lastActive = trade.closedAt;

    if (trade.realizedPnL > 0) s.wins++;
    else s.losses++;

    s.winRate = s.totalTrades > 0 ? s.wins / s.totalTrades : 0;
    s.roi = s.totalTrades > 0 ? s.totalPnL / (s.totalTrades * 50) : 0;
    s.score = this.calcScore(s);

    log.debug(
      `${s.label}: ${s.totalTrades} trades, WR ${(s.winRate * 100).toFixed(0)}%, ` +
        `PnL $${s.totalPnL.toFixed(2)}, score ${s.score.toFixed(2)}`,
    );
  }

  isTraderQualified(addr: string): boolean {
    const s = this.stats.get(addr);
    if (!s) return false;

    if (s.totalTrades < CONFIG.TRADER_SELECTION.MIN_TRADES) return true;

    return (
      s.winRate >= CONFIG.TRADER_SELECTION.MIN_WIN_RATE &&
      s.roi >= CONFIG.TRADER_SELECTION.MIN_ROI
    );
  }

  getAllStats(): TraderStats[] {
    return Array.from(this.stats.values()).sort((a, b) => b.score - a.score);
  }

  private calcScore(s: TraderStats): number {
    if (s.totalTrades < 3) return 0.5;

    const wrScore = s.winRate * 0.35;
    const roiScore = clamp(s.roi, -1, 1) * 0.35;
    const activity = Math.min(s.totalTrades / 10, 1) * 0.2;
    const recency = Date.now() - s.lastActive < 86_400_000 ? 0.1 : 0;

    return clamp(wrScore + roiScore + activity + recency, 0, 1);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
