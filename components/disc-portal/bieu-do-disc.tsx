/**
 * Biểu đồ điểm bốn nhóm D-I-S-C cho cổng phụ huynh — SVG/CSS thuần, KHÔNG thư viện chart, KHÔNG hook
 * (chạy được trong Server Component). Mọi con số đều có dạng CHỮ đi kèm (không chỉ dựa vào màu / hình).
 */
export type DiemDisc = { D: number; I: number; S: number; C: number };

export const NHOM_DISC = ["D", "I", "S", "C"] as const;

/** Nhãn gợi nhớ ngắn — văn bản của chúng ta, KHÔNG phải nội dung diễn giải DISC gốc (chưa có giấy phép). */
export const NHAN_NHOM: Record<(typeof NHOM_DISC)[number], string> = {
  D: "Quyết đoán",
  I: "Giao tiếp",
  S: "Ổn định",
  C: "Cẩn trọng",
};

export const LUU_Y_XU_HUONG =
  "Kết quả cho biết xu hướng hành vi tại thời điểm làm bài, không phải chẩn đoán hay xếp loại con người. Trẻ thay đổi nhanh theo tuổi và hoàn cảnh — hãy dùng kết quả để trò chuyện và đồng hành, không dùng để gắn nhãn.";

const kep = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
const lamTron = (v: number) => Math.round(v);

export function ThanhDiem({ diem, ten }: { diem: DiemDisc; ten: string }) {
  return (
    <ul className="space-y-2" aria-label={`Điểm bốn nhóm của ${ten}`} data-bieu-do="thanh">
      {NHOM_DISC.map((k) => (
        <li key={k} className="grid grid-cols-[5.5rem_1fr_2.25rem] items-center gap-2 text-sm">
          <span className="font-medium text-foreground">
            {k} <span className="text-xs font-normal text-muted-foreground">{NHAN_NHOM[k]}</span>
          </span>
          <span
            role="progressbar"
            aria-label={`Nhóm ${k} (${NHAN_NHOM[k]}) của ${ten}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={lamTron(kep(diem[k]))}
            className="block h-2.5 overflow-hidden rounded-full bg-muted"
          >
            <span className="block h-full rounded-full bg-accent" style={{ width: `${kep(diem[k])}%` }} />
          </span>
          <span className="text-right font-semibold tabular-nums text-foreground">{lamTron(diem[k])}</span>
        </li>
      ))}
    </ul>
  );
}

/** Radar 4 trục: D (trên) · I (phải) · S (dưới) · C (trái). Chữ mô tả đầy đủ nằm ở `aria-label`. */
export function RadarDisc({ diem, ten }: { diem: DiemDisc; ten: string }) {
  const R = 70;
  const O = 100;
  const toaDo: Record<(typeof NHOM_DISC)[number], [number, number]> = {
    D: [0, -1],
    I: [1, 0],
    S: [0, 1],
    C: [-1, 0],
  };
  const diemTai = (k: (typeof NHOM_DISC)[number], tiLe: number) =>
    `${(O + toaDo[k][0] * R * tiLe).toFixed(1)},${(O + toaDo[k][1] * R * tiLe).toFixed(1)}`;
  const da = (tiLe: number) => NHOM_DISC.map((k) => diemTai(k, tiLe)).join(" ");
  const mota = NHOM_DISC.map((k) => `${k} ${lamTron(kep(diem[k]))}`).join(", ");
  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label={`Biểu đồ radar của ${ten}: ${mota}`}
      data-bieu-do="radar"
      className="mx-auto h-auto w-full max-w-[220px] text-accent"
    >
      {[0.25, 0.5, 0.75, 1].map((m) => (
        <polygon key={m} points={da(m)} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />
      ))}
      {NHOM_DISC.map((k) => (
        <line key={k} x1={O} y1={O} x2={diemTai(k, 1).split(",")[0]} y2={diemTai(k, 1).split(",")[1]} stroke="currentColor" strokeOpacity={0.18} />
      ))}
      <polygon
        points={NHOM_DISC.map((k) => diemTai(k, kep(diem[k]) / 100)).join(" ")}
        fill="currentColor"
        fillOpacity={0.22}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <g className="fill-foreground text-[11px] font-semibold" textAnchor="middle" aria-hidden>
        <text x={O} y={O - R - 8}>D</text>
        <text x={O + R + 12} y={O + 4}>I</text>
        <text x={O} y={O + R + 16}>S</text>
        <text x={O - R - 12} y={O + 4}>C</text>
      </g>
    </svg>
  );
}
