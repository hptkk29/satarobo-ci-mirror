"use client";

// GỠ một giao dịch đã gắn — chỉ kế toán (`payments:manage`).
//
// ⚠️ Vì sao bắt gõ lý do chứ không phải bấm hai lần cho nhanh: gỡ gắn đẩy công nợ của một bé
// TĂNG LẠI, và người nhận hậu quả là phụ huynh nhận cuộc gọi đòi tiền đã đóng. Sáu tháng sau,
// câu hỏi sẽ là "ai gỡ, và vì sao" — hai lần bấm không trả lời được câu nào.
//
// Nút KHÔNG xoá gì: phân bổ được gỡ, còn dòng `Payment` gốc ở lại nguyên và được trung hoà
// bằng một bút toán đảo. Xem `goGanTheoCon` (lib/finance/ghi-tien-don.ts).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { goGanGiaoDichAction } from "../_gan-theo-con";

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

export function GoGanGiaoDich({
  bankTransactionId,
  amount,
  laThe,
}: {
  bankTransactionId: string;
  amount: number;
  /**
   * Giao dịch QUẸT THẺ POS — Q-M (chủ dự án chốt 30/09/2026): gỡ gắn thẻ luôn ĐÓNG phiếu gộp nó đã trả,
   * không mở lại. Hộp xác nhận phải NÓI TRƯỚC điều đó (luật 12). BẮT BUỘC — không mặc định (luật 7).
   */
  laThe: boolean;
}) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [dangChay, batDau] = useTransition();

  function go() {
    batDau(async () => {
      const res = await goGanGiaoDichAction({ bankTransactionId, lyDo });
      if (res.ok) {
        toast.success(res.message);
        setMo(false);
        setLyDo("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted"
      >
        Gỡ gắn
      </button>
    );
  }

  return (
    <div className="w-[min(92vw,260px)] space-y-2 rounded-md border border-border bg-card p-2">
      <label className="block text-xs font-semibold text-foreground">
        Lý do gỡ <span className="text-state-danger-ink">*</span>
      </label>
      <textarea
        value={lyDo}
        onChange={(e) => setLyDo(e.target.value)}
        rows={2}
        placeholder="vd: gắn nhầm sang đơn của bé khác"
        className="w-full rounded border border-border px-2 py-1 text-xs focus:border-primary focus:outline-none"
      />
      <p className="text-[11px] leading-snug text-muted-foreground">
        {fmt(amount)}đ sẽ về lại hàng chờ đối soát (giao dịch thẻ đã bị hủy/hoàn thì sang Bỏ qua),
        công nợ của bé tăng lại đúng phần đã gỡ.
        Dòng thu gốc KHÔNG bị xoá — hệ thống ghi thêm một bút toán đảo.
      </p>
      {laThe && (
        <p role="status" className="text-[11px] font-medium leading-snug text-state-warning-ink">
          Giao dịch thẻ: mã phiếu gộp mà tiền này đã trả hoặc đã lấp sẽ ĐÓNG, không mở lại — phát mã mới nếu cần thu lại.
          Phiếu phát SAU khi gắn khoản này giữ nguyên.
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={dangChay || !lyDo.trim()}
          onClick={go}
          className="rounded bg-state-danger-ink px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          {dangChay ? "Đang gỡ…" : "Xác nhận gỡ"}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </div>
  );
}
