"use client";

// components/cham-cong/nut-xin-huy-don.tsx — nút "Xin huỷ" một đơn ĐÃ DUYỆT (đợt 11 đơn từ). Dùng chung
// "Đơn của tôi" ở site admin và site GV — thư mục dùng chung ⇒ chỉ token `:root`.
//
// Trang chỉ vẽ nút khi `coTheXinHuy` (lib/cham-cong/huy-don-mo-ta.ts) — cùng hàm cổng server hỏi.
// Lý do bắt buộc (server kiểm lại ≥5 ký tự). Xin huỷ chưa phải đã huỷ: đơn giữ hiệu lực tới khi quản lý
// duyệt huỷ — câu dưới ô nói rõ điều đó và nói hệ thống sẽ làm gì nếu được duyệt.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { yeuCauHuyDonAction } from "@/lib/cham-cong/request-actions";

const NUT =
  "inline-flex h-8 items-center rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-60";

export function NutXinHuyDon({ id, khiDuyetHuy, className }: { id: string; khiDuyetHuy: string; className?: string }) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [pending, start] = useTransition();

  const gui = () => {
    if (lyDo.trim().length < 5) {
      toast.error("Ghi lý do xin huỷ (tối thiểu 5 ký tự)");
      return;
    }
    start(async () => {
      const r = await yeuCauHuyDonAction({ id, lyDo });
      if (r.ok) {
        toast.success("Đã gửi yêu cầu huỷ — đơn vẫn hiệu lực tới khi quản lý duyệt huỷ");
        setMo(false);
        setLyDo("");
        router.refresh();
      } else toast.error(r.error);
    });
  };

  if (!mo) {
    return (
      <button type="button" onClick={() => setMo(true)} className={cn(NUT, "block border-border bg-card text-muted-foreground hover:bg-muted", className)}>
        Xin huỷ
      </button>
    );
  }
  return (
    <div className={cn("w-full min-w-[14rem] max-w-sm space-y-1.5", className)}>
      <label htmlFor={`xin-huy-${id}`} className="block text-xs font-semibold text-foreground">
        Lý do xin huỷ <span className="text-state-danger-ink">*</span>
      </label>
      <textarea
        id={`xin-huy-${id}`}
        value={lyDo}
        onChange={(e) => setLyDo(e.target.value)}
        rows={2}
        maxLength={1000}
        className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-sm text-foreground"
      />
      <p className="text-xs text-muted-foreground">Nếu quản lý duyệt huỷ, hệ thống sẽ: {khiDuyetHuy}.</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={gui} disabled={pending} className={cn(NUT, "border-state-danger bg-state-danger-soft text-state-danger-ink")}>
          {pending ? "Đang gửi…" : "Gửi yêu cầu huỷ"}
        </button>
        <button type="button" onClick={() => setMo(false)} disabled={pending} className={cn(NUT, "border-border bg-card text-muted-foreground hover:bg-muted")}>
          Thôi
        </button>
      </div>
    </div>
  );
}
