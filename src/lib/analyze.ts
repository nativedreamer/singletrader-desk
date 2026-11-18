import { createServerFn } from "@tanstack/react-start";
import type { AnalyzeInput, Timeframe } from "@/lib/market-types";
import { MAX_PAIRS, PAIR_MAP } from "@/lib/pairs";
import { runAnalysis } from "@/lib/run-analysis.server";

const TIMEFRAMES = new Set<Timeframe>(["5m", "15m", "1h", "4h"]);

function validate(input: unknown): AnalyzeInput {
  const raw = (input ?? {}) as Partial<AnalyzeInput>;
  const pairs = Array.isArray(raw.pairs)
    ? [...new Set(raw.pairs.map((id) => String(id)))].filter((id) => PAIR_MAP.has(id))
    : [];
  if (pairs.length < 1 || pairs.length > MAX_PAIRS) {
    throw new Error(`Choose between 1 and ${MAX_PAIRS} pairs.`);
  }
  if (!TIMEFRAMES.has(raw.timeframe as Timeframe)) {
    throw new Error("Unknown timeframe.");
  }
  const key = typeof raw.twelveDataKey === "string" ? raw.twelveDataKey.slice(0, 128) : "";
  return {
    pairs,
    timeframe: raw.timeframe as Timeframe,
    twelveDataKey: key,
  };
}

export const analyzeMarkets = createServerFn({ method: "POST" })
  .validator(validate)
  .handler(async ({ data }) => runAnalysis(data));
