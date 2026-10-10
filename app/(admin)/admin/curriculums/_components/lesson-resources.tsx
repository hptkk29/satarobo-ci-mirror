"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileBox,
  Loader2,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { AssignmentKind, AssignmentStatus, ScormPackageStatus } from "@prisma/client";
// 1 giáo án/buổi — đẩy bản mới (LessonScormUpload) tự phát hành + thay bản cũ; gỡ hẳn
// bằng deleteScormPackage. Quản lý đầy đủ ở /scorm (Khoá học → Buổi → giáo án).
import { deleteScormPackage } from "@/app/(admin)/admin/scorm/_actions";
import { attachAssignmentToLesson, detachAssignmentFromLesson } from "../_actions";
import { LessonScormUpload } from "./lesson-scorm-upload";

export type ScormPkgRow = {
  id: string;
  name: string;
  version: number;
  status: ScormPackageStatus;
  isActiveForLesson: boolean;
  error: string | null;
};

export type AssignmentRow = {
  id: string;
  title: string;
  kind: AssignmentKind;
  status: AssignmentStatus;
  className: string;
};

export type LessonResourceRow = {
  lessonId: string;
  order: number;
  title: string;
  scorm: ScormPkgRow[];
  assignments: AssignmentRow[];
};

const KIND_LABEL: Record<AssignmentKind, string> = {
  CLASSWORK: "Trên lớp",
  HOMEWORK: "Về nhà",
};

