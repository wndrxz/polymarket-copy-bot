// ════════════════════════════════════════════════════════════
//  CopyTradingBot — Core Orchestrator
//
//  Wires together every subsystem and runs the main loops:
//    • Signal polling  → Risk evaluation → Order execution
//    • Price updates   → SL/TP monitoring → Auto-exits
//    • Periodic reports, state persistence, graceful shutdown
// ════════════════════════════════════════════════════════════

import type {
  Config, Signal, Position, Trade, RiskVerdict,
  ISignalSource, PerformanceReport, BotState,
} from './core/types';
import { BotEmitter }           from './core/events';
import { PaperExchange }        from './exchange/paper';
import { MockSignalSource }     from './signals/mock';
import { PolymarketSignalSource } from './signals/polymarket';
import { RiskEngine }           from './risk/engine';
import { TraderTracker }        from './scoring/tracker';
import { StateStore }           from './persistence/store';
import { Reporter }             from './reporting/reporter';
import { log }                  from './utils/logger';
import { todayKey, fmtDuration } from './utils/helpers';

// ─── Timer handle wrapper for clean shutdown ─────────────

interface BotTimers {
  signal:    ReturnType<typeof setInterval> | null;
  price:     ReturnType<typeof setInterval> | null;
  monitor:   ReturnType<typeof setInterval> | null;
  report:    ReturnType<typeof setInterval> | null;
  persist:   ReturnType<typeof setInterval> | null;
}

export class CopyTradingBot {
  // ── Dependencies ────────────────────────────────────────
  private readonly config: Config;
  private readonly emitter: BotEmitter;
  private readonly exchange: PaperExchange;
  private readonly signalSource: ISignalSource;
  private readonly risk: RiskEngine;
  private readonly tracker: TraderTracker;
  private readonly store: StateStore;
  private readonly reporter: Reporter;

  // ── Internal state ──────────────────────────────────────
  private running = false;
  private lastTradeTime = 0;
  private signalsProcessed = 0;
  private signalsApproved = 0;
  private signalsRejected = 0;
  private marketPrices = new Map<string, Record<string, number>>();
  private timers: BotTimers = {
    signal: null, price: null, monitor: null, report: null, persist: null,
  };
  private startedAt = 0;

  // ── Alias lookup for mock traders ───────────────────────
  private static readonly TRADER_ALIASES: Record<string, string> = {
    trader_alpha:   'WhaleAlpha',
    trader_bravo:   'SmartMoney',
    trader_charlie: 'DegenDave',
    trader_delta:   'InsiderIan',
    trader_echo:    'RandomRob',
  };

  constructor(config: Config) {
    this.config   = config;
    this.emitter  = new BotEmitter();
    this.risk     = new RiskEngine();
    this.store    = new StateStore();
    this.reporter = new Reporter(config);

    // ── Restore state or start fresh ──────────────────────
    const saved = this.store.load();
    if (saved) {
      this.exchange = new PaperExchange(config, {
        balance:    saved.portfolio.balance,
        peakEquity: saved.portfolio.peakEquity,
        positions:  new Map(saved.portfolio.positions),
        orders:     saved.portfolio.orders,
        trades:     saved.portfolio.trades,
        dailyPnl:   new Map(saved.portfolio.dailyPnl),
      });
      this.tracker = new TraderTracker(new Map(saved.traders));
      this.marketPrices = new Map(saved.marketPrices);
      this.lastTradeTime = saved.portfolio.trades.length > 0
        ? saved.portfolio.trades[saved.portfolio.trades.length - 1].closedAt
        : 0;
    } else {
      this.exchange = new PaperExchange(config);
      this.tracker  = new TraderTracker();
    }

    // ── Signal source ─────────────────────────────────────
    if (config.mockSignals) {
      this.signalSource = new MockSignalSource();
    } else {
      this.signalSource = new PolymarketSignalSource(config);
    }

    // ── Wire event listeners ──────────────────────────────
    this.wireEvents();
  }

