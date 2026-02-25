import { CONFIG } from "../config";
import { TradeSignal, IExchange, MarketInfo, RiskCheckResult } from "../types";
import { log } from "../utils/logger";

export class RiskManager {
  private lastTradeTs = 0;
  private marketCooldowns: Map<string, number> = new Map();

  evaluate(
    signal: TradeSignal,
    exchange: IExchange,
    market: MarketInfo | null,
    traderWeight: number,
  ): RiskCheckResult {
    if (signal.side === "SELL") {
      return { passed: true, reason: "SELL pass-through" };
    }

    const checks: (() => RiskCheckResult)[] = [
      () => this.checkDailyLoss(exchange),
      () => this.checkCooldown(signal),
      () => this.checkPriceSanity(signal),
      () => this.checkVolume(market),
      () => this.checkMaxPositions(exchange),
      () => this.checkExposure(exchange),
      () => this.checkPerMarket(signal, exchange),
    ];

    for (const check of checks) {
      const r = check();
      if (!r.passed) {
        log.risk(`BLOCKED: ${r.reason}`);
        return r;
      }
    }

    const shares = this.calcSize(signal, exchange, traderWeight);
    const cost = shares * signal.price;

    if (cost < CONFIG.RISK.MIN_POSITION_USDC) {
      return {
        passed: false,
        reason: `Position too small: $${cost.toFixed(2)} < min $${CONFIG.RISK.MIN_POSITION_USDC}`,
      };
    }

    this.lastTradeTs = Date.now();
    this.marketCooldowns.set(signal.conditionId, Date.now());

    log.risk(
      `APPROVED: ${shares.toFixed(1)} shares ($${cost.toFixed(2)}) | ` +
        `weight=${traderWeight} ratio=${CONFIG.RISK.BALANCE_RATIO}`,
    );

    return { passed: true, reason: "All checks passed", adjustedSize: shares };
  }

  private checkDailyLoss(ex: IExchange): RiskCheckResult {
    const daily = ex.getDailyPnL();
    if (daily < -CONFIG.RISK.MAX_DAILY_LOSS_USDC) {
      return {
        passed: false,
        reason: `Daily loss limit: $${daily.toFixed(2)} < -$${CONFIG.RISK.MAX_DAILY_LOSS_USDC}`,
      };
    }
    return ok();
  }

  private checkCooldown(s: TradeSignal): RiskCheckResult {
    const now = Date.now();
    const sinceLast = now - this.lastTradeTs;
    if (sinceLast < CONFIG.RISK.TRADE_COOLDOWN_MS) {
      return {
        passed: false,
        reason: `Trade cooldown: ${((CONFIG.RISK.TRADE_COOLDOWN_MS - sinceLast) / 1000).toFixed(1)}s left`,
      };
    }
    const sinceMarket = now - (this.marketCooldowns.get(s.conditionId) ?? 0);
    if (sinceMarket < CONFIG.RISK.SAME_MARKET_COOLDOWN_MS) {
      return {
        passed: false,
        reason: `Same-market cooldown: ${s.conditionId.slice(0, 12)}...`,
      };
    }
    return ok();
  }

  private checkPriceSanity(s: TradeSignal): RiskCheckResult {
    if (s.price > CONFIG.RISK.MAX_PRICE)
      return {
        passed: false,
        reason: `Price $${s.price} > max $${CONFIG.RISK.MAX_PRICE} (no upside)`,
      };
    if (s.price < CONFIG.RISK.MIN_PRICE)
      return {
        passed: false,
        reason: `Price $${s.price} < min $${CONFIG.RISK.MIN_PRICE} (too risky)`,
      };
    return ok();
  }

  private checkVolume(m: MarketInfo | null): RiskCheckResult {
    if (!m) return ok();
    if (m.volume24h < CONFIG.RISK.MIN_MARKET_VOLUME_24H)
      return {
        passed: false,
        reason: `Low volume: $${m.volume24h} < $${CONFIG.RISK.MIN_MARKET_VOLUME_24H}`,
      };
    if (m.liquidity < CONFIG.RISK.MIN_MARKET_LIQUIDITY)
      return {
        passed: false,
        reason: `Low liquidity: $${m.liquidity} < $${CONFIG.RISK.MIN_MARKET_LIQUIDITY}`,
      };
    return ok();
  }

  private checkMaxPositions(ex: IExchange): RiskCheckResult {
    const count = ex.getPositions().length;
    if (count >= CONFIG.RISK.MAX_POSITIONS)
      return {
        passed: false,
        reason: `Max positions: ${count} >= ${CONFIG.RISK.MAX_POSITIONS}`,
      };
    return ok();
  }

  private checkExposure(ex: IExchange): RiskCheckResult {
    const equity = ex.getBalance() + ex.getTotalExposure();
    const maxExp = equity * CONFIG.RISK.MAX_EXPOSURE_PERCENT;
    if (ex.getTotalExposure() >= maxExp)
      return {
        passed: false,
        reason: `Max exposure: $${ex.getTotalExposure().toFixed(2)} >= $${maxExp.toFixed(2)} (${(CONFIG.RISK.MAX_EXPOSURE_PERCENT * 100).toFixed(0)}%)`,
      };
    return ok();
  }

  private checkPerMarket(s: TradeSignal, ex: IExchange): RiskCheckResult {
    const equity = ex.getBalance() + ex.getTotalExposure();
    const maxPerMkt = equity * CONFIG.RISK.MAX_PER_MARKET_PERCENT;
    const mktExposure = ex
      .getPositions()
      .filter((p) => p.conditionId === s.conditionId)
      .reduce((sum, p) => sum + p.costBasis, 0);

    if (mktExposure >= maxPerMkt)
      return {
        passed: false,
        reason: `Per-market limit: $${mktExposure.toFixed(2)} >= $${maxPerMkt.toFixed(2)}`,
      };
    return ok();
  }

  private calcSize(
    signal: TradeSignal,
    ex: IExchange,
    traderWeight: number,
  ): number {
    const ratio = CONFIG.RISK.BALANCE_RATIO;
    const balance = ex.getBalance();
    const exposure = ex.getTotalExposure();
    const equity = balance + exposure;
    const availableExp = equity * CONFIG.RISK.MAX_EXPOSURE_PERCENT - exposure;
    const maxPerMkt = equity * CONFIG.RISK.MAX_PER_MARKET_PERCENT;

    let usdc = signal.usdcAmount * ratio * traderWeight;

    usdc = Math.min(usdc, CONFIG.RISK.MAX_POSITION_USDC);
    usdc = Math.min(usdc, availableExp);
    usdc = Math.min(usdc, maxPerMkt);
    usdc = Math.min(usdc, balance * 0.95);
    usdc = Math.max(usdc, 0);

    return signal.price > 0 ? usdc / signal.price : 0;
  }
}

function ok(): RiskCheckResult {
  return { passed: true, reason: "" };
}
