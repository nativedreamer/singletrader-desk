import type { Candle, GroupScore, ScriptRead, Side, Timeframe } from "@/lib/market-types";
import { anchoredVwap, atr, ema, hma, roundPx, rsi, supertrend } from "@/lib/indicators";
import { runLeo } from "@/lib/strategies";

type Dir = -1 | 0 | 1;

const GROUPS: GroupScore[] = [
  { id: "direction", label: "Direction", weight: 30, score: 0 },
  { id: "trigger", label: "Trigger", weight: 25, score: 0 },
  { id: "structure", label: "Structure", weight: 20, score: 0 },
  { id: "higher", label: "Higher timeframe", weight: 15, score: 0 },
  { id: "participation", label: "Participation", weight: 10, score: 0 },
];

export type ConfluenceRead = {
  action: Side;
  entryState: "live" | "passed" | "flat";
  entry: number;
  sl: number;
  tp: [number, number, number, number];
  bias: "Bullish" | "Bearish" | "Flat";
  trendZone: string;
  note: string;
  score: number;
  stars: number;
  starCap: number | null;
  agree: number;
  regime: number;
  reversal: Dir;
  scripts: ScriptRead[];
  groups: GroupScore[];
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
};

function sma(data: number[], length: number): number[] {
  const out = new Array<number>(data.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= length) sum -= data[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

function stdev(data: number[], length: number): number[] {
  const out = new Array<number>(data.length).fill(NaN);
  for (let i = length - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < length; j++) sum += data[i - j];
    const mean = sum / length;
    let acc = 0;
    for (let j = 0; j < length; j++) {
      const d = data[i - j] - mean;
      acc += d * d;
    }
    out[i] = Math.sqrt(acc / length);
  }
  return out;
}

function alma(data: number[], length: number, offset = 0.85, sigma = 6): number[] {
  const out = new Array<number>(data.length).fill(NaN);
  const m = offset * (length - 1);
  const s = length / sigma;
  const weights: number[] = [];
  let den = 0;
  for (let k = 0; k < length; k++) {
    const weight = Math.exp(-((k - m) * (k - m)) / (2 * s * s));
    weights.push(weight);
    den += weight;
  }
  for (let i = length - 1; i < data.length; i++) {
    let num = 0;
    for (let k = 0; k < length; k++) num += weights[k] * data[i - (length - 1 - k)];
    out[i] = num / den;
  }
  return out;
}

function mean(votes: number[]): number {
  const live = votes.filter((v) => v !== 0);
  if (!live.length) return 0;
  return live.reduce((sum, v) => sum + v, 0) / live.length;
}

function emaReady(data: number[], length: number): number[] {
  const first = data.findIndex((v) => Number.isFinite(v));
  const out = new Array<number>(data.length).fill(NaN);
  if (first < 0) return out;
  const sliced = data.slice(first).map((v) => (Number.isFinite(v) ? v : 0));
  const smooth = ema(sliced, length);
  for (let i = 0; i < smooth.length; i++) out[first + i] = smooth[i];
  return out;
}

function asDir(n: number): Dir {
  if (!Number.isFinite(n) || n === 0) return 0;
  return n > 0 ? 1 : -1;
}

function htfSize(tf: Timeframe): number {
  if (tf === "5m") return 12;
  if (tf === "15m") return 4;
  if (tf === "1h") return 4;
  return 6;
}

function fold(candles: Candle[], size: number): Candle[] {
  if (size <= 1 || candles.length < size * 2) return candles;
  const out: Candle[] = [];
  const start = candles.length % size;
  for (let i = start; i + size <= candles.length; i += size) {
    const slice = candles.slice(i, i + size);
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const c of slice) {
      high = Math.max(high, c.high);
      low = Math.min(low, c.low);
      volume += c.volume;
    }
    const last = slice[slice.length - 1];
    out.push({
      time: slice[0].time,
      open: slice[0].open,
      high,
      low,
      close: last.close,
      volume,
    });
  }
  return out;
}