  // ════════════════════════════════════════════════════════
  //  Lifecycle
  // ════════════════════════════════════════════════════════

  async start(): Promise<void> {
    if (this.running) {
      log.warn('Bot', 'Already running');
      return;
    }

    this.running = true;
    this.startedAt = Date.now();

    this.printBanner();

    log.info('Bot', '🚀 Starting copy-trading bot…');
    log.info('Bot', `  Mode:       ${this.config.dryRun ? 'PAPER TRADING' : '⚠  LIVE TRADING'}`);
    log.info('Bot', `  Signals:    ${this.config.mockSignals ? 'Mock (simulated)' : 'Polymarket API'}`);
    log.info('Bot', `  Balance:    $${this.exchange.getBalance().toFixed(2)}`);
    log.info('Bot', `  Positions:  ${this.exchange.getPositions().length} open`);
    log.info('Bot', `  Trades:     ${this.exchange.getTrades().length} completed`);
    log.info('Bot', `  Traders:    ${this.tracker.getCount()} tracked`);
    log.divider();

    // ── Start all loops ───────────────────────────────────
    this.timers.signal = setInterval(
      () => this.signalLoop().catch(e => this.handleError(e as Error)),
      this.config.signalIntervalMs,
    );

    this.timers.price = setInterval(
      () => this.priceUpdateLoop(),
      this.config.priceUpdateIntervalMs,
    );

    this.timers.monitor = setInterval(
      () => this.monitorPositions(),
      this.config.riskCheckIntervalMs,
    );

    this.timers.report = setInterval(
      () => this.reportLoop(),
      this.config.reportIntervalMs,
    );

    this.timers.persist = setInterval(
      () => this.persistState(),
      this.config.persistIntervalMs,
    );

    // Run immediately once
    await this.signalLoop().catch(e => this.handleError(e as Error));
    this.priceUpdateLoop();

    this.emitter.emit('bot:started');
    log.info('Bot', '✓ All loops started');
    log.info('Bot', `  Signal poll:    every ${this.config.signalIntervalMs / 1000}s`);
    log.info('Bot', `  Price update:   every ${this.config.priceUpdateIntervalMs / 1000}s`);
    log.info('Bot', `  Position check: every ${this.config.riskCheckIntervalMs / 1000}s`);
    log.info('Bot', `  Report:         every ${this.config.reportIntervalMs / 1000}s`);
    log.info('Bot', `  State save:     every ${this.config.persistIntervalMs / 1000}s`);
    log.divider();
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    log.info('Bot', '🛑 Shutting down…');
    this.running = false;

    const timerKeys = Object.keys(this.timers) as (keyof BotTimers)[];
    for (const key of timerKeys) {
      const handle = this.timers[key];
      if (handle) {
        clearInterval(handle);
        this.timers[key] = null;
      }
    }

    // Final state save
    this.persistState();

    // Final report
    this.reportLoop();

    const uptime = Date.now() - this.startedAt;
    log.info('Bot', `Session duration: ${fmtDuration(uptime)}`);
    log.info('Bot', `Signals processed: ${this.signalsProcessed} (${this.signalsApproved} approved, ${this.signalsRejected} rejected)`);
    log.info('Bot', `Final equity: $${this.exchange.getEquity().toFixed(2)}`);

    this.emitter.emit('bot:stopped');
    log.info('Bot', '✓ Shutdown complete');
  }

  isRunning(): boolean {
    return this.running;
  }

  // ════════════════════════════════════════════════════════
  //  Main Loops
  // ════════════════════════════════════════════════════════

  // ─── 1. Signal Polling & Processing ─────────────────────

  private async signalLoop(): Promise<void> {
    if (!this.running) return;

    try {
      const signals = await this.signalSource.poll();
      if (signals.length === 0) return;

      for (const signal of signals) {
        await this.processSignal(signal);
      }
    } catch (err) {
      log.error('SignalLoop', `Poll failed: ${(err as Error).message}`);
    }
  }