export function LessonResources({
  lessons,
  availableAssignments,
  scormEnabled,
  canActivateScorm,
}: {
  lessons: LessonResourceRow[];
  // Bài tập cùng khoá học, chưa gắn buổi nào — nguồn để gắn vào buổi.
  availableAssignments: AssignmentRow[];
  // SCORM_ENABLED — off thì ẩn section SCORM (không vỡ trang, AC3).
  scormEnabled: boolean;
  // training:manage — quyền đặt bản SCORM đang dùng cho buổi.
  canActivateScorm: boolean;
}) {
  if (lessons.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border p-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Học liệu &amp; bài tập theo buổi
          </h2>
          <p className="text-xs text-muted-foreground">
            Gắn gói SCORM (đặt bản đang dùng) và bài tập cho từng buổi — không cần
            rời trang.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-border">
        {lessons.map((lesson) => {
          const giaoAn =
            lesson.scorm.find((p) => p.isActiveForLesson && p.status === "PUBLISHED") ?? null;
          const scormPending =
            lesson.scorm.find((p) => p.status === "UPLOADING" || p.status === "PROCESSING") ?? null;
          return (
            <li key={lesson.lessonId} className="p-4">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="tabular-nums text-muted-foreground">
                    Bài {lesson.order}
                  </span>
                  <span className="truncate">{lesson.title}</span>
                  <span className="ml-auto flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    {scormEnabled && (
                      <span className="inline-flex items-center gap-1">
                        <FileBox className="h-3.5 w-3.5" />
                        {giaoAn ? "Giáo án ✓" : scormPending ? "Đang xử lý" : "Chưa có"}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <BookOpen className="h-3.5 w-3.5" />
                      {lesson.assignments.length} bài tập
                    </span>
                  </span>
                </summary>

                <div className="mt-3 pl-1">
                  <LessonResourcePanel
                    lesson={lesson}
                    availableAssignments={availableAssignments}
                    scormEnabled={scormEnabled}
                    canActivateScorm={canActivateScorm}
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Giáo án SCORM + bài tập của MỘT buổi (29/09/2026 — tách ra để ngăn chỉnh buổi của màn giáo
 * trình mới dùng lại). Thân giữ NGUYÊN mã cũ: cùng action tải/gỡ SCORM, gắn/gỡ bài tập — không
 * có đường ghi thứ hai.
 */
export function LessonResourcePanel({
  lesson,
  availableAssignments,
  scormEnabled,
  canActivateScorm,
}: {
  lesson: LessonResourceRow;
  availableAssignments: AssignmentRow[];
  scormEnabled: boolean;
  canActivateScorm: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [picks, setPicks] = useState<Record<string, string>>({});
  // 2-click confirm để gỡ giáo án (tránh xoá nhầm).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Có lỗi xảy ra");
        return;
      }
      setConfirmDelete(null);
      router.refresh();
    });
  }

  const giaoAn =
    lesson.scorm.find((p) => p.isActiveForLesson && p.status === "PUBLISHED") ?? null;
  const scormPending =
    lesson.scorm.find((p) => p.status === "UPLOADING" || p.status === "PROCESSING") ?? null;
  const scormFailed = lesson.scorm.find((p) => p.status === "FAILED") ?? null;
  const pick = picks[lesson.lessonId] ?? "";

  return (
    <>
      {error && (
        <div className="mb-3 rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          {error}
        </div>
      )}
                <div className="space-y-4">
                  {/* ── SCORM ─────────────────────────────────────────── */}
                  {scormEnabled && (
                    <div className="rounded-lg border border-border bg-muted/60 p-3">
                      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        <FileBox className="h-3.5 w-3.5" /> Giáo án giảng dạy (SCORM)
                      </h3>
                      {giaoAn ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-state-success-soft bg-card px-2.5 py-1.5 text-sm">
                          <CheckCircle2 className="h-3.5 w-3.5 text-state-success-ink" />
                          <span className="font-medium text-foreground">{giaoAn.name}</span>
                          <Link
                            href={`/scorm/play/${giaoAn.id}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                          >
                            <Play className="h-3.5 w-3.5" /> Xem thử
                          </Link>
                          {canActivateScorm &&
                            (confirmDelete === giaoAn.id ? (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => run(() => deleteScormPackage(giaoAn.id))}
                                className="ml-auto inline-flex items-center gap-1 rounded-md bg-state-danger-ink px-2 py-0.5 text-xs font-semibold text-white hover:bg-state-danger-ink-hover disabled:opacity-40"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Xác nhận
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => setConfirmDelete(giaoAn.id)}
                                className="ml-auto inline-flex items-center gap-1 rounded-md border border-state-danger-soft px-2 py-0.5 text-xs font-semibold text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-40"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Gỡ
                              </button>
                            ))}
                        </div>
                      ) : scormPending ? (
                        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-state-info-ink">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang xử lý{" "}
                          <span className="font-medium">{scormPending.name}</span> — giáo án sẽ hiện
                          sau giây lát.
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Chưa có giáo án cho buổi. Đẩy tệp .zip bên dưới hoặc{" "}
                          <Link
                            href="/scorm"
                            className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
                          >
                            quản lý ở trang SCORM <ExternalLink className="h-3 w-3" />
                          </Link>
                          .
                        </p>
                      )}
                      {scormFailed && (
                        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-state-danger-ink">
                          <AlertCircle className="h-3.5 w-3.5" /> Bản {scormFailed.name} lỗi
                          {scormFailed.error ? `: ${scormFailed.error}` : ""}.
                          {canActivateScorm && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => run(() => deleteScormPackage(scormFailed.id))}
                              className="inline-flex items-center gap-1 rounded-md border border-state-danger-soft px-2 py-0.5 font-semibold hover:bg-state-danger-soft disabled:opacity-40"
                            >
                              <Trash2 className="h-3 w-3" /> Dọn
                            </button>
                          )}
                        </p>
                      )}
                      {/* R2-LMS-3 — upload gói SCORM inline (chỉ Đào tạo: training:manage). */}
                      {canActivateScorm && <LessonScormUpload lessonId={lesson.lessonId} />}
                      <Link
                        href="/scorm"
                        className="mt-2 inline-flex items-center gap-0.5 text-xs font-semibold text-muted-foreground hover:text-primary"
                      >
                        Quản lý gói SCORM <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  )}

                  {/* ── Bài tập của buổi ──────────────────────────────── */}
                  <div className="rounded-lg border border-border bg-muted/60 p-3">
                    <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5" /> Bài tập của buổi
                    </h3>
                    {lesson.assignments.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Chưa gắn bài tập nào.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {lesson.assignments.map((a) => (
                          <li
                            key={a.id}
                            className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm"
                          >
                            <span className="font-medium text-foreground">
                              {a.title}
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {KIND_LABEL[a.kind]} · {a.className}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                run(() =>
                                  detachAssignmentFromLesson({ assignmentId: a.id }),
                                )
                              }
                              disabled={pending}
                              title="Gỡ bài tập khỏi buổi"
                              className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-semibold text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-40"
                            >
                              <X className="h-3.5 w-3.5" /> Gỡ
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={pick}
                        onChange={(e) =>
                          setPicks((s) => ({
                            ...s,
                            [lesson.lessonId]: e.target.value,
                          }))
                        }
                        disabled={pending || availableAssignments.length === 0}
                        className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-60"
                      >
                        <option value="">
                          {availableAssignments.length === 0
                            ? "Không còn bài tập trống để gắn…"
                            : "— Chọn bài tập đã có để gắn —"}
                        </option>
                        {availableAssignments.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title} ({KIND_LABEL[a.kind]} · {a.className})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          if (!pick) return;
                          run(() =>
                            attachAssignmentToLesson({
                              lessonId: lesson.lessonId,
                              assignmentId: pick,
                            }),
                          );
                          setPicks((s) => ({ ...s, [lesson.lessonId]: "" }));
                        }}
                        disabled={pending || !pick}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" /> Gắn
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Chỉ liệt kê bài tập cùng khoá học, chưa gắn buổi nào. Tạo bài
                      tập mới ở{" "}
                      <Link
                        href="/assignments"
                        className="font-semibold text-muted-foreground hover:text-primary"
                      >
                        Quản lý bài tập
                      </Link>
                      .
                    </p>
                  </div>
                </div>
    </>
  );
}
