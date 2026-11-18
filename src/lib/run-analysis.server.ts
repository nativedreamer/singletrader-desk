import type { AnalyzeInput, AnalyzeResult, PairResult } from "@/lib/market-types";
import { barsPerDay, MAX_PAIRS, PAIR_MAP } from "@/lib/pairs";
import { anchoredVwap, roundPx } from "@/lib/indicators";
import { loadCandles } from "@/lib/feeds.server";
import { scoreConfluence } from "@/lib/confluence";

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
  return out;
}

function changePct(closes: number[], tfBars: number) {
  const last = closes[closes.length - 1];
  const prev = closes[Math.max(0, closes.length - 1 - tfBars)];
  if (!prev) return 0;
  return Math.round(((last - prev) / prev) * 10000) / 100;
}

export async function runAnalysis(input: AnalyzeInput): Promise<AnalyzeResult> {
  const unique = [...new Set(input.pairs)].filter((id) => PAIR_MAP.has(id)).slice(0, MAX_PAIRS);
  const results = await mapPool(unique, 3, async (id): Promise<PairResult> => {
    const pair = PAIR_MAP.get(id)!;
    const base = {
      id: pair.id,
      label: pair.label,
      name: pair.name,
      klass: pair.klass,
    };
    try {
      const { candles, source, price } = await loadCandles(pair, input.timeframe, input.twelveDataKey);
      const read = scoreConfluence(candles, price, input.timeframe);
      const closes = candles.map((c) => c.close);
      const vwap = anchoredVwap(candles, "session");
      const window = candles.slice(-140);
      const offset = candles.length - window.length;
      const series = window.map((c, idx) => ({
        t: c.time,
        c: roundPx(c.close),
        v: roundPx(vwap[offset + idx]),
      }));
      const live = roundPx(price);
      if (series.length && series[series.length - 1].c !== live) {
        series.push({ t: Math.floor(Date.now() / 1000), c: live, v: series[series.length - 1].v });
      }

      return {
        ...base,
        price: live,
        changePct: changePct(closes, barsPerDay(input.timeframe)),
        source,
        action: read.action,
        entryState: read.entryState,
        confidence: Math.abs(read.score),
        entry: read.entry,
        sl: read.sl,
        tp: read.tp,
        bias: read.bias,
        trendZone: read.trendZone,
        note: read.note,
        score: read.score,
        stars: read.stars,
        starCap: read.starCap,
        agree: read.agree,
        regime: read.regime,
        reversal: read.reversal,
        scripts: read.scripts,
        groups: read.groups,
        indicators: read.indicators,
        backtest: { trades: 0, wins: 0, winRate: 0, netR: 0 },
        series,
        error: null,
      };
    } catch (err) {
      return {
        ...base,
        price: 0,
        changePct: 0,
        source: "",
        action: "HOLD",
        entryState: "flat",
        confidence: 0,
        entry: 0,
        sl: 0,
        tp: [0, 0, 0, 0],
        bias: "Flat",
        trendZone: "",
        note: "",
        score: 0,
        stars: 0,
        starCap: null,
        agree: 0,
        regime: 1,
        reversal: 0,
        scripts: [],
        groups: [],
        indicators: {
          emaFast: 0,
          emaSlow: 0,
          ema200: 0,
          vwapSession: 0,
          vwapWeekly: 0,
          vwapMonthly: 0,
          atr: 0,
          rsi: 0,
        },
        backtest: { trades: 0, wins: 0, winRate: 0, netR: 0 },
        series: [],
        error: err instanceof Error ? err.message : "Feed failed",
      };
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    timeframe: input.timeframe,
    results,
  };
}
