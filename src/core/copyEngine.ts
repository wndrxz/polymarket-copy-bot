import { CONFIG } from "../config";
import { TradeSignal, ClosedTrade, IExchange } from "../types";
import { log } from "../utils/logger";
import { MockExchange } from "../paper/mockExchange";
import { RiskManager } from "../risk/riskManager";
import { StopLossMonitor } from "../risk/stopLossMonitor";
import { DataFetcher } from "./dataFetcher";
import { TraderManager } from "../traders/traderManager";
import { Reporter } from "../paper/reporter";
import * as fs from "fs";

export class CopyEngine {
  private exchange: IExchange;
  private risk: RiskManager;
  private stopLoss: StopLossMonitor;
  private data: DataFetcher;
  private traders: TraderManager;
  private reporter: Reporter;

  private running = false;
  private processedSignals: Set<string> = new Set();
  private signalLoopTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastActivityTimestamps: Map<string, number> = new Map();

  constructor() {
    this.exchange = new MockExchange();
    this.risk = new RiskManager();
    this.stopLoss = new StopLossMonitor();
    this.data = new DataFetcher();
    this.traders = new TraderManager();
    this.reporter = new Reporter();
  }

  async start(): Promise<void> {
    this.running = true;
    this.printBanner();

    this.stopLoss.start(this.exchange, (trade: ClosedTrade) => {
      this.traders.recordTrade(trade);
      log.info(
        `Auto-closed by ${trade.reason}: "${trade.outcome}" PnL ${fmtPnL(trade.realizedPnL)}`,
      );
    });

    this.reporter.start(this.exchange, this.traders);

    if (CONFIG.MOCK_SIGNALS) {
      log.info("Mock signal mode - generating simulated trades");
      this.startMockSignalLoop();
    } else {
      log.info("Live polling mode - watching target wallets via Data API");
      this.startPollingLoop();
    }

    log.info("Copy engine started. Waiting for signals...\n");
  }

  async stop(): Promise<void> {
    log.info("\nShutting down copy engine...");
    this.running = false;

    if (this.signalLoopTimer) clearInterval(this.signalLoopTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);

    this.stopLoss.stop();
    this.reporter.stop();

    log.info("Generating final report...");
    this.reporter.print(this.exchange, this.traders);

    this.saveState();

    log.info("Bot stopped cleanly.");
  }

  private startMockSignalLoop(): void {
    this.signalLoopTimer = setInterval(async () => {
      if (!this.running) return;

      try {
        const signal = this.data.generateMockSignal();

        if (signal.side === "SELL") {
          const posId = `${signal.conditionId}-${signal.tokenId}`;
          const pos = this.exchange.getPosition(posId);
          if (!pos) {
            log.debug(`Mock SELL skipped - no position for ${signal.outcome}`);
            return;
          }
          signal.price = pos.currentPrice;
          signal.size = pos.shares;
          signal.usdcAmount = signal.price * signal.size;
        }

        await this.processSignal(signal);
      } catch (err) {
        log.error("Mock signal loop error:", (err as Error).message);
      }
    }, CONFIG.MOCK_SIGNAL_INTERVAL_MS);
  }

  private startPollingLoop(): void {
    for (const w of this.traders.getEnabledWallets()) {
      this.lastActivityTimestamps.set(w.address, Date.now());
    }

    this.pollTimer = setInterval(async () => {
      if (!this.running) return;

      for (const wallet of this.traders.getEnabledWallets()) {
        try {
          const activities = await this.data.fetchTraderActivity(
            wallet.address,
            10,
          );

          for (const act of activities) {
            const actTs = new Date(
              act.timestamp ?? act.createdAt ?? 0,
            ).getTime();
            const lastSeen =
              this.lastActivityTimestamps.get(wallet.address) ?? 0;

            if (actTs <= lastSeen) continue;

            const signal = this.activityToSignal(
              act,
              wallet.address,
              wallet.label,
            );
            if (signal) {
              await this.processSignal(signal);
            }

            this.lastActivityTimestamps.set(
              wallet.address,
              Math.max(lastSeen, actTs),
            );
          }
        } catch (err) {
          log.debug(
            `Poll error for ${wallet.label}: ${(err as Error).message}`,
          );
        }
      }
    }, CONFIG.POLL_INTERVAL_MS);
  }

  private async processSignal(signal: TradeSignal): Promise<void> {
    if (this.processedSignals.has(signal.id)) return;
    this.processedSignals.add(signal.id);
    this.cleanupProcessedSignals();

    log.info(
      `Signal: ${signal.traderLabel} ${signal.side} ${signal.size} x ` +
        `"${signal.outcome}" @ $${signal.price.toFixed(3)} | ${signal.question.slice(0, 40)}...`,
    );

    if (!this.traders.isTraderQualified(signal.traderAddress)) {
      log.risk(
        `Trader ${signal.traderLabel} disqualified (low win rate / ROI). Skipping.`,
      );
      return;
    }

    if (signal.side === "BUY") {
      await this.handleBuy(signal);
    } else {
      await this.handleSell(signal);
    }
  }

