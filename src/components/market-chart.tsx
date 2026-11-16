import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPx } from "@/lib/indicators";

type Point = { t: number; c: number; v: number };

export function MarketChart({ series }: { series: Point[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || series.length < 2) {
    return <div className="h-52 rounded-xl bg-fill" />;
  }

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="t" hide />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            cursor={{ stroke: "var(--color-line)" }}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 12,
              boxShadow: "none",
              fontSize: 12,
              color: "var(--color-fg)",
            }}
            labelFormatter={() => ""}
            formatter={(value, name) => [
              formatPx(Number(value)),
              name === "v" ? "Session VWAP" : "Price",
            ]}
          />
          <Line
            type="monotone"
            dataKey="c"
            stroke="var(--color-fg)"
            strokeWidth={1.75}
            dot={false}
            name="c"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke="var(--color-accent)"
            strokeWidth={1.25}
            dot={false}
            name="v"
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
