import { CONFIG } from "../config";
import { IExchange, ClosedTrade } from "../types";
import { log } from "../utils/logger";

export class StopLossMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private onClosed?: (trade: ClosedTrade) => void;

  start(exchange: IExchange, onClosed?: (t: ClosedTrade) => void): void {
    this.onClosed = onClosed;
    const sec = CONFIG.PNL_CHECK_INTERVAL_MS / 1000;
    log.info(`SL/TP monitor started (every ${sec}s)`);

    this.intervalId = setInterval(
      () => this.tick(exchange),
      CONFIG.PNL_CHECK_INTERVAL_MS,
    );
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick(ex: IExchange): void {
    const daily = ex.getDailyPnL();
    if (daily < -CONFIG.RISK.MAX_DAILY_LOSS_USDC) {
      log.risk(
        `DAILY LOSS LIMIT ($${daily.toFixed(2)}) - closing ALL positions`,
      );
      for (const pos of ex.getPositions()) {
        const c = ex.closePosition(pos.id, pos.currentPrice, "stop_loss");
        if (c) this.onClosed?.(c);
      }
      return;
    }

    for (const pos of ex.getPositions()) {
      const newPrice = drift(pos.currentPrice);
      ex.updatePositionPrice(pos.id, newPrice);

      const updated = ex.getPosition(pos.id);
      if (!updated) continue;

      const pctStr = `${(updated.unrealizedPnLPercent * 100).toFixed(1)}%`;

      if (updated.unrealizedPnLPercent <= CONFIG.RISK.STOP_LOSS_PERCENT) {
        log.risk(
          `STOP-LOSS "${updated.outcome}" | PnL ${pctStr} <= ${(CONFIG.RISK.STOP_LOSS_PERCENT * 100).toFixed(0)}%`,
        );
        const c = ex.closePosition(pos.id, updated.currentPrice, "stop_loss");
        if (c) this.onClosed?.(c);
        continue;
      }

      if (updated.unrealizedPnLPercent >= CONFIG.RISK.TAKE_PROFIT_PERCENT) {
        log.risk(
          `TAKE-PROFIT "${updated.outcome}" | PnL ${pctStr} >= ${(CONFIG.RISK.TAKE_PROFIT_PERCENT * 100).toFixed(0)}%`,
        );
        const c = ex.closePosition(pos.id, updated.currentPrice, "take_profit");
        if (c) this.onClosed?.(c);
        continue;
      }

      log.debug(
        `"${updated.outcome}" $${updated.avgEntryPrice.toFixed(3)}->${updated.currentPrice.toFixed(3)} PnL ${pctStr}`,
      );
    }
  }
}

function drift(price: number): number {
  const vol = 0.005 + Math.random() * 0.01;
  const reversion = (0.5 - price) * 0.02;
  const noise = (Math.random() - 0.5) * 2 * vol;
  const next = price + reversion + noise;
  return Math.round(Math.max(0.01, Math.min(0.99, next)) * 1000) / 1000;
}
