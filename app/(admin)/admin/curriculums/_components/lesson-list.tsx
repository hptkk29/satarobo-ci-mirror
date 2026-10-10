"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Lock,
  MessageSquarePlus,
  FileBox,
  Pencil,
  Plus,
  Trash2,
  Unlock,
} from "lucide-react";
import type { LessonStatus } from "@prisma/client";
import { LessonFormDialog, type LessonFormValue } from "./lesson-form-dialog";
import { LessonChangeRequestDialog } from "./lesson-change-request-dialog";
import {
  archiveLessonAction,
  deleteLesson,
  reorderLessons,
  setLessonStatusAction,
  unarchiveLessonAction,
} from "../_actions";

export type LessonRow = LessonFormValue & {
  status: LessonStatus;
  version: number;
  archivedAt: string | null;
  openChangeRequests: number;
};

const STATUS_LABEL: Record<LessonStatus, string> = {
  INCOMPLETE: "Chưa hoàn thiện",
  COMPLETE: "Hoàn thiện",
  IN_USE: "Đang sử dụng",
  NEEDS_UPDATE: "Cần cập nhật",
  LOCKED: "Đã khóa",
};

const STATUS_CLASS: Record<LessonStatus, string> = {
  INCOMPLETE: "bg-muted text-muted-foreground",
  COMPLETE: "bg-state-success-soft text-state-success-ink",
  IN_USE: "bg-state-info-soft text-state-info-ink",
  NEEDS_UPDATE: "bg-state-warning-soft text-state-warning-ink",
  LOCKED: "bg-state-danger-soft text-state-danger-ink",
};

const SELECTABLE_STATUSES: LessonStatus[] = [
  "INCOMPLETE",
  "COMPLETE",
  "IN_USE",
  "NEEDS_UPDATE",
];

