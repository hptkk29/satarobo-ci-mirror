"use client";

// components/portal/nut-sao-chep-link.tsx — nút «Sao chép» cho link giới thiệu của CHÍNH đối tác (AFF-P3 H3). Client vì cần clipboard + trạng thái «Đã sao chép».
//
// Địa chỉ được truyền xuống từ server (đã dựng từ token CỦA ĐỐI TÁC ĐANG ĐĂNG NHẬP); thành phần này không tự dựng hay tra gì thêm.
// Trình duyệt chặn clipboard (http, quyền) ⇒ nói thẳng «Không sao chép được — hãy chọn và sao chép thủ công», không giả vờ thành công.
import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";

type TrangThai = "nghi" | "xong" | "loi";

export function NutSaoChepLink({ diaChi, nhan }: { diaChi: string; nhan: string }) {
  const [tt, setTt] = useState<TrangThai>("nghi");
  const hen = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function sao() {
    let ketQua: TrangThai = "xong";
    try {
      await navigator.clipboard.writeText(diaChi);
    } catch {
      ketQua = "loi";
    }
    setTt(ketQua);
    if (hen.current) clearTimeout(hen.current);
    hen.current = setTimeout(() => setTt("nghi"), 2500);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={sao}
        aria-label={`Sao chép ${nhan}`}
        className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-9"
      >
        {tt === "xong" ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
        {tt === "xong" ? "Đã sao chép" : "Sao chép"}
      </button>
      <span role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {tt === "loi" ? "Không sao chép được — hãy chọn địa chỉ và sao chép thủ công." : ""}
      </span>
    </div>
  );
}
