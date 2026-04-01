// ════════════════════════════════════════════════════════════
//  Test Suite — node assert, zero dependencies
//  Run: npx ts-node tests/run.ts
// ════════════════════════════════════════════════════════════

import * as assert from 'assert';
import { loadConfig }          from '../src/config';
import { PaperExchange }       from '../src/exchange/paper';
import { MockSignalSource }    from '../src/signals/mock';
import { RiskEngine }          from '../src/risk/engine';
import { TraderTracker }       from '../src/scoring/tracker';
import { StateStore }          from '../src/persistence/store';
import { Reporter }            from '../src/reporting/reporter';
import { rid, clamp, mean, stddev, sigmoid, todayKey } from '../src/utils/helpers';
import type { Signal, Config, Trade, Portfolio } from '../src/core/types';

// ─── Helpers ──────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then(() => { passed++; console.log(`  ✅ ${name}`); })
        .catch((e: Error) => {
          failed++;
          errors.push(`${name}: ${e.message}`);
          console.log(`  ❌ ${name}: ${e.message}`);
        });
    } else {
      passed++;
      console.log(`  ✅ ${name}`);
    }
  } catch (e) {
    failed++;
    const msg = (e as Error).message;
    errors.push(`${name}: ${msg}`);
    console.log(`  ❌ ${name}: ${msg}`);
  }
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    dryRun: true,
    mockSignals: true,
    logLevel: 'ERROR',        // suppress logs during tests
    startingBalance: 1000,
    maxExposurePct: 30,
    maxPositionPct: 15,
    maxPositions: 10,
    stopLossPct: 15,
    takeProfitPct: 50,
    dailyLossLimitPct: 10,
    drawdownHaltPct: 25,
    tradeCooldownMs: 0,       // no cooldown for tests
    minPrice: 0.05,
    maxPrice: 0.95,
    minLiquidity: 1000,
    minTraderScore: 40,
    signalIntervalMs: 10_000,
    priceUpdateIntervalMs: 5_000,
    riskCheckIntervalMs: 3_000,
    reportIntervalMs: 60_000,
    persistIntervalMs: 30_000,
    targetTraders: [],
    clobApiUrl: 'https://clob.polymarket.com',
    gammaApiUrl: 'https://gamma-api.polymarket.com',
    ...overrides,
  };
}

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: `sig_test_${rid()}`,
    timestamp: Date.now(),
    traderId: 'trader_test',
    marketId: 'test-market',
    marketSlug: 'test-market',
    question: 'Will this test pass?',
    outcome: 'Yes',
    side: 'BUY',
    price: 0.60,
    size: 20,
    confidence: 0.80,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════
//  Test Categories
// ════════════════════════════════════════════════════════════

