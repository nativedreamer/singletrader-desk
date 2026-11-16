import type { Pair, Timeframe } from "@/lib/market-types";

export const PAIRS: Pair[] = [
  {
    id: "BTCUSD",
    label: "BTC/USD",
    name: "Bitcoin",
    klass: "crypto",
    biquote: "BTCUSD",
    yahoo: "BTC-USD",
    binance: "BTCUSDT",
    coinbase: "BTC-USD",
    twelve: "BTC/USD",
  },
  {
    id: "ETHUSD",
    label: "ETH/USD",
    name: "Ether",
    klass: "crypto",
    biquote: "ETHUSD",
    yahoo: "ETH-USD",
    binance: "ETHUSDT",
    coinbase: "ETH-USD",
    twelve: "ETH/USD",
  },
  {
    id: "SOLUSD",
    label: "SOL/USD",
    name: "Solana",
    klass: "crypto",
    biquote: "SOLUSD",
    yahoo: "SOL-USD",
    binance: "SOLUSDT",
    coinbase: "SOL-USD",
    twelve: "SOL/USD",
  },
  {
    id: "XRPUSD",
    label: "XRP/USD",
    name: "XRP",
    klass: "crypto",
    biquote: "XRPUSD",
    yahoo: "XRP-USD",
    binance: "XRPUSDT",
    coinbase: "XRP-USD",
    twelve: "XRP/USD",
  },
  {
    id: "EURUSD",
    label: "EUR/USD",
    name: "Euro",
    klass: "forex",
    biquote: "EURUSD",
    yahoo: "EURUSD=X",
    twelve: "EUR/USD",
  },
  {
    id: "GBPUSD",
    label: "GBP/USD",
    name: "Sterling",
    klass: "forex",
    biquote: "GBPUSD",
    yahoo: "GBPUSD=X",
    twelve: "GBP/USD",
  },
  {
    id: "USDJPY",
    label: "USD/JPY",
    name: "Yen",
    klass: "forex",
    biquote: "USDJPY",
    yahoo: "USDJPY=X",
    twelve: "USD/JPY",
  },
  {
    id: "USDCHF",
    label: "USD/CHF",
    name: "Swiss franc",
    klass: "forex",
    biquote: "USDCHF",
    yahoo: "USDCHF=X",
    twelve: "USD/CHF",
  },
  {
    id: "AUDUSD",
    label: "AUD/USD",
    name: "Australian dollar",
    klass: "forex",
    biquote: "AUDUSD",
    yahoo: "AUDUSD=X",
    twelve: "AUD/USD",
  },
  {
    id: "USDCAD",
    label: "USD/CAD",
    name: "Canadian dollar",
    klass: "forex",
    biquote: "USDCAD",
    yahoo: "USDCAD=X",
    twelve: "USD/CAD",
  },
  {
    id: "NZDUSD",
    label: "NZD/USD",
    name: "New Zealand dollar",
    klass: "forex",
    biquote: "NZDUSD",
    yahoo: "NZDUSD=X",
    twelve: "NZD/USD",
  },
  {
    id: "EURGBP",
    label: "EUR/GBP",
    name: "Euro sterling",
    klass: "forex",
    biquote: "EURGBP",
    yahoo: "EURGBP=X",
    twelve: "EUR/GBP",
  },
  {
    id: "EURJPY",
    label: "EUR/JPY",
    name: "Euro yen",
    klass: "forex",
    biquote: "EURJPY",
    yahoo: "EURJPY=X",
    twelve: "EUR/JPY",
  },
  {
    id: "GBPJPY",
    label: "GBP/JPY",
    name: "Sterling yen",
    klass: "forex",
    biquote: "GBPJPY",
    yahoo: "GBPJPY=X",
    twelve: "GBP/JPY",
  },
  {
    id: "XAUUSD",
    label: "XAU/USD",
    name: "Gold",
    klass: "metal",
    biquote: "XAUUSD",
    yahoo: "GC=F",
    twelve: "XAU/USD",
  },
  {
    id: "XAGUSD",
    label: "XAG/USD",
    name: "Silver",
    klass: "metal",
    biquote: "XAGUSD",
    yahoo: "SI=F",
    twelve: "XAG/USD",
  },
];

export const PAIR_MAP = new Map(PAIRS.map((p) => [p.id, p]));

export const DEFAULT_PAIRS = ["BTCUSD", "EURUSD", "GBPUSD"];

export const MAX_PAIRS = 6;

export const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1H" },
  { id: "4h", label: "4H" },
];

export function intervalSeconds(tf: Timeframe): number {
  if (tf === "5m") return 300;
  if (tf === "15m") return 900;
  if (tf === "1h") return 3600;
  return 14400;
}

export function barsPerDay(tf: Timeframe): number {
  if (tf === "5m") return 288;
  if (tf === "15m") return 96;
  if (tf === "1h") return 24;
  return 6;
}