function pivotHigh(candles: Candle[], len: number, i: number): number | null {
  const p = i - len;
  if (p < len || p >= candles.length) return null;
  const h = candles[p].high;
  for (let j = p - len; j <= p + len; j++) {
    if (j !== p && candles[j].high >= h) return null;
  }
  return h;
}

function pivotLow(candles: Candle[], len: number, i: number): number | null {
  const p = i - len;
  if (p < len || p >= candles.length) return null;
  const l = candles[p].low;
  for (let j = p - len; j <= p + len; j++) {
    if (j !== p && candles[j].low <= l) return null;
  }
  return l;
}

function rangeTrend(candles: Candle[], len: number, mult: number): Dir {
  const ranges = candles.map((c) => c.high - c.low);
  const basis = sma(ranges, len);
  let trend: Dir = 1;
  let stop = NaN;
  for (let i = len; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const upper = hl2 + mult * basis[i];
    const lower = hl2 - mult * basis[i];
    const prev = stop;
    if (!Number.isFinite(prev)) {
      stop = lower;
      trend = 1;
      continue;
    }
    if (trend === 1) {
      stop = Math.max(lower, prev);
      if (candles[i].close < prev) {
        trend = -1;
        stop = upper;
      }
    } else {
      stop = Math.min(upper, prev);
      if (candles[i].close > prev) {
        trend = 1;
        stop = lower;
      }
    }
  }
  return trend;
}

function heikin(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const close = (c.open + c.high + c.low + c.close) / 4;
    const prev = out[out.length - 1];
    const open = prev ? (prev.open + prev.close) / 2 : (c.open + c.close) / 2;
    out.push({
      time: c.time,
      open,
      close,
      high: Math.max(c.high, open, close),
      low: Math.min(c.low, open, close),
      volume: c.volume,
    });
  }
  return out;
}

function trailingSide(candles: Candle[], atrLen: number, key: number): { side: Dir; flip: number } {
  const atrs = atr(candles, atrLen);
  let stop = NaN;
  let side: Dir = 0;
  let flip = -1;
  for (let i = atrLen; i < candles.length; i++) {
    const src = candles[i].close;
    const prev = candles[i - 1].close;
    const dist = atrs[i] * key;
    const prevStop = stop;
    if (!Number.isFinite(prevStop) || !Number.isFinite(dist)) {
      stop = src;
      continue;
    }
    if (src > prevStop && prev > prevStop) stop = Math.max(prevStop, src - dist);
    else if (src < prevStop && prev < prevStop) stop = Math.min(prevStop, src + dist);
    else if (src > prevStop) stop = src - dist;
    else stop = src + dist;
    const next: Dir = src > stop ? 1 : src < stop ? -1 : 0;
    if (next !== 0 && side !== 0 && next !== side) flip = i;
    if (next !== 0) side = next;
  }
  return { side, flip };
}

function crossState(fast: number[], slow: number[]): { side: Dir; flip: number } {
  let side: Dir = 0;
  let flip = -1;
  for (let i = 1; i < fast.length; i++) {
    if (![fast[i], slow[i], fast[i - 1], slow[i - 1]].every(Number.isFinite)) continue;
    if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) {
      side = 1;
      flip = i;
    } else if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) {
      side = -1;
      flip = i;
    }
  }
  return { side, flip };
}

function vwcSide(closes: number[]): Dir {
  const basis = emaReady(alma(closes, 34), 3);
  const mean20 = sma(closes, 20);
  const madRaw = closes.map((v, i) =>
    Number.isFinite(mean20[i]) ? Math.abs(v - mean20[i]) : NaN,
  );
  const vol = emaReady(
    sma(madRaw.map((v) => (Number.isFinite(v) ? v : 0)), 20).map((v) => (Number.isFinite(v) ? v * 1.4826 : 0)),
    5,
  );
  let side: Dir = 0;
  for (let i = 100; i < closes.length; i++) {
    if (!Number.isFinite(basis[i]) || !Number.isFinite(vol[i])) continue;
    let le = 0;
    let n = 0;
    for (let j = i - 99; j <= i; j++) {
      if (!Number.isFinite(vol[j])) continue;
      n += 1;
      if (vol[j] <= vol[i]) le += 1;
    }
    const rank = n ? le / n : 0.5;
    const mult = 0.8 + rank;
    const upper = basis[i] + vol[i] * mult;
    const lower = basis[i] - vol[i] * mult;
    const prev = closes[i - 1];
    if (prev <= upper && closes[i] > upper) side = 1;
    else if (prev >= lower && closes[i] < lower) side = -1;
    else if (side === 0) side = closes[i] >= basis[i] ? 1 : -1;
  }
  return side;
}

