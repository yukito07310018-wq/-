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
import type { AxisInsight } from "@/lib/interview/profileService";

/**
 * §30 — radar with confidence made visible rather than implied.
 *
 * The score ring's fill opacity tracks axis confidence, and a second ring plots
 * confidence itself, so a well-supported 80 and a guessed 80 do not look alike.
 */

interface Props {
  axes: AxisInsight[];
}

interface Row {
  axis: string;
  score: number;
  confidenceScaled: number;
  confidence: number;
  coverage: number;
}

export default function AxisRadarChart({ axes }: Props) {
  const data: Row[] = axes.map((a) => ({
    axis: a.name,
    score: Math.round(a.score * 10) / 10,
    confidenceScaled: Math.round(a.confidence * 1000) / 10,
    confidence: a.confidence,
    coverage: a.coverage,
  }));

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
          <PolarRadiusAxis domain={[0, 100]} tick={{ fill: "#4c5c6e", fontSize: 10 }} />
          <Radar
            name="スコア"
            dataKey="score"
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
            formatter={(value, name) => {
              const numeric = typeof value === "number" ? value : Number(value);
              return name === "確からしさ(×100)"
                ? [(numeric / 100).toFixed(2), "Confidence"]
                : [numeric.toFixed(1), "Score"];
            }}
          />
        </RadarChart>
      </ResponsiveContainer>

      <p className="mt-1 text-center text-xs text-[color:var(--muted)]">
        実線がスコア、破線が確からしさ（Confidence）です。塗りの濃さは平均Confidenceに連動します。
      </p>
    </div>
  );
}
