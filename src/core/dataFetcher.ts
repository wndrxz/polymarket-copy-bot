import axios from "axios";
import { CONFIG } from "../config";
import { TradeSignal, MarketInfo } from "../types";
import { log } from "../utils/logger";
import { retry } from "../utils/retry";

const MOCK_MARKETS: MarketInfo[] = [
  {
    conditionId: "mock-btc-100k",
    question: "Will Bitcoin exceed $100K by end of 2025?",
    tokens: [
      { tokenId: "btc-yes", outcome: "Yes", price: 0.72 },
      { tokenId: "btc-no", outcome: "No", price: 0.28 },
    ],
    volume24h: 450_000,
    liquidity: 80_000,
    active: true,
  },
  {
    conditionId: "mock-fed-cut",
    question: "Will the Fed cut rates before July 2025?",
    tokens: [
      { tokenId: "fed-yes", outcome: "Yes", price: 0.38 },
      { tokenId: "fed-no", outcome: "No", price: 0.62 },
    ],
    volume24h: 320_000,
    liquidity: 55_000,
    active: true,
  },
  {
    conditionId: "mock-eth-5k",
    question: "Will Ethereum price exceed $5,000 in Q2 2025?",
    tokens: [
      { tokenId: "eth-yes", outcome: "Yes", price: 0.31 },
      { tokenId: "eth-no", outcome: "No", price: 0.69 },
    ],
    volume24h: 210_000,
    liquidity: 42_000,
    active: true,
  },
  {
    conditionId: "mock-ai-bill",
    question: "Will US pass major AI regulation bill in 2025?",
    tokens: [
      { tokenId: "ai-yes", outcome: "Yes", price: 0.22 },
      { tokenId: "ai-no", outcome: "No", price: 0.78 },
    ],
    volume24h: 150_000,
    liquidity: 28_000,
    active: true,
  },
  {
    conditionId: "mock-election-2025",
    question: "Will party X win the 2025 special election?",
    tokens: [
      { tokenId: "elec-yes", outcome: "Yes", price: 0.55 },
      { tokenId: "elec-no", outcome: "No", price: 0.45 },
    ],
    volume24h: 890_000,
    liquidity: 120_000,
    active: true,
  },
];

export class DataFetcher {
  private prices: Map<string, number> = new Map();

  constructor() {
    for (const m of MOCK_MARKETS) {
      for (const t of m.tokens) this.prices.set(t.tokenId, t.price);
    }
  }

  async getMarketInfo(conditionId: string): Promise<MarketInfo | null> {
    if (CONFIG.MOCK_SIGNALS) {
      const m = MOCK_MARKETS.find((x) => x.conditionId === conditionId);
      if (m) {
        for (const t of m.tokens) {
          const cur = this.prices.get(t.tokenId) ?? t.price;
          t.price = driftPrice(cur);
          this.prices.set(t.tokenId, t.price);
        }
      }
      return m ?? null;
    }

    try {
      return await retry(
        async () => {
          const { data } = await axios.get(`${CONFIG.GAMMA_API_URL}/markets`, {
            params: { id: conditionId },
            timeout: 5000,
          });
          const raw = Array.isArray(data) ? data[0] : data;
          if (!raw) return null;
          return {
            conditionId: raw.conditionId ?? raw.id,
            question: raw.question,
            tokens: (raw.tokens ?? []).map((t: any) => ({
              tokenId: t.token_id,
              outcome: t.outcome,
              price: Number(t.price),
            })),
            volume24h: Number(raw.volume24hr ?? 0),
            liquidity: Number(raw.liquidity ?? 0),
            active: raw.active ?? true,
          } as MarketInfo;
        },
        2,
        1000,
        "getMarketInfo",
      );
    } catch {
      return null;
    }
  }

  async fetchTraderActivity(address: string, limit = 20): Promise<any[]> {
    try {
      const { data } = await axios.get(`${CONFIG.DATA_API_URL}/activity`, {
        params: { user: address, limit, type: "TRADE", sortBy: "TIMESTAMP" },
        timeout: 5000,
      });
      return data?.data ?? data ?? [];
    } catch (err) {
      log.debug(
        `Cannot fetch activity for ${address.slice(0, 10)}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  async getPrice(tokenId: string): Promise<number | null> {
    if (CONFIG.MOCK_SIGNALS) {
      const p = this.prices.get(tokenId);
      if (p !== undefined) {
        const newP = driftPrice(p);
        this.prices.set(tokenId, newP);
        return newP;
      }
      return null;
    }

    try {
      const { data } = await axios.get(`${CONFIG.CLOB_API_URL}/price`, {
        params: { token_id: tokenId, side: "buy" },
        timeout: 5000,
      });
      return Number(data?.price) ?? null;
    } catch {
      return null;
    }
  }

  generateMockSignal(): TradeSignal {
    const wallets = CONFIG.TARGET_WALLETS.filter((w) => w.enabled);
    const wallet = pick(wallets);
    const market = pick(MOCK_MARKETS);
    const token = pick(market.tokens);
    const side: "BUY" | "SELL" = Math.random() < 0.75 ? "BUY" : "SELL";
    const price = this.prices.get(token.tokenId) ?? token.price;
    const size = Math.round(50 + Math.random() * 450);

    return {
      id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      traderAddress: wallet.address,
      traderLabel: wallet.label,
      conditionId: market.conditionId,
      tokenId: token.tokenId,
      side,
      price: round3(price),
      size,
      usdcAmount: round3(price) * size,
      outcome: token.outcome,
      question: market.question,
      timestamp: Date.now(),
    };
  }
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function driftPrice(price: number): number {
  const d = (Math.random() - 0.5) * 0.02;
  return round3(Math.max(0.02, Math.min(0.98, price + d)));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
