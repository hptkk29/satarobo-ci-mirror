"use client";

// Nút "Gỡ liên kết" lead nguồn — HAI LẦN BẤM (không `window.confirm`, theo nếp admin).
// Gỡ chỉ xoá `Student.leadId/leadChildId`; các ô đã điền từ lead GIỮ NGUYÊN (action B).

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unlink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { goLienKetLead } from "../../[id]/_lien-ket-lead-actions";
import { NUT_CHU } from "./o-nhap";

export function NutGoLienKet({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [cho, setCho] = useState(false);
  const [dangGo, startGo] = useTransition();
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    if (!cho) return;
    const t = window.setTimeout(() => setCho(false), 4000);
    return () => window.clearTimeout(t);
  }, [cho]);

  function bam() {
    setLoi(null);
    if (!cho) {
      setCho(true);
      return;
    }
    setCho(false);
    startGo(async () => {
      try {
        const res = await goLienKetLead({ studentId });
        if (!res.ok) {
          setLoi(res.error);
          return;
        }
        toast.success("Đã gỡ liên kết lead — các ô đã điền trên hồ sơ giữ nguyên");
        router.refresh();
      } catch {
        setLoi("Mất kết nối — chưa gỡ được. Thử lại.");
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={bam}
        disabled={dangGo}
        className={cn(
          NUT_CHU,
          cho
            ? "bg-state-danger-soft text-state-danger-ink"
            : "text-muted-foreground hover:bg-state-danger-soft hover:text-state-danger-ink",
        )}
      >
        <Unlink className="size-3.5" aria-hidden />
        {dangGo ? "Đang gỡ…" : cho ? "Bấm lần nữa để gỡ" : "Gỡ liên kết"}
      </button>
      {loi && (
        <span role="alert" className="text-xs text-state-danger-ink">
          {loi}
        </span>
      )}
    </span>
  );
}
