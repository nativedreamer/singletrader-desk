import type { Candle, Pair, Timeframe } from "@/lib/market-types";
import { intervalSeconds } from "@/lib/pairs";

const UA = "Mozilla/5.0 (compatible; SingleTrader/1.0)";

function limitFor(tf: Timeframe) {
  if (tf === "5m") return 500;
  if (tf === "4h") return 400;
  return 500;
}

function dropOpen(candles: Candle[], tf: Timeframe): Candle[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  const now = Date.now() / 1000;
  if (last.time + intervalSeconds(tf) > now) return candles.slice(0, -1);
  return candles;
}

function sortUnique(candles: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of candles) {
    if (![c.open, c.high, c.low, c.close, c.time].every(Number.isFinite)) continue;
    if (c.close <= 0) continue;
    map.set(c.time, c);
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function aggregate(candles: Candle[], seconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    const t = Math.floor(c.time / seconds) * seconds;
    const prev = buckets.get(t);
    if (!prev) {
      buckets.set(t, { ...c, time: t });
      continue;
    }
    prev.high = Math.max(prev.high, c.high);
    prev.low = Math.min(prev.low, c.low);
    prev.close = c.close;
    prev.volume += c.volume;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fromBiquote(
  pair: Pair,
  tf: Timeframe,
): Promise<{ candles: Candle[]; live?: number }> {
  const url = `https://biquote.io/api/${pair.biquote}/ohlc?interval=${tf}&limit=${limitFor(tf)}`;
  const json = (await getJson(url)) as { bars?: Array<Record<string, unknown>> };
  const bars = json.bars;
  if (!Array.isArray(bars) || bars.length < 2) throw new Error("empty");
  const candles: Candle[] = [];
  let live: number | undefined;
  for (const b of bars) {
    const close = Number(b.close);
    if (b.isOpen === true) {
      if (Number.isFinite(close) && close > 0) live = close;
      continue;
    }
    const time = Math.floor(new Date(String(b.openTime)).getTime() / 1000);
    candles.push({
      time,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close,
      volume: Number(b.volume) || Number(b.tickVolume) || 1,
    });
  }
  const settled = dropOpen(sortUnique(candles), tf);
  if (live === undefined && settled.length) live = settled[settled.length - 1].close;
  return { candles: settled, live };
}

async function fromBinanceVision(pair: Pair, tf: Timeframe): Promise<Candle[]> {
  if (!pair.binance) throw new Error("no binance symbol");
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${pair.binance}&interval=${tf}&limit=${limitFor(tf)}`;
  const json = (await getJson(url)) as unknown[];
  if (!Array.isArray(json) || json.length < 2) throw new Error("empty");
  const candles = json.map((row) => {
    const item = row as unknown[];
    return {
      time: Math.floor(Number(item[0]) / 1000),
      open: Number(item[1]),
      high: Number(item[2]),
      low: Number(item[3]),
      close: Number(item[4]),
      volume: Number(item[5]) || 1,
    };
  });
  return dropOpen(sortUnique(candles), tf);
}

async function fromCoinbase(pair: Pair, tf: Timeframe): Promise<Candle[]> {
  if (!pair.coinbase) throw new Error("no coinbase symbol");
  const gran = tf === "5m" ? 300 : tf === "15m" ? 900 : 3600;
  const url = `https://api.exchange.coinbase.com/products/${pair.coinbase}/candles?granularity=${gran}`;
  const json = (await getJson(url)) as unknown[];
  if (!Array.isArray(json) || json.length < 2) throw new Error("empty");
  let candles = json.map((row) => {
    const item = row as number[];
    return {
      time: Number(item[0]),
      low: Number(item[1]),
      high: Number(item[2]),
      open: Number(item[3]),
      close: Number(item[4]),
      volume: Number(item[5]) || 1,
    };
  });
  candles = dropOpen(sortUnique(candles), tf === "4h" ? "1h" : tf);
  if (tf === "4h") candles = dropOpen(aggregate(candles, 14400), "4h");
  return candles;
}

function yahooRange(tf: Timeframe) {
  if (tf === "5m") return { interval: "5m", range: "5d" };
  if (tf === "15m") return { interval: "15m", range: "1mo" };
  if (tf === "1h") return { interval: "1h", range: "6mo" };
  return { interval: "1h", range: "1y" };
}

async function fromYahoo(pair: Pair, tf: Timeframe): Promise<Candle[]> {
  if (!pair.yahoo) throw new Error("no yahoo symbol");
  const spec = yahooRange(tf);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair.yahoo)}?interval=${spec.interval}&range=${spec.range}`;
  const json = (await getJson(url)) as {
    chart?: { result?: Array<Record<string, unknown>> };
  };
  const result = json.chart?.result?.[0];
  if (!result) throw new Error("empty");
  const ts = (result.timestamp as number[]) || [];
  const quote = ((result.indicators as { quote?: Array<Record<string, number[]>> })?.quote ||
    [])[0];
  if (!quote || ts.length < 2) throw new Error("empty");
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    if (![open, high, low, close].every((n) => typeof n === "number" && Number.isFinite(n))) {
      continue;
    }
    candles.push({
      time: ts[i],
      open,
      high,
      low,
      close,
      volume: quote.volume?.[i] || 1,
    });
  }
  let sorted = dropOpen(sortUnique(candles), spec.interval === "1h" && tf === "4h" ? "1h" : tf);
  if (tf === "4h") sorted = dropOpen(aggregate(sorted, 14400), "4h");
  return sorted;
}

async function fromTwelve(pair: Pair, tf: Timeframe, key: string): Promise<Candle[]> {
  if (!pair.twelve || key.trim().length < 8) throw new Error("no twelve data key");
  const interval = tf === "5m" ? "5min" : tf === "15m" ? "15min" : tf === "1h" ? "1h" : "4h";
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(pair.twelve)}&interval=${interval}&outputsize=280&apikey=${encodeURIComponent(key.trim())}`;
  const json = (await getJson(url)) as { values?: Array<Record<string, string>>; status?: string };
  if (!Array.isArray(json.values) || json.values.length < 2) throw new Error("empty");
  const candles = json.values.map((v) => ({
    time: Math.floor(new Date(v.datetime).getTime() / 1000),
    open: Number(v.open),
    high: Number(v.high),
    low: Number(v.low),
    close: Number(v.close),
    volume: Number(v.volume) || 1,
  }));
  return dropOpen(sortUnique(candles), tf);
}

