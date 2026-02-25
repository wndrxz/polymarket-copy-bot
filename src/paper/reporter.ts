import { IExchange } from "../types";
import { CONFIG } from "../config";
import { log } from "../utils/logger";
import { TraderManager } from "../traders/traderManager";
import * as fs from "fs";

export class Reporter {
  private intervalId: NodeJS.Timeout | null = null;
  private startTime = Date.now();

  start(exchange: IExchange, traders: TraderManager): void {
    log.info(
      `Reporter started (every ${CONFIG.PAPER.REPORT_INTERVAL_MS / 1000}s)`,
    );

    this.intervalId = setInterval(() => {
      this.print(exchange, traders);
    }, CONFIG.PAPER.REPORT_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  print(exchange: IExchange, traders: TraderManager): void {
    const bal = exchange.getBalance();
    const positions = exchange.getPositions();
    const trades = exchange.getClosedTrades();
    const startBal = CONFIG.PAPER.STARTING_BALANCE;
    const exposure = exchange.getTotalExposure();
    const unrealPnL = positions.reduce((s, p) => s + p.unrealizedPnL, 0);
    const realPnL = trades.reduce((s, t) => s + t.realizedPnL, 0);
    const equity = bal + exposure + unrealPnL;
    const totalPnL = equity - startBal;
    const pct = ((totalPnL / startBal) * 100).toFixed(2);

    const wins = trades.filter((t) => t.realizedPnL > 0);
    const losses = trades.filter((t) => t.realizedPnL <= 0);
    const wr =
      trades.length > 0
        ? ((wins.length / trades.length) * 100).toFixed(1)
        : "0.0";
    const avgW =
      wins.length > 0
        ? wins.reduce((s, t) => s + t.realizedPnL, 0) / wins.length
        : 0;
    const avgL =
      losses.length > 0
        ? losses.reduce((s, t) => s + t.realizedPnL, 0) / losses.length
        : 0;

    const uptimeH = ((Date.now() - this.startTime) / 3_600_000).toFixed(1);
    const sep = "=".repeat(55);

    const lines = [
      "",
      sep,
      `  PAPER TRADING REPORT - ${new Date().toISOString().slice(0, 16)}`,
      `  Uptime: ${uptimeH}h | Mode: ${CONFIG.DRY_RUN ? "PAPER" : "LIVE"}`,
      sep,
      `  Starting Balance:     $${startBal.toFixed(2)}`,
      `  Current Cash:         $${bal.toFixed(2)}`,
      `  Open Exposure:        $${exposure.toFixed(2)}`,
      `  Unrealized PnL:       ${fmtPnL(unrealPnL)}`,
      `  Total Equity:         $${equity.toFixed(2)}`,
      `  ---------------------------------------`,
      `  Total PnL:            ${fmtPnL(totalPnL)} (${pct}%)`,
      `  Realized PnL:         ${fmtPnL(realPnL)}`,
      `  Today's PnL:          ${fmtPnL(exchange.getDailyPnL())}`,
      `  ---------------------------------------`,
      `  Open Positions:       ${positions.length} / ${CONFIG.RISK.MAX_POSITIONS}`,
      `  Closed Trades:        ${trades.length}`,
      `  Win / Loss:           ${wins.length}W / ${losses.length}L`,
      `  Win Rate:             ${wr}%`,
      `  Avg Win:              ${fmtPnL(avgW)}`,
      `  Avg Loss:             ${fmtPnL(avgL)}`,
    ];

    if (positions.length > 0) {
      lines.push(`  ---------------------------------------`);
      lines.push(`  OPEN POSITIONS:`);
      for (const p of positions) {
        const ppct = (p.unrealizedPnLPercent * 100).toFixed(1);
        lines.push(
          `    * ${p.outcome.padEnd(4)} $${p.avgEntryPrice.toFixed(3)}->${p.currentPrice.toFixed(3)} ` +
            `${fmtPnL(p.unrealizedPnL)} (${ppct}%) | ${p.question.slice(0, 30)}...`,
        );
      }
    }

    const stats = traders.getAllStats().filter((t) => t.totalTrades > 0);
    if (stats.length > 0) {
      lines.push(`  ---------------------------------------`);
      lines.push(`  TRADER PERFORMANCE:`);
      for (const t of stats) {
        lines.push(
          `    * ${t.label.padEnd(14)} ${t.totalTrades} trades | WR ${(t.winRate * 100).toFixed(0)}% | ` +
            `PnL ${fmtPnL(t.totalPnL)} | score ${t.score.toFixed(2)}`,
        );
      }
    }

    lines.push(sep, "");
    for (const l of lines) log.report(l);

    this.save(exchange, traders);
  }

  private save(exchange: IExchange, traders: TraderManager): void {
    try {
      if (!fs.existsSync("data")) fs.mkdirSync("data");
      fs.writeFileSync(
        "data/latest-report.json",
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            balance: exchange.getBalance(),
            positions: exchange.getPositions(),
            closedTrades: exchange.getClosedTrades(),
            traderStats: traders.getAllStats(),
          },
          null,
          2,
        ),
      );
    } catch {
      // silent
    }
  }
}

function fmtPnL(v: number): string {
  return `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`;
}
