"use client";

// ĐÓNG cảnh báo "giao dịch thẻ bị hủy SAU KHI đã ghi nhận" — chỉ `payments:import-pos`.
//
// Nút KHÔNG đảo bút toán nào: tầng POS không bao giờ tự gỡ tiền. Kế toán gỡ gắn / hoàn bằng luồng
// hiện có TRƯỚC, rồi mới đóng cảnh báo ở đây kèm ghi chú (≥ 5 ký tự — cùng ngưỡng với
// `dongCanhBaoHuyPosAction`) để sáu tháng sau còn trả lời được "ai đóng, đã xử lý thế nào".

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { dongCanhBaoHuyPosAction } from "../_pos-actions";

const TOI_THIEU = 5;

export function DongCanhBaoPos({ id }: { id: string }) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [ghiChu, setGhiChu] = useState("");
  const [dangChay, batDau] = useTransition();
  const du = ghiChu.trim().length >= TOI_THIEU;

  function dong() {
    batDau(async () => {
      const res = await dongCanhBaoHuyPosAction({ id, ghiChu });
      if (res.ok) {
        toast.success(res.message);
        setMo(false);
        setGhiChu("");
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
        className="min-h-8 whitespace-nowrap rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-muted"
      >
        Đóng cảnh báo
      </button>
    );
  }

  return (
    <div className="w-[min(88vw,260px)] space-y-2 rounded-md border border-border bg-card p-2">
      <label htmlFor={`ghi-chu-${id}`} className="block text-xs font-semibold text-foreground">
        Đã xử lý thế nào <span className="text-state-danger-ink">*</span>
      </label>
      <textarea
        id={`ghi-chu-${id}`}
        value={ghiChu}
        onChange={(e) => setGhiChu(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="vd: đã gỡ gắn, hoàn tiền mặt cho phụ huynh"
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {!du && ghiChu.length > 0 && (
        <p className="text-[11px] text-muted-foreground">Ít nhất {TOI_THIEU} ký tự.</p>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={dangChay || !du}
          onClick={dong}
          className="rounded bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary-dark disabled:opacity-50"
        >
          {dangChay ? "Đang đóng…" : "Xác nhận đóng"}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </div>
  );
}
