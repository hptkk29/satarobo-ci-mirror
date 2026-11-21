"use client";
// Nút "Đồng bộ lại tuần này" — chỉ hiện khi người xem phân công được ở cơ sở này VÀ công tắc phân công đang bật (trang quyết, luật 12:
// không vẽ nút chắc chắn bị từ chối).
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import { dongBoLaiTuanAction } from "../_actions";

export function NutDongBo({ centerId, tuan }: { centerId: string; tuan: string }) {
  const [dang, start] = useTransition();
  return (
    <button
      type="button"
      className={BTN_OUTLINE}
      disabled={dang}
      onClick={() =>
        start(async () => {
          const r = await dongBoLaiTuanAction({ centerId, tuan });
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        })
      }
    >
      <RefreshCw className={dang ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />
      {dang ? "Đang đồng bộ…" : "Đồng bộ lại tuần này"}
    </button>
  );
}