export function LessonList({
  curriculumId,
  initialLessons,
  canManageTraining,
  canAuthor,
  moNganBuoi = false,
}: {
  curriculumId: string;
  initialLessons: LessonRow[];
  // Đào tạo (training:manage) — mở khóa buổi LOCKED.
  canManageTraining: boolean;
  // GV (questions:author) — gửi đề xuất chỉnh sửa.
  canAuthor: boolean;
  /** true ⇒ nút Sửa mở NGĂN chỉnh buổi (nội dung + giáo án SCORM + bài tập) qua `?bai=`
   *  thay vì hộp thoại chỉ có nội dung. Trang giáo trình dựng ngăn đó ở tab Thiết lập. */
  moNganBuoi?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  function moNgan(id: string, ngan: "noi-dung" | "tai-lieu") {
    const q = new URLSearchParams(sp?.toString() ?? "");
    q.set("bai", id);
    if (ngan === "tai-lieu") q.set("ngan", ngan);
    else q.delete("ngan");
    router.replace(`?${q.toString()}`, { scroll: false });
  }
  const active = initialLessons.filter((l) => !l.archivedAt);
  const archived = initialLessons.filter((l) => l.archivedAt);
  const [lessons, setLessons] = useState<LessonRow[]>(active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // `lessons` là state cục bộ CHỈ để đổi thứ tự lạc quan (hàm move). useState chỉ nhận
  // giá trị khởi tạo ở lần mount ĐẦU, nên sau khi sửa tên/trạng thái buổi thì
  // router.refresh() có nạp dữ liệu mới về prop cũng vô ích — màn hình đứng im cho tới
  // khi F5. Đồng bộ lại khi prop đổi (idiom sẵn có ở leads-kanban.tsx:81).
  useEffect(() => {
    setLessons(initialLessons.filter((l) => !l.archivedAt));
  }, [initialLessons]);

  const nextOrder =
    initialLessons.length === 0
      ? 1
      : Math.max(...initialLessons.map((l) => l.order)) + 1;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Có lỗi xảy ra");
        return;
      }
      router.refresh();
    });
  }

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= lessons.length) return;
    const next = [...lessons];
    [next[idx], next[j]] = [next[j], next[idx]];
    setLessons(next);
    setError(null);
    startTransition(async () => {
      const res = await reorderLessons({
        curriculumId,
        lessonIds: next.map((l) => l.id),
      });
      if (!res.ok) {
        setError(res.error);
        setLessons(active);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete(lesson: LessonRow) {
    if (
      !confirm(
        `Xoá vĩnh viễn "Bài ${lesson.order}: ${lesson.title}"? Cân nhắc "Lưu trữ" thay vì xoá. Hành động này không hoàn tác.`,
      )
    ) {
      return;
    }
    run(() => deleteLesson(lesson.id));
  }

  function handleStatusChange(lesson: LessonRow, status: LessonStatus) {
    if (status === lesson.status) return;
    run(() => setLessonStatusAction({ lessonId: lesson.id, status }));
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border p-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Bài học ({lessons.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            Sắp xếp bằng nút ↑↓; đổi trạng thái / khóa / lưu trữ từng buổi.
          </p>
        </div>
        <LessonFormDialog
          curriculumId={curriculumId}
          defaultOrder={nextOrder}
          trigger={(open) => (
            <button
              type="button"
              onClick={open}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Thêm bài
            </button>
          )}
        />
      </header>

      {error && (
        <div className="border-b border-state-danger-soft bg-state-danger-soft px-4 py-2 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      {lessons.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Chưa có bài học. Bấm “Thêm bài” hoặc dùng “Số buổi” để sinh nhanh.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {lessons.map((lesson, idx) => {
            const locked = lesson.status === "LOCKED";
            return (
              <li key={lesson.id} className="p-3 hover:bg-muted/60">
                <div className="flex items-start gap-3">
                  <div className="pt-1 font-bold tabular-nums text-foreground w-16 shrink-0">
                    Bài {lesson.order}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">
                        {lesson.title}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[lesson.status]}`}
                      >
                        {STATUS_LABEL[lesson.status]}
                      </span>
                      {lesson.openChangeRequests > 0 && (
                        <span className="rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-primary">
                          {lesson.openChangeRequests} đề xuất chờ
                        </span>
                      )}
                    </div>
                    {lesson.description && (
                      <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                        {lesson.description}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={locked ? "LOCKED" : lesson.status}
                        onChange={(e) =>
                          handleStatusChange(lesson, e.target.value as LessonStatus)
                        }
                        disabled={pending || locked}
                        title={locked ? "Buổi đang khóa — dùng nút Mở khóa" : "Đổi trạng thái"}
                        className="rounded-lg border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-60"
                      >
                        {locked && <option value="LOCKED">Đã khóa</option>}
                        {SELECTABLE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>

                      {locked ? (
                        <button
                          type="button"
                          onClick={() =>
                            run(() =>
                              setLessonStatusAction({ lessonId: lesson.id, status: "COMPLETE" }),
                            )
                          }
                          disabled={pending || !canManageTraining}
                          title={
                            canManageTraining
                              ? "Mở khóa (Đào tạo)"
                              : "Chỉ Đào tạo mới mở khóa được"
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40"
                        >
                          <Unlock className="h-3.5 w-3.5" /> Mở khóa
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            run(() =>
                              setLessonStatusAction({ lessonId: lesson.id, status: "LOCKED" }),
                            )
                          }
                          disabled={pending}
                          title="Khóa nội dung buổi"
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40"
                        >
                          <Lock className="h-3.5 w-3.5" /> Khóa
                        </button>
                      )}

                      {canAuthor && (
                        <LessonChangeRequestDialog
                          lessonId={lesson.id}
                          lessonTitle={`Bài ${lesson.order}: ${lesson.title}`}
                          trigger={(open) => (
                            <button
                              type="button"
                              onClick={open}
                              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                            >
                              <MessageSquarePlus className="h-3.5 w-3.5" /> Đề xuất sửa
                            </button>
                          )}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => move(idx, -1)}
                      disabled={pending || idx === 0}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      aria-label="Lên"
                      title="Lên"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(idx, 1)}
                      disabled={pending || idx === lessons.length - 1}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      aria-label="Xuống"
                      title="Xuống"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {moNganBuoi && (
                      <button
                        type="button"
                        onClick={() => moNgan(lesson.id, "tai-lieu")}
                        className="rounded p-1.5 text-primary hover:bg-primary-soft"
                        aria-label="Giáo án & bài tập"
                        title="Giáo án SCORM & bài tập"
                      >
                        <FileBox className="h-4 w-4" />
                      </button>
                    )}
                    {moNganBuoi ? (
                      <button
                        type="button"
                        onClick={() => moNgan(lesson.id, "noi-dung")}
                        disabled={locked}
                        className="rounded p-1.5 text-primary hover:bg-primary-soft disabled:opacity-30"
                        aria-label="Sửa"
                        title={locked ? "Buổi đang khóa" : "Sửa"}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    ) : (
                    <LessonFormDialog
                      curriculumId={curriculumId}
                      lesson={lesson}
                      trigger={(open) => (
                        <button
                          type="button"
                          onClick={open}
                          disabled={locked}
                          className="rounded p-1.5 text-primary hover:bg-primary-soft disabled:opacity-30"
                          aria-label="Sửa"
                          title={locked ? "Buổi đang khóa" : "Sửa"}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    />
                    )}
                    <button
                      type="button"
                      onClick={() => run(() => archiveLessonAction(lesson.id))}
                      disabled={pending}
                      className="rounded p-1.5 text-state-warning-ink hover:bg-state-warning-soft disabled:opacity-30"
                      aria-label="Lưu trữ"
                      title="Lưu trữ (soft, có thể khôi phục)"
                    >
                      <Archive className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(lesson)}
                      disabled={pending}
                      className="rounded p-1.5 text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-30"
                      aria-label="Xoá"
                      title="Xoá vĩnh viễn"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {archived.length > 0 && (
        <div className="border-t border-border p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Buổi đã lưu trữ ({archived.length}) — đọc-only
          </h3>
          <ul className="mt-2 space-y-1.5">
            {archived.map((lesson) => (
              <li
                key={lesson.id}
                className="flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground">
                  <span className="font-semibold">Bài {lesson.order}:</span>{" "}
                  {lesson.title}
                </span>
                <button
                  type="button"
                  onClick={() => run(() => unarchiveLessonAction(lesson.id))}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40"
                >
                  <ArchiveRestore className="h-3.5 w-3.5" /> Khôi phục
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
