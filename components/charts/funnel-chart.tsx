interface FunnelStep {
  name: string;
  value: number;
  fill?: string;
}

interface FunnelChartProps {
  data: FunnelStep[];
  height?: number;
}

// Funnel conversion (vd: NEW → CONTACTED → DEMO → ENROLLED).
//
// Render bằng HTML/CSS thay cho Recharts <Funnel>: bản Recharts v3 KHÔNG vẽ được funnel
// trong ResponsiveContainer (khung trắng trơn — Bar/Line vẫn OK). CSS funnel luôn hiện,
// nhãn không bị cắt (nằm trong layout HTML), và có empty-state rõ ràng.
const COLORS = ["#F97316", "#FB923C", "#FDBA74", "#FED7AA", "#7C3AED"];

export function FunnelChart({ data }: FunnelChartProps) {
  const max = Math.max(0, ...data.map((d) => d.value ?? 0));

  // Toàn 0 → hiện placeholder rõ ràng thay vì khung trắng khó phân biệt "rỗng"/"lỗi".
  if (max <= 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg bg-neutral-50 text-sm text-neutral-400">
        Chưa có dữ liệu trong kỳ
      </div>
    );
  }

  return (
    <div className="space-y-2 py-2">
      {data.map((d, i) => {
        const value = d.value ?? 0;
        // Bề rộng dải ∝ value/max (tối thiểu 6% để dải nhỏ vẫn thấy + đủ chỗ số).
        const widthPct = Math.max((value / max) * 100, 6);
        // Tỉ lệ giữ so với bước trước (bước đầu = 100%).
        const prev = i > 0 ? (data[i - 1].value ?? 0) : value;
        const keepPct = prev > 0 ? Math.round((value / prev) * 100) : 0;
        return (
          <div key={`${d.name}-${i}`} className="flex items-center gap-3">
            <div className="w-44 shrink-0 truncate text-right text-sm text-gray-600" title={d.name}>
              {d.name}
            </div>
            <div className="flex flex-1 items-center justify-center">
              <div
                className="flex h-9 items-center justify-center rounded-md text-sm font-semibold text-white shadow-sm"
                style={{
                  width: `${widthPct}%`,
                  background: d.fill || COLORS[i % COLORS.length],
                }}
              >
                {value.toLocaleString("vi-VN")}
              </div>
            </div>
            <div className="w-12 shrink-0 text-right text-xs tabular-nums text-gray-400">
              {i === 0 ? "" : `${keepPct}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