  private async processSignal(signal: Signal): Promise<void> {
    this.signalsProcessed++;
    this.emitter.emit('signal:received', signal);

    // Register trader
    const alias = CopyTradingBot.TRADER_ALIASES[signal.traderId] ?? signal.traderId.slice(0, 12);
    this.tracker.registerTrader(signal.traderId, alias);

    log.info('Signal',
      `📡 ${alias} → ${signal.side} ${signal.outcome} on "${signal.question.slice(0, 35)}…"` +
      ` @ ${signal.price.toFixed(3)} × ${signal.size} (conf: ${signal.confidence})`
    );

    // ── Check if trading is halted ────────────────────────
    const portfolio = this.exchange.getPortfolio();
    if (this.risk.isHalted(portfolio, this.config)) {
      log.warn('Signal', '⚠ Trading halted by risk circuit breaker — skipping signal');
      this.signalsRejected++;
      return;
    }

    // ── Only process BUY signals for now ──────────────────
    if (signal.side !== 'BUY') {
      log.debug('Signal', 'Non-BUY signal skipped');
      return;
    }

    // ── Run through 10-layer risk engine ──────────────────
    const traderStats = this.tracker.getStats(signal.traderId);
    const verdict: RiskVerdict = this.risk.evaluate({
      signal,
      portfolio,
      config: this.config,
      traderStats,
      lastTradeTime: this.lastTradeTime,
      marketPrices: this.marketPrices,
    });

    if (!verdict.approved) {
      this.signalsRejected++;
      this.emitter.emit('risk:rejected', signal, verdict);
      const failedCheck = verdict.checks.find(c => !c.passed);
      log.info('Signal', `❌ Rejected — ${failedCheck?.name}: ${failedCheck?.reason}`);
      return;
    }

    this.signalsApproved++;
    this.emitter.emit('risk:approved', signal, verdict);

    // ── Execute the trade ─────────────────────────────────
    const order = this.exchange.buy(signal, verdict.adjustedSize, signal.price);

    if (order.status === 'FILLED') {
      this.lastTradeTime = Date.now();
      this.emitter.emit('order:filled', order);

      const cost = verdict.adjustedSize * signal.price;
      log.trade(
        `✅ BOUGHT ${verdict.adjustedSize} shares of "${signal.question.slice(0, 30)}…" ` +
        `[${signal.outcome}] @ ${signal.price.toFixed(3)} = $${cost.toFixed(2)}` +
        ` | Balance: $${this.exchange.getBalance().toFixed(2)}`
      );

      // Find the newly created position
      const positions = this.exchange.getPositions();
      const newPos = positions.find(p => p.signalId === signal.id);
      if (newPos) {
        this.emitter.emit('position:opened', newPos);
      }
    } else {
      this.emitter.emit('order:rejected', order);
      log.warn('Signal', `❌ Order rejected: ${order.reason}`);
    }
  }

  // ─── 2. Price Update Loop ──────────────────────────────

  private priceUpdateLoop(): void {
    if (!this.running) return;

    // Get latest prices from signal source
    this.marketPrices = this.signalSource.getMarketPrices();

    // Push price updates to all positions
    for (const [marketId, prices] of this.marketPrices) {
      for (const [outcome, price] of Object.entries(prices)) {
        this.exchange.updateMarketPrice(marketId, outcome, price);
      }
    }

    // Emit position updates
    for (const pos of this.exchange.getPositions()) {
      this.emitter.emit('position:updated', pos);
    }
  }

  // ─── 3. Position Monitor (SL/TP) ───────────────────────

