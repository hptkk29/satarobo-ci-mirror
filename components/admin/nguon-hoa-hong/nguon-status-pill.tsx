// components/admin/nguon-hoa-hong/nguon-status-pill.tsx — ÁNH XẠ trạng thái/lý do → tông màu ở MỘT chỗ (06 §7).
//
// Bọc `StatusPill` (06 §0: không viết pill thứ ba). Tông theo thang NGỮ NGHĨA, không mượn màu thương hiệu
// (DESIGN.md §1): đang dùng = success; chờ/thiếu = warning; gian lận/lỗi = danger; nháp/ngừng = muted.
// `StatusPill` tô bằng màu SÁNG (trượt AA trên nền trắng) nên luôn đè `text-state-*-ink` như chính ghi chú của
// `status-pill.tsx` dặn — cùng cách `PeriodStatusPill` của chấm công làm.
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { NHAN_LY_DO, nhanCanhBao, type LyDoHangCho } from "@/lib/nguon/doc-hang-cho";
import { INK_THEO_TONE as INK } from "./trang-thai-nguon-pill";

// Pill TRẠNG THÁI nguồn nằm ở `trang-thai-nguon-pill.tsx` (client-safe: tệp này kéo `doc-hang-cho` → db-scope → `next/headers`). Xuất lại để nơi gọi cũ không đổi.
export { NguonStatusPill } from "./trang-thai-nguon-pill";

/** Lý do vào hàng chờ → tông. Cảnh báo gian lận là danger; thiếu dữ liệu là warning. */
export const TONE_VAN_DE: Record<LyDoHangCho, PillTone> = {
  UNKNOWN: "warning",
  THIEU_NGUOI: "warning",
  THIEU_GIAI_TRINH: "warning",
  CANH_BAO: "danger",
};

/**
 * Một pill cho MỘT lý do. Lý do CẢNH BÁO thì in đúng từng mã ("SĐT trùng nhân viên"), không gộp thành "Có cảnh
 * báo" — người duyệt cần biết cảnh báo nào để quyết.
 */
export function VanDePill({ lyDo, canhBao }: { lyDo: LyDoHangCho; canhBao?: string[] }) {
  const tone = TONE_VAN_DE[lyDo];
  if (lyDo === "CANH_BAO" && canhBao && canhBao.length > 0) {
    return (
      <>
        {canhBao.map((ma) => (
          <StatusPill key={ma} tone={tone} className={INK[tone]}>
            {nhanCanhBao(ma)}
          </StatusPill>
        ))}
      </>
    );
  }
  return (
    <StatusPill tone={tone} className={INK[tone]}>
      {NHAN_LY_DO[lyDo]}
    </StatusPill>
  );
}
