// ════════════════════════════════════════════════════════════
// Performance Reporter
// Computes portfolio metrics and prints a formatted
// terminal dashboard with box-drawing characters.
// ════════════════════════════════════════════════════════════

import type {
  Config,
  Portfolio,
  PerformanceReport,
  TraderStats,
  Position,
  Trade,
} from '../core/types';
import { mean, stddev, todayKey, fmtDuration, fmtUsd, fmtPct } from '../utils/helpers';

const C = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  red:      '\x1b[31m',
  green:    '\x1b[32m',
  yellow:   '\x1b[33m',
  cyan:     '\x1b[36m',
  white:    '\x1b[37m',
  bgGreen:  '\x1b[42m',
  bgRed:    '\x1b[41m',
  bgYellow: '\x1b[43m',
};

export class Reporter {
  private startTime: number;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.startTime = Date.now();
  }

  /** Compute all performance metrics from the current portfolio state */
  generateReport(
    portfolio: Portfolio,
    topTraders: TraderStats[],
  ): PerformanceReport {
    const { trades } = portfolio;
    const equity = portfolio.equity;
    const totalReturn = equity - portfolio.startingBalance;
    const totalReturnPct = portfolio.startingBalance > 0
      ? totalReturn / portfolio.startingBalance * 100
      : 0;
    const dayPnl = portfolio.dailyPnl.get(todayKey()) ?? 0;

    // Win/loss stats from completed trades
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const winRate = trades.length > 0 ? wins.length / trades.length * 100 : 0;

    // Profit factor
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0
      ? grossProfit / grossLoss
      : grossProfit > 0 ? Infinity : 0;

    // Sharpe ratio (from trade returns)
    const returns = trades.map(t => t.cost > 0 ? t.pnl / t.cost : 0);
    const avgRet = mean(returns);
    const stdRet = stddev(returns);
    const sharpeRatio = stdRet > 0.001 ? avgRet / stdRet : 0;

    // Drawdown
    const maxDDPct = portfolio.peakEquity > 0
      ? (portfolio.peakEquity - Math.min(equity, portfolio.peakEquity)) / portfolio.peakEquity * 100
      : 0;
    const currentDDPct = portfolio.peakEquity > 0
      ? (portfolio.peakEquity - equity) / portfolio.peakEquity * 100
      : 0;

    // Best / worst trade
    const pnls = trades.map(t => t.pnl);
    const bestTrade = pnls.length > 0 ? Math.max(...pnls) : 0;
    const worstTrade = pnls.length > 0 ? Math.min(...pnls) : 0;

    // Average hold time
    const holdTimes = trades.map(t => t.holdTimeMs);
    const avgHoldTimeMs = holdTimes.length > 0 ? mean(holdTimes) : 0;

    // Exposure
    let totalExposure = 0;
    for (const p of portfolio.positions.values()) totalExposure += p.currentValue;
    const exposurePct = equity > 0 ? totalExposure / equity * 100 : 0;

    // Risk status
    const halted =
      dayPnl < -(this.config.startingBalance * this.config.dailyLossLimitPct / 100) ||
      currentDDPct >= this.config.drawdownHaltPct;

    return {
      timestamp: Date.now(),
      uptimeMs: Date.now() - this.startTime,
      balance: portfolio.balance,
      equity,
      totalReturn,
      totalReturnPct,
      dayPnl,
      winRate,
      totalTrades: trades.length,
      openPositions: portfolio.positions.size,
      totalExposure,
      exposurePct,
      maxDrawdownPct: maxDDPct,
      currentDrawdownPct: currentDDPct,
      profitFactor,
      sharpeRatio,
      bestTrade,
      worstTrade,
      avgHoldTimeMs,
      positions: [...portfolio.positions.values()],
      topTraders,
      riskStatus: halted ? 'HALTED' : 'ACTIVE',
    };
  }

  /** Print a full terminal dashboard */
  printDashboard(r: PerformanceReport): void {
    const W = 72;
    const hr = '─'.repeat(W - 2);

    const pad = (s: string, len: number) => {
      // Strip ANSI for length calculation
      const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
      const diff = len - stripped.length;
      return diff > 0 ? s + ' '.repeat(diff) : s;
    };

    const row = (content: string) => {
      const stripped = content.replace(/\x1b\[[0-9;]*m/g, '');
      const rem = W - 4 - stripped.length;
      return `│ ${content}${' '.repeat(Math.max(0, rem))} │`;
    };

    const mode = this.config.dryRun ? 'PAPER TRADING' : 'LIVE';
    const retColor = r.totalReturnPct >= 0 ? C.green : C.red;
    const dayColor = r.dayPnl >= 0 ? C.green : C.red;
    const statusBadge = r.riskStatus === 'ACTIVE'
      ? `${C.bgGreen}${C.bold} ACTIVE ${C.reset}`
      : `${C.bgRed}${C.bold} HALTED ${C.reset}`;

    console.log('');
    console.log(`┌${hr}┐`);
    console.log(row(`${C.bold}${C.cyan}POLYMARKET COPY-TRADING BOT${C.reset}                   ${C.dim}v1.0.0${C.reset}`));
    console.log(row(`${C.dim}Mode: ${mode}  |  Uptime: ${fmtDuration(r.uptimeMs)}${C.reset}`));
    console.log(`├${hr}┤`);

    // Portfolio
    console.log(row(
      `${C.bold}Balance:${C.reset}  $${r.balance.toFixed(2)}    ` +
      `${C.bold}Equity:${C.reset}  $${r.equity.toFixed(2)}    ` +
      `${C.bold}P&L:${C.reset}  ${retColor}${fmtUsd(r.totalReturn)}${C.reset}`
    ));
    console.log(row(
      `${C.bold}Return:${C.reset}   ${retColor}${fmtPct(r.totalReturnPct)}${C.reset}    ` +
      `${C.bold}Win Rate:${C.reset} ${r.winRate.toFixed(1)}%    ` +
      `${C.bold}Trades:${C.reset}  ${r.totalTrades}`
    ));
    console.log(row(
      `${C.bold}Sharpe:${C.reset}   ${r.sharpeRatio.toFixed(2)}       ` +
      `${C.bold}P.Factor:${C.reset} ${r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)}    ` +
      `${C.bold}Max DD:${C.reset}  ${C.red}-${r.maxDrawdownPct.toFixed(1)}%${C.reset}`
    ));

    console.log(`├${hr}┤`);

    // Positions
    const posCount = r.positions.length;
    console.log(row(
      `${C.bold}OPEN POSITIONS${C.reset} (${posCount}/${this.config.maxPositions})` +
      `                    Exposure: ${r.exposurePct.toFixed(1)}%`
    ));
    if (posCount === 0) {
      console.log(row(`${C.dim}  No open positions${C.reset}`));
    } else {
      for (const p of r.positions.slice(0, 8)) {
        const q = p.question.length > 22 ? p.question.slice(0, 22) + '…' : p.question;
        const pColor = p.pnl >= 0 ? C.green : C.red;
        console.log(row(
          `  ${pad(q, 24)} ${pad(p.outcome, 4)} ` +
          `${p.entryPrice.toFixed(2)}→${p.currentPrice.toFixed(2)}  ` +
          `${pColor}${fmtPct(p.pnlPct)}${C.reset}  ` +
          `${pColor}${fmtUsd(p.pnl)}${C.reset}`
        ));
      }
      if (posCount > 8) console.log(row(`${C.dim}  ... and ${posCount - 8} more${C.reset}`));
    }

    console.log(`├${hr}┤`);

    // Top Traders
    console.log(row(`${C.bold}TOP TRADERS${C.reset}`));
    if (r.topTraders.length === 0) {
      console.log(row(`${C.dim}  No trader data yet${C.reset}`));
    } else {
      for (const t of r.topTraders.slice(0, 5)) {
        const alias = pad(t.alias, 14);
        console.log(row(
          `  ${alias} Score: ${C.bold}${t.compositeScore.toFixed(1).padStart(5)}${C.reset}  ` +
          `WR: ${(t.winRate * 100).toFixed(0)}%  ` +
          `ROI: ${t.roi >= 0 ? C.green : C.red}${fmtPct(t.roi * 100)}${C.reset}  ` +
          `Trades: ${t.totalTrades}`
        ));
      }
    }

    console.log(`├${hr}┤`);

    // Risk status
    console.log(row(
      `Risk: ${statusBadge}    ` +
      `Day P&L: ${dayColor}${fmtUsd(r.dayPnl)}${C.reset}    ` +
      `DD: ${r.currentDrawdownPct.toFixed(1)}%/${this.config.drawdownHaltPct}%`
    ));

    console.log(`└${hr}┘`);
    console.log('');
  }

  /** One-line trade execution log */
  printTrade(trade: Trade, action: string): void {
    const pColor = trade.pnl >= 0 ? C.green : C.red;
    const q = trade.question.length > 25 ? trade.question.slice(0, 25) + '…' : trade.question;
    console.log(
      `  ${C.bold}${action}${C.reset}  ${q}  [${trade.outcome}]  ` +
      `${trade.entryPrice.toFixed(2)}→${trade.exitPrice.toFixed(2)}  ` +
      `${pColor}${fmtUsd(trade.pnl)}${C.reset}  (${fmtDuration(trade.holdTimeMs)})`
    );
  }
}