// components/admin/nguon-hoa-hong/trang-thai-nguon-pill.tsx — pill TRẠNG THÁI của một nguồn (Nháp · Đang dùng · Tạm ngừng · Lưu trữ), CLIENT-SAFE.
//
// Tách khỏi `nguon-status-pill.tsx` vì tệp đó kéo `@/lib/nguon/doc-hang-cho` (→ db-scope → `next/headers`) cho phần pill LÝ DO hàng chờ; hộp thoại đổi trạng thái là component CLIENT nên
// import cả tệp ấy là kéo mã máy chủ vào gói trình duyệt (webpack: "You're importing a component that needs next/headers"). `nguon-status-pill.tsx` xuất lại từ đây —
// nơi gọi cũ không đổi. Bọc `StatusPill` (06 §0: không viết pill thứ ba); tông theo thang NGỮ NGHĨA (DESIGN.md §1).
import type { SourceStatus } from "@prisma/client";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { NHAN_TRANG_THAI_NGUON_DB } from "@/lib/nguon/nhan-hien-thi";
import { cn } from "@/lib/utils";

/** `StatusPill` tô bằng màu SÁNG (trượt AA trên nền trắng) nên luôn đè `text-state-*-ink`. */
export const INK_THEO_TONE: Record<PillTone, string> = {
  success: "text-state-success-ink",
  warning: "text-state-warning-ink",
  danger: "text-state-danger-ink",
  info: "text-state-info-ink",
  brand: "text-primary-ink",
  muted: "",
};

// Chỉ TÔNG ở đây; CHỮ nằm ở bảng gốc `NHAN_TRANG_THAI_NGUON_DB` (lib/nguon/nhan-hien-thi.ts) — pill, chip lọc, nhật ký và trình soạn cùng nói một chữ.
const TONE_TRANG_THAI_NGUON: Record<SourceStatus, PillTone> = {
  DRAFT: "muted",
  ACTIVE: "success",
  INACTIVE: "muted",
  ARCHIVED: "muted",
};

export function NguonStatusPill({ status, className }: { status: SourceStatus; className?: string }) {
  const tone = TONE_TRANG_THAI_NGUON[status];
  return (
    <StatusPill tone={tone} className={cn(INK_THEO_TONE[tone], className)}>
      {NHAN_TRANG_THAI_NGUON_DB[status]}
    </StatusPill>
  );
}