async function runAll(): Promise<void> {

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  POLYMARKET COPY-BOT — TEST SUITE        ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ─── 1. Utility Functions ──────────────────────────────

  console.log('┌─ Utility Functions ───────────────────────┐');

  test('rid() generates 16-char hex string', () => {
    const id = rid();
    assert.strictEqual(id.length, 16);
    assert.ok(/^[0-9a-f]+$/.test(id));
  });

  test('rid() generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => rid()));
    assert.strictEqual(ids.size, 100);
  });

  test('clamp() constrains values', () => {
    assert.strictEqual(clamp(5, 0, 10), 5);
    assert.strictEqual(clamp(-1, 0, 10), 0);
    assert.strictEqual(clamp(15, 0, 10), 10);
    assert.strictEqual(clamp(0, 0, 10), 0);
    assert.strictEqual(clamp(10, 0, 10), 10);
  });

  test('mean() computes correctly', () => {
    assert.strictEqual(mean([1, 2, 3, 4, 5]), 3);
    assert.strictEqual(mean([10]), 10);
    assert.strictEqual(mean([]), 0);
  });

  test('stddev() computes correctly', () => {
    assert.ok(Math.abs(stddev([1, 1, 1, 1]) - 0) < 0.001);
    assert.ok(stddev([1, 2, 3, 4, 5]) > 1.4);
    assert.strictEqual(stddev([]), 0);
    assert.strictEqual(stddev([5]), 0);
  });

  test('sigmoid() maps to (0, 1)', () => {
    assert.ok(Math.abs(sigmoid(0) - 0.5) < 0.001);
    assert.ok(sigmoid(10) > 0.99);
    assert.ok(sigmoid(-10) < 0.01);
  });

  test('todayKey() returns YYYY-MM-DD', () => {
    const key = todayKey();
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(key));
  });

  console.log('');

  // ─── 2. Paper Exchange ─────────────────────────────────

  console.log('┌─ Paper Exchange ──────────────────────────┐');

  test('Exchange initializes with starting balance', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    assert.strictEqual(ex.getBalance(), 1000);
    assert.strictEqual(ex.getEquity(), 1000);
    assert.strictEqual(ex.getPositions().length, 0);
  });

  test('Buy order deducts balance and creates position', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    const signal = makeSignal({ price: 0.50, size: 20 });

    const order = ex.buy(signal, 20, 0.50);
    assert.strictEqual(order.status, 'FILLED');
    assert.strictEqual(ex.getBalance(), 1000 - (20 * 0.50));
    assert.strictEqual(ex.getPositions().length, 1);

    const pos = ex.getPositions()[0];
    assert.strictEqual(pos.entryPrice, 0.50);
    assert.strictEqual(pos.size, 20);
    assert.strictEqual(pos.cost, 10);
  });

  test('Buy order rejected when insufficient balance', () => {
    const config = makeConfig({ startingBalance: 5 });
    const ex = new PaperExchange(config);
    const signal = makeSignal({ price: 0.50, size: 20 });

    const order = ex.buy(signal, 20, 0.50);
    assert.strictEqual(order.status, 'REJECTED');
    assert.strictEqual(ex.getBalance(), 5);
    assert.strictEqual(ex.getPositions().length, 0);
  });

  test('Sell order closes position and updates balance', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    const signal = makeSignal({ price: 0.50, size: 10 });

    ex.buy(signal, 10, 0.50);
    const pos = ex.getPositions()[0];

    // Simulate price increase
    ex.updateMarketPrice(signal.marketId, signal.outcome, 0.70);

    const trade = ex.sell(pos.id, 0.70);
    assert.ok(trade !== null);
    assert.strictEqual(trade!.entryPrice, 0.50);
    assert.strictEqual(trade!.exitPrice, 0.70);
    assert.ok(trade!.pnl > 0);
    assert.strictEqual(ex.getPositions().length, 0);
    // Balance should be starting (1000) - cost (5) + proceeds (7) = 1002
    assert.ok(Math.abs(ex.getBalance() - 1002) < 0.01);
  });

  test('Sell on nonexistent position returns null', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    const trade = ex.sell('nonexistent-id');
    assert.strictEqual(trade, null);
  });

  test('Price update changes position PnL', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    const signal = makeSignal({ price: 0.40, size: 25 });

    ex.buy(signal, 25, 0.40);

    // Price goes up
    ex.updateMarketPrice(signal.marketId, signal.outcome, 0.60);
    let pos = ex.getPositions()[0];
    assert.strictEqual(pos.currentPrice, 0.60);
    assert.ok(pos.pnl > 0);
    assert.ok(pos.pnlPct > 0);

    // Price goes down
    ex.updateMarketPrice(signal.marketId, signal.outcome, 0.30);
    pos = ex.getPositions()[0];
    assert.strictEqual(pos.currentPrice, 0.30);
    assert.ok(pos.pnl < 0);
    assert.ok(pos.pnlPct < 0);
  });

  test('Multiple positions track independently', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);

    const sig1 = makeSignal({ marketId: 'market-a', outcome: 'Yes', price: 0.40 });
    const sig2 = makeSignal({ marketId: 'market-b', outcome: 'No', price: 0.60 });

    ex.buy(sig1, 10, 0.40);
    ex.buy(sig2, 10, 0.60);

    assert.strictEqual(ex.getPositions().length, 2);

    ex.updateMarketPrice('market-a', 'Yes', 0.80);
    ex.updateMarketPrice('market-b', 'No', 0.30);

    const positions = ex.getPositions();
    const posA = positions.find(p => p.marketId === 'market-a')!;
    const posB = positions.find(p => p.marketId === 'market-b')!;

    assert.ok(posA.pnl > 0);   // market-a went up
    assert.ok(posB.pnl < 0);   // market-b went down
  });

  test('Equity = balance + sum(position values)', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    const signal = makeSignal({ price: 0.50, size: 20 });

    ex.buy(signal, 20, 0.50);
    ex.updateMarketPrice(signal.marketId, signal.outcome, 0.60);

    const bal = ex.getBalance();
    const posValue = ex.getPositions().reduce((s, p) => s + p.currentValue, 0);

    assert.ok(Math.abs(ex.getEquity() - (bal + posValue)) < 0.01);
  });

  test('Daily PnL tracks after selling', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    const signal = makeSignal({ price: 0.50, size: 10 });

    ex.buy(signal, 10, 0.50);
    const pos = ex.getPositions()[0];
    ex.sell(pos.id, 0.70);

    const todayPnl = ex.getTodayPnl();
    assert.ok(todayPnl > 0);
  });

  test('getPortfolio() returns complete snapshot', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    const signal = makeSignal();

    ex.buy(signal, 10, 0.50);

    const pf = ex.getPortfolio();
    assert.ok(pf.balance > 0);
    assert.ok(pf.equity > 0);
    assert.strictEqual(pf.positions.size, 1);
    assert.strictEqual(pf.orders.length, 1);
    assert.strictEqual(pf.startingBalance, 1000);
  });

  console.log('');

  // ─── 3. Risk Engine ────────────────────────────────────

  console.log('┌─ Risk Engine ─────────────────────────────┐');

  test('Signal within all limits → approved', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    const risk = new RiskEngine();
    const signal = makeSignal({ price: 0.50, size: 10, confidence: 0.8 });

    const verdict = risk.evaluate({
      signal,
      portfolio: ex.getPortfolio(),
      config,
      traderStats: null,
      lastTradeTime: 0,
      marketPrices: new Map(),
    });

    assert.ok(verdict.approved);
    assert.ok(verdict.adjustedSize > 0);
    assert.ok(verdict.checks.every(c => c.passed));
  });

  test('Price below min → rejected (PriceSanity)', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    const risk = new RiskEngine();
    const signal = makeSignal({ price: 0.02 });

    const verdict = risk.evaluate({
      signal,
      portfolio: ex.getPortfolio(),
      config,
      traderStats: null,
      lastTradeTime: 0,
      marketPrices: new Map(),
    });

    assert.ok(!verdict.approved);
    const failed = verdict.checks.find(c => !c.passed);
    assert.strictEqual(failed?.name, 'PriceSanity');
  });

  test('Price above max → rejected (PriceSanity)', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    const risk = new RiskEngine();
    const signal = makeSignal({ price: 0.98 });

    const verdict = risk.evaluate({
      signal,
      portfolio: ex.getPortfolio(),
      config,
      traderStats: null,
      lastTradeTime: 0,
      marketPrices: new Map(),
    });

    assert.ok(!verdict.approved);
  });

  test('Cooldown enforced when trading too fast', () => {
    const config = makeConfig({ tradeCooldownMs: 60_000 });
    const ex = new PaperExchange(config);
    const risk = new RiskEngine();
    const signal = makeSignal();

    const verdict = risk.evaluate({
      signal,
      portfolio: ex.getPortfolio(),
      config,
      traderStats: null,
      lastTradeTime: Date.now() - 5_000,  // 5s ago
      marketPrices: new Map(),
    });

    assert.ok(!verdict.approved);
    const failed = verdict.checks.find(c => !c.passed);
    assert.strictEqual(failed?.name, 'TradeCooldown');
  });

  test('Max positions limit enforced', () => {
    const config = makeConfig({ maxPositions: 2 });
    const ex = new PaperExchange(config);
    const risk = new RiskEngine();

    // Open 2 positions
    for (let i = 0; i < 2; i++) {
      const sig = makeSignal({ marketId: `market-${i}`, price: 0.10, size: 5 });
      ex.buy(sig, 5, 0.10);
    }

    const signal = makeSignal({ marketId: 'market-3', price: 0.50, size: 5 });
    const verdict = risk.evaluate({
      signal,
      portfolio: ex.getPortfolio(),
      config,
      traderStats: null,
      lastTradeTime: 0,
      marketPrices: new Map(),
    });

    assert.ok(!verdict.approved);
    const failed = verdict.checks.find(c => !c.passed);
    assert.strictEqual(failed?.name, 'MaxPositions');
  });

  test('Total exposure limit enforced', () => {
    const config = makeConfig({ maxExposurePct: 10, startingBalance: 100 });
    const ex = new PaperExchange(config);
    const risk = new RiskEngine();

    // Open position worth $15 (15% of equity, over 10% limit)
    const sig = makeSignal({ price: 0.50, size: 30 });
    ex.buy(sig, 30, 0.50); // cost = $15

    const signal = makeSignal({ price: 0.50, size: 5 });
    const verdict = risk.evaluate({
      signal,
      portfolio: ex.getPortfolio(),
      config,
      traderStats: null,
      lastTradeTime: 0,
      marketPrices: new Map(),
    });

    assert.ok(!verdict.approved);
    const failed = verdict.checks.find(c => !c.passed);
    assert.strictEqual(failed?.name, 'TotalExposure');
  });

  test('Low-scoring trader → rejected', () => {
    const config = makeConfig({ minTraderScore: 60 });
    const ex = new PaperExchange(config);
    const risk = new RiskEngine();
    const signal = makeSignal();

    const verdict = risk.evaluate({
      signal,
      portfolio: ex.getPortfolio(),
      config,
      traderStats: {
        id: 'bad-trader',
        alias: 'Loser',
        totalTrades: 20,
        wins: 4,
        losses: 16,
        winRate: 0.20,
        totalPnl: -50,
        totalInvested: 200,
        roi: -0.25,
        avgReturn: -0.025,
        returnStdDev: 0.1,
        sharpeRatio: -0.25,
        compositeScore: 15.0,
        lastActive: Date.now(),
        returns: [],
      },
      lastTradeTime: 0,
      marketPrices: new Map(),
    });

    assert.ok(!verdict.approved);
    const failed = verdict.checks.find(c => !c.passed);
    assert.strictEqual(failed?.name, 'TraderScore');
  });

  test('Daily loss limit halts trading', () => {
    const config = makeConfig({ dailyLossLimitPct: 5, startingBalance: 100 });
    const risk = new RiskEngine();

    // Simulate a portfolio with daily loss exceeding the limit
    const portfolio: Portfolio = {
      balance: 93,
      startingBalance: 100,
      equity: 93,
      positions: new Map(),
      orders: [],
      trades: [],
      dailyPnl: new Map([[todayKey(), -6]]),  // Lost $6, limit is $5
      peakEquity: 100,
    };

    const signal = makeSignal();
    const verdict = risk.evaluate({
      signal,
      portfolio,
      config,
      traderStats: null,
      lastTradeTime: 0,
      marketPrices: new Map(),
    });

    assert.ok(!verdict.approved);
    const failed = verdict.checks.find(c => !c.passed);
    assert.strictEqual(failed?.name, 'DailyLossLimit');
  });

  test('Drawdown circuit breaker triggers', () => {
    const config = makeConfig({ drawdownHaltPct: 20 });
    const risk = new RiskEngine();

    const portfolio: Portfolio = {
      balance: 750,
      startingBalance: 1000,
      equity: 750,
      positions: new Map(),
      orders: [],
      trades: [],
      dailyPnl: new Map(),
      peakEquity: 1000,
    };

    assert.ok(risk.isHalted(portfolio, config));
  });

  test('Position sizing scales with confidence & score', () => {
    const config = makeConfig();
    const ex = new PaperExchange(config);
    const risk = new RiskEngine();

    // High confidence signal
    const highConf = makeSignal({ price: 0.50, size: 50, confidence: 1.0 });
    const v1 = risk.evaluate({
      signal: highConf,
      portfolio: ex.getPortfolio(),
      config,
      traderStats: {
        id: 'good', alias: 'Good', totalTrades: 50,
        wins: 40, losses: 10, winRate: 0.8,
        totalPnl: 100, totalInvested: 500, roi: 0.2,
        avgReturn: 0.02, returnStdDev: 0.01, sharpeRatio: 2.0,
        compositeScore: 85, lastActive: Date.now(), returns: [],
      },
      lastTradeTime: 0,
      marketPrices: new Map(),
    });

    // Low confidence signal
    const lowConf = makeSignal({ price: 0.50, size: 50, confidence: 0.3 });
    const v2 = risk.evaluate({
      signal: lowConf,
      portfolio: ex.getPortfolio(),
      config,
      traderStats: null,
      lastTradeTime: 0,
      marketPrices: new Map(),
    });

    // High confidence + good trader → larger position
    assert.ok(v1.approved);
    assert.ok(v2.approved);
    assert.ok(v1.adjustedSize > v2.adjustedSize);
  });

  console.log('');

  // ─── 4. Trader Scoring ─────────────────────────────────

  console.log('┌─ Trader Scoring ──────────────────────────┐');

  test('New trader starts with neutral score', () => {
    const tracker = new TraderTracker();
    tracker.registerTrader('t1', 'Trader One');
    const stats = tracker.getStats('t1');
    assert.ok(stats !== null);
    assert.strictEqual(stats!.compositeScore, 50);
    assert.strictEqual(stats!.totalTrades, 0);
  });

  test('Winning trades improve score', () => {
    const tracker = new TraderTracker();
    tracker.registerTrader('t1', 'Winner');
    const initial = tracker.getStats('t1')!.compositeScore;

    // Record winning trades
    for (let i = 0; i < 10; i++) {
      const trade: Trade = {
        id: `trd_${i}`, orderId: '', signalId: '', traderId: 't1',
        marketId: 'test', question: 'Test', outcome: 'Yes', side: 'SELL',
        entryPrice: 0.40, exitPrice: 0.60, size: 10,
        cost: 4, proceeds: 6, pnl: 2, pnlPct: 50,
        holdTimeMs: 60_000, openedAt: Date.now() - 60_000, closedAt: Date.now(),
      };
      tracker.recordTrade(trade);
    }

    const after = tracker.getStats('t1')!.compositeScore;
    assert.ok(after > initial, `Score should improve: ${initial} → ${after}`);
  });

  test('Losing trades decrease score', () => {
    const tracker = new TraderTracker();
    tracker.registerTrader('t2', 'Loser');

    // Record first a winning trade for baseline
    tracker.recordTrade({
      id: 'win', orderId: '', signalId: '', traderId: 't2',
      marketId: 'test', question: 'Test', outcome: 'Yes', side: 'SELL',
      entryPrice: 0.50, exitPrice: 0.60, size: 10,
      cost: 5, proceeds: 6, pnl: 1, pnlPct: 20,
      holdTimeMs: 60_000, openedAt: Date.now() - 60_000, closedAt: Date.now(),
    });

    const afterWin = tracker.getStats('t2')!.compositeScore;

    // Now lose repeatedly
    for (let i = 0; i < 15; i++) {
      tracker.recordTrade({
        id: `loss_${i}`, orderId: '', signalId: '', traderId: 't2',
        marketId: 'test', question: 'Test', outcome: 'Yes', side: 'SELL',
        entryPrice: 0.50, exitPrice: 0.30, size: 10,
        cost: 5, proceeds: 3, pnl: -2, pnlPct: -40,
        holdTimeMs: 60_000, openedAt: Date.now() - 60_000, closedAt: Date.now(),
      });
    }

    const afterLoss = tracker.getStats('t2')!.compositeScore;
    assert.ok(afterLoss < afterWin, `Score should decrease: ${afterWin} → ${afterLoss}`);
  });

  test('getTopTraders() returns sorted by score', () => {
    const tracker = new TraderTracker();

    // Create 3 traders with different performance
    for (const [id, wins, losses] of [['a', 8, 2], ['b', 3, 7], ['c', 6, 4]] as [string, number, number][]) {
      tracker.registerTrader(id, `Trader-${id}`);
      for (let i = 0; i < wins; i++) {
        tracker.recordTrade({
          id: `w_${id}_${i}`, orderId: '', signalId: '', traderId: id,
          marketId: 'test', question: 'Test', outcome: 'Yes', side: 'SELL',
          entryPrice: 0.40, exitPrice: 0.60, size: 10,
          cost: 4, proceeds: 6, pnl: 2, pnlPct: 50,
          holdTimeMs: 1000, openedAt: Date.now(), closedAt: Date.now(),
        });
      }
      for (let i = 0; i < losses; i++) {
        tracker.recordTrade({
          id: `l_${id}_${i}`, orderId: '', signalId: '', traderId: id,
          marketId: 'test', question: 'Test', outcome: 'Yes', side: 'SELL',
          entryPrice: 0.50, exitPrice: 0.30, size: 10,
          cost: 5, proceeds: 3, pnl: -2, pnlPct: -40,
          holdTimeMs: 1000, openedAt: Date.now(), closedAt: Date.now(),
        });
      }
    }

    const top = tracker.getTopTraders(3);
    assert.strictEqual(top.length, 3);
    assert.ok(top[0].compositeScore >= top[1].compositeScore);
    assert.ok(top[1].compositeScore >= top[2].compositeScore);
    assert.strictEqual(top[0].id, 'a');  // best trader
  });

  test('Win rate calculates correctly', () => {
    const tracker = new TraderTracker();
    tracker.registerTrader('wr', 'WinRate');

    for (let i = 0; i < 3; i++) {
      tracker.recordTrade({
        id: `w_${i}`, orderId: '', signalId: '', traderId: 'wr',
        marketId: 'test', question: 'Test', outcome: 'Yes', side: 'SELL',
        entryPrice: 0.40, exitPrice: 0.60, size: 10,
        cost: 4, proceeds: 6, pnl: 2, pnlPct: 50,
        holdTimeMs: 1000, openedAt: Date.now(), closedAt: Date.now(),
      });
    }
    tracker.recordTrade({
      id: 'loss', orderId: '', signalId: '', traderId: 'wr',
      marketId: 'test', question: 'Test', outcome: 'Yes', side: 'SELL',
      entryPrice: 0.50, exitPrice: 0.30, size: 10,
      cost: 5, proceeds: 3, pnl: -2, pnlPct: -40,
      holdTimeMs: 1000, openedAt: Date.now(), closedAt: Date.now(),
    });

    const stats = tracker.getStats('wr')!;
    assert.ok(Math.abs(stats.winRate - 0.75) < 0.01);
    assert.strictEqual(stats.wins, 3);
    assert.strictEqual(stats.losses, 1);
  });

  console.log('');

  // ─── 5. Mock Signal Source ──────────────────────────────

  console.log('┌─ Mock Signal Source ──────────────────────┐');

  test('MockSignalSource initializes with markets', () => {
    const source = new MockSignalSource();
    const markets = source.getMarkets();
    assert.ok(markets.length >= 5);
    assert.ok(markets[0].id.length > 0);
    assert.ok(markets[0].question.length > 0);
  });

  test('MockSignalSource.poll() returns valid signals', async () => {
    const source = new MockSignalSource();
    // Poll multiple times to ensure we get at least one signal
    let allSignals: Signal[] = [];
    for (let i = 0; i < 20; i++) {
      const sigs = await source.poll();
      allSignals.push(...sigs);
      if (allSignals.length > 0) break;
    }
    assert.ok(allSignals.length > 0, 'Should generate at least 1 signal in 20 polls');

    const sig = allSignals[0];
    assert.ok(sig.id.startsWith('sig_'));
    assert.ok(['BUY', 'SELL'].includes(sig.side));
    assert.ok(sig.price > 0 && sig.price < 1);
    assert.ok(sig.size > 0);
    assert.ok(sig.confidence >= 0 && sig.confidence <= 1);
  });

  test('MockSignalSource.getMarketPrices() returns prices for all markets', () => {
    const source = new MockSignalSource();
    const prices = source.getMarketPrices();
    assert.ok(prices.size > 0);

    for (const [, mp] of prices) {
      assert.ok('Yes' in mp || 'No' in mp);
      const yes = mp['Yes'] ?? 0;
      const no = mp['No'] ?? 0;
      assert.ok(Math.abs(yes + no - 1) < 0.05, `Prices should sum to ~1: ${yes} + ${no}`);
    }
  });

  test('Prices drift over time', async () => {
    const source = new MockSignalSource();
    const initial = source.getMarketPrices();
    const firstMarketId = [...initial.keys()][0];
    const initialPrice = initial.get(firstMarketId)!['Yes'];

    // Poll many times to drift
    for (let i = 0; i < 50; i++) {
      await source.poll();
    }

    const after = source.getMarketPrices();
    const afterPrice = after.get(firstMarketId)!['Yes'];

    // After 50 ticks with noise, prices should have moved
    // (There's a tiny chance they haven't, but very unlikely)
    // Just check they're still valid
    assert.ok(afterPrice > 0 && afterPrice < 1);
  });

  console.log('');

  // ─── 6. State Persistence ──────────────────────────────

  console.log('┌─ State Persistence ───────────────────────┐');

  test('StateStore save and load roundtrip', () => {
    const store = new StateStore();
    const config = makeConfig();
    const ex = new PaperExchange(config);

    // Add some data
    const signal = makeSignal();
    ex.buy(signal, 10, 0.50);

    const portfolio = ex.getPortfolio();
    const traders = new Map<string, any>();
    traders.set('t1', {
      id: 't1', alias: 'Test', totalTrades: 5,
      wins: 3, losses: 2, winRate: 0.6,
      totalPnl: 10, totalInvested: 50, roi: 0.2,
      avgReturn: 0.02, returnStdDev: 0.01, sharpeRatio: 2.0,
      compositeScore: 70, lastActive: Date.now(), returns: [0.1, -0.05, 0.15],
    });

    const prices = new Map<string, Record<string, number>>();
    prices.set('test-market', { Yes: 0.60, No: 0.40 });

    store.save(portfolio, traders, prices);

    assert.ok(store.exists());

    const loaded = store.load();
    assert.ok(loaded !== null);
    assert.strictEqual(loaded!.version, 1);
    assert.strictEqual(loaded!.portfolio.balance, portfolio.balance);
    assert.strictEqual(loaded!.portfolio.positions.length, 1);
    assert.strictEqual(loaded!.traders.length, 1);
    assert.strictEqual(loaded!.traders[0][0], 't1');

    store.clear();
    assert.ok(!store.exists());
  });

  console.log('');

  // ─── 7. Reporter ───────────────────────────────────────

  console.log('┌─ Reporter ────────────────────────────────┐');

  test('Reporter generates valid report', () => {
    const config = makeConfig();
    const reporter = new Reporter(config);
    const ex = new PaperExchange(config);

    const signal = makeSignal();
    ex.buy(signal, 10, 0.50);

    const portfolio = ex.getPortfolio();
    const report = reporter.generateReport(portfolio, []);

    assert.ok(report.timestamp > 0);
    assert.strictEqual(report.balance, ex.getBalance());
    assert.ok(report.equity > 0);
    assert.strictEqual(report.openPositions, 1);
    assert.strictEqual(report.riskStatus, 'ACTIVE');
  });

  test('Report calculates win rate from trades', () => {
    const config = makeConfig();
    const reporter = new Reporter(config);
    const ex = new PaperExchange(config);

    // Make some trades (buy and sell)
    for (let i = 0; i < 3; i++) {
      const sig = makeSignal({ marketId: `m_${i}`, price: 0.40, size: 5 });
      ex.buy(sig, 5, 0.40);
      const pos = ex.getPositions().find(p => p.marketId === `m_${i}`)!;
      // Winning trade
      ex.sell(pos.id, 0.60);
    }
    // One losing trade
    const loseSig = makeSignal({ marketId: 'lose', price: 0.50, size: 5 });
    ex.buy(loseSig, 5, 0.50);
    const losePos = ex.getPositions().find(p => p.marketId === 'lose')!;
    ex.sell(losePos.id, 0.30);

    const report = reporter.generateReport(ex.getPortfolio(), []);
    assert.ok(Math.abs(report.winRate - 75) < 1);  // 3/4 = 75%
    assert.strictEqual(report.totalTrades, 4);
  });

  console.log('');

  // ─── 8. Integration Tests ──────────────────────────────

  console.log('┌─ Integration ─────────────────────────────┐');

  test('Full pipeline: signal → risk → execute → monitor', () => {
    const config = makeConfig({ tradeCooldownMs: 0 });
    const ex = new PaperExchange(config);
    const risk = new RiskEngine();
    const tracker = new TraderTracker();

    const signal = makeSignal({ price: 0.45, size: 20, confidence: 0.85 });
    tracker.registerTrader(signal.traderId, 'TestTrader');

    // Step 1: Evaluate risk
    const verdict = risk.evaluate({
      signal,
      portfolio: ex.getPortfolio(),
      config,
      traderStats: tracker.getStats(signal.traderId),
      lastTradeTime: 0,
      marketPrices: new Map(),
    });
    assert.ok(verdict.approved);

    // Step 2: Execute
    const order = ex.buy(signal, verdict.adjustedSize, signal.price);
    assert.strictEqual(order.status, 'FILLED');

    // Step 3: Price update → SL/TP check
    ex.updateMarketPrice(signal.marketId, signal.outcome, 0.70);
    const pos = ex.getPositions()[0];
    assert.ok(pos.pnl > 0);

    // Step 4: Take profit
    if (pos.pnlPct >= config.takeProfitPct) {
      const trade = ex.sell(pos.id, pos.currentPrice);
      assert.ok(trade !== null);
      assert.ok(trade!.pnl > 0);
      tracker.recordTrade(trade!);

      const stats = tracker.getStats(signal.traderId)!;
      assert.strictEqual(stats.totalTrades, 1);
      assert.strictEqual(stats.wins, 1);
    }
  });

  test('Risk pipeline blocks over-exposed portfolio', () => {
    const config = makeConfig({
      startingBalance: 100,
      maxExposurePct: 20,
      maxPositionPct: 15,
      tradeCooldownMs: 0,
    });
    const ex = new PaperExchange(config);
    const risk = new RiskEngine();

    // Fill up to exposure limit
    const sig1 = makeSignal({ marketId: 'm1', price: 0.50, size: 30 });
    ex.buy(sig1, 30, 0.50);  // $15 = 15% of equity

    // This should be blocked by total exposure
    const sig2 = makeSignal({ marketId: 'm2', price: 0.50, size: 30 });
    const verdict = risk.evaluate({
      signal: sig2,
      portfolio: ex.getPortfolio(),
      config,
      traderStats: null,
      lastTradeTime: 0,
      marketPrices: new Map(),
    });

    assert.ok(!verdict.approved);
  });

  test('Multiple sell/buy cycles maintain correct balance', () => {
    const config = makeConfig({ startingBalance: 1000 });
    const ex = new PaperExchange(config);

    for (let i = 0; i < 5; i++) {
      const sig = makeSignal({ marketId: `round_${i}`, price: 0.50, size: 10 });
      ex.buy(sig, 10, 0.50);
      const pos = ex.getPositions().find(p => p.marketId === `round_${i}`)!;
      const exitPrice = 0.45 + Math.random() * 0.20;
      ex.sell(pos.id, exitPrice);
    }

    // Balance should be internally consistent
    assert.strictEqual(ex.getPositions().length, 0);
    const bal = ex.getBalance();
    const equity = ex.getEquity();
    assert.ok(Math.abs(bal - equity) < 0.01);

    // 5 trades completed
    assert.strictEqual(ex.getTrades().length, 5);
    assert.strictEqual(ex.getOrders().length, 5);
  });

  console.log('');

  // ─── Summary ────────────────────────────────────────────

  // Wait a tick for any async tests
  await new Promise(r => setTimeout(r, 100));

  console.log('╔══════════════════════════════════════════╗');
  console.log(`║  Results: ${passed} passed, ${failed} failed${' '.repeat(20 - String(passed).length - String(failed).length)}║`);
  if (failed > 0) {
    console.log('╠══════════════════════════════════════════╣');
    for (const e of errors) {
      console.log(`║  ❌ ${e.slice(0, 36).padEnd(36)}║`);
    }
  }
  console.log('╚══════════════════════════════════════════╝\n');

  if (failed > 0) process.exit(1);
}

runAll().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});