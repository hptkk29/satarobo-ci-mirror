"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { sendZnsTest } from "../_actions";

/**
 * AUTH-SĐT P4 — gửi thử ZNS mẫu Xác thực tới 1 SĐT, để kiểm template + tên
 * tham số TRƯỚC khi mở cho phụ huynh thật. Kết quả hiện nguyên văn mã lỗi ZNS
 * (vd `ZNS_NO_ZALO_ACCOUNT:ZNS_ERR_-118:...`) — đừng rút gọn, người trực cần
 * mã số để tra bảng lỗi ZBS.
 */
export function ZnsTest({ canEdit }: { canEdit: boolean }) {
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (!canEdit) return null;

  function submit() {
    setResult(null);
    start(async () => {
      const res = await sendZnsTest({ phone });
      if (res.ok) {
        toast.success(res.live ? "Đã gửi tin thật" : "Mô phỏng (chưa bật live)");
        setResult({ ok: true, text: res.detail ?? "Gửi thành công" });
      } else {
        toast.error("Gửi thử thất bại");
        setResult({ ok: false, text: res.error ?? "Lỗi không rõ" });
      }
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted p-3">
      <div className="text-xs font-semibold text-foreground">Gửi thử ZNS (mẫu Xác thực)</div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Gửi 1 mã ngẫu nhiên tới số bên dưới để đối chiếu nội dung tin. Khi OA còn ở chế độ
        development, chỉ SĐT quản trị viên OA nhận được (số khác trả <code>-127</code>). Mỗi tin
        gửi thành công tốn ~300đ · tối đa 5 lần/giờ.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0905123456"
          inputMode="tel"
          className="w-44 rounded-md border border-border px-2.5 py-1.5 text-sm"
        />
        <button
          onClick={submit}
          disabled={pending || phone.trim().length < 9}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? "Đang gửi…" : "Gửi thử"}
        </button>
      </div>
      {result && (
        <p
          className={`mt-2 break-all text-xs ${result.ok ? "text-state-success-ink" : "text-state-danger-ink"}`}
        >
          {result.ok ? "✅ " : "❌ "}
          {result.text}
        </p>
      )}
    </div>
  );
}