  private monitorPositions(): void {
    if (!this.running) return;

    const positions = this.exchange.getPositions();

    for (const pos of positions) {
      // ── Stop-Loss Check ─────────────────────────────────
      if (pos.pnlPct <= -this.config.stopLossPct) {
        log.warn('Monitor',
          `🔴 STOP-LOSS triggered on "${pos.question.slice(0, 30)}…" ` +
          `[${pos.outcome}] — PnL: ${pos.pnlPct.toFixed(1)}%`
        );

        const trade = this.exchange.sell(pos.id, pos.currentPrice);
        if (trade) {
          this.tracker.recordTrade(trade);
          this.emitter.emit('position:stoploss', pos, trade);
          this.emitter.emit('position:closed', pos, trade);
          this.reporter.printTrade(trade, '🔴 SL');
          log.trade(
            `🔴 STOP-LOSS sold ${trade.size} shares ` +
            `@ ${trade.exitPrice.toFixed(3)} — PnL: $${trade.pnl.toFixed(2)} ` +
            `| Balance: $${this.exchange.getBalance().toFixed(2)}`
          );
        }
        continue;
      }

      // ── Take-Profit Check ──────────────────────────────
      if (pos.pnlPct >= this.config.takeProfitPct) {
        log.info('Monitor',
          `🟢 TAKE-PROFIT triggered on "${pos.question.slice(0, 30)}…" ` +
          `[${pos.outcome}] — PnL: +${pos.pnlPct.toFixed(1)}%`
        );

        const trade = this.exchange.sell(pos.id, pos.currentPrice);
        if (trade) {
          this.tracker.recordTrade(trade);
          this.emitter.emit('position:takeprofit', pos, trade);
          this.emitter.emit('position:closed', pos, trade);
          this.reporter.printTrade(trade, '🟢 TP');
          log.trade(
            `🟢 TAKE-PROFIT sold ${trade.size} shares ` +
            `@ ${trade.exitPrice.toFixed(3)} — PnL: +$${trade.pnl.toFixed(2)} ` +
            `| Balance: $${this.exchange.getBalance().toFixed(2)}`
          );
        }
        continue;
      }

      // ── Trailing stop (optional advanced feature) ──────
      // If position is up > 25%, set a trailing stop at 50% of gains
      if (pos.pnlPct > 25) {
        const trailingThreshold = pos.entryPrice * (1 + (pos.pnlPct * 0.5) / 100);
        if (pos.currentPrice < trailingThreshold) {
          log.info('Monitor',
            `🟡 TRAILING STOP on "${pos.question.slice(0, 30)}…" — ` +
            `price ${pos.currentPrice.toFixed(3)} < trail ${trailingThreshold.toFixed(3)}`
          );

          const trade = this.exchange.sell(pos.id, pos.currentPrice);
          if (trade) {
            this.tracker.recordTrade(trade);
            this.emitter.emit('position:closed', pos, trade);
            this.reporter.printTrade(trade, '🟡 TS');
          }
        }
      }
    }
  }

  // ─── 4. Report Generation ──────────────────────────────

  private reportLoop(): void {
    if (!this.running) return;

    const portfolio = this.exchange.getPortfolio();
    const topTraders = this.tracker.getTopTraders(5);
    const report = this.reporter.generateReport(portfolio, topTraders);
    this.reporter.printDashboard(report);
    this.emitter.emit('report:generated', report);
  }

  // ─── 5. State Persistence ──────────────────────────────

  private persistState(): void {
    const portfolio = this.exchange.getPortfolio();
    const traders = this.tracker.getAll();
    this.store.save(portfolio, traders, this.marketPrices);
    this.emitter.emit('state:saved');
  }

  // ════════════════════════════════════════════════════════
  //  Event Wiring
  // ════════════════════════════════════════════════════════

