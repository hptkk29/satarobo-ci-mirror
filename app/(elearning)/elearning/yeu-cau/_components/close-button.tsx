"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { dongYeuCauAction } from "../../_actions";

/**
 * EL-17 — ĐÓNG một yêu cầu đào tạo.
 *
 * ⚠️ Không có nút xoá, và đó là thiết kế: một yêu cầu đã áp cho người ta sáu tháng
 * là một phần lịch sử tuân thủ. Xoá nó làm mọi báo cáo cũ đổi nghĩa hồi tố, và những
 * lượt học sinh ra vì nó bỗng không giải thích được.
 */
export function CloseButton(props: { requirementId: string }) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");

  const du = lyDo.trim().length >= 10;

  const dong = () =>
    batDau(async () => {
      const r = await dongYeuCauAction(
        { requirementId: props.requirementId },
        // `reason` ở tham số THỨ HAI — schema là `.strict()`.
        { reason: lyDo.trim() },
      );
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã đóng yêu cầu");
      setMo(false);
      setLyDo("");
      router.refresh();
    });

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className="rounded-md border px-2 py-1 text-xs"
      >
        Đóng
      </button>
    );
  }

  return (
    <div className="mt-1 space-y-1 rounded-md border p-2 text-left">
      <p className="text-xs text-muted-foreground">
        {/* Nói hệ quả TRƯỚC khi bấm: người đóng cần biết ai đang học dở thì sao. */}
        Đóng từ hôm nay. Những người đang học dở KHÔNG bị huỷ lượt — họ chỉ thôi bị
        đếm là chưa tuân thủ kể từ ngày này.
      </p>
      <textarea
        value={lyDo}
        onChange={(e) => setLyDo(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Lý do đóng (bắt buộc, ít nhất 10 ký tự) — sẽ lưu vào nhật ký"
        className="w-full rounded-md border px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={dangChay || !du}
          onClick={dong}
          className="rounded-md bg-destructive px-3 py-1 text-xs text-destructive-foreground disabled:opacity-50"
        >
          {dangChay ? "Đang đóng…" : "Xác nhận đóng"}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-md border px-3 py-1 text-xs"
        >
          Thôi
        </button>
      </div>
    </div>
  );
}
