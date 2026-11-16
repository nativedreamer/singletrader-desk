import type { Candle } from "@/lib/market-types";

export function ema(data: number[], length: number): number[] {
  const result = new Array<number>(data.length).fill(NaN);
  if (length < 1 || data.length < length) return result;
  const k = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < length; i++) sum += data[i];
  result[length - 1] = sum / length;
  for (let i = length; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function wma(data: number[], length: number): number[] {
  const result = new Array<number>(data.length).fill(NaN);
  if (data.length < length || length < 1) return result;
  const den = (length * (length + 1)) / 2;
  for (let i = length - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < length; j++) sum += data[i - length + 1 + j] * (j + 1);
    result[i] = sum / den;
  }
  return result;
}

export function hma(data: number[], length: number): number[] {
  const half = Math.max(1, Math.floor(length / 2));
  const sqrt = Math.max(1, Math.floor(Math.sqrt(length)));
  const wmaHalf = wma(data, half);
  const wmaFull = wma(data, length);
  const diff = data.map((_, i) =>
    Number.isFinite(wmaHalf[i]) && Number.isFinite(wmaFull[i])
      ? 2 * wmaHalf[i] - wmaFull[i]
      : NaN,
  );
  const out = new Array<number>(data.length).fill(NaN);
  const den = (sqrt * (sqrt + 1)) / 2;
  for (let i = 0; i < data.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = 0; j < sqrt; j++) {
      const v = diff[i - sqrt + 1 + j];
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      sum += v * (j + 1);
    }
    if (ok) out[i] = sum / den;
  }
  return out;
}

export function atr(candles: Candle[], length: number): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length < length || length < 1) return out;
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) tr.push(c.high - c.low);
    else {
      const prev = candles[i - 1].close;
      tr.push(
        Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)),
      );
    }
  }
  let seed = 0;
  for (let i = 0; i < length; i++) seed += tr[i];
  out[length - 1] = seed / length;
  for (let i = length; i < candles.length; i++) {
    out[i] = (out[i - 1] * (length - 1) + tr[i]) / length;
  }
  return out;
}

export function rsi(data: number[], length = 14): number[] {
  const out = new Array<number>(data.length).fill(NaN);
  if (data.length <= length) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= length; i++) {
    const d = data[i] - data[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / length;
  let avgLoss = losses / length;
  out[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = length + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (length - 1) + g) / length;
    avgLoss = (avgLoss * (length - 1) + l) / length;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(data: number[], fast = 12, slow = 26, signal = 9) {
  const fastE = ema(data, fast);
  const slowE = ema(data, slow);
  const line = data.map((_, i) =>
    Number.isFinite(fastE[i]) && Number.isFinite(slowE[i]) ? fastE[i] - slowE[i] : NaN,
  );
  const signalLine = new Array<number>(data.length).fill(NaN);
  const hist = new Array<number>(data.length).fill(NaN);
  const start = line.findIndex((v) => Number.isFinite(v));
  if (start >= 0) {
    const sliced = line.slice(start).map((v) => (Number.isFinite(v) ? v : 0));
    const sig = ema(sliced, signal);
    for (let i = 0; i < sig.length; i++) {
      signalLine[start + i] = sig[i];
      if (Number.isFinite(line[start + i]) && Number.isFinite(sig[i])) {
        hist[start + i] = line[start + i] - sig[i];
      }
    }
  }
  return { line, signalLine, hist };
}

export function supertrend(candles: Candle[], factor = 5, atrPeriod = 10) {
  const len = candles.length;
  const st = new Array<number>(len).fill(NaN);
  const dir = new Array<number>(len).fill(1);
  const atrs = atr(candles, atrPeriod);
  let prevUpper = NaN;
  let prevLower = NaN;
  let prevSt = NaN;

  for (let i = atrPeriod; i < len; i++) {
    const c = candles[i];
    const prevC = candles[i - 1];
    const hl2 = (c.high + c.low) / 2;
    let upper = hl2 + factor * atrs[i];
    let lower = hl2 - factor * atrs[i];
    if (Number.isFinite(prevLower)) {
      lower = lower > prevLower || prevC.close < prevLower ? lower : prevLower;
    }
    if (Number.isFinite(prevUpper)) {
      upper = upper < prevUpper || prevC.close > prevUpper ? upper : prevUpper;
    }
    let d = 1;
    if (Number.isFinite(prevSt)) {
      if (prevSt === prevUpper) d = c.close > upper ? 1 : -1;
      else d = c.close < lower ? -1 : 1;
    }
    const value = d === 1 ? lower : upper;
    st[i] = value;
    dir[i] = d;
    prevUpper = upper;
    prevLower = lower;
    prevSt = value;
  }
  return { st, dir };
}

export function donchianTrend(candles: Candle[], period = 30): number[] {
  const trend = new Array<number>(candles.length).fill(0);
  let cur = 0;
  for (let i = period; i < candles.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = 1; j <= period; j++) {
      hh = Math.max(hh, candles[i - j].high);
      ll = Math.min(ll, candles[i - j].low);
    }
    if (candles[i].close > hh) cur = 1;
    else if (candles[i].close < ll) cur = -1;
    trend[i] = cur;
  }
  return trend;
}

function dayKey(sec: number) {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function weekKey(sec: number) {
  const d = new Date(sec * 1000);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

function monthKey(sec: number) {
  const d = new Date(sec * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

export function anchoredVwap(
  candles: Candle[],
  anchor: "session" | "week" | "month",
): number[] {
  const keyOf = anchor === "session" ? dayKey : anchor === "week" ? weekKey : monthKey;
  const out = new Array<number>(candles.length).fill(NaN);
  let cumPV = 0;
  let cumV = 0;
  let key = "";
  for (let i = 0; i < candles.length; i++) {
    const next = keyOf(candles[i].time);
    if (next !== key) {
      key = next;
      cumPV = 0;
      cumV = 0;
    }
    const c = candles[i];
    const tp = (c.high + c.low + c.close) / 3;
    const vol = c.volume > 0 ? c.volume : 1;
    cumPV += tp * vol;
    cumV += vol;
    out[i] = cumPV / cumV;
  }
  return out;
}

export function roundPx(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 10 ? 4 : 5;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function formatPx(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 10 ? 4 : 5;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