  private wireEvents(): void {
    this.emitter.on('error', (err) => {
      log.error('Event', `Unhandled event error: ${err.message}`);
    });

    this.emitter.on('position:stoploss', (_pos, trade) => {
      log.warn('Event', `Stop-loss exit: ${trade.question.slice(0, 30)}… PnL: $${trade.pnl.toFixed(2)}`);
    });

    this.emitter.on('position:takeprofit', (_pos, trade) => {
      log.info('Event', `Take-profit exit: ${trade.question.slice(0, 30)}… PnL: +$${trade.pnl.toFixed(2)}`);
    });

    this.emitter.on('report:generated', (report) => {
      log.debug('Event', `Report generated — equity: $${report.equity.toFixed(2)}, positions: ${report.openPositions}`);
    });
  }

  // ════════════════════════════════════════════════════════
  //  Error Handling
  // ════════════════════════════════════════════════════════

  private handleError(err: Error): void {
    log.error('Bot', `Unhandled error: ${err.message}`);
    log.error('Bot', err.stack ?? '');
    this.emitter.emit('error', err);
  }

  // ════════════════════════════════════════════════════════
  //  Banner
  // ════════════════════════════════════════════════════════

  private printBanner(): void {
    const C = {
      cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m',
      green: '\x1b[32m', yellow: '\x1b[33m',
    };

    console.log('');
    console.log(`${C.cyan}${C.bold}`);
    console.log(`  ╔══════════════════════════════════════════════════════════╗`);
    console.log(`  ║                                                        ║`);
    console.log(`  ║   ██████╗  ██████╗ ██╗  ██╗   ██╗    ██████╗  ██████╗  ║`);
    console.log(`  ║   ██╔══██╗██╔═══██╗██║  ╚██╗ ██╔╝    ██╔══██╗██╔═══██╗ ║`);
    console.log(`  ║   ██████╔╝██║   ██║██║   ╚████╔╝     ██████╔╝██║   ██║ ║`);
    console.log(`  ║   ██╔═══╝ ██║   ██║██║    ╚██╔╝      ██╔══██╗██║   ██║ ║`);
    console.log(`  ║   ██║     ╚██████╔╝███████╗██║       ██████╔╝╚██████╔╝ ║`);
    console.log(`  ║   ╚═╝      ╚═════╝ ╚══════╝╚═╝       ╚═════╝  ╚═════╝ ║`);
    console.log(`  ║                                                        ║`);
    console.log(`  ║   ${C.reset}${C.dim}Polymarket Copy-Trading Bot v1.0.0${C.reset}${C.cyan}${C.bold}                 ║`);
    console.log(`  ║   ${C.reset}${C.dim}github.com/you/polymarket-copy-bot${C.reset}${C.cyan}${C.bold}                ║`);
    console.log(`  ║                                                        ║`);
    console.log(`  ╚══════════════════════════════════════════════════════════╝`);
    console.log(`${C.reset}`);
  }

  // ════════════════════════════════════════════════════════
  //  Public API (for tests & external integrations)
  // ════════════════════════════════════════════════════════

  getEmitter(): BotEmitter            { return this.emitter; }
  getExchange(): PaperExchange        { return this.exchange; }
  getRiskEngine(): RiskEngine         { return this.risk; }
  getTracker(): TraderTracker         { return this.tracker; }
  getReporter(): Reporter             { return this.reporter; }
  getStore(): StateStore              { return this.store; }
  getMarketPrices(): Map<string, Record<string, number>> { return this.marketPrices; }
  getStats() {
    return {
      signalsProcessed: this.signalsProcessed,
      signalsApproved:  this.signalsApproved,
      signalsRejected:  this.signalsRejected,
      uptime:           Date.now() - this.startedAt,
    };
  }

  /** Manual signal injection (useful for testing) */
  async injectSignal(signal: Signal): Promise<void> {
    await this.processSignal(signal);
  }

  /** Force an immediate report */
  forceReport(): PerformanceReport {
    const portfolio = this.exchange.getPortfolio();
    const topTraders = this.tracker.getTopTraders(5);
    const report = this.reporter.generateReport(portfolio, topTraders);
    this.reporter.printDashboard(report);
    return report;
  }

  /** Force a state save */
  forceSave(): void {
    this.persistState();
  }
}