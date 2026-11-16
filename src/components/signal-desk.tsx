import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as Checkbox from "@radix-ui/react-checkbox";
import * as Switch from "@radix-ui/react-switch";
import { Check } from "lucide-react";
import { analyzeMarkets } from "@/lib/analyze";
import { formatPct, formatPx } from "@/lib/indicators";
import type { AnalyzeResult, EntryState, PairResult, Side, StrategyId, Timeframe } from "@/lib/market-types";
import { DEFAULT_PAIRS, MAX_PAIRS, PAIRS, PAIR_MAP, TIMEFRAMES } from "@/lib/pairs";
import { MarketChart } from "@/components/market-chart";

const STORAGE = "st.desk.v2";

type Saved = {
  pairs: string[];
  timeframe: Timeframe;
  strategy: StrategyId;
  hybrid: boolean;
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
  const [strategy, setStrategy] = useState<StrategyId>("ema_vwap");
  const [hybrid, setHybrid] = useState(false);
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
    if (saved?.strategy === "leo" || saved?.strategy === "ema_vwap") setStrategy(saved.strategy);
    if (typeof saved?.hybrid === "boolean") setHybrid(saved.hybrid);
    if (typeof saved?.twelveDataKey === "string") setTwelveDataKey(saved.twelveDataKey);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload: Saved = { pairs, timeframe, strategy, hybrid, twelveDataKey };
    localStorage.setItem(STORAGE, JSON.stringify(payload));
  }, [hydrated, pairs, timeframe, strategy, hybrid, twelveDataKey]);

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
        setNotice(`Six pairs is the cap. Untick one before adding ${PAIR_MAP.get(id)?.label}.`);
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
        data: { pairs, timeframe, strategy, hybrid, twelveDataKey },
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
        <p className="text-sm font-medium text-muted">Signals</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">SingleTrader</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Open crosses stay on the desk with entry, stop, and targets, even after price has
          traded through.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="order-2 space-y-4 lg:order-1">
          {focus && !focus.error ? (
            <Hero result={focus} when={report?.generatedAt} strategy={strategy} hybrid={hybrid} />
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

            <h2 className="mt-4 px-1 text-sm font-medium text-muted">Strategy</h2>
            <Segmented
              value={strategy}
              options={[
                { id: "ema_vwap" as const, label: "EMA VWAP" },
                { id: "leo" as const, label: "Leo 2:1" },
              ]}
              onChange={setStrategy}
            />

            <label className="mt-3 flex min-h-14 items-center gap-3 rounded-xl px-1">
              <Switch.Root
                checked={hybrid}
                onCheckedChange={setHybrid}
                className="relative flex h-7 w-12 shrink-0 items-center rounded-full bg-fill transition-colors data-[state=checked]:bg-fg"
              >
                <Switch.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-surface transition-transform data-[state=checked]:translate-x-6" />
              </Switch.Root>
              <span>
                <span className="block text-sm font-medium">Hybrid</span>
                <span className="block text-xs leading-5 text-muted">
                  Only when EMA VWAP and Leo share a side
                </span>
              </span>
            </label>
          </div>

          <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-panel">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-sm font-medium text-muted">Pairs</h2>
              <span className="text-xs text-muted tabular-nums">
                {pairs.length} of {MAX_PAIRS}
              </span>
            </div>
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
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${actionClass(result.action)}`}>
        {result.action}
      </span>
    );
  }
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${actionClass("HOLD")}`}>Flat</span>;
}

function Hero({
  result,
  when,
  strategy,
  hybrid,
}: {
  result: PairResult;
  when?: string;
  strategy: StrategyId;
  hybrid: boolean;
}) {
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
  const leo = strategy === "leo" && !hybrid;
  const stats = [
    ["RSI 14", result.indicators.rsi, true],
    ["ATR 14", result.indicators.atr, false],
    [leo ? "EMA 150" : "EMA 11", result.indicators.emaFast, false],
    [leo ? "EMA 250" : "EMA 34", result.indicators.emaSlow, false],
    ["Weekly VWAP", result.indicators.vwapWeekly, false],
    ["Monthly VWAP", result.indicators.vwapMonthly, false],
  ] as const;

  return (
    <article className="rounded-3xl border border-line bg-surface px-5 py-5 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{result.name}</p>
          <h2 className="text-2xl font-semibold tracking-tight">{result.label}</h2>
        </div>
        <StatusPill state={result.entryState} action={result.action} confidence={result.confidence} />
      </div>
      <p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">{formatPx(result.price)}</p>
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
          .map(([label, value, rsi]) => (
            <Stat key={label} label={label} value={rsi ? value.toFixed(1) : formatPx(value)} />
          ))}
      </div>

      <ul className="mt-4 space-y-2">
        {result.votes.map((vote) => (
          <li key={vote.strategy} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">{vote.name}</span>
            <span className="font-medium">
              {vote.action === "HOLD" ? "Flat" : vote.action}
              {vote.action !== "HOLD" && vote.entryState === "passed" ? " · passed" : ""}
              <span className="font-normal text-muted"> · {vote.confidence}</span>
            </span>
          </li>
        ))}
      </ul>

      {result.backtest.trades > 0 && (
        <p className="mt-3 text-xs leading-5 text-muted">
          Walk-forward on this window: {result.backtest.trades} closed trades,{" "}
          {result.backtest.winRate}% reached TP1 before the stop, net {result.backtest.netR} R.
        </p>
      )}
    </article>
  );
}

function StatusPill({
  state,
  action,
  confidence,
}: {
  state: EntryState;
  action: Side;
  confidence: number;
}) {
  if (action === "BUY" || action === "SELL") {
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${actionClass(action)}`}>
        {action}
        {state === "passed" ? " · passed" : ""} · {confidence}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-fill px-3 py-1 text-xs font-semibold text-muted">
      {state === "passed" ? "Passed" : "Flat"}
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
