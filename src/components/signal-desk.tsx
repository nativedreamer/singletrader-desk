import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as Checkbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { analyzeMarkets } from "@/lib/analyze";
import { formatPct, formatPx } from "@/lib/indicators";
import type { AnalyzeResult, EntryState, PairResult, Side, Timeframe } from "@/lib/market-types";
import { DEFAULT_PAIRS, MAX_PAIRS, PAIRS, PAIR_MAP, TIMEFRAMES } from "@/lib/pairs";
import { MarketChart } from "@/components/market-chart";

const STORAGE = "st.desk.v3";

type Saved = {
  pairs: string[];
  timeframe: Timeframe;
  twelveDataKey: string;
};

function loadSaved(): Partial<Saved> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE);
    return raw ? (JSON.parse(raw) as Partial<Saved>) : null;
  } catch {
    return null;
  }
}

function actionClass(action: string) {
  if (action === "BUY") return "bg-green-soft text-green";
  if (action === "SELL") return "bg-red-soft text-red";
  return "bg-fill text-muted";
}

export function SignalDesk() {
  const run = useServerFn(analyzeMarkets);
  const [pairs, setPairs] = useState<string[]>(DEFAULT_PAIRS);
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [twelveDataKey, setTwelveDataKey] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<AnalyzeResult | null>(null);
  const [focusId, setFocusId] = useState<string>(DEFAULT_PAIRS[0]);

  useEffect(() => {
    const saved = loadSaved();
    if (saved?.pairs) {
      const next = saved.pairs.filter((id) => PAIR_MAP.has(id)).slice(0, MAX_PAIRS);
      if (next.length) {
        setPairs(next);
        setFocusId(next[0]);
      }
    }
    if (saved?.timeframe && TIMEFRAMES.some((t) => t.id === saved.timeframe)) {
      setTimeframe(saved.timeframe);
    }
    if (typeof saved?.twelveDataKey === "string") setTwelveDataKey(saved.twelveDataKey);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload: Saved = { pairs, timeframe, twelveDataKey };
    localStorage.setItem(STORAGE, JSON.stringify(payload));
  }, [hydrated, pairs, timeframe, twelveDataKey]);

  const grouped = useMemo(
    () => [
      { title: "Crypto", items: PAIRS.filter((p) => p.klass === "crypto") },
      { title: "Forex", items: PAIRS.filter((p) => p.klass === "forex") },
      { title: "Metals", items: PAIRS.filter((p) => p.klass === "metal") },
    ],
    [],
  );

  const focus = report?.results.find((r) => r.id === focusId) ?? report?.results[0] ?? null;
  const buckets = useMemo(() => {
    const results = report?.results ?? [];
    return {
      live: results.filter((r) => !r.error && r.entryState === "live"),
      passed: results.filter((r) => !r.error && r.entryState === "passed"),
      quiet: results.filter((r) => r.error || r.entryState === "flat"),
    };
  }, [report]);

  function togglePair(id: string) {
    setNotice(null);
    setPairs((current) => {
      if (current.includes(id)) {
        if (current.length === 1) {
          setNotice("Keep at least one pair so the desk has something to read.");
          return current;
        }
        return current.filter((item) => item !== id);
      }
      if (current.length >= MAX_PAIRS) {
        setNotice(`${MAX_PAIRS} pairs is the cap. Untick one before adding ${PAIR_MAP.get(id)?.label}.`);
        return current;
      }
      return [...current, id];
    });
  }

  async function onAnalyse() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const next = await run({
        data: { pairs, timeframe, twelveDataKey },
      });
      setReport(next);
      const firstTrade = next.results.find((r) => !r.error && r.action !== "HOLD");
      const firstOk = firstTrade ?? next.results.find((r) => !r.error) ?? next.results[0];
      if (firstOk) setFocusId(firstOk.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The desk could not reach the feeds.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 pt-8 pb-16 lg:px-8">
      <header className="mb-8 max-w-xl">
        <div className="flex items-center gap-3">
          <Wheel />
          <div>
            <p className="text-sm font-medium text-muted">Weighted read</p>
            <h1 className="mt-0.5 text-3xl font-semibold tracking-tight">Confluence</h1>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted">
          Twenty scripts vote in five weights: direction 30, trigger 25, structure 20, higher
          timeframe 15, participation 10. Chop scales the score. A strong reversal can only cap
          the stars.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="order-2 space-y-4 lg:order-1">
          {focus && !focus.error ? (
            <Hero result={focus} when={report?.generatedAt} />
          ) : (
            <div className="rounded-3xl border border-line bg-surface px-5 py-8 shadow-panel">
              <p className="text-lg font-semibold tracking-tight">Waiting for a read</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted">
                Tick the markets you want, then analyse. Nothing is fetched until then.
              </p>
            </div>
          )}

          {report && (
            <div className="space-y-4">
              <ResultGroup
                title="Entries"
                empty="No open cross on the selected pairs."
                rows={[...buckets.live, ...buckets.passed]}
                focusId={focus?.id}
                onFocus={setFocusId}
              />
              <ResultGroup
                title="Quiet"
                empty=""
                rows={buckets.quiet}
                focusId={focus?.id}
                onFocus={setFocusId}
              />
            </div>
          )}

          <p className="px-1 text-xs leading-5 text-muted">
            Live prints come from Biquote, with Yahoo Finance, Binance Vision, and Coinbase for
            history. Twelve Data is used only when those fail and a key is saved. This is a
            mechanical read, not a recommendation to trade.
          </p>
        </section>

        <aside className="order-1 space-y-4 lg:sticky lg:top-6 lg:order-2">
          <div className="overflow-hidden rounded-3xl border border-line bg-surface p-3 shadow-panel">
            <h2 className="px-1 text-sm font-medium text-muted">Timeframe</h2>
            <Segmented
              value={timeframe}
              options={TIMEFRAMES.map((item) => ({ id: item.id, label: item.label }))}
              onChange={setTimeframe}
            />
            <p className="mt-3 px-1 text-xs leading-5 text-muted">
              Direction, trigger, structure, higher timeframe, and participation are always on.
            </p>
          </div>

          <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-panel">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-sm font-medium text-muted">Pairs</h2>
              <span className="text-xs text-muted tabular-nums">
                {pairs.length} of {MAX_PAIRS}
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {grouped.map((group) => (
                <div key={group.title}>
                  <p className="px-4 pt-2 pb-1 text-xs text-muted">{group.title}</p>
                  {group.items.map((pair) => {
                    const on = pairs.includes(pair.id);
                    return (
                      <label
                        key={pair.id}
                        className="flex min-h-12 w-full items-center gap-3 px-4"
                      >
                        <Checkbox.Root
                          checked={on}
                          onCheckedChange={() => togglePair(pair.id)}
                          className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-line bg-surface data-[state=checked]:border-fg data-[state=checked]:bg-fg data-[state=checked]:text-bg"
                        >
                          <Checkbox.Indicator>
                            <Check className="h-3.5 w-3.5" strokeWidth={3} />
                          </Checkbox.Indicator>
                        </Checkbox.Root>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{pair.label}</span>
                          <span className="block truncate text-xs text-muted">{pair.name}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex gap-4 border-t border-line px-4 py-2">
              <button
                type="button"
                className="min-h-11 text-sm font-medium text-fg"
                onClick={() => {
                  setNotice(null);
                  setPairs(["EURUSD", "GBPUSD", "USDJPY", "USDCHF"]);
                }}
              >
                Majors
              </button>
              <button
                type="button"
                className="min-h-11 text-sm font-medium text-fg"
                onClick={() => {
                  setNotice(null);
                  setPairs(["BTCUSD", "ETHUSD", "SOLUSD"]);
                }}
              >
                Crypto
              </button>
            </div>
          </div>

          <details className="overflow-hidden rounded-3xl border border-line bg-surface shadow-panel">
            <summary className="min-h-14 px-4 py-3 text-sm font-medium">
              Twelve Data key
              <span className="mt-0.5 block text-xs font-normal text-muted">
                Optional. Last resort if the free feeds miss
              </span>
            </summary>
            <div className="px-4 pb-4">
              <input
                type="password"
                autoComplete="off"
                value={twelveDataKey}
                onChange={(event) => setTwelveDataKey(event.target.value)}
                placeholder="Paste a key"
                className="min-h-11 w-full rounded-xl bg-fill px-3 text-base outline-none"
              />
            </div>
          </details>

          {notice && <p className="px-1 text-sm text-muted">{notice}</p>}
          {error && <p className="px-1 text-sm text-red">{error}</p>}

          <button
            type="button"
            onClick={onAnalyse}
            disabled={loading}
            className="min-h-12 w-full rounded-xl bg-fg text-base font-medium text-bg transition-opacity active:opacity-80 disabled:opacity-60"
          >
            {loading ? "Reading markets…" : `Analyse ${pairs.length} ${pairs.length === 1 ? "pair" : "pairs"}`}
          </button>
        </aside>
      </div>
    </main>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  const index = Math.max(0, options.findIndex((item) => item.id === value));
  return (
    <div
      className="relative mt-2 grid rounded-xl bg-fill p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 rounded-lg bg-surface shadow-panel transition-transform duration-200 ease-out"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          left: "0.25rem",
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={`relative z-10 min-h-11 rounded-lg text-sm font-medium ${
            value === item.id ? "text-fg" : "text-muted"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ResultGroup({
  title,
  empty,
  rows,
  focusId,
  onFocus,
}: {
  title: string;
  empty: string;
  rows: PairResult[];
  focusId?: string;
  onFocus: (id: string) => void;
}) {
  if (!rows.length && !empty) return null;
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-panel">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="border-t border-line px-4 py-4 text-sm leading-6 text-muted">{empty}</p>
      ) : (
        <ul>
          {rows.map((result) => (
            <li key={result.id} className="border-t border-line">
              <button
                type="button"
                onClick={() => onFocus(result.id)}
                className={`flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left ${
                  focusId === result.id ? "bg-accent-soft" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{result.label}</p>
                  <p className="truncate text-xs text-muted">
                    {result.error ? result.error : result.name}
                  </p>
                </div>
                {result.error ? (
                  <span className="text-xs font-medium text-red">No data</span>
                ) : (
                  <>
                    <span
                      className={`text-sm font-medium tabular-nums ${
                        result.changePct >= 0 ? "text-green" : "text-red"
                      }`}
                    >
                      {formatPct(result.changePct)}
                    </span>
                    <StateChip result={result} />
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StateChip({ result }: { result: PairResult }) {
  if (result.action === "BUY" || result.action === "SELL") {
    return (
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${actionClass(result.action)}`}>
        {result.action} {result.score > 0 ? "+" : ""}
        {result.score}
      </span>
    );
  }
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${actionClass("HOLD")}`}>
      {result.score}
    </span>
  );
}

function Hero({ result, when }: { result: PairResult; when?: string }) {
  const clock = when
    ? new Date(when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const levels = [
    ["Entry", result.entry],
    ["Stop", result.sl],
    ["TP1", result.tp[0]],
    ["TP2", result.tp[1]],
    ["TP3", result.tp[2]],
    ["TP4", result.tp[3]],
  ] as const;
  const stats = [
    ["RSI 14", result.indicators.rsi, true],
    ["ATR 14", result.indicators.atr, false],
    ["EMA 11", result.indicators.emaFast, false],
    ["EMA 34", result.indicators.emaSlow, false],
    ["Weekly VWAP", result.indicators.vwapWeekly, false],
    ["Monthly VWAP", result.indicators.vwapMonthly, false],
  ] as const;
  const signed = result.score > 0 ? `+${result.score}` : String(result.score);

  return (
    <article className="rounded-3xl border border-line bg-surface px-5 py-5 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{result.name}</p>
          <h2 className="text-2xl font-semibold tracking-tight">{result.label}</h2>
        </div>
        <StatusPill state={result.entryState} action={result.action} score={result.score} />
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted">Score</p>
          <p className="text-4xl font-semibold tracking-tight tabular-nums">{signed}</p>
        </div>
        <div className="pb-1 text-right">
          <Stars n={result.stars} />
          <p className="mt-2 text-sm font-medium tabular-nums">
            {result.agree} of {result.scripts.length || 20} agree
          </p>
        </div>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{formatPx(result.price)}</p>
      <p className={`mt-1 text-sm font-medium tabular-nums ${result.changePct >= 0 ? "text-green" : "text-red"}`}>
        {formatPct(result.changePct)}
        <span className="font-normal text-muted">
          {" "}
          · {result.trendZone} · {result.source}
          {clock ? ` · ${clock}` : ""}
        </span>
      </p>
      {(result.action === "BUY" || result.action === "SELL") && (
        <p className="mt-2 text-sm text-muted">{positionNote(result)}</p>
      )}

      <ul className="mt-4 space-y-3">
        {result.groups.map((group) => (
          <li key={group.id}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span>
                {group.label}
                <span className="text-muted"> · {group.weight}%</span>
              </span>
              <span className="font-medium tabular-nums">
                {group.score > 0 ? "+" : ""}
                {group.score}
              </span>
            </div>
            <Meter score={group.score} />
          </li>
        ))}
      </ul>
      {result.starCap !== null && (
        <p className="mt-3 text-xs leading-5 text-muted">
          Strong Reversal opposes this side, so the rating stops at {result.starCap} stars. It never adds.
        </p>
      )}

      <div className="mt-4">
        <MarketChart series={result.series} />
        <div className="mt-1 flex gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-fg" /> Price
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-accent" /> Session VWAP
          </span>
        </div>
      </div>

      <p className="mt-4 text-sm leading-6">{result.note}</p>

      {(result.action === "BUY" || result.action === "SELL") && (
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line sm:grid-cols-3">
          {levels.map(([label, value]) => (
            <div key={label} className="bg-surface px-3 py-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="text-sm font-medium tabular-nums">{formatPx(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {stats
          .filter(([, value]) => value !== 0)
          .map(([label, value, isRsi]) => (
            <Stat key={label} label={label} value={isRsi ? value.toFixed(1) : formatPx(value)} />
          ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
        {result.scripts.map((script) => (
          <div key={script.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-muted">{script.name}</span>
            <span className={`font-medium ${script.vote > 0 ? "text-green" : script.vote < 0 ? "text-red" : ""}`}>
              {script.vote > 0 ? "Long" : script.vote < 0 ? "Short" : "Flat"}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-1" aria-label={`${n} of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < n ? "bg-fg" : "bg-fill"}`} />
      ))}
    </span>
  );
}

function Meter({ score }: { score: number }) {
  const width = Math.abs(score) / 2;
  return (
    <div className="relative h-1.5 overflow-hidden rounded-full bg-fill">
      <span className="absolute top-0 bottom-0 left-1/2 w-px bg-line" />
      <span
        className={`absolute top-0 h-full ${score >= 0 ? "left-1/2 bg-green" : "bg-red"}`}
        style={
          score >= 0
            ? { width: `${width}%` }
            : { width: `${width}%`, left: `${50 - width}%` }
        }
      />
    </div>
  );
}

function Wheel() {
  return (
    <svg viewBox="0 0 32 32" className="h-11 w-11 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-fg" />
      <g className="stroke-bg" fill="none" strokeWidth="1.35" strokeLinecap="round">
        <circle cx="16" cy="16" r="10.2" />
        <circle cx="16" cy="16" r="3.15" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (Math.PI / 4) * i - Math.PI / 2;
          const x1 = 16 + Math.cos(a) * 3.55;
          const y1 = 16 + Math.sin(a) * 3.55;
          const x2 = 16 + Math.cos(a) * 9.55;
          const y2 = 16 + Math.sin(a) * 9.55;
          const hx = 16 + Math.cos(a) * 11.55;
          const hy = 16 + Math.sin(a) * 11.55;
          const px = -Math.sin(a) * 2.15;
          const py = Math.cos(a) * 2.15;
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} />
              <line x1={hx - px} y1={hy - py} x2={hx + px} y2={hy + py} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function StatusPill({
  state,
  action,
  score,
}: {
  state: EntryState;
  action: Side;
  score: number;
}) {
  const signed = score > 0 ? `+${score}` : String(score);
  if (action === "BUY" || action === "SELL") {
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-semibold tabular-nums ${actionClass(action)}`}>
        {action}
        {state === "passed" ? " · passed" : ""} · {signed}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-fill px-3 py-1 text-xs font-semibold text-muted tabular-nums">
      Flat · {signed}
    </span>
  );
}

function positionNote(result: PairResult) {
  if (!result.entry) return "";
  if (result.entryState === "passed") {
    return "Price has already traded through this entry. Stop and targets stay on the card.";
  }
  const beyond = (result.price - result.entry) * (result.action === "SELL" ? -1 : 1);
  const rel = Math.abs(result.price - result.entry) / result.entry;
  if (rel < 0.00008) return "Price is sitting on the entry.";
  if (beyond < 0) return `Market is still ${formatPx(Math.abs(result.price - result.entry))} short of the entry.`;
  return "Price is pressing the entry, but has not traded through it.";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}
