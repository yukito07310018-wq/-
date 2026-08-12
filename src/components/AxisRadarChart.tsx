"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { radarRadius, rankAxes, type AxisRanking } from "@/lib/engine/ordinal";
import type { AxisInsight } from "@/lib/interview/profileService";

/**
 * §30 — radar of the axis *ordering*, with confidence made visible rather than
 * implied.
 *
 * Plotting raw scores drew a near-perfect circle: real axis differences arrive
 * compressed about 3.1×, so ten axes whose true values span 25–75 all landed
 * between 39 and 61 on a 0–100 ring. That was honest — it invented nothing — but
 * it showed nothing either, including differences that are really there.
 *
 * The ring now plots rank, which is the part the model gets right (r = 0.98
 * against truth). The radius axis is therefore unlabelled: distance from the
 * centre means "higher among your ten axes", not "higher out of 100".
 *
 * The score ring's fill opacity still tracks confidence, and a second ring plots
 * confidence itself, so a well-supported ordering and a guessed one do not look
 * alike.
 */

interface Props {
  axes: AxisInsight[];
}

interface Row {
  axis: string;
  rankRadius: number;
  rank: number | null;
  outOf: number;
  confidenceScaled: number;
  confidence: number;
  coverage: number;
}

export default function AxisRadarChart({ axes }: Props) {
  const rankings = new Map<string, AxisRanking>(rankAxes(axes).map((r) => [r.axis_id, r]));
  const data: Row[] = axes.map((a) => {
    const ranking = rankings.get(a.axis_id)!;
    return {
      axis: a.name,
      rankRadius: radarRadius(ranking),
      rank: ranking.rank,
      outOf: ranking.outOf,
      confidenceScaled: Math.round(a.confidence * 1000) / 10,
      confidence: a.confidence,
      coverage: a.coverage,
    };
  });

  const meanConfidence =
    axes.length > 0 ? axes.reduce((s, a) => s + a.confidence, 0) / axes.length : 0;
  // 0.08 keeps the shape readable even at confidence 0, without implying certainty.
  const fillOpacity = 0.08 + 0.42 * meanConfidence;

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#2a3745" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: "#93a4b8", fontSize: 12 }} />
          {/* No ticks: the radius is an ordering, and numbering it would put back
              exactly the false precision this chart exists to avoid. */}
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            name="順位"
            dataKey="rankRadius"
            stroke="#5eb0ef"
            fill="#5eb0ef"
            fillOpacity={fillOpacity}
          />
          <Radar
            name="確からしさ(×100)"
            dataKey="confidenceScaled"
            stroke="#b98cf0"
            fill="#b98cf0"
            fillOpacity={0.06}
            strokeDasharray="4 3"
          />
          <Tooltip
            contentStyle={{
              background: "#131a23",
              border: "1px solid #2a3745",
              borderRadius: 10,
              color: "#e8eef5",
              fontSize: 12,
            }}
            formatter={(value, name, entry) => {
              const numeric = typeof value === "number" ? value : Number(value);
              if (name === "確からしさ(×100)") return [(numeric / 100).toFixed(2), "Confidence"];
              const row = entry?.payload as Row | undefined;
              return row?.rank == null
                ? ["情報不足", "順位"]
                : [`${row.rank} / ${row.outOf}`, "順位"];
            }}
          />
        </RadarChart>
      </ResponsiveContainer>

      <p className="mt-1 text-center text-xs text-[color:var(--muted)]">
        実線は<strong>10軸の相対的な順位</strong>（外側ほど上位）、破線が確からしさ（Confidence）です。
        絶対的な高さではありません。塗りの濃さは平均Confidenceに連動します。
      </p>
    </div>
  );
}
