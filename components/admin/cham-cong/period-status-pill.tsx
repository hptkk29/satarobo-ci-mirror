// components/admin/cham-cong/period-status-pill.tsx — kỳ này đang mở hay đã chốt.
//
// Vì sao file này tồn tại: chốt sổ đóng băng số công, nên "sửa được hay không" là câu hỏi đứng
// trước mọi thao tác ở 8 màn. Trước đây trạng thái kỳ chỉ hiện ở màn Kỳ công, nên người ta sửa
// ô ở lưới rồi mới biết kỳ đã chốt. Pill này đi cùng ScopeBar ở mọi màn, và bấm được để sang
// thẳng màn Kỳ công.
//
// `tone` của StatusPill dùng màu SÁNG (--state-*) — trượt AA trên nền trắng — nên luôn đè
// `text-state-*-ink` như chính ghi chú trong `status-pill.tsx` dặn.
import Link from "next/link";
import { Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import type { PeriodStatus } from "@/lib/cham-cong/module-scope";

const INFO: Record<PeriodStatus, { text: string; tone: PillTone; ink: string }> = {
  // OPEN là tông INFO chứ không phải success: "đang mở" là trạng thái làm việc bình thường,
  // tô xanh lá thành ra khen ngợi một việc chưa xong.
  OPEN: { text: "Đang mở", tone: "info", ink: "text-state-info-ink" },
  CLOSING: { text: "Đang chốt", tone: "warning", ink: "text-state-warning-ink" },
  LOCKED: { text: "Đã chốt", tone: "success", ink: "text-state-success-ink" },
  REOPENED: { text: "Đã mở lại", tone: "warning", ink: "text-state-warning-ink" },
};

export function PeriodStatusPill({
  status,
  href,
  className,
}: {
  status: PeriodStatus | null;
  href?: string;
  className?: string;
}) {
  const info = status ? INFO[status] : null;
  const pill = info ? (
    <StatusPill tone={info.tone} className={cn(info.ink, className)}>
      {status === "LOCKED" && <Lock aria-hidden className="mr-1 h-3 w-3" />}
      {status === "REOPENED" && <Unlock aria-hidden className="mr-1 h-3 w-3" />}
      {info.text}
    </StatusPill>
  ) : (
    // Chưa mở kỳ ≠ lỗi: kỳ chỉ được mở ở màn Kỳ công, ScopeBar cố ý không tự mở hộ.
    <StatusPill tone="muted" className={className}>
      Chưa mở kỳ
    </StatusPill>
  );

  if (!href) return pill;
  return (
    <Link href={href} className="hover:underline">
      {pill}
    </Link>
  );
}
