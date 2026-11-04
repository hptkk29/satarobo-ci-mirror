"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { quyetCoAction } from "../../../_actions";

/**
 * EL-13 — HAI NÚT QUYẾT của người xử cờ.
 *
 * ⚠️ Gỡ cờ BẮT BUỘC có lý do, và nút bị khoá cho tới khi có chữ. Máy trạng thái ở
 * server cũng chặn — nhưng để nút bấm được rồi mới báo lỗi là bắt người xử gõ lại
 * từ đầu, và họ sẽ học cách gõ một dấu chấm cho xong.
 *
 * Giữ cờ thì KHÔNG bắt buộc lý do: nó là kết quả mặc định của việc không có gì
 * phản bác, và đòi lý do cho một hành động "giữ nguyên hiện trạng" chỉ đẻ ra những
 * dòng ghi chú rỗng nghĩa.
 */
export function DecideFlag(props: { flagId: string }) {
  const [lyDo, setLyDo] = useState("");
  const [dangGui, batDau] = useTransition();

  const quyet = (giuCo: boolean) => {
    batDau(async () => {
      const r = await quyetCoAction({
        flagId: props.flagId,
        giuCo,
        lyDo: lyDo.trim() || null,
      });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(giuCo ? "Đã giữ cờ" : "Đã gỡ cờ");
    });
  };

  return (
    <div className="mt-2 space-y-2">
      <input
        value={lyDo}
        onChange={(e) => setLyDo(e.target.value)}
        placeholder="Lý do (bắt buộc khi gỡ cờ)"
        className="w-full rounded-md border px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={dangGui || lyDo.trim().length === 0}
          onClick={() => quyet(false)}
          className="rounded-md border border-green-600 px-3 py-1.5 text-xs text-green-700 disabled:opacity-40"
        >
          Gỡ cờ
        </button>
        <button
          type="button"
          disabled={dangGui}
          onClick={() => quyet(true)}
          className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-40"
        >
          Giữ cờ
        </button>
      </div>
    </div>
  );
}
