"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { thuHoiChungNhanAction } from "../../_actions";

/**
 * EL-16 — nút THU HỒI chứng nhận.
 *
 * ⚠️ Ô lý do là BẮT BUỘC, và nút bị khoá cho tới khi có đủ chữ. Server cũng chặn
 * (`requireReason` của factory) — hai lớp, cố ý: chặn ở server là để không đường
 * vòng nào lách được, còn chặn ở client là để người dùng biết TRƯỚC khi bấm, thay vì
 * bấm rồi nhận một câu từ chối.
 *
 * ⚠️ Không có bước "bấm hai lần để xác nhận" kiểu bảng dữ liệu thường. Ở đây chính
 * ô lý do là bước xác nhận: gõ được một câu giải thích thì không phải bấm nhầm.
 */
export function RevokeButton(props: { certificateId: string; certCode: string }) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");

  const du = lyDo.trim().length >= 10;

  const thuHoi = () =>
    batDau(async () => {
      const r = await thuHoiChungNhanAction(
        { certificateId: props.certificateId },
        // ⚠️ `reason` đi ở THAM SỐ THỨ HAI, không nằm trong input: schema của action
        // là `.strict()`, nhét vào input sẽ bị zod bác.
        { reason: lyDo.trim() },
      );
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(`Đã thu hồi ${props.certCode}`);
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
        Thu hồi
      </button>
    );
  }

  return (
    <div className="mt-1 space-y-1 rounded-md border p-2 text-left">
      <p className="text-xs text-muted-foreground">
        {/* Nói hệ quả TRƯỚC khi bấm. Người thu hồi cần biết trang tra cứu công khai
            sẽ đổi câu trả lời ngay, còn bản PDF trong tay người ta thì không. */}
        Thu hồi <span className="font-mono">{props.certCode}</span>: trang tra cứu
        công khai sẽ báo &ldquo;đã thu hồi&rdquo; ngay. Bản PDF đã phát vẫn còn trong
        tay người được cấp.
      </p>
      <textarea
        value={lyDo}
        onChange={(e) => setLyDo(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Lý do thu hồi (bắt buộc, ít nhất 10 ký tự) — sẽ lưu vào nhật ký"
        className="w-full rounded-md border px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={dangChay || !du}
          onClick={thuHoi}
          className="rounded-md bg-destructive px-3 py-1 text-xs text-destructive-foreground disabled:opacity-50"
        >
          {dangChay ? "Đang thu hồi…" : "Xác nhận thu hồi"}
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
