"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { xoaBaiLamAction } from "@/app/(portal)/portal/disc/_actions-so";

/** Xoá MỘT lần làm bài (hai bước: bấm «Xoá» rồi xác nhận). Server kiểm quyền sở hữu sổ; id lạ ≡ không tìm thấy. */
export function XoaLanLam({ baiId, lan }: { baiId: string; lan: string }) {
  const [hoi, setHoi] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangXoa, batDau] = useTransition();
  const router = useRouter();

  if (!hoi) {
    return (
      <button type="button" onClick={() => setHoi(true)} className="min-h-9 flex-none rounded-lg px-2 text-xs font-semibold text-[var(--sr-ink-muted)] underline hover:text-[var(--sr-bad-ink)]">
        Xoá
      </button>
    );
  }
  return (
    <span role="group" aria-label={`Xác nhận xoá ${lan}`} className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-[var(--sr-bad-bg)] px-3 py-2 text-xs">
      <span className="flex-[1_1_220px]">Xoá {lan}? Bản phân tích có dùng lần này cũng bị xoá. Không hoàn tác được.</span>
      {loi ? <span role="alert" className="text-[var(--sr-bad-ink)]">{loi}</span> : null}
      <button
        type="button"
        disabled={dangXoa}
        onClick={() =>
          batDau(async () => {
            const r = await xoaBaiLamAction(baiId);
            if (!r.ok) setLoi(r.error);
            else router.refresh();
          })
        }
        className="min-h-9 rounded-lg bg-[var(--sr-bad)] px-3 font-bold text-white disabled:opacity-60"
      >
        {dangXoa ? "Đang xoá…" : "Xoá lần làm"}
      </button>
      <button type="button" onClick={() => setHoi(false)} className="min-h-9 rounded-lg border border-border bg-card px-3 font-semibold">
        Huỷ
      </button>
    </span>
  );
}