function mrBands(closes: number[], candles: Candle[]): { side: Dir; flip: number } {
  const fast = ema(closes, 9);
  let side: Dir = 0;
  let flip = -1;
  const vel = fast.map((v, i) => (i > 0 && Number.isFinite(v) && Number.isFinite(fast[i - 1]) ? v - fast[i - 1] : NaN));
  const base = sma(vel.map((v) => (Number.isFinite(v) ? v : 0)), 14);
  const sig = stdev(vel.map((v) => (Number.isFinite(v) ? v : 0)), 14);
  for (let i = 20; i < candles.length; i++) {
    if (!Number.isFinite(vel[i]) || !Number.isFinite(sig[i])) continue;
    const lower = base[i] - 1.618 * sig[i];
    const upper = base[i] + 1.618 * sig[i];
    const prev = vel[i - 1];
    const c = candles[i];
    if (prev < lower && vel[i] > lower && c.close > c.open) {
      side = 1;
      flip = i;
    } else if (prev > upper && vel[i] < upper && c.close < c.open) {
      side = -1;
      flip = i;
    }
  }
  return { side, flip };
}

function mrSlope(candles: Candle[]): { side: Dir; flip: number } {
  const atrs = atr(candles, 10);
  let side: Dir = 0;
  let flip = -1;
  for (let i = 12; i < candles.length; i++) {
    const a = atrs[i];
    if (!Number.isFinite(a) || a === 0) continue;
    const slope = (candles[i].close - candles[i - 4].close) / 4 / a;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - 8; j < i; j++) {
      hh = Math.max(hh, candles[j].high);
      ll = Math.min(ll, candles[j].low);
    }
    const c = candles[i];
    if (slope > 0.4 && c.close > hh - a * 0.2 && c.close > c.open) {
      side = 1;
      flip = i;
    } else if (slope < -0.4 && c.close < ll + a * 0.2 && c.close < c.open) {
      side = -1;
      flip = i;
    }
  }
  return { side, flip };
}

function volOsc(closes: number[], volumes: number[]): Dir {
  const pv = closes.map((c, i) => c * (volumes[i] > 0 ? volumes[i] : 1));
  const vol = volumes.map((v) => (v > 0 ? v : 1));
  const num = ema(pv, 21);
  const den = ema(vol, 21);
  const diff = closes.map((c, i) =>
    Number.isFinite(num[i]) && den[i] ? ((c - num[i] / den[i]) / (num[i] / den[i])) * 100 : NaN,
  );
  const sig = stdev(diff.map((v) => (Number.isFinite(v) ? v : 0)), 20);
  const i = closes.length - 1;
  if (!Number.isFinite(diff[i]) || !Number.isFinite(sig[i])) return 0;
  const band = Math.max(sig[i] * 1.2, 0.05);
  if (diff[i] > band) return 1;
  if (diff[i] < -band) return -1;
  return 0;
}

function cocoSide(closes: number[]): Dir {
  const a = ema(closes, 4);
  const b = ema(closes, 9);
  const c = ema(closes, 18);
  const i = closes.length - 1;
  if (![a[i], b[i], c[i]].every(Number.isFinite)) return 0;
  if (a[i] >= b[i] && b[i] > c[i]) return 1;
  if (a[i] < b[i] && b[i] < c[i]) return -1;
  return 0;
}