function mergeCandles(base: Candle[], extra: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const candle of base) map.set(candle.time, candle);
  for (const candle of extra) map.set(candle.time, candle);
  return [...map.values()].sort((a, b) => a.time - b.time);
}

const cache = new Map<string, { at: number; candles: Candle[]; source: string; price: number }>();
const TTL = 45_000;

export async function loadCandles(
  pair: Pair,
  tf: Timeframe,
  twelveDataKey?: string,
): Promise<{ candles: Candle[]; source: string; price: number }> {
  const cacheKey = `${pair.id}:${tf}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL) {
    return { candles: hit.candles, source: hit.source, price: hit.price };
  }

  const attempts: Array<{ name: string; run: () => Promise<{ candles: Candle[]; live?: number }> }> = [
    { name: "Biquote", run: () => fromBiquote(pair, tf) },
    { name: "Yahoo Finance", run: async () => ({ candles: await fromYahoo(pair, tf) }) },
  ];
  if (pair.klass === "crypto") {
    attempts.push(
      { name: "Binance Vision", run: async () => ({ candles: await fromBinanceVision(pair, tf) }) },
      { name: "Coinbase", run: async () => ({ candles: await fromCoinbase(pair, tf) }) },
    );
  }
  if (twelveDataKey && twelveDataKey.trim().length >= 8) {
    attempts.push({
      name: "Twelve Data",
      run: async () => ({ candles: await fromTwelve(pair, tf, twelveDataKey) }),
    });
  }

  const settled = await Promise.all(
    attempts.map(async (attempt) => {
      try {
        const result = await attempt.run();
        if (result.candles.length < 60) return null;
        return { name: attempt.name, candles: result.candles, live: result.live };
      } catch {
        return null;
      }
    }),
  );
  const ok = settled.filter(
    (row): row is { name: string; candles: Candle[]; live: number | undefined } => row !== null,
  );
  if (ok.length === 0) {
    throw new Error("No free feed returned enough candles");
  }

  const ranked = [...ok].sort((a, b) => b.candles.length - a.candles.length);
  const deep = ranked.find((row) => row.candles.length >= 260) ?? ranked[0];
  const liveFeed = ok.find((row) => row.name === "Biquote");
  const candles =
    liveFeed && liveFeed.name !== deep.name
      ? mergeCandles(deep.candles, liveFeed.candles)
      : deep.candles;
  const source = liveFeed && liveFeed.name !== deep.name ? `${deep.name} + Biquote` : deep.name;
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const price = liveFeed?.live && liveFeed.live > 0 ? liveFeed.live : lastClose;

  cache.set(cacheKey, { at: Date.now(), candles, source, price });
  return { candles, source, price };
}
