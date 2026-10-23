"use client";

// Hỏi LÝ DO trước khi đẩy lead vào một bậc rơi (`LEAD_DROP_STATUSES`).
//
// Vì sao là hộp thoại chứ không phải một ô trong form: ba chỗ đổi trạng thái tay
// (kéo thẻ Kanban, ô chọn ở bảng, nút Lưu ở ngăn chi tiết) đều là thao tác MỘT CÚ —
// nhét thêm một ô cố định vào cả ba là bắt người dùng nhìn nó ở 8 bậc còn lại, nơi
// nó vô nghĩa. Hộp thoại chỉ bật đúng hai bậc cần.
//
// Server vẫn kiểm lại (`updateLeadStatus`): hộp thoại này là tiện nghi, không phải rào.

import { useEffect, useState } from "react";
import type { LeadStatus } from "@prisma/client";
import { LEAD_STATUS_LABEL } from "@/lib/leads/status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function LyDoRotDialog({
  status,
  tenLead,
  dangGui,
  onXacNhan,
  onHuy,
}: {
  /** Bậc sắp chuyển tới. `null` = đóng hộp thoại. */
  status: LeadStatus | null;
  tenLead?: string | null;
  dangGui?: boolean;
  onXacNhan: (lyDo: string) => void;
  onHuy: () => void;
}) {
  const [lyDo, setLyDo] = useState("");

  // Mỗi lần mở cho một lead/bậc khác thì xoá chữ cũ — giữ lại là để người dùng
  // vô tình gán lý do của lead trước cho lead sau.
  useEffect(() => {
    if (status) setLyDo("");
  }, [status]);

  const du = lyDo.trim().length >= 3;

  return (
    <Dialog open={status !== null} onOpenChange={(o) => !o && onHuy()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Chuyển sang &quot;{status ? LEAD_STATUS_LABEL[status] : ""}&quot;
          </DialogTitle>
          <DialogDescription>
            {tenLead ? `${tenLead} — ` : ""}Lead rời phễu ở bước này. Ghi lý do để
            báo cáo biết vì sao mất, không chỉ biết mất ở bậc nào.
          </DialogDescription>
        </DialogHeader>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">
            Lý do <span className="text-red-600">*</span>
          </span>
          <textarea
            autoFocus
            rows={3}
            value={lyDo}
            maxLength={500}
            onChange={(e) => setLyDo(e.target.value)}
            placeholder="VD: học phí cao hơn dự tính, đã chọn trung tâm khác, chưa sắp được lịch…"
            className="w-full rounded-lg border border-border p-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {du ? `${lyDo.trim().length}/500` : "Ít nhất 3 ký tự"}
          </span>
        </label>

        <DialogFooter>
          <button
            type="button"
            onClick={onHuy}
            disabled={dangGui}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={() => onXacNhan(lyDo.trim())}
            disabled={!du || dangGui}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {dangGui ? "Đang lưu…" : "Xác nhận"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
