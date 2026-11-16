import type { Candle, EntryState, Side, Vote } from "@/lib/market-types";
import {
  anchoredVwap,
  atr,
  clamp,
  donchianTrend,
  ema,
  hma,
  macd,
  roundPx,
  rsi,
  supertrend,
} from "@/lib/indicators";

export type StrategyRun = {
  action: Side;
  entryState: EntryState;
  confidence: number;
  entry: number;
  sl: number;
  tp: [number, number, number, number];
  tpHit: number;
  barsAgo: number;
  note: string;
  backtest: { trades: number; wins: number; winRate: number; netR: number };
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
  bias: "Bullish" | "Bearish" | "Flat";
  trendZone: string;
};

type OpenTrade = {
  dir: 1 | -1;
  entry: number;
  sl: number;
  tp: [number, number, number, number];
  tpHit: number;
  closed: boolean;
  r: number;
  won: boolean;
  openedAt: number;
};

function emptyIndicators(): StrategyRun["indicators"] {
  return {
    emaFast: 0,
    emaSlow: 0,
    ema200: 0,
    vwapSession: 0,
    vwapWeekly: 0,
    vwapMonthly: 0,
    atr: 0,
    rsi: 0,
  };
}

function packBacktest(trades: number, wins: number, netR: number) {
  return {
    trades,
    wins,
    winRate: trades ? Math.round((wins / trades) * 1000) / 10 : 0,
    netR: Math.round(netR * 10) / 10,
  };
}

function manage(trade: OpenTrade, candle: Candle, rPerTp: number[]) {
  if (trade.closed) return;
  const hitSl = trade.dir === 1 ? candle.low <= trade.sl : candle.high >= trade.sl;
  let progressed = false;
  for (let k = trade.tpHit; k < 4; k++) {
    const level = trade.tp[k];
    if (!level) break;
    const hit = trade.dir === 1 ? candle.high >= level : candle.low <= level;
    if (!hit) break;
    trade.tpHit = k + 1;
    trade.r = rPerTp[k];
    trade.won = true;
    progressed = true;
  }
  if (hitSl && !progressed) {
    trade.closed = true;
    if (!trade.won) trade.r = -1;
    return;
  }
  if (trade.tpHit >= 4) trade.closed = true;
}

function settle(trade: OpenTrade, stats: { trades: number; wins: number; netR: number }) {
  if (trade.closed) {
    stats.trades += 1;
    if (trade.won) stats.wins += 1;
    stats.netR += trade.r;
  }
}

/**
 * Ema Vwap Trend Pro (Multi-VWAP), Pine v6.
 * Signal: EMA 11 / EMA 34 cross on a closed bar.
 * Risk: SL = 2.5 × ATR(14). TP1–TP4 = 1.5, 3.0, 4.5, 6.0 × that risk.
 * Context: session, weekly, and monthly VWAP versus EMA 200.
 */
