"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BreakdownRow, TimeseriesPoint } from "@/lib/types";
import { compactNumber, formatDay, formatUsd } from "@/lib/utils";

const axis = {
  stroke: "#64748b",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const tooltipStyle = {
  backgroundColor: "#0f172a",
  border: "1px solid rgba(148,163,184,0.25)",
  borderRadius: 10,
  fontSize: 12,
  color: "#e2e8f0",
} as const;

const PALETTE = ["#38bdf8", "#34d399", "#a78bfa", "#fbbf24", "#fb7185", "#22d3ee"];

export function TrafficChart({ data }: { data: TimeseriesPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="requestsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="errorsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb7185" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#fb7185" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={formatDay} {...axis} />
          <YAxis tickFormatter={compactNumber} width={52} {...axis} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(value) => formatDay(String(value))}
            formatter={(value: number, name: string) => [compactNumber(value), name]}
          />
          <Area
            type="monotone"
            dataKey="requests"
            name="Requests"
            stroke="#38bdf8"
            fill="url(#requestsFill)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="errors"
            name="Errors"
            stroke="#fb7185"
            fill="url(#errorsFill)"
            strokeWidth={1.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SpendChart({ data }: { data: TimeseriesPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={formatDay} {...axis} />
          <YAxis tickFormatter={(value) => formatUsd(Number(value), 2)} width={64} {...axis} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(value) => formatDay(String(value))}
            formatter={(value: number) => [formatUsd(value), "Spend"]}
          />
          <Line
            type="monotone"
            dataKey="costUsd"
            name="Spend"
            stroke="#34d399"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BreakdownChart({ data }: { data: BreakdownRow[] }) {
  const top = [...data].sort((a, b) => b.tokens - a.tokens).slice(0, 6);
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={top} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" horizontal={false} />
          <XAxis type="number" tickFormatter={compactNumber} {...axis} />
          <YAxis
            type="category"
            dataKey="label"
            width={130}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number) => [compactNumber(value), "Tokens"]}
          />
          <Bar dataKey="tokens" radius={[0, 4, 4, 0]} barSize={16}>
            {top.map((entry, index) => (
              <Cell key={entry.key} fill={PALETTE[index % PALETTE.length]} />
            ))}
          </Bar>
          <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
