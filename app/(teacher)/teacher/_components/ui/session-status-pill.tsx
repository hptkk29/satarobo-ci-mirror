import { CircleDashed } from "lucide-react";

import type { NhanTrangThaiBuoi } from "@/lib/lms/session-order";
import { cn } from "@/lib/utils";

/**
 * Pill trạng thái BUỔI HỌC (ClassSession.status).
 *
 * Cố ý KHÔNG dùng `StatusPill` dùng chung: ở đó `completed` nghĩa là "Hoàn thành"
 * (khoá học), còn với buổi học nghĩa là "Đã dạy". Trộn hai từ điển vào một map sẽ
 * sai nghĩa ở một trong hai chỗ.
 */
export const SESSION_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Đã lên lịch",
  IN_PROGRESS: "Đang diễn ra",
  COMPLETED: "Đã dạy",
  CANCELLED: "Đã hủy",
};

const SESSION_STATUS_CLASS: Record<string, string> = {
  SCHEDULED: "bg-state-info-soft text-state-info-ink",
  IN_PROGRESS: "bg-state-warning-soft text-state-warning-ink",
  COMPLETED: "bg-state-success-soft text-state-success-ink",
  CANCELLED: "bg-state-danger-soft text-state-danger-ink",
};

export function SessionStatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        SESSION_STATUS_CLASS[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {SESSION_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/**
 * Nhãn buổi ĐỌC TỪ `ClassSession.status` (qua `nhanTrangThaiBuoi`).
 *
 * Khác `SessionStatusPill` một điều: nó biết phân biệt "buổi tương lai còn
 * SCHEDULED" (bình thường) với "buổi đã qua ngày mà chưa ai chốt" (việc còn nợ) —
 * hai ca mà `status` một mình không tách được, nên trước D0 cả hai đều in
 * "Đã lên lịch" và cái sau bị nhãn "Hoàn tất" suy-ra che mất.
 *
 * ⚠️ MÀU XANH CHỈ DÀNH CHO `da-day`. Đủ ba việc mà chưa chốt vẫn là CHƯA XONG — tô
 * xanh ở đó là quay lại đúng lỗi D0 đang sửa.
 */
export function BuoiPill({ nhan }: { nhan: NhanTrangThaiBuoi }) {
  if (nhan.loai === "da-day") return <SessionStatusPill status="COMPLETED" />;
  if (nhan.loai === "da-huy") return <SessionStatusPill status="CANCELLED" />;
  if (nhan.loai === "chua-toi-gio") return <SessionStatusPill status="SCHEDULED" />;
  return (
    <div className="space-y-0.5">
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-state-warning-soft px-2.5 py-1 text-xs font-semibold text-state-warning-ink">
        <CircleDashed className="h-3.5 w-3.5" aria-hidden />
        Chưa chốt
      </span>
      <p className="text-xs text-muted-foreground">
        {nhan.sanSangChot ? "Đủ 3 việc — chỉ còn bấm chốt" : "Còn việc chưa xong"}
      </p>
    </div>
  );
}
