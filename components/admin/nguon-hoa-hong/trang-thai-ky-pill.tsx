// components/admin/nguon-hoa-hong/trang-thai-ky-pill.tsx — trạng thái KỲ hoa hồng (OPEN → … → PAID).
//
// Ánh xạ trạng thái → tone nằm ở MỘT chỗ (`TONE_TRANG_THAI_KY`, lib/hoa-hong/ky-man-hinh.ts): tiền đã khoá/đã chi = success, chờ người rà = warning,
// còn đang tính = info. Màu thương hiệu không mang nghĩa trạng thái (06 §0). `StatusPill` tô màu SÁNG (--state-*) — trượt AA trên nền trắng — nên chữ luôn
// đè bậc `-ink`, như ghi chú trong `status-pill.tsx` dặn.
import { Lock } from "lucide-react";

import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import type { TrangThaiKy } from "@/lib/hoa-hong/ky-hoa-hong";
import { NHAN_TRANG_THAI_KY, TONE_TRANG_THAI_KY, type ToneKy } from "@/lib/hoa-hong/ky-man-hinh";
import { cn } from "@/lib/utils";

const MUC: Record<ToneKy, { tone: PillTone; ink: string }> = {
  info: { tone: "info", ink: "text-state-info-ink" },
  warning: { tone: "warning", ink: "text-state-warning-ink" },
  success: { tone: "success", ink: "text-state-success-ink" },
  muted: { tone: "muted", ink: "" },
};

const DA_DONG: ReadonlySet<TrangThaiKy> = new Set<TrangThaiKy>(["LOCKED", "EXPORTED", "PAID"]);

/** `status = null` ⇒ kỳ chưa mở (chưa có trong DB): không phải lỗi, chỉ là chưa có khoản nào được ghi hay Tính. */
export function TrangThaiKyPill({ status, className }: { status: TrangThaiKy | null; className?: string }) {
  if (status === null) {
    return (
      <StatusPill tone="muted" className={className}>
        Chưa mở kỳ
      </StatusPill>
    );
  }
  const m = MUC[TONE_TRANG_THAI_KY[status]];
  return (
    <StatusPill tone={m.tone} className={cn(m.ink, className)}>
      {DA_DONG.has(status) && <Lock aria-hidden className="mr-1 h-3 w-3" />}
      {NHAN_TRANG_THAI_KY[status]}
    </StatusPill>
  );
}
