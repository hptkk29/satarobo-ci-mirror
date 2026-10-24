"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { saveSessionFeedback } from "../_actions";
import { SessionEvalFill } from "@/app/(admin)/admin/evaluations/_components/session-eval-fill";

type StudentRow = {
  studentId: string;
  name: string;
  present: boolean;
  comment: string;
  rating: number | null;
};

export function SessionFeedbackEditor({
  sessionId,
  students,
  canEdit,
}: {
  sessionId: string;
  students: StudentRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  /**
   * CHỈ giữ những gì NGƯỜI DÙNG GÕ, không chụp cả danh sách.
   *
   * ⚠️ 19/08 — bản cũ `useState<StudentRow[]>(students)` đóng băng danh sách lúc mount,
   * trong khi mốc so-sánh-dirty (`initialById`) lại memo theo prop nên vẫn tươi. Hai thứ
   * lệch nhau là ra lệnh XOÁ: giáo viên viết nhận xét ở site GV → payload RSC của trang
   * này cập nhật → mốc có nội dung mới, còn `rows` vẫn rỗng như lúc mở màn ⇒ mọi dòng
   * bị coi là "vừa bị xoá chữ" ⇒ bấm Lưu là gửi comment rỗng cho cả lớp, và
   * saveSessionFeedbackCore hiểu dòng rỗng là lệnh xoá phiếu.
   * Dựng giá trị hiển thị từ PROP + phần đã gõ thì hai bên không thể lệch nữa.
   */
  const [edits, setEdits] = useState<Record<string, Partial<StudentRow>>>({});
  const rows = useMemo(
    () => students.map((s) => ({ ...s, ...edits[s.studentId] })),
    [students, edits],
  );
  const initialById = useMemo(
    () => new Map(students.map((s) => [s.studentId, s])),
    [students],
  );

  function update(id: string, patch: Partial<StudentRow>) {
    setEdits((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));
  }

  function save() {
    // FIX #1 (client) — CHỈ gửi dòng dirty (comment/sao đổi). Dòng không chạm KHÔNG gửi
    // → server không nhầm phiếu rubric-only (comment rỗng) thành lệnh xoá phiếu.
    const items = rows
      .filter((r) => {
        const init = initialById.get(r.studentId);
        return (
          !init ||
          r.comment.trim() !== init.comment.trim() ||
          (r.rating ?? null) !== (init.rating ?? null)
        );
      })
      .map((r) => ({
        studentId: r.studentId,
        comment: r.comment,
        rating: r.rating,
      }));
    if (items.length === 0) {
      toast("Không có thay đổi để lưu");
      return;
    }
    startTransition(async () => {
      const res = await saveSessionFeedback({ sessionId, items });
      if (res.ok) {
        toast.success("Đã lưu nhận xét từng học sinh");
        // Bỏ phần đã gõ để màn hình quay về đúng dữ liệu server vừa trả.
        setEdits({});
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (students.length === 0) {
    return <p className="text-sm text-muted-foreground">Lớp chưa có học sinh đăng ký.</p>;
  }

  return (
    <div className="space-y-4">
      {/* FL4 — phiếu đánh giá buổi học (SESSION_EVAL) động theo từng HS là UI CHÍNH. */}
      <SessionEvalFill
        sessionId={sessionId}
        students={rows.map((r) => ({ studentId: r.studentId, name: r.name, present: r.present }))}
        canEdit={canEdit}
      />

      {/* Đường cũ comment+rating (StudentSessionFeedback) — GIỮ song song (2-phase),
          thu gọn dưới mục phụ; portal /portal/nhan-xet vẫn đọc đường cũ này. */}
      <details className="rounded-lg border border-border bg-muted/60">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
          Nhận xét nhanh (cũ) — nhận xét + chấm sao từng học sinh
        </summary>
        <div className="space-y-3 px-3 pb-3">
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.studentId} className="py-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-medium text-foreground">{r.name}</span>
                  {!r.present && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Vắng
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <textarea
                    value={r.comment}
                    onChange={(e) => update(r.studentId, { comment: e.target.value })}
                    disabled={!canEdit || pending}
                    rows={2}
                    placeholder="Nhận xét cho học sinh này trong buổi…"
                    className="flex-1 resize-y rounded-lg border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none disabled:bg-muted"
                  />
                  <select
                    value={r.rating ?? ""}
                    onChange={(e) =>
                      update(r.studentId, { rating: e.target.value ? Number(e.target.value) : null })
                    }
                    disabled={!canEdit || pending}
                    className="h-9 rounded-lg border border-border px-2 text-sm focus:border-primary focus:outline-none disabled:bg-muted"
                    aria-label={`Điểm ${r.name}`}
                  >
                    <option value="">— sao —</option>
                    {[5, 4, 3, 2, 1].map((s) => (
                      <option key={s} value={s}>{s} ★</option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
          {canEdit && (
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {pending ? "Đang lưu…" : "Lưu nhận xét nhanh"}
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
