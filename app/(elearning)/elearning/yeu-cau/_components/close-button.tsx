"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { dongYeuCauAction } from "../../_actions";
import { NUT_NGUY, NUT_NHO, NUT_PHU, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";

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
      <button type="button" onClick={() => setMo(true)} aria-expanded={false} className={NUT_NHO}>
        Đóng yêu cầu
      </button>
    );
  }

  return (
    <div className="mt-1 min-w-64 space-y-2 rounded-xl border border-border bg-background p-3 text-left">
      <p className="text-sm text-muted-foreground">
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
        aria-label="Lý do đóng yêu cầu"
        className={O_NHAP_VAN_BAN}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={dangChay || !du} onClick={dong} className={NUT_NGUY}>
          {dangChay ? "Đang đóng…" : "Xác nhận đóng"}
        </button>
        <button type="button" onClick={() => setMo(false)} className={NUT_PHU}>
          Thôi
        </button>
      </div>
    </div>
  );
}
