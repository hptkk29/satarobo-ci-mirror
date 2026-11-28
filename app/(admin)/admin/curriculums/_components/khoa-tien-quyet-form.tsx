"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  clearCoursePrerequisites,
  setCoursePrerequisites,
} from "../../course-prerequisites/_actions";

type Muc = { id: string; nhan: string };

export function KhoaTienQuyetForm({
  courseId,
  tenKhoa,
  dangYeuCau,
  luaChon,
  coTheSua,
}: {
  courseId: string;
  tenKhoa: string;
  dangYeuCau: Muc[];
  luaChon: Muc[];
  /** `courses:create` — cùng cổng với server action; không có thì chỉ xem. */
  coTheSua: boolean;
}) {
  const router = useRouter();
  const [chon, setChon] = useState<Set<string>>(() => new Set(dangYeuCau.map((m) => m.id)));
  const [dang, start] = useTransition();
  const goc = new Set(dangYeuCau.map((m) => m.id));
  const daDoi = chon.size !== goc.size || [...chon].some((id) => !goc.has(id));

  function doi(id: string) {
    setChon((cu) => {
      const moi = new Set(cu);
      if (moi.has(id)) moi.delete(id);
      else moi.add(id);
      return moi;
    });
  }

  function luu() {
    start(async () => {
      const kq =
        chon.size === 0
          ? await clearCoursePrerequisites(courseId)
          : await setCoursePrerequisites({ courseId, requiredCourseIds: [...chon] });
      if (!kq.ok) {
        toast.error(kq.error);
        return;
      }
      toast.success(chon.size === 0 ? "Đã bỏ hết khoá tiên quyết" : "Đã lưu khoá tiên quyết");
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Workflow className="size-4 text-primary" aria-hidden />
        Khoá tiên quyết
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Học viên phải <b className="font-medium text-foreground">hoàn thành</b> các khoá dưới đây trước khi được
        đăng ký vào <span className="font-medium text-foreground">{tenKhoa}</span>. Cấu hình theo khoá, nên mọi
        giáo trình của khoá này dùng chung.
      </p>

      {!coTheSua ? (
        <p className="mt-3 text-sm">
          {dangYeuCau.length ? (
            dangYeuCau.map((m) => m.nhan).join(" · ")
          ) : (
            <span className="text-muted-foreground">Không yêu cầu khoá nào.</span>
          )}
        </p>
      ) : luaChon.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Chưa có khoá dạy nào khác để chọn.</p>
      ) : (
        <>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Chọn khoá tiên quyết">
            {luaChon.map((m) => {
              const bat = chon.has(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    aria-pressed={bat}
                    disabled={dang}
                    onClick={() => doi(m.id)}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-sm transition-colors disabled:opacity-60",
                      bat
                        ? "border-primary bg-primary-soft font-medium text-primary-ink"
                        : "border-border bg-background text-foreground hover:bg-muted",
                    )}
                  >
                    {m.nhan}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground tabular-nums">Đang chọn {chon.size} khoá</p>
            <Button size="sm" onClick={luu} disabled={dang || !daDoi}>
              {dang ? "Đang lưu…" : "Lưu khoá tiên quyết"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