export function runEmaVwap(candles: Candle[]): StrategyRun {
  const blank: StrategyRun = {
    action: "HOLD",
    entryState: "flat",
    confidence: 0,
    entry: 0,
    sl: 0,
    tp: [0, 0, 0, 0],
    tpHit: 0,
    barsAgo: 0,
    note: "Not enough closed bars for EMA VWAP.",
    backtest: packBacktest(0, 0, 0),
    indicators: emptyIndicators(),
    bias: "Flat",
    trendZone: "Warming up",
  };
  if (candles.length < 50) return blank;

  const closes = candles.map((c) => c.close);
  const emaFast = ema(closes, 11);
  const emaSlow = ema(closes, 34);
  const ema200 = ema(closes, 200);
  const atr14 = atr(candles, 14);
  const rsi14 = rsi(closes, 14);
  const vwapS = anchoredVwap(candles, "session");
  const vwapW = anchoredVwap(candles, "week");
  const vwapM = anchoredVwap(candles, "month");

  const slMult = 2.5;
  const tpMult = 1.5;
  const rPerTp = [1.5, 3, 4.5, 6];

  let active: OpenTrade | null = null;
  const stats = { trades: 0, wins: 0, netR: 0 };

  for (let i = 35; i < candles.length; i++) {
    if (active && !active.closed) manage(active, candles[i], rPerTp);
    if (active?.closed) {
      settle(active, stats);
      active = null;
    }

    const prevF = emaFast[i - 1];
    const prevS = emaSlow[i - 1];
    const curF = emaFast[i];
    const curS = emaSlow[i];
    if (![prevF, prevS, curF, curS, atr14[i]].every(Number.isFinite)) continue;

    const crossUp = prevF <= prevS && curF > curS;
    const crossDn = prevF >= prevS && curF < curS;
    if (!crossUp && !crossDn) continue;

    const dir: 1 | -1 = crossUp ? 1 : -1;
    const entry = candles[i].close;
    const risk = atr14[i] * slMult;
    active = {
      dir,
      entry,
      sl: entry - dir * risk,
      tp: [
        entry + dir * risk * tpMult * 1,
        entry + dir * risk * tpMult * 2,
        entry + dir * risk * tpMult * 3,
        entry + dir * risk * tpMult * 4,
      ],
      tpHit: 0,
      closed: false,
      r: 0,
      won: false,
      openedAt: i,
    };
  }

  const i = candles.length - 1;
  const price = closes[i];
  const fast = emaFast[i];
  const slow = emaSlow[i];
  const slow200 = ema200[i];
  const bull = Number.isFinite(fast) && Number.isFinite(slow) && fast > slow;
  const bear = Number.isFinite(fast) && Number.isFinite(slow) && fast < slow;
  const zone = !Number.isFinite(slow200)
    ? "EMA 200 still warming up"
    : vwapS[i] > slow200
      ? "Session VWAP above EMA 200"
      : "Session VWAP below EMA 200";

  let confidence = 46;
  if (bull && vwapS[i] > slow200 && price > vwapS[i]) confidence += 10;
  if (bear && vwapS[i] < slow200 && price < vwapS[i]) confidence += 10;
  if (bull && price > vwapW[i]) confidence += 4;
  if (bear && price < vwapW[i]) confidence += 4;
  if (bull && price > vwapM[i]) confidence += 4;
  if (bear && price < vwapM[i]) confidence += 4;
  if (Number.isFinite(rsi14[i]) && rsi14[i] > 78 && bull) confidence -= 8;
  if (Number.isFinite(rsi14[i]) && rsi14[i] < 22 && bear) confidence -= 8;

  const open = active && !active.closed ? active : null;
  if (open) confidence += 18;

  const indicators = {
    emaFast: roundPx(fast),
    emaSlow: roundPx(slow),
    ema200: roundPx(slow200),
    vwapSession: roundPx(vwapS[i]),
    vwapWeekly: roundPx(vwapW[i]),
    vwapMonthly: roundPx(vwapM[i]),
    atr: roundPx(atr14[i]),
    rsi: Number.isFinite(rsi14[i]) ? Math.round(rsi14[i] * 10) / 10 : 0,
  };

  if (!open) {
    return {
      action: "HOLD",
      entryState: "flat",
      confidence: clamp(Math.round(confidence), 20, 64),
      entry: roundPx(price),
      sl: 0,
      tp: [0, 0, 0, 0],
      tpHit: 0,
      barsAgo: 0,
      note: bull
        ? "Fast EMA is above the slow EMA, but there is no fresh cross."
        : bear
          ? "Fast EMA is below the slow EMA, but there is no fresh cross."
          : "EMAs are tangled. No cross.",
      backtest: packBacktest(stats.trades, stats.wins, stats.netR),
      indicators,
      bias: bull ? "Bullish" : bear ? "Bearish" : "Flat",
      trendZone: zone,
    };
  }

  return {
    action: open.dir === 1 ? "BUY" : "SELL",
    entryState: "live",
    confidence: clamp(Math.round(confidence), 48, 94),
    entry: roundPx(open.entry),
    sl: roundPx(open.sl),
    tp: open.tp.map(roundPx) as [number, number, number, number],
    tpHit: open.tpHit,
    barsAgo: i - open.openedAt,
    note:
      open.tpHit > 0
        ? `EMA 11/34 cross is open. TP${open.tpHit} already tagged.`
        : "EMA 11 crossed EMA 34. Stops sit 2.5× ATR away.",
    backtest: packBacktest(stats.trades, stats.wins, stats.netR),
    indicators,
    bias: open.dir === 1 ? "Bullish" : "Bearish",
    trendZone: zone,
  };
}

/**
 * Leo confirmed confluence from the SingleTrader engine:
 * Supertrend cross plus Donchian, MACD expansion, EMA 150/250, and HMA 55.
 * Stop is 2.2 × ATR(14). Targets are 1R, 2R, 3R, 4R.
 */
