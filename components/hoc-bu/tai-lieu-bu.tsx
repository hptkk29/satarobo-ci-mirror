"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BookOpen, Send } from "lucide-react";
import type { TaiLieuBu } from "@/lib/hoc-bu/tai-lieu-bu";

// TÀI LIỆU + BÀI KIỂM TRA của buổi bù (29/09/2026) — dùng chung admin + site GV.
// ⚠️ Chỉ token `:root` (site GV không có `.admin-scope`).
type KetQua = { ok: true; soBe: number } | { ok: false; error: string };

export function KhoiTaiLieuBu({
  taiLieu,
  hrefScorm,
  soCoMat,
  guiBai,
}: {
  taiLieu: TaiLieuBu;
  /** Đường mở bài giảng (site GV) — null = người xem không mở SCORM từ màn này. */
  hrefScorm: string | null;
  soCoMat: number;
  /** null = người xem không gửi bài được. */
  guiBai: ((examId: string) => Promise<KetQua>) | null;
}) {
  const [examId, setExamId] = useState(taiLieu.deKiemTra[0]?.id ?? "");
  const [pending, start] = useTransition();

  function gui() {
    if (!guiBai || !examId) return;
    start(async () => {
      try {
        const kq = await guiBai(examId);
        if (!kq.ok) toast.error(kq.error);
        else toast.success(kq.soBe ? `Đã gửi bài cho ${kq.soBe} bé` : "Các bé đã có bài này rồi");
      } catch {
        toast.error("Mất kết nối — chưa gửi được, thử lại");
      }
    });
  }

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BookOpen className="size-4" aria-hidden /> Bài giảng của buổi bù
        </h3>
        {taiLieu.scorm ? (
          <>
            <p className="mt-1 truncate text-sm text-muted-foreground">{taiLieu.scorm.name}</p>
            {hrefScorm && (
              <a
                href={hrefScorm}
                className="mt-3 inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Mở bài giảng
              </a>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Bài này chưa có gói SCORM đang dùng — báo Đào tạo.</p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Send className="size-4" aria-hidden /> Bài kiểm tra bù
        </h3>
        {taiLieu.deKiemTra.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Bài này không có đề kiểm tra — không cần gửi.</p>
        ) : guiBai ? (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="Đề kiểm tra"
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
            >
              {taiLieu.deKiemTra.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={gui}
              disabled={pending || soCoMat === 0}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {pending ? "Đang gửi…" : `Gửi cho ${soCoMat} bé có mặt`}
            </button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{taiLieu.deKiemTra.length} đề của bài — giáo viên gửi sau buổi bù.</p>
        )}
        {guiBai && soCoMat === 0 && taiLieu.deKiemTra.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Điểm danh có mặt trước, rồi mới gửi bài được.</p>
        )}
      </div>
    </section>
  );
}
