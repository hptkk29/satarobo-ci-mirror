"use client";

// Người được GIAO trực tự nhận / từ chối (D-Q3). Từ chối bắt buộc lý do — ô lý do mở ngay dưới nút, không modal.
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { quyetDinhTrucAction } from "../../_actions-truc";

export function NhanTruc({ dutyId, phienBan }: { dutyId: string; phienBan: number }) {
  const [moLyDo, setMoLyDo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [dang, batDau] = useTransition();
  const id = useId();
  const gui = (quyetDinh: "ACCEPTED" | "DECLINED") =>
    batDau(async () => {
      const r = await quyetDinhTrucAction(quyetDinh === "ACCEPTED" ? { dutyId, phienBan, quyetDinh } : { dutyId, phienBan, quyetDinh, lyDo });
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });
  const nut = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
  return (
    <div className="flex flex-col gap-2">
      {moLyDo && (
        <label htmlFor={id} className="flex flex-col gap-1 text-xs text-muted-foreground">
          Lý do từ chối (bắt buộc)
          <input id={id} value={lyDo} onChange={(e) => setLyDo(e.target.value)} maxLength={500} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={dang} onClick={() => gui("ACCEPTED")} className={`${nut} bg-primary text-primary-foreground`}>
          Nhận trực
        </button>
        <button
          type="button"
          disabled={dang}
          onClick={() => (moLyDo ? (lyDo.trim().length < 5 ? toast.error("Ghi lý do (tối thiểu 5 ký tự).") : gui("DECLINED")) : setMoLyDo(true))}
          className={`${nut} border border-border bg-card text-foreground`}
        >
          {moLyDo ? "Gửi từ chối" : "Từ chối"}
        </button>
      </div>
    </div>
  );
}