function apexCloud(candles: Candle[], closes: number[]): Dir {
  const base = hma(closes, 55);
  const atrs = atr(candles, 55);
  let trend: Dir = 0;
  for (let i = 60; i < candles.length; i++) {
    if (!Number.isFinite(base[i]) || !Number.isFinite(atrs[i])) continue;
    const upper = base[i] + atrs[i] * 1.5;
    const lower = base[i] - atrs[i] * 1.5;
    if (candles[i].close > upper) trend = 1;
    else if (candles[i].close < lower) trend = -1;
  }
  return trend;
}

function structureBreak(candles: Candle[], len = 8): Dir {
  let lastHigh = NaN;
  let lastLow = NaN;
  let dir: Dir = 0;
  for (let i = len * 2; i < candles.length; i++) {
    const hi = pivotHigh(candles, len, i);
    const lo = pivotLow(candles, len, i);
    if (hi !== null) lastHigh = hi;
    if (lo !== null) lastLow = lo;
    const c = candles[i];
    if (Number.isFinite(lastHigh) && c.close > lastHigh && c.close > c.open) dir = 1;
    else if (Number.isFinite(lastLow) && c.close < lastLow && c.close < c.open) dir = -1;
  }
  return dir;
}

function smcSide(candles: Candle[]): Dir {
  const atrs = atr(candles, 14);
  let vote: Dir = 0;
  for (let i = 2; i < candles.length; i++) {
    const prev = candles[i - 1];
    const c = candles[i];
    const a = atrs[i];
    if (!Number.isFinite(a) || a <= 0) continue;
    if (prev.close < prev.open && c.close > prev.high && c.close - c.open > a * 0.5) vote = 1;
    else if (prev.close > prev.open && c.close < prev.low && c.open - c.close > a * 0.5) vote = -1;
  }
  return vote;
}

function breakerSide(candles: Candle[]): Dir {
  const atrs = atr(candles, 14);
  let top = NaN;
  let bot = NaN;
  let kind: Dir = 0;
  let vote: Dir = 0;
  for (let i = 2; i < candles.length; i++) {
    const prev = candles[i - 1];
    const c = candles[i];
    const a = atrs[i];
    if (Number.isFinite(a) && prev.close < prev.open && c.close > prev.high && c.close - c.open > a * 0.5) {
      top = prev.high;
      bot = prev.low;
      kind = 1;
    } else if (Number.isFinite(a) && prev.close > prev.open && c.close < prev.low && c.open - c.close > a * 0.5) {
      top = prev.high;
      bot = prev.low;
      kind = -1;
    }
    if (!Number.isFinite(top) || kind === 0) continue;
    if (kind === 1 && c.close < bot) {
      kind = -1;
      vote = -1;
    } else if (kind === -1 && c.close > top) {
      kind = 1;
      vote = 1;
    }
  }
  return vote;
}

function zoneSide(candles: Candle[], len: number): Dir {
  let hi = NaN;
  let lo = NaN;
  for (let i = len * 2; i < candles.length; i++) {
    const ph = pivotHigh(candles, len, i);
    const pl = pivotLow(candles, len, i);
    if (ph !== null) hi = ph;
    if (pl !== null) lo = pl;
  }
  const c = candles[candles.length - 1];
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo) return 0;
  if (c.close > hi) return 1;
  if (c.close < lo) return -1;
  const pos = (c.close - lo) / (hi - lo);
  if (pos < 0.35 && c.close >= c.open) return 1;
  if (pos > 0.65 && c.close <= c.open) return -1;
  return 0;
}

function goldSide(candles: Candle[]): Dir {
  let hi = NaN;
  let lo = NaN;
  const len = 5;
  for (let i = len * 2; i < candles.length; i++) {
    const p = i - len;
    if (p < len) continue;
    const px = candles[p].close;
    let isHigh = true;
    let isLow = true;
    for (let j = p - len; j <= p + len; j++) {
      if (j === p) continue;
      if (candles[j].close >= px) isHigh = false;
      if (candles[j].close <= px) isLow = false;
    }
    if (isHigh) hi = px;
    if (isLow) lo = px;
  }
  const c = candles[candles.length - 1].close;
  if (Number.isFinite(hi) && c > hi) return 1;
  if (Number.isFinite(lo) && c < lo) return -1;
  return 0;
}

