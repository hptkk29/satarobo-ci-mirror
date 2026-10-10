"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import { HelpHint } from "@/components/admin/ui/help-hint";
import {
  applyResizeCurriculum,
  previewResizeCurriculum,
} from "../_actions";

type Plan = {
  current: number;
  target: number;
  mode: "noop" | "increase" | "decrease";
  toCreateCount: number;
  toArchive: {
    id: string;
    order: number;
    title: string;
    examCount: number;
    assignmentCount: number;
    documentCount: number;
    hasLinks: boolean;
    isInUse: boolean;
  }[];
  blocked: { order: number }[];
  needsConfirm: boolean;
};

export function CurriculumSessionsForm({
  curriculumId,
  currentCount,
  expectedVersions,
}: {
  curriculumId: string;
  currentCount: number;
  // map lessonId → version (buổi đang hoạt động) cho optimistic-lock khi giảm.
  expectedVersions: Record<string, number>;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<number>(currentCount);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function done(msg: string) {
    setNotice(msg);
    setPlan(null);
    router.refresh();
  }

  function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (target < 1) {
      setError("Số buổi phải ≥ 1");
      return;
    }
    startTransition(async () => {
      const res = await previewResizeCurriculum(curriculumId, target);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const p = res.data as Plan;
      if (p.mode === "noop") {
        setNotice("Số buổi không đổi.");
        return;
      }
      if (p.mode === "increase") {
        // Tăng → áp dụng ngay, không cần confirm.
        const apply = await applyResizeCurriculum({ curriculumId, targetN: target });
        if (!apply.ok) {
          setError(apply.error);
          return;
        }
        done(`Đã thêm ${apply.data?.created ?? 0} buổi mới.`);
        return;
      }
      // decrease → mở modal xác nhận
      setPlan(p);
    });
  }

  function confirmDecrease() {
    setError(null);
    startTransition(async () => {
      const apply = await applyResizeCurriculum({
        curriculumId,
        targetN: target,
        confirm: true,
        expectedVersions,
      });
      if (!apply.ok) {
        setError(apply.error);
        return;
      }
      done(`Đã lưu trữ ${apply.data?.archived ?? 0} buổi.`);
    });
  }

  const hasBlocked = (plan?.blocked.length ?? 0) > 0;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
        Số buổi
        {/* `normal-case tracking-normal` đặt trên NỘI DUNG chứ không trên nút: tiêu đề
            đang uppercase + giãn chữ, hướng dẫn 2 câu mà kế thừa thì đọc không nổi. */}
        <HelpHint className="ml-1">
          <span className="block normal-case tracking-normal">
            Nhập tổng số buổi. Tăng → thêm buổi mới ở cuối (giữ nguyên buổi cũ); giảm →
            lưu trữ buổi cuối (có cảnh báo nếu gắn bài tập/đề thi/tài liệu, không xóa).
          </span>
        </HelpHint>
      </h2>

      {error && (
        <div className="mt-3 rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="mt-3 rounded-lg border border-state-success-soft bg-state-success-soft px-3 py-2 text-sm text-state-success-ink">
          {notice}
        </div>
      )}

      <form onSubmit={handlePreview} className="mt-3 flex items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">
            Tổng số buổi (hiện tại: {currentCount})
          </span>
          <input
            type="number"
            min={1}
            value={target}
            onChange={(e) => setTarget(Math.max(1, parseInt(e.target.value, 10) || 1))}
            disabled={pending}
            className="w-32 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Đang xử lý..." : "Áp dụng"}
        </button>
      </form>

      {plan && plan.mode === "decrease" && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-8"
          onClick={() => !pending && setPlan(null)}
        >
          <div
            className="relative w-full max-w-lg rounded-xl bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => !pending && setPlan(null)}
              aria-label="Đóng"
              className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
            <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <AlertTriangle className="h-5 w-5 text-state-warning-ink" />
              Xác nhận giảm còn {plan.target} buổi
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.toArchive.length} buổi sẽ được <strong>lưu trữ</strong> (đọc-only,
              không xóa — có thể khôi phục sau):
            </p>

            <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
              {plan.toArchive.map((l) => (
                <li
                  key={l.id}
                  className="rounded-lg border border-border bg-muted px-3 py-2 text-sm"
                >
                  <span className="font-semibold text-foreground">
                    Bài {l.order}: {l.title}
                  </span>
                  {l.isInUse && (
                    <span className="ml-2 rounded bg-state-danger-soft px-1.5 py-0.5 text-xs font-semibold text-state-danger-ink">
                      Đang sử dụng — không thể loại
                    </span>
                  )}
                  {l.hasLinks && (
                    <span className="ml-2 text-xs text-state-warning-ink">
                      ⚠ {l.examCount} đề thi · {l.assignmentCount} bài tập ·{" "}
                      {l.documentCount} tài liệu (giữ nguyên link)
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {hasBlocked && (
              <div className="mt-3 rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
                Có buổi đang được sử dụng (IN_USE). Hãy đổi trạng thái khỏi “Đang sử
                dụng” trước khi loại.
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPlan(null)}
                disabled={pending}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={confirmDecrease}
                disabled={pending || hasBlocked}
                className="rounded-lg bg-state-danger-ink px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Đang lưu..." : "Xác nhận lưu trữ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
