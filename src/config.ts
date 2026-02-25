import dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  DRY_RUN: process.env.DRY_RUN !== "false",
  MOCK_SIGNALS: process.env.MOCK_SIGNALS !== "false",
  LOG_LEVEL: (process.env.LOG_LEVEL || "info") as
    | "debug"
    | "info"
    | "warn"
    | "error",

  CLOB_API_URL: process.env.CLOB_API_URL || "https://clob.polymarket.com",
  DATA_API_URL: process.env.DATA_API_URL || "https://data-api.polymarket.com",
  GAMMA_API_URL:
    process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com",

  PAPER: {
    STARTING_BALANCE: Number(process.env.STARTING_BALANCE) || 1000,
    REPORT_INTERVAL_MS: 120_000,
  },

  RISK: {
    MAX_POSITION_USDC: 100,
    MIN_POSITION_USDC: 5,
    BALANCE_RATIO: 0.1,

    MAX_EXPOSURE_PERCENT: 0.3,
    MAX_POSITIONS: 10,
    MAX_PER_MARKET_PERCENT: 0.15,

    STOP_LOSS_PERCENT: -0.15,
    TAKE_PROFIT_PERCENT: 0.5,
    MAX_DAILY_LOSS_USDC: 200,

    MIN_MARKET_VOLUME_24H: 10_000,
    MIN_MARKET_LIQUIDITY: 5_000,
    MAX_PRICE: 0.95,
    MIN_PRICE: 0.05,

    TRADE_COOLDOWN_MS: 5_000,
    SAME_MARKET_COOLDOWN_MS: 60_000,
  },

  TRADER_SELECTION: {
    MIN_WIN_RATE: 0.55,
    MIN_ROI: 0.1,
    MIN_TRADES: 20,
  },

  POLL_INTERVAL_MS: Number(process.env.POLL_INTERVAL_MS) || 5_000,
  PNL_CHECK_INTERVAL_MS: 15_000,
  MOCK_SIGNAL_INTERVAL_MS: 8_000,

  TARGET_WALLETS: [
    {
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      label: "Trader_Alpha",
      weight: 1.0,
      enabled: true,
    },
    {
      address: "0x1234567890abcdef1234567890abcdef12345678",
      label: "Trader_Beta",
      weight: 0.7,
      enabled: true,
    },
    {
      address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      label: "Trader_Gamma",
      weight: 0.5,
      enabled: true,
    },
  ] as Array<{
    address: string;
    label: string;
    weight: number;
    enabled: boolean;
  }>,
};