function levelMap(candles: Candle[], len: number): Dir {
  let hi = NaN;
  let lo = NaN;
  for (let i = len * 2; i < candles.length; i++) {
    const ph = pivotHigh(candles, len, i);
    const pl = pivotLow(candles, len, i);
    if (ph !== null) hi = ph;
    if (pl !== null) lo = pl;
  }
  const c = candles[candles.length - 1].close;
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return 0;
  const up = Math.abs(hi - c);
  const down = Math.abs(c - lo);
  if (c > hi) return 1;
  if (c < lo) return -1;
  if (down < up) return 1;
  if (up < down) return -1;
  return 0;
}

function pressure(candles: Candle[], len = 20): Dir {
  let buy = 0;
  let sell = 0;
  const start = Math.max(0, candles.length - len);
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const rng = c.high - c.low;
    const vol = c.volume > 0 ? c.volume : 1;
    if (rng <= 0) continue;
    const b = (vol * (c.close - c.low)) / rng;
    buy += b;
    sell += vol - b;
  }
  const tot = buy + sell;
  if (!tot) return 0;
  const ratio = (buy - sell) / tot;
  if (ratio > 0.08) return 1;
  if (ratio < -0.08) return -1;
  return 0;
}

function volumeSide(candles: Candle[]): Dir {
  const vols = candles.map((c) => (c.volume > 0 ? c.volume : 1));
  const avg = sma(vols, 20);
  const i = candles.length - 1;
  const c = candles[i];
  if (!Number.isFinite(avg[i]) || vols[i] <= avg[i]) return 0;
  if (c.close > c.open) return 1;
  if (c.close < c.open) return -1;
  return 0;
}

function adxLast(candles: Candle[], len = 14): number {
  const n = candles.length;
  if (n < len * 2 + 2) return 22;
  const tr = new Array<number>(n).fill(0);
  const plus = new Array<number>(n).fill(0);
  const minus = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plus[i] = up > down && up > 0 ? up : 0;
    minus[i] = down > up && down > 0 ? down : 0;
    const prev = candles[i - 1].close;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prev),
      Math.abs(candles[i].low - prev),
    );
  }
  const wilder = (src: number[]) => {
    const out = new Array<number>(n).fill(NaN);
    let sum = 0;
    for (let i = 1; i <= len; i++) sum += src[i];
    out[len] = sum;
    for (let i = len + 1; i < n; i++) out[i] = out[i - 1] - out[i - 1] / len + src[i];
    return out;
  };
  const trs = wilder(tr);
  const pd = wilder(plus);
  const md = wilder(minus);
  const dx = new Array<number>(n).fill(NaN);
  for (let i = len; i < n; i++) {
    if (!trs[i]) continue;
    const p = (100 * pd[i]) / trs[i];
    const m = (100 * md[i]) / trs[i];
    const s = p + m;
    dx[i] = s === 0 ? 0 : (100 * Math.abs(p - m)) / s;
  }
  let value = 0;
  let count = 0;
  const start = len * 2;
  for (let i = len; i < Math.min(start, n); i++) {
    if (Number.isFinite(dx[i])) {
      value += dx[i];
      count += 1;
    }
  }
  if (!count) return 22;
  value /= count;
  for (let i = start; i < n; i++) {
    if (!Number.isFinite(dx[i])) continue;
    value = (value * (len - 1) + dx[i]) / len;
  }
  return value;
}

function atrRegime(candles: Candle[]): number {
  const atrs = atr(candles, 14);
  const avg = sma(atrs.map((v) => (Number.isFinite(v) ? v : 0)), 50);
  const i = candles.length - 1;
  if (!Number.isFinite(atrs[i]) || !Number.isFinite(avg[i]) || avg[i] === 0) return 1;
  return atrs[i] < avg[i] * 0.8 ? 0.8 : 1;
}

