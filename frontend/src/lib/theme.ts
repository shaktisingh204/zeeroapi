// Shared chart/visual tokens (was hardcoded in 3+ pages: admin analytics,
// overview, portal analytics).
export const TOOLTIP_STYLE = {
  background: "#1c2230",
  border: "1px solid #262d3d",
  borderRadius: 8,
  color: "#fff",
} as const;

// Categorical palette for charts (donuts, multi-series).
export const CHART_COLORS = [
  "#22c55e", // brand green
  "#3b82f6", // blue
  "#a855f7", // purple
  "#f59e0b", // amber
  "#ef4444", // red
  "#14b8a6", // teal
];

// Status-class colors used by analytics + logs.
export const STATUS_CLASS_COLOR: Record<number, string> = {
  2: "#22c55e",
  4: "#f59e0b",
  5: "#ef4444",
};
