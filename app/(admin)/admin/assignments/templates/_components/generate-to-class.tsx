"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { generateAssignmentFromTemplate } from "../_actions";

interface ClassOption {
  id: string;
  name: string;
  classCode: string | null;
}

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

/**
 * FL1-06 — Sinh BÀI GIAO (Assignment, có classId) từ mẫu hiện tại.
 * Bài mới ở trạng thái DRAFT + giữ templateId truy vết. Sau khi sinh, điều hướng
 * sang trang sửa bài giao để publish cho lớp.
 */
export function GenerateToClass({
  templateId,
  classes,
}: {
  templateId: string;
  classes: ClassOption[];
}) {
  const router = useRouter();
  const [classId, setClassId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleGenerate() {
    setError(null);
    setInfo(null);
    if (!classId) {
      setError("Chọn lớp để sinh bài giao");
      return;
    }
    startTransition(async () => {
      const res = await generateAssignmentFromTemplate({
        templateId,
        classId,
        dueAt: dueAt ? new Date(dueAt) : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setInfo("Đã sinh bài giao (DRAFT). Đang mở trang sửa để publish...");
      router.push(`/assignments/${res.data!.assignmentId}/edit`);
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Sinh bài giao cho lớp
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Tạo một bài tập (gắn lớp, trạng thái DRAFT) sao chép nội dung từ mẫu này.
          Bài giao giữ liên kết về mẫu nguồn để truy vết.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-lg border border-state-success-soft bg-state-success-soft px-4 py-3 text-sm text-state-success-ink">
          {info}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Lớp học <span className="text-state-danger-ink">*</span>
          </span>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            disabled={pending}
            className={inputClass}
          >
            <option value="">— Chọn lớp —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.classCode ? `${c.classCode} · ` : ""}
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Hạn nộp (tuỳ chọn)
          </span>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-xl bg-state-success-ink px-6 py-3 font-bold text-white shadow-md hover:bg-state-success-ink-hover disabled:opacity-60"
      >
        <Send className="h-4 w-4" />
        {pending ? "Đang sinh..." : "Sinh bài giao"}
      </button>
    </section>
  );
}