function reversalSide(candles: Candle[]): Dir {
  const len = 20;
  let side: Dir = 0;
  let at = -1;
  for (let i = len * 2; i < candles.length; i++) {
    const ph = pivotHigh(candles, len, i);
    const pl = pivotLow(candles, len, i);
    const c = candles[i];
    const rng = c.high - c.low;
    if (rng <= 0) continue;
    const upWick = (c.high - Math.max(c.open, c.close)) / rng;
    const dnWick = (Math.min(c.open, c.close) - c.low) / rng;
    if (ph !== null && i > 0) {
      /* pivot is confirmed later; compare live sweeps against the stored swing below */
    }
    if (upWick >= 0.2) {
      let swing = -Infinity;
      for (let j = Math.max(0, i - len); j < i; j++) swing = Math.max(swing, candles[j].high);
      if (c.high > swing && c.close < swing) {
        side = -1;
        at = i;
      }
    }
    if (dnWick >= 0.2) {
      let swing = Infinity;
      for (let j = Math.max(0, i - len); j < i; j++) swing = Math.min(swing, candles[j].low);
      if (c.low < swing && c.close > swing) {
        side = 1;
        at = i;
      }
    }
  }
  if (at < 0 || candles.length - 1 - at > 20) return 0;
  return side;
}

function starsFor(abs: number): number {
  if (abs < 12) return 0;
  if (abs < 28) return 1;
  if (abs < 44) return 2;
  if (abs < 60) return 3;
  if (abs < 76) return 4;
  return 5;
}

function blank(note: string): ConfluenceRead {
  return {
    action: "HOLD",
    entryState: "flat",
    entry: 0,
    sl: 0,
    tp: [0, 0, 0, 0],
    bias: "Flat",
    trendZone: "Warming up",
    note,
    score: 0,
    stars: 0,
    starCap: null,
    agree: 0,
    regime: 1,
    reversal: 0,
    scripts: [],
    groups: GROUPS.map((g) => ({ ...g })),
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
  };
}

