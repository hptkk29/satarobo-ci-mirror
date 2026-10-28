// components/admin/nguon-hoa-hong/affiliate/trang-thai-doi-tac-pill.tsx — pill TRẠNG THÁI của một đối tác (Nháp · Chờ duyệt · Đang hoạt động · Tạm dừng · Đã kết thúc). CLIENT-SAFE.
//
// Bọc `StatusPill` (06 §0: không viết pill thứ ba); tông theo thang NGỮ NGHĨA (DESIGN.md §1). Chữ nằm ở bảng gốc `NHAN_TRANG_THAI_DOI_TAC` (lib/affiliate/ghi-doi-tac-dau-vao.ts) —
// pill, chip lọc và hộp thoại đổi trạng thái nói cùng một chữ.
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { NHAN_TRANG_THAI_DOI_TAC, type TrangThaiDoiTac } from "@/lib/affiliate/ghi-doi-tac-dau-vao";
import { cn } from "@/lib/utils";
import { INK_THEO_TONE } from "../trang-thai-nguon-pill";

const TONE: Record<TrangThaiDoiTac, PillTone> = {
  DRAFT: "muted",
  PENDING: "warning",
  ACTIVE: "success",
  SUSPENDED: "warning",
  ENDED: "muted",
};

export function TrangThaiDoiTacPill({ trangThai, className }: { trangThai: TrangThaiDoiTac; className?: string }) {
  return (
    <StatusPill tone={TONE[trangThai]} className={cn(INK_THEO_TONE[TONE[trangThai]], className)}>
      {NHAN_TRANG_THAI_DOI_TAC[trangThai]}
    </StatusPill>
  );
}
