# Charts (Admin only)

Recharts wrappers cho admin dashboard. **KHÔNG import vào client site** — ESLint sẽ chặn.

## Components

| Component | Use case |
|---|---|
| `<LineChart>` | Trends theo thời gian (leads/day, revenue/month) |
| `<BarChart>` | So sánh categories (department headcount, top sources) |
| `<FunnelChart>` | Conversion funnel (lead → enrolled) |

## Rules

1. Animation duration giữ 300ms — KHÔNG tăng (admin tối giản).
2. Brand colors: cam `#F97316`, tím `#7C3AED`.
3. Font size labels 12–13px.
4. Luôn dùng `ResponsiveContainer` (wrapper đã include).
5. Tooltip: background trắng, border `#E5E7EB`, radius 8px.

## Lazy load khi page nặng

```tsx
import dynamic from "next/dynamic";

const LineChart = dynamic(
  () => import("@/components/charts/line-chart").then((m) => m.LineChart),
  { ssr: false, loading: () => <div className="h-[300px] rounded bg-gray-100 animate-pulse" /> }
);
```