export function scoreConfluence(candles: Candle[], livePrice: number, timeframe: Timeframe): ConfluenceRead {
  if (candles.length < 80) return blank("Not enough closed bars to weight the twenty scripts.");

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const last = candles.length - 1;
  const ema11 = ema(closes, 11);
  const ema34 = ema(closes, 34);
  const ema10 = ema(closes, 10);
  const ema30 = ema(closes, 30);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const vwapS = anchoredVwap(candles, "session");
  const vwapW = anchoredVwap(candles, "week");
  const vwapM = anchoredVwap(candles, "month");

  const nayrafa = asDir(supertrend(candles, 5, 15).dir[last]);
  const volTrend = rangeTrend(candles, 50, 3.5);
  const apex = apexCloud(candles, closes);
  const mind = asDir(supertrend(heikin(candles), 3.22, 14).dir[last]);
  const vwc = vwcSide(closes);
  const emaState = asDir(
    Number.isFinite(vwapS[last]) && Number.isFinite(ema200[last]) ? vwapS[last] - ema200[last] : 0,
  );
  const nalas = asDir(
    Number.isFinite(ema10[last]) && Number.isFinite(ema30[last]) ? ema10[last] - ema30[last] : 0,
  );

  const ut = trailingSide(candles, 10, 1);
  const garbage = asDir(supertrend(candles, 4, 11).dir[last]);
  let garbageFlip = -1;
  const gdir = supertrend(candles, 4, 11).dir;
  for (let i = 1; i < gdir.length; i++) {
    if (gdir[i] !== 0 && gdir[i - 1] !== 0 && gdir[i] !== gdir[i - 1]) garbageFlip = i;
  }
  const leoRun = runLeo(candles);
  const leo: Dir = leoRun.action === "BUY" ? 1 : leoRun.action === "SELL" ? -1 : 0;
  const bands = mrBands(closes, candles);
  const slope = mrSlope(candles);
  const osc = volOsc(closes, volumes);
  const coco = cocoSide(closes);
  const cross = crossState(ema11, ema34);

  const brk = structureBreak(candles, 8);
  const smc = smcSide(candles);
  const snr = zoneSide(candles, 10);
  const breakers = breakerSide(candles);
  const gold = goldSide(candles);
  const apexLevels = levelMap(candles, 8);
  const garbageLevels = levelMap(candles, 12);

  const higher = fold(candles, htfSize(timeframe));
  const htfUt = higher.length > 40 ? trailingSide(higher, 10, 1).side : 0;
  const htfBrk = higher.length > 40 ? structureBreak(higher, 5) : 0;
  const htfMind = higher.length > 40 ? asDir(supertrend(heikin(higher), 3.22, 14).dir[higher.length - 1]) : 0;
  const px = closes[last];
  const vwapAlign: Dir =
    Number.isFinite(vwapW[last]) && Number.isFinite(vwapM[last])
      ? px > vwapW[last] && px > vwapM[last]
        ? 1
        : px < vwapW[last] && px < vwapM[last]
          ? -1
          : 0
      : 0;

  const partPressure = pressure(candles);
  const partVolume = volumeSide(candles);

  const scripts: ScriptRead[] = [
    { id: "nayrafa", name: "Nayrafa", group: "direction", vote: nayrafa },
    { id: "vol-trend", name: "Volume-Trend OB", group: "direction", vote: volTrend },
    { id: "apex", name: "Apex", group: "direction", vote: apex },
    { id: "marketmind", name: "MarketMind", group: "direction", vote: mind },
    { id: "vwc", name: "VWC", group: "direction", vote: vwc },
    { id: "ema-vwap", name: "EMA VWAP state", group: "direction", vote: emaState },
    { id: "nalas", name: "NALAS EMA state", group: "direction", vote: nalas },
    { id: "ut", name: "UT Bot", group: "trigger", vote: ut.side },
    { id: "garbage", name: "Garbage Algo", group: "trigger", vote: garbage },
    { id: "leo", name: "Leo 2:1", group: "trigger", vote: leo },
    { id: "mr-bands", name: "MR Mt4 bands", group: "trigger", vote: bands.side },
    { id: "mr-slope", name: "MR Mt4 slope", group: "trigger", vote: slope.side },
    { id: "vol-osc", name: "Volume MAs", group: "trigger", vote: osc },
    { id: "coco", name: "COCO+", group: "trigger", vote: coco },
    { id: "ema-cross", name: "EMA 11/34", group: "trigger", vote: cross.side },
    { id: "sbreak", name: "Sbreakout", group: "structure", vote: brk },
    { id: "smc", name: "SMC OB", group: "structure", vote: smc },
    { id: "snr", name: "S&R zones", group: "structure", vote: snr },
    { id: "breakers", name: "Breaker Blocks", group: "structure", vote: breakers },
    { id: "gold", name: "GOLD SNR", group: "structure", vote: gold },
  ];

  const direction = mean([nayrafa, volTrend, apex, mind, vwc, emaState, nalas]);
  const trigger = mean([ut.side, garbage, leo, bands.side, slope.side, osc, coco, cross.side]);
  const structure = mean([brk, smc, snr, breakers, gold, apexLevels, garbageLevels]);
  const higherScore = mean([htfUt, htfBrk, htfMind, vwapAlign]);
  const participation = mean([partPressure, partVolume]);

  const raw = 0.3 * direction + 0.25 * trigger + 0.2 * structure + 0.15 * higherScore + 0.1 * participation;
  const adx = adxLast(candles, 14);
  let regime = adx < 18 ? 0.45 : adx < 22 ? 0.65 : adx < 28 ? 0.85 : 1;
  regime = Math.max(0.35, Math.min(1, regime * atrRegime(candles)));
  const score = Math.max(-100, Math.min(100, Math.round(raw * regime * 100)));
  const action: Side = score >= 12 ? "BUY" : score <= -12 ? "SELL" : "HOLD";
  const dir: Dir = action === "BUY" ? 1 : action === "SELL" ? -1 : 0;
  const agree = dir === 0 ? 0 : scripts.filter((s) => s.vote === dir).length;

  const reversal = reversalSide(candles);
  let stars = starsFor(Math.abs(score));
  let starCap: number | null = null;
  if (dir !== 0 && reversal !== 0 && reversal !== dir) {
    starCap = 2;
    stars = Math.min(stars, 2);
  }

  const groups: GroupScore[] = [
    { id: "direction", label: "Direction", weight: 30, score: Math.round(direction * 100) },
    { id: "trigger", label: "Trigger", weight: 25, score: Math.round(trigger * 100) },
    { id: "structure", label: "Structure", weight: 20, score: Math.round(structure * 100) },
    { id: "higher", label: "Higher timeframe", weight: 15, score: Math.round(higherScore * 100) },
    { id: "participation", label: "Participation", weight: 10, score: Math.round(participation * 100) },
  ];

  const atrNow = Number.isFinite(atr14[last]) ? atr14[last] : 0;
  let entry = 0;
  let entryState: ConfluenceRead["entryState"] = "flat";
  let sl = 0;
  let tp: [number, number, number, number] = [0, 0, 0, 0];
  if (dir !== 0) {
    const flips = [
      { i: ut.flip, side: ut.side },
      { i: garbageFlip, side: garbage },
      { i: bands.flip, side: bands.side },
      { i: slope.flip, side: slope.side },
      { i: cross.flip, side: cross.side },
    ].filter((item) => item.i >= 0 && item.side === dir);
    const flip = flips.length ? Math.max(...flips.map((item) => item.i)) : last;
    entry = roundPx(candles[flip].close);
    const risk = atrNow * 2.2 || Math.abs(entry) * 0.004;
    sl = roundPx(entry - dir * risk);
    tp = [1, 2, 3, 4].map((r) => roundPx(entry + dir * risk * r)) as [number, number, number, number];
    const price = livePrice > 0 ? livePrice : px;
    const slip = Math.max(atrNow * 0.2, Math.abs(entry) * 0.00025);
    const beyond = (price - entry) * dir;
    entryState = beyond > slip ? "passed" : "live";
  }

  const sideWord = action === "BUY" ? "Long" : action === "SELL" ? "Short" : "Flat";
  const capNote = starCap !== null ? " A strong reversal caps the stars." : "";
  const passNote =
    entryState === "passed" ? " Price has already traded through the entry. Stop and targets stay." : "";
  const note =
    action === "HOLD"
      ? `Weighted score ${score}. No side clears the line. Chop multiplier ${regime.toFixed(2)}.`
      : `${sideWord} ${score}. ${agree} of ${scripts.length} scripts agree. Chop multiplier ${regime.toFixed(2)}.${capNote}${passNote}`;

  return {
    action,
    entryState,
    entry,
    sl,
    tp,
    bias: dir === 1 ? "Bullish" : dir === -1 ? "Bearish" : "Flat",
    trendZone: Number.isFinite(ema200[last])
      ? px > ema200[last]
        ? "Price above EMA 200"
        : "Price below EMA 200"
      : "EMA 200 still warming up",
    note,
    score,
    stars,
    starCap,
    agree,
    regime: Math.round(regime * 100) / 100,
    reversal,
    scripts,
    groups,
    indicators: {
      emaFast: roundPx(ema11[last]),
      emaSlow: roundPx(ema34[last]),
      ema200: roundPx(ema200[last]),
      vwapSession: roundPx(vwapS[last]),
      vwapWeekly: roundPx(vwapW[last]),
      vwapMonthly: roundPx(vwapM[last]),
      atr: roundPx(atrNow),
      rsi: Number.isFinite(rsi14[last]) ? Math.round(rsi14[last] * 10) / 10 : 0,
    },
  };
}