export function runLeo(candles: Candle[]): StrategyRun {
  const blank: StrategyRun = {
    action: "HOLD",
    entryState: "flat",
    confidence: 0,
    entry: 0,
    sl: 0,
    tp: [0, 0, 0, 0],
    tpHit: 0,
    barsAgo: 0,
    note: "Not enough history for Leo's slow averages on this timeframe.",
    backtest: packBacktest(0, 0, 0),
    indicators: emptyIndicators(),
    bias: "Flat",
    trendZone: "Warming up",
  };
  if (candles.length < 80) return blank;

  const closes = candles.map((c) => c.close);
  const ema150 = ema(closes, 150);
  const ema200 = ema(closes, 200);
  const ema250 = ema(closes, 250);
  const hma55 = hma(closes, 55);
  const rsi14 = rsi(closes, 14);
  const macdSet = macd(closes, 12, 26, 9);
  const st = supertrend(candles, 5, 10);
  const trend = donchianTrend(candles, 30);
  const atr14 = atr(candles, 14);
  const vwapS = anchoredVwap(candles, "session");

  const rPerTp = [1, 2, 3, 4];
  let active: OpenTrade | null = null;
  const stats = { trades: 0, wins: 0, netR: 0 };
  const start = 60;

  for (let i = start; i < candles.length; i++) {
    if (active && !active.closed) manage(active, candles[i], rPerTp);
    if (active?.closed) {
      settle(active, stats);
      active = null;
    }

    const c = candles[i];
    const prev = candles[i - 1];
    const curSt = st.st[i];
    const prevSt = st.st[i - 1];
    if (!Number.isFinite(curSt) || !Number.isFinite(prevSt) || !Number.isFinite(atr14[i])) {
      continue;
    }

    const crossover = prev.close <= prevSt && c.close > curSt;
    const crossunder = prev.close >= prevSt && c.close < curSt;
    const prevCrossover =
      i >= 2 &&
      Number.isFinite(st.st[i - 2]) &&
      candles[i - 2].close <= st.st[i - 2] &&
      prev.close > prevSt;
    const prevCrossunder =
      i >= 2 &&
      Number.isFinite(st.st[i - 2]) &&
      candles[i - 2].close >= st.st[i - 2] &&
      prev.close < prevSt;

    const curMacd = macdSet.line[i];
    const prevMacd = macdSet.line[i - 1];
    const ready = [ema150[i], ema250[i], hma55[i], hma55[i - 2], curMacd, prevMacd].every(
      Number.isFinite,
    );
    if (!ready) continue;

    const confBull =
      (crossover || (prevCrossover && trend[i - 1] < 0)) &&
      curMacd > 0 &&
      curMacd > prevMacd &&
      ema150[i] > ema250[i] &&
      hma55[i] > hma55[i - 2] &&
      trend[i] > 0;
    const confBear =
      (crossunder || (prevCrossunder && trend[i - 1] > 0)) &&
      curMacd < 0 &&
      curMacd < prevMacd &&
      ema150[i] < ema250[i] &&
      hma55[i] < hma55[i - 2] &&
      trend[i] < 0;

    if (!confBull && !confBear) continue;

    const dir: 1 | -1 = confBull ? 1 : -1;
    const entry = c.close;
    const risk = atr14[i] * 2.2;
    active = {
      dir,
      entry,
      sl: entry - dir * risk,
      tp: [entry + dir * risk, entry + dir * risk * 2, entry + dir * risk * 3, entry + dir * risk * 4],
      tpHit: 0,
      closed: false,
      r: 0,
      won: false,
      openedAt: i,
    };
  }

  const i = candles.length - 1;
  const price = closes[i];
  const bullishStack =
    Number.isFinite(ema150[i]) && Number.isFinite(ema250[i]) && ema150[i] > ema250[i];
  const bearishStack =
    Number.isFinite(ema150[i]) && Number.isFinite(ema250[i]) && ema150[i] < ema250[i];
  const zone = !Number.isFinite(ema200[i])
    ? "EMA 200 still warming up"
    : price > ema200[i]
      ? "Price above EMA 200"
      : "Price below EMA 200";

  const indicators = {
    emaFast: roundPx(ema150[i]),
    emaSlow: roundPx(ema250[i]),
    ema200: roundPx(ema200[i]),
    vwapSession: roundPx(vwapS[i]),
    vwapWeekly: 0,
    vwapMonthly: 0,
    atr: roundPx(atr14[i]),
    rsi: Number.isFinite(rsi14[i]) ? Math.round(rsi14[i] * 10) / 10 : 0,
  };

  const open = active && !active.closed ? active : null;
  let confidence = bullishStack || bearishStack ? 42 : 34;
  if (open) {
    confidence = 74;
    if (open.dir === 1 && price > ema200[i]) confidence += 6;
    if (open.dir === -1 && price < ema200[i]) confidence += 6;
    if (open.dir === 1 && macdSet.hist[i] > 0) confidence += 4;
    if (open.dir === -1 && macdSet.hist[i] < 0) confidence += 4;
  }

  if (!open) {
    const shortHistory = !Number.isFinite(ema250[i]);
    return {
      action: "HOLD",
      entryState: "flat",
      confidence: clamp(Math.round(confidence), 18, 60),
      entry: roundPx(price),
      sl: 0,
      tp: [0, 0, 0, 0],
      tpHit: 0,
      barsAgo: 0,
      note: shortHistory
        ? "Leo needs a longer lookback before the 250 EMA is valid."
        : "Confirmed Supertrend confluence is quiet.",
      backtest: packBacktest(stats.trades, stats.wins, stats.netR),
      indicators,
      bias: bullishStack ? "Bullish" : bearishStack ? "Bearish" : "Flat",
      trendZone: zone,
    };
  }

  return {
    action: open.dir === 1 ? "BUY" : "SELL",
    entryState: "live",
    confidence: clamp(Math.round(confidence), 55, 92),
    entry: roundPx(open.entry),
    sl: roundPx(open.sl),
    tp: open.tp.map(roundPx) as [number, number, number, number],
    tpHit: open.tpHit,
    barsAgo: i - open.openedAt,
    note:
      open.tpHit > 0
        ? `Leo confirmed ${open.dir === 1 ? "long" : "short"}. TP${open.tpHit} tagged.`
        : "Supertrend, Donchian, MACD, and the slow EMAs agree.",
    backtest: packBacktest(stats.trades, stats.wins, stats.netR),
    indicators,
    bias: open.dir === 1 ? "Bullish" : "Bearish",
    trendZone: zone,
  };
}

