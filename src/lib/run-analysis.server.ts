import type { AnalyzeInput, AnalyzeResult, PairResult } from "@/lib/market-types";
import { barsPerDay, PAIR_MAP } from "@/lib/pairs";
import { anchoredVwap, roundPx } from "@/lib/indicators";
import { loadCandles } from "@/lib/feeds.server";
import { assessEntry, blendHybrid, runEmaVwap, runLeo, toVote } from "@/lib/strategies";

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
  const unique = [...new Set(input.pairs)].filter((id) => PAIR_MAP.has(id)).slice(0, 6);
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
      const emaRun = assessEntry(runEmaVwap(candles), price);
      const leoRun = assessEntry(runLeo(candles), price);
      const chosen = input.hybrid
        ? blendHybrid(emaRun, leoRun)
        : input.strategy === "leo"
          ? leoRun
          : emaRun;
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
        action: chosen.action,
        entryState: chosen.entryState,
        confidence: chosen.confidence,
        entry: chosen.entry,
        sl: chosen.sl,
        tp: chosen.tp,
        bias: chosen.bias,
        trendZone: chosen.trendZone,
        note: chosen.note,
        votes: [toVote("ema_vwap", "EMA VWAP", emaRun), toVote("leo", "Leo 2:1", leoRun)],
        indicators: emaRun.indicators,
        backtest: chosen.backtest,
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
        votes: [],
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
    strategy: input.strategy,
    hybrid: input.hybrid,
    results,
  };
}