  private async handleBuy(signal: TradeSignal): Promise<void> {
    const market = await this.data.getMarketInfo(signal.conditionId);
    const weight = this.traders.getTraderWeight(signal.traderAddress);

    const check = this.risk.evaluate(signal, this.exchange, market, weight);

    if (!check.passed) {
      log.info(`Trade blocked: ${check.reason}`);
      return;
    }

    const shares = check.adjustedSize!;
    const cost = shares * signal.price;

    log.info(
      `Risk approved: ${shares.toFixed(1)} shares ($${cost.toFixed(2)}) ` +
        `[original: ${signal.size} shares ($${signal.usdcAmount.toFixed(2)})]`,
    );

    const result = await this.exchange.createOrder({
      tokenId: signal.tokenId,
      conditionId: signal.conditionId,
      side: "BUY",
      price: signal.price,
      size: shares,
      outcome: signal.outcome,
      question: signal.question,
      copiedFrom: signal.traderAddress,
    });

    if (result.success) {
      log.info(
        `Order filled: ${result.fillSize.toFixed(1)} shares @ $${result.fillPrice.toFixed(3)} | ` +
          `Cost: $${result.costOrRevenue.toFixed(2)} | ` +
          `${CONFIG.DRY_RUN ? "PAPER" : "LIVE"}`,
      );
    } else {
      log.error(`Order failed: ${result.error}`);
    }
  }

  private async handleSell(signal: TradeSignal): Promise<void> {
    const posId = `${signal.conditionId}-${signal.tokenId}`;
    const pos = this.exchange.getPosition(posId);

    if (!pos) {
      log.debug(`No position to sell for ${signal.outcome} - skipping`);
      return;
    }

    log.info(
      `Closing position: "${pos.outcome}" | ` +
        `${pos.shares.toFixed(1)} shares @ entry $${pos.avgEntryPrice.toFixed(3)} -> exit $${signal.price.toFixed(3)}`,
    );

    const closed = this.exchange.closePosition(
      posId,
      signal.price,
      "copy_sell",
    );

    if (closed) {
      this.traders.recordTrade(closed);
      log.info(
        `Position closed: PnL ${fmtPnL(closed.realizedPnL)} ` +
          `(${(closed.realizedPnLPercent * 100).toFixed(1)}%) | ${CONFIG.DRY_RUN ? "PAPER" : "LIVE"}`,
      );
    }
  }

  private activityToSignal(
    activity: any,
    traderAddr: string,
    traderLabel: string,
  ): TradeSignal | null {
    try {
      const side = (activity.side ?? activity.type ?? "").toUpperCase();
      if (side !== "BUY" && side !== "SELL") return null;

      const price = Number(activity.price ?? 0);
      const size = Number(activity.size ?? activity.amount ?? 0);
      if (!price || !size) return null;

      return {
        id:
          activity.id ??
          `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        traderAddress: traderAddr,
        traderLabel: traderLabel,
        conditionId: activity.conditionId ?? activity.market ?? "",
        tokenId: activity.tokenId ?? activity.asset ?? "",
        side: side as "BUY" | "SELL",
        price,
        size,
        usdcAmount: price * size,
        outcome: activity.outcome ?? activity.title ?? "Unknown",
        question: activity.question ?? activity.market_slug ?? "",
        timestamp: new Date(activity.timestamp ?? activity.createdAt).getTime(),
      };
    } catch (err) {
      log.debug(`Failed to parse activity: ${(err as Error).message}`);
      return null;
    }
  }

  private cleanupProcessedSignals(): void {
    if (this.processedSignals.size > 5000) {
      const arr = Array.from(this.processedSignals);
      this.processedSignals = new Set(arr.slice(arr.length - 1000));
      log.debug("Cleaned up processed signals set");
    }
  }

  private saveState(): void {
    try {
      if (!fs.existsSync("data")) fs.mkdirSync("data");
      fs.writeFileSync(
        "data/final-state.json",
        JSON.stringify(
          {
            savedAt: new Date().toISOString(),
            balance: this.exchange.getBalance(),
            positions: this.exchange.getPositions(),
            closedTrades: this.exchange.getClosedTrades(),
            traderStats: this.traders.getAllStats(),
            totalSignalsProcessed: this.processedSignals.size,
          },
          null,
          2,
        ),
      );
      log.info("State saved to data/final-state.json");
    } catch (err) {
      log.error("Failed to save state:", (err as Error).message);
    }
  }

  private printBanner(): void {
    const lines = [
      "",
      "========================================================",
      "       POLYMARKET COPY-TRADING BOT                      ",
      "========================================================",
      `  Mode:          ${CONFIG.DRY_RUN ? "PAPER TRADING" : "LIVE TRADING"}`,
      `  Signals:       ${CONFIG.MOCK_SIGNALS ? "Mock (simulated)" : "Live (Data API)"}`,
      `  Balance:       $${CONFIG.PAPER.STARTING_BALANCE.toFixed(2)}`,
      `  Traders:       ${CONFIG.TARGET_WALLETS.filter((w) => w.enabled).length} wallets tracked`,
      `  Max Exposure:  ${(CONFIG.RISK.MAX_EXPOSURE_PERCENT * 100).toFixed(0)}% of equity`,
      `  Stop-Loss:     ${(CONFIG.RISK.STOP_LOSS_PERCENT * 100).toFixed(0)}%`,
      `  Take-Profit:   +${(CONFIG.RISK.TAKE_PROFIT_PERCENT * 100).toFixed(0)}%`,
      "========================================================",
      "",
    ];
    for (const l of lines) log.report(l);
  }
}

function fmtPnL(v: number): string {
  return `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`;
}