export function toVote(strategy: Vote["strategy"], name: string, run: StrategyRun): Vote {
  return {
    strategy,
    name,
    action: run.action,
    entryState: run.entryState,
    confidence: run.confidence,
    entry: run.entry,
    sl: run.sl,
    tp: run.tp,
    note: run.note,
  };
}

/** A fill is live only while price has not traded through the entry, and no target is tagged. */
export function assessEntry(run: StrategyRun, livePrice: number): StrategyRun {
  if (run.action === "HOLD" || !run.entry) {
    return { ...run, action: "HOLD", entryState: "flat", tpHit: 0, sl: 0, tp: [0, 0, 0, 0] };
  }
  const dir = run.action === "BUY" ? 1 : -1;
  const slip = Math.max(
    Number.isFinite(run.indicators.atr) ? run.indicators.atr * 0.2 : 0,
    Math.abs(run.entry) * 0.00025,
  );
  const beyond = (livePrice - run.entry) * dir;
  const side = run.action === "BUY" ? "Long" : "Short";
  if (run.tpHit > 0 || beyond > slip) {
    return {
      ...run,
      action: "HOLD",
      entryState: "passed",
      confidence: clamp(Math.round(run.confidence * 0.45), 12, 42),
      sl: 0,
      tp: [0, 0, 0, 0],
      note:
        run.tpHit > 0
          ? `${side} already reached TP${run.tpHit}. That entry is behind the market.`
          : `${side} entry is behind the market. Price has traded through it, so it is not a live fill.`,
    };
  }
  const fresh = run.barsAgo <= 1;
  return {
    ...run,
    entryState: "live",
    note: fresh
      ? `Live ${side.toLowerCase()}. Printed on the last closed bar, and price has not traded through it.`
      : `Live ${side.toLowerCase()}. Price is back at the entry and has not traded through it.`,
  };
}

export function blendHybrid(emaRun: StrategyRun, leoRun: StrategyRun): StrategyRun {
  if (emaRun.entryState === "passed" && leoRun.entryState === "passed") {
    return {
      ...emaRun,
      action: "HOLD",
      entryState: "passed",
      confidence: clamp(Math.round((emaRun.confidence + leoRun.confidence) / 2), 12, 40),
      sl: 0,
      tp: [0, 0, 0, 0],
      note: "Hybrid is on. Both entries have already been traded through.",
      bias: "Flat",
    };
  }
  const agree =
    emaRun.entryState === "live" &&
    leoRun.entryState === "live" &&
    emaRun.action !== "HOLD" &&
    emaRun.action === leoRun.action;
  if (!agree) {
    return {
      ...emaRun,
      action: "HOLD",
      entryState: "flat",
      confidence: clamp(Math.round((emaRun.confidence + leoRun.confidence) / 4), 12, 48),
      sl: 0,
      tp: [0, 0, 0, 0],
      tpHit: 0,
      note: "Hybrid is on. There is no shared live entry.",
      bias: "Flat",
    };
  }
  return {
    ...emaRun,
    action: emaRun.action,
    entryState: "live",
    confidence: clamp(Math.round((emaRun.confidence + leoRun.confidence) / 2 + 8), 60, 96),
    entry: emaRun.entry,
    sl: emaRun.sl,
    tp: emaRun.tp,
    note: `Live hybrid ${emaRun.action === "BUY" ? "long" : "short"}. Both reads agree, and price has not traded through the entry.`,
    bias: emaRun.bias,
    trendZone: emaRun.trendZone,
  };
}
