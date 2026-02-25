export interface TradeSignal {
  id: string;
  traderAddress: string;
  traderLabel: string;
  conditionId: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  usdcAmount: number;
  outcome: string;
  question: string;
  timestamp: number;
}

export interface Position {
  id: string;
  conditionId: string;
  tokenId: string;
  outcome: string;
  question: string;
  shares: number;
  avgEntryPrice: number;
  costBasis: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  copiedFrom: string;
  openedAt: number;
}

export interface ClosedTrade {
  positionId: string;
  conditionId: string;
  tokenId: string;
  outcome: string;
  question: string;
  shares: number;
  entryPrice: number;
  exitPrice: number;
  costBasis: number;
  revenue: number;
  realizedPnL: number;
  realizedPnLPercent: number;
  copiedFrom: string;
  openedAt: number;
  closedAt: number;
  reason: "copy_sell" | "stop_loss" | "take_profit" | "manual";
}

export interface OrderParams {
  tokenId: string;
  conditionId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  outcome: string;
  question: string;
  copiedFrom: string;
}

export interface OrderResult {
  id: string;
  success: boolean;
  fillPrice: number;
  fillSize: number;
  costOrRevenue: number;
  timestamp: number;
  paper: boolean;
  error?: string;
}

export interface MarketInfo {
  conditionId: string;
  question: string;
  tokens: { tokenId: string; outcome: string; price: number }[];
  volume24h: number;
  liquidity: number;
  active: boolean;
}

export interface TraderConfig {
  address: string;
  label: string;
  weight: number;
  enabled: boolean;
}

export interface TraderStats {
  address: string;
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  roi: number;
  score: number;
  lastActive: number;
}

export interface RiskCheckResult {
  passed: boolean;
  reason: string;
  adjustedSize?: number;
}

export interface IExchange {
  createOrder(params: OrderParams): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;
  getPositions(): Position[];
  getPosition(positionId: string): Position | undefined;
  getBalance(): number;
  getClosedTrades(): ClosedTrade[];
  getDailyPnL(): number;
  getTotalExposure(): number;
  updatePositionPrice(positionId: string, newPrice: number): void;
  closePosition(
    positionId: string,
    price: number,
    reason: ClosedTrade["reason"],
  ): ClosedTrade | null;
}
