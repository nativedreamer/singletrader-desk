export type Timeframe = "5m" | "15m" | "1h" | "4h";
export type StrategyId = "ema_vwap" | "leo";
export type Side = "BUY" | "SELL" | "HOLD";
export type AssetClass = "crypto" | "forex" | "metal";
export type EntryState = "live" | "passed" | "flat";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Pair = {
  id: string;
  label: string;
  name: string;
  klass: AssetClass;
  biquote: string;
  yahoo?: string;
  binance?: string;
  coinbase?: string;
  twelve?: string;
};

export type Vote = {
  strategy: StrategyId;
  name: string;
  action: Side;
  entryState: EntryState;
  confidence: number;
  entry: number;
  sl: number;
  tp: [number, number, number, number];
  note: string;
};

export type PairResult = {
  id: string;
  label: string;
  name: string;
  klass: AssetClass;
  price: number;
  changePct: number;
  source: string;
  action: Side;
  entryState: EntryState;
  confidence: number;
  entry: number;
  sl: number;
  tp: [number, number, number, number];
  bias: "Bullish" | "Bearish" | "Flat";
  trendZone: string;
  note: string;
  votes: Vote[];
  indicators: {
    emaFast: number;
    emaSlow: number;
    ema200: number;
    vwapSession: number;
    vwapWeekly: number;
    vwapMonthly: number;
    atr: number;
    rsi: number;
  };
  backtest: {
    trades: number;
    wins: number;
    winRate: number;
    netR: number;
  };
  series: { t: number; c: number; v: number }[];
  error: string | null;
};

export type AnalyzeInput = {
  pairs: string[];
  timeframe: Timeframe;
  strategy: StrategyId;
  hybrid: boolean;
  twelveDataKey?: string;
};

export type AnalyzeResult = {
  generatedAt: string;
  timeframe: Timeframe;
  strategy: StrategyId;
  hybrid: boolean;
  results: PairResult[];
};
