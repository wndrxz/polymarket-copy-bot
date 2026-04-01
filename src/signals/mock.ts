// ════════════════════════════════════════════════════════════
// Mock Signal Generator
// Simulates 5 traders across 8 prediction markets with
// drifting prices and skill-weighted signal quality.
// ════════════════════════════════════════════════════════════

import type { Signal, Market, ISignalSource } from '../core/types';
import { rid, clamp, randomPick, gaussRandom } from '../utils/helpers';
import { log } from '../utils/logger';

interface MockTrader {
  id: string;
  alias: string;
  skill: number;        // 0–1, affects signal quality
  activityRate: number;  // 0–1, chance of trading per poll
}

const TRADERS: MockTrader[] = [
  { id: 'trader_alpha',   alias: 'WhaleAlpha',  skill: 0.72, activityRate: 0.25 },
  { id: 'trader_bravo',   alias: 'SmartMoney',  skill: 0.81, activityRate: 0.15 },
  { id: 'trader_charlie', alias: 'DegenDave',   skill: 0.38, activityRate: 0.35 },
  { id: 'trader_delta',   alias: 'InsiderIan',  skill: 0.90, activityRate: 0.10 },
  { id: 'trader_echo',    alias: 'RandomRob',   skill: 0.50, activityRate: 0.30 },
];

const INITIAL_MARKETS: Market[] = [
  { id: 'btc-100k-2025',    slug: 'btc-100k-2025',    question: 'Will Bitcoin exceed $100k by Dec 2025?',  outcomes: ['Yes', 'No'], endDate: '2025-12-31', active: true, volume: 5_200_000, liquidity: 320_000, prices: { Yes: 0.62, No: 0.38 } },
  { id: 'fed-rate-cut',     slug: 'fed-rate-cut',     question: 'Fed rate cut at next FOMC meeting?',      outcomes: ['Yes', 'No'], endDate: '2025-09-18', active: true, volume: 3_800_000, liquidity: 210_000, prices: { Yes: 0.74, No: 0.26 } },
  { id: 'gpt5-2025',        slug: 'gpt5-2025',        question: 'Will GPT-5 be released by end of 2025?',  outcomes: ['Yes', 'No'], endDate: '2025-12-31', active: true, volume: 1_500_000, liquidity: 95_000,  prices: { Yes: 0.41, No: 0.59 } },
  { id: 'spacex-mars-2030', slug: 'spacex-mars-2030', question: 'SpaceX crewed Mars landing before 2030?', outcomes: ['Yes', 'No'], endDate: '2029-12-31', active: true, volume: 800_000,   liquidity: 55_000,  prices: { Yes: 0.13, No: 0.87 } },
  { id: 'wc-brazil-2026',   slug: 'wc-brazil-2026',   question: 'Brazil wins 2026 FIFA World Cup?',        outcomes: ['Yes', 'No'], endDate: '2026-07-19', active: true, volume: 2_100_000, liquidity: 140_000, prices: { Yes: 0.11, No: 0.89 } },
  { id: 'us-recession-2025',slug: 'us-recession-2025',question: 'US enters recession in 2025?',            outcomes: ['Yes', 'No'], endDate: '2025-12-31', active: true, volume: 4_100_000, liquidity: 260_000, prices: { Yes: 0.33, No: 0.67 } },
  { id: 'eth-flip-btc',     slug: 'eth-flip-btc',     question: 'ETH market cap exceeds BTC before 2027?', outcomes: ['Yes', 'No'], endDate: '2026-12-31', active: true, volume: 1_800_000, liquidity: 110_000, prices: { Yes: 0.08, No: 0.92 } },
  { id: 'trump-conviction', slug: 'trump-conviction', question: 'Trump receives prison sentence in 2025?', outcomes: ['Yes', 'No'], endDate: '2025-12-31', active: true, volume: 6_000_000, liquidity: 400_000, prices: { Yes: 0.18, No: 0.82 } },
];

export class MockSignalSource implements ISignalSource {
  private markets: Market[];
  private tickCount = 0;

  constructor() {
    // Deep-clone so we can mutate prices
    this.markets = JSON.parse(JSON.stringify(INITIAL_MARKETS));
    log.info('MockSignals', `Initialized ${this.markets.length} simulated markets, ${TRADERS.length} traders`);
  }

  /** Drift all market prices (random walk + mean reversion) */
  private driftPrices(): void {
    for (const m of this.markets) {
      const yesPrice = m.prices['Yes'];
      const drift = (0.5 - yesPrice) * 0.005;           // gentle mean reversion
      const noise = gaussRandom(0, 0.015);               // normal noise
      const jump = Math.random() < 0.01 ? gaussRandom(0, 0.08) : 0;

      const newYes = clamp(yesPrice + drift + noise + jump, 0.02, 0.98);
      m.prices['Yes'] = Math.round(newYes * 1000) / 1000;
      m.prices['No']  = Math.round((1 - newYes) * 1000) / 1000;

      // Simulate volume fluctuation
      m.volume += Math.floor(gaussRandom(0, 5000));
      m.liquidity = Math.max(1000, m.liquidity + Math.floor(gaussRandom(0, 1000)));
    }
  }

  async poll(): Promise<Signal[]> {
    this.tickCount++;
    this.driftPrices();

    const signals: Signal[] = [];

    for (const trader of TRADERS) {
      if (Math.random() > trader.activityRate) continue;

      const market = randomPick(this.markets);

      // Skilled traders tend to pick the more likely outcome
      const trueProb = market.prices['Yes'];
      let outcome: string;
      if (trader.skill > 0.6) {
        // Skilled: picks the side with perceived edge
        outcome = trueProb > 0.5 ? 'Yes' : 'No';
        // Occasionally contrarian
        if (Math.random() < 0.2) outcome = outcome === 'Yes' ? 'No' : 'Yes';
      } else {
        outcome = Math.random() > 0.5 ? 'Yes' : 'No';
      }

      const price = market.prices[outcome];
      const size = Math.round(10 + Math.random() * 80);  // 10–90 shares
      const confidence = clamp(trader.skill + gaussRandom(0, 0.1), 0.1, 1.0);

      signals.push({
        id: `sig_${rid()}`,
        timestamp: Date.now(),
        traderId: trader.id,
        marketId: market.id,
        marketSlug: market.slug,
        question: market.question,
        outcome,
        side: 'BUY',
        price,
        size,
        confidence: Math.round(confidence * 100) / 100,
      });
    }

    if (signals.length > 0) {
      log.debug('MockSignals', `Generated ${signals.length} signal(s) on tick #${this.tickCount}`);
    }

    return signals;
  }

  getMarketPrices(): Map<string, Record<string, number>> {
    const map = new Map<string, Record<string, number>>();
    for (const m of this.markets) {
      map.set(m.id, { ...m.prices });
    }
    return map;
  }

  getMarkets(): Market[] {
    return [...this.markets];
  }
}