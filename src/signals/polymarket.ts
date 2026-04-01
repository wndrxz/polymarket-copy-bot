// ════════════════════════════════════════════════════════════
// Polymarket Live Signal Source
// Polls the Gamma & CLOB APIs for market data, tracks
// target wallets' positions and emits copy-signals.
// ════════════════════════════════════════════════════════════

import * as https from 'https';
import type { Signal, Market, Config, ISignalSource } from '../core/types';
import { rid } from '../utils/helpers';
import { log } from '../utils/logger';

// ─── Lightweight HTTPS JSON fetcher ─────────────────────────
function fetchJson<T = unknown>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error from ${url}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ─── Gamma API response shapes ──────────────────────────────
interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: string;        // JSON array string like '["Yes","No"]'
  outcomePrices: string;   // JSON array string like '[0.62,0.38]'
  volume: string;
  liquidity: string;
  endDate: string;
  active: boolean;
  closed: boolean;
}

// ─── Snapshot of a trader's positions for diff detection ────
interface PositionSnapshot {
  marketId: string;
  outcome: string;
  size: number;
  price: number;
}

export class PolymarketSignalSource implements ISignalSource {
  private config: Config;
  private markets: Market[] = [];
  private marketPrices = new Map<string, Record<string, number>>();
  private lastSnapshots = new Map<string, PositionSnapshot[]>();  // traderId -> positions
  private lastFetchTime = 0;
  private readonly CACHE_TTL = 30_000;  // 30s cache for market list

  constructor(config: Config) {
    this.config = config;
    log.info('Polymarket', `Live signal source initialized — tracking ${config.targetTraders.length} wallet(s)`);
  }

  // ─── Fetch market catalogue from Gamma API ─────────────────
  private async fetchMarkets(): Promise<void> {
    if (Date.now() - this.lastFetchTime < this.CACHE_TTL && this.markets.length > 0) return;

    try {
      const url = `${this.config.gammaApiUrl}/markets?limit=200&active=true&closed=false`;
      const raw = await fetchJson<GammaMarket[]>(url);

      this.markets = raw
        .filter(m => m.active && !m.closed)
        .map(m => {
          let outcomes: [string, string] = ['Yes', 'No'];
          let prices: Record<string, number> = { Yes: 0.5, No: 0.5 };

          try {
            const oc = JSON.parse(m.outcomes) as string[];
            outcomes = [oc[0] ?? 'Yes', oc[1] ?? 'No'];
          } catch { /* use defaults */ }

          try {
            const pr = JSON.parse(m.outcomePrices) as number[];
            prices = { [outcomes[0]]: pr[0] ?? 0.5, [outcomes[1]]: pr[1] ?? 0.5 };
          } catch { /* use defaults */ }

          return {
            id: m.id,
            slug: m.slug,
            question: m.question,
            outcomes,
            endDate: m.endDate,
            active: m.active,
            volume: parseFloat(m.volume) || 0,
            liquidity: parseFloat(m.liquidity) || 0,
            prices,
          };
        });

      // Update price map
      for (const m of this.markets) {
        this.marketPrices.set(m.id, { ...m.prices });
      }

      this.lastFetchTime = Date.now();
      log.debug('Polymarket', `Fetched ${this.markets.length} active markets`);
    } catch (err) {
      log.error('Polymarket', `Failed to fetch markets: ${(err as Error).message}`);
    }
  }

  // ─── Detect position changes for a target wallet ───────────
  private async fetchWalletPositions(address: string): Promise<PositionSnapshot[]> {
    // NOTE: This endpoint may require authentication or may not exist publicly.
    // Replace with the correct endpoint for your setup:
    //   - Polymarket Profiles API
    //   - The Graph subgraph query
    //   - Direct Polygon RPC calls
    //
    // For now we attempt the data API which exposes public positions.
    try {
      const url = `${this.config.gammaApiUrl}/positions?user=${address}&sizeThreshold=0.1`;
      const data = await fetchJson<Array<{
        market: string;
        outcome: string;
        size: string;
        avgPrice: string;
      }>>(url);

      return (data || []).map(p => ({
        marketId: p.market,
        outcome: p.outcome,
        size: parseFloat(p.size) || 0,
        price: parseFloat(p.avgPrice) || 0,
      }));
    } catch (err) {
      log.warn('Polymarket', `Could not fetch positions for ${address.slice(0, 10)}…: ${(err as Error).message}`);
      return [];
    }
  }

  private diffPositions(
    traderId: string,
    current: PositionSnapshot[],
  ): Signal[] {
    const prev = this.lastSnapshots.get(traderId) || [];
    const signals: Signal[] = [];

    const prevMap = new Map(prev.map(p => [`${p.marketId}_${p.outcome}`, p]));

    for (const pos of current) {
      const key = `${pos.marketId}_${pos.outcome}`;
      const old = prevMap.get(key);

      // New position or increased size → BUY signal
      if (!old || pos.size > old.size + 0.5) {
        const market = this.markets.find(m => m.id === pos.marketId);
        if (!market) continue;

        const addedSize = old ? pos.size - old.size : pos.size;
        signals.push({
          id: `sig_${rid()}`,
          timestamp: Date.now(),
          traderId,
          marketId: pos.marketId,
          marketSlug: market.slug,
          question: market.question,
          outcome: pos.outcome,
          side: 'BUY',
          price: pos.price || (market.prices[pos.outcome] ?? 0.5),
          size: Math.round(addedSize),
          confidence: 0.7,
        });
      }
    }

    this.lastSnapshots.set(traderId, current);
    return signals;
  }

  // ─── ISignalSource Implementation ─────────────────────────
  async poll(): Promise<Signal[]> {
    await this.fetchMarkets();

    if (this.config.targetTraders.length === 0) {
      log.debug('Polymarket', 'No target traders configured');
      return [];
    }

    const allSignals: Signal[] = [];
    for (const address of this.config.targetTraders) {
      const positions = await this.fetchWalletPositions(address);
      const signals = this.diffPositions(address, positions);
      allSignals.push(...signals);
    }

    if (allSignals.length > 0) {
      log.info('Polymarket', `Detected ${allSignals.length} new signal(s) from tracked wallets`);
    }

    return allSignals;
  }

  getMarketPrices(): Map<string, Record<string, number>> {
    return new Map(this.marketPrices);
  }

  getMarkets(): Market[] {
    return [...this.markets];
  }
}