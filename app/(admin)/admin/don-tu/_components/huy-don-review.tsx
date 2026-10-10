"use client";

// app/(admin)/admin/don-tu/_components/huy-don-review.tsx — quyết định một YÊU CẦU HUỶ đơn đã duyệt
// (đợt 11). Cùng khuôn `work-request-review.tsx`: hai ô chữ riêng (ghi chú duyệt huỷ / lý do từ chối),
// từ chối bắt buộc lý do — server vẫn chặn (`quyetDinhHuyAction`), đây chỉ là lớp thứ hai.
//
// Duyệt huỷ là HOÀN TÁC (khôi phục ca, gỡ dạy thay, hoàn quỹ…) nên bấm HAI LẦN mới gửi: lần đầu mở khối
// xác nhận đọc lại câu "Khi duyệt huỷ sẽ", lần hai mới gọi server.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { quyetDinhHuyAction } from "@/lib/cham-cong/request-actions";
import { BTN_DANGER, BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";

type Mode = "idle" | "approve" | "reject";
const TEXTAREA = cn(FIELD, "h-20 w-full resize-y py-2 leading-snug");

export function HuyDonReview({
  requestId,
  khiDuyetHuy,
  onDone,
}: {
  requestId: string;
  khiDuyetHuy: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode>("idle");
  const [note, setNote] = useState("");
  const [lyDoTuChoi, setLyDoTuChoi] = useState("");

  function gui(decision: "APPROVED" | "REJECTED") {
    const n = (decision === "APPROVED" ? note : lyDoTuChoi).trim() || null;
    if (decision === "REJECTED" && !n) {
      toast.error("Nhập lý do từ chối huỷ");
      return;
    }
    start(async () => {
      const r = await quyetDinhHuyAction({ id: requestId, decision, note: n });
      if (r.ok) {
        toast.success(decision === "APPROVED" ? (r.note ? `Đã huỷ đơn — ${r.note}` : "Đã huỷ đơn") : "Đã từ chối yêu cầu huỷ — đơn giữ hiệu lực");
        setMode("idle");
        router.refresh();
        onDone?.();
      } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <p className="rounded-lg bg-state-info-soft p-3 text-sm text-state-info-ink">
        <b>Khi duyệt huỷ sẽ:</b> {khiDuyetHuy}.
      </p>
      {mode === "approve" && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <label htmlFor={`huy-note-${requestId}`} className="block text-sm font-semibold text-foreground">
            Ghi chú (không bắt buộc)
          </label>
          <textarea id={`huy-note-${requestId}`} aria-label="Ghi chú duyệt huỷ" value={note} onChange={(e) => setNote(e.target.value)} className={TEXTAREA} maxLength={1000} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => gui("APPROVED")} disabled={pending} className={BTN_DANGER}>
              {pending ? "Đang huỷ…" : "Xác nhận huỷ đơn"}
            </button>
            <button type="button" onClick={() => setMode("idle")} disabled={pending} className={BTN_OUTLINE}>
              Thôi
            </button>
          </div>
        </div>
      )}
      {mode === "reject" && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <label htmlFor={`huy-tuchoi-${requestId}`} className="block text-sm font-semibold text-foreground">
            Lý do từ chối huỷ <span className="text-state-danger-ink">*</span>
          </label>
          <textarea
            id={`huy-tuchoi-${requestId}`}
            aria-label="Lý do từ chối huỷ"
            value={lyDoTuChoi}
            onChange={(e) => setLyDoTuChoi(e.target.value)}
            className={TEXTAREA}
            maxLength={1000}
            required
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => gui("REJECTED")} disabled={pending} className={BTN_PRIMARY}>
              {pending ? "Đang gửi…" : "Từ chối huỷ — đơn giữ hiệu lực"}
            </button>
            <button type="button" onClick={() => setMode("idle")} disabled={pending} className={BTN_OUTLINE}>
              Thôi
            </button>
          </div>
        </div>
      )}
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode("approve")} className={BTN_DANGER}>
            Duyệt huỷ
          </button>
          <button type="button" onClick={() => setMode("reject")} className={BTN_OUTLINE}>
            Từ chối huỷ
          </button>
        </div>
      )}
    </div>
  );
}
