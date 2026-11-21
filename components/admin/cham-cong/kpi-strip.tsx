// components/admin/cham-cong/kpi-strip.tsx — hàng số liệu đầu màn.
//
// Vì sao file này tồn tại: mỗi màn cũ tự dựng lưới thẻ số với cột khác nhau, nên cùng một hàng KPI
// mà chỗ 3 cột chỗ 5 cột, và số thì có thẻ tràn ra ngoài. Ở đây một lưới, còn thẻ mượn `StatCard`
// chuẩn của admin.
//
// `href` là điểm chính: KPI của module này KHÔNG phải để ngắm — "Cờ cần rà 7" phải bấm được để ra
// đúng bộ lọc sinh ra số 7 đó, không thì người dùng lại đi lọc tay và ra số khác.
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { StatCard, type StatTone } from "@/components/admin/ui/stat-card";

export type KpiItem = {
  icon?: LucideIcon;
  /** Số ĐÃ định dạng ở page (`toLocaleString('vi-VN')`) — thẻ không tự format. */
  value: string | number;
  label: string;
  tone?: StatTone;
  hint?: string;
  href?: string;
  /** Thẻ đang là bộ lọc hiện hành — viền nhấn + `aria-current` (bấm lại thẻ khác để đổi lọc). */
  dangChon?: boolean;
};

export function KpiStrip({ items, cols = 4 }: { items: KpiItem[]; cols?: 4 | 5 | 6 | 7 }) {
  if (items.length === 0) return null;
  // Class phải là chuỗi TĨNH — Tailwind quét mã nguồn, `lg:grid-cols-${cols}` không sinh ra CSS.
  const lg = cols === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4";
  // 7 thẻ chia cột theo BỀ NGANG VÙNG CHỨA (container query), KHÔNG theo màn hình: ở 768px sidebar còn mở, vùng nội
  // dung chỉ ~490px — chia theo màn (md:4 cột) làm số "12" thành "1.." (đo thật 13/10/2026, `p3b-do-viewport.ts`).
  // 6 thẻ (Phân công buổi từ 20/10/2026, bỏ thẻ "thiếu trợ giảng bắt buộc") — cùng lối chia theo vùng chứa.
  const luoi =
    cols === 7
      ? "grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-4 @7xl:grid-cols-7"
      : cols === 6
        ? "grid-cols-2 @xl:grid-cols-3 @6xl:grid-cols-6"
        : `grid-cols-2 md:grid-cols-4 ${lg}`;
  return (
    <div className={cols >= 6 ? "@container mb-4" : "mb-4"}>
    <div className={`grid gap-3 ${luoi}`}>
      {items.map((it) => {
        const card = (
          <StatCard
            icon={it.icon}
            value={it.value}
            label={it.label}
            tone={it.tone}
            hint={it.hint}
            // Lưới này xuống 2 cột ở mobile ⇒ thẻ còn ~150px, trừ ô biểu tượng 40px thì nhãn chỉ
            // còn ~80px. Đo ở 375px: "Cờ cần rà" thành "Cờ cần …", "0 người trong ngày" thành
            // "0 người t…". Cho nhãn xuống dòng; SỐ vẫn cắt như cũ.
            wrapLabel
          />
        );
        return it.href ? (
          <Link
            key={it.label}
            href={it.href}
            aria-current={it.dangChon ? "true" : undefined}
            className={it.dangChon ? "block rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background" : "block rounded-xl"}
          >
            {card}
          </Link>
        ) : (
          <div key={it.label}>{card}</div>
        );
      })}
    </div>
    </div>
  );
}
