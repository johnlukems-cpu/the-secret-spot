"use client";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";

const GOLD = "#C98A86";
const CHARCOAL = "#4A0B1C";
const TAUPE = "#8A6468";
const fmt = (v: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);

export function LineSeries({ data, x, lines, height = 260 }: { data: Record<string, unknown>[]; x: string; lines: { key: string; label: string }[]; height?: number }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#eee" vertical={false} />
        <XAxis dataKey={x} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmt} width={60} />
        <Tooltip formatter={(v: number) => fmt(v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {lines.map((l, i) => <Line key={l.key} dataKey={l.key} name={l.label} stroke={[CHARCOAL, GOLD, TAUPE][i % 3]} strokeWidth={2} dot={false} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, x, y, label, height = 260, horizontal = false }: { data: Record<string, unknown>[]; x: string; y: string; label: string; height?: number; horizontal?: boolean }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#eee" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmt} />
            <YAxis type="category" dataKey={x} tick={{ fontSize: 11 }} width={120} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={60} tickLine={false} axisLine={false} />
          </>
        )}
        <Tooltip formatter={(v: number) => fmt(v)} />
        <Bar dataKey={y} name={label} fill={CHARCOAL} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, nameKey, valueKey, height = 220 }: { data: Record<string, unknown>[]; nameKey: string; valueKey: string; height?: number }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius="55%" outerRadius="85%" paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={[CHARCOAL, GOLD, TAUPE, "#7B0F2B"][i % 4]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => fmt(v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function Empty() {
  return <div className="flex h-40 items-center justify-center text-sm text-taupe">Nog geen gegevens in deze periode</div>;
}
