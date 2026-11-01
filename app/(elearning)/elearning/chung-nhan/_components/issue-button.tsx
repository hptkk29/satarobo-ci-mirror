"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { capChungNhanTayAction } from "../../_actions";
import { NUT_CHINH, NUT_NHO, NUT_PHU, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";

/**
 * EL-16 — nút CẤP CHỨNG NHẬN BẰNG TAY cho một lượt đã hoàn thành mà chưa có.
 *
 * ⚠️ Nút này là CỬA của khoá quyền `elearning:certificate:issue` — một trong 17 khoá
 * của module, và trước đó không mã nào dùng tới.
 */
export function IssueButton(props: { enrollmentId: string; tenNguoi: string }) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");

  const du = lyDo.trim().length >= 10;

  const cap = () =>
    batDau(async () => {
      const r = await capChungNhanTayAction(
        { enrollmentId: props.enrollmentId },
        // `reason` ở tham số THỨ HAI — schema là `.strict()`.
        { reason: lyDo.trim() },
      );
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(
        r.data.daCoTruoc
          ? `Lượt này đã có chứng nhận ${r.data.certCode} từ trước`
          : `Đã cấp ${r.data.certCode}`,
      );
      setMo(false);
      setLyDo("");
      router.refresh();
    });

  if (!mo) {
    return (
      <button type="button" onClick={() => setMo(true)} aria-expanded={false} className={NUT_NHO}>
        Cấp chứng nhận
      </button>
    );
  }

  return (
    <div className="mt-2 min-w-64 space-y-2 rounded-xl border border-border bg-background p-3 text-left text-sm">
      <p className="text-sm text-muted-foreground">
        {/* Nói rõ đây KHÔNG phải cửa sau: người bấm cần biết hệ thống vẫn kiểm, để
            không đi hỏi vì sao "cấp tay" mà vẫn bị từ chối. */}
        Cấp cho <strong>{props.tenNguoi}</strong>. Hệ thống vẫn kiểm đủ điều kiện và
        vẫn tự suy hạn hiệu lực — đây không phải đường bỏ qua điều kiện.
      </p>
      <textarea
        value={lyDo}
        onChange={(e) => setLyDo(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Lý do cấp tay (bắt buộc, ít nhất 10 ký tự) — sẽ lưu vào nhật ký"
        aria-label="Lý do (bắt buộc)"
        className={O_NHAP_VAN_BAN}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={dangChay || !du} onClick={cap} className={NUT_CHINH}>
          {dangChay ? "Đang cấp…" : "Xác nhận cấp"}
        </button>
        <button type="button" onClick={() => setMo(false)} className={NUT_PHU}>
          Thôi
        </button>
      </div>
    </div>
  );
}
