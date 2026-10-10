"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  UploadCloud,
  Play,
  Trash2,
  Loader2,
  RefreshCw,
  FileBox,
  AlertCircle,
  BookOpen,
} from "lucide-react";
import { createScormPackage, confirmUpload, processScormNow, deleteScormPackage } from "../_actions";

export type GiaoAn = {
  id: string;
  name: string;
  kind: "SCORM" | "PDF";
  version: number;
  sizeBytes: number | null;
  fileCount: number | null;
  scormVersion: "SCORM_12" | "SCORM_2004" | null;
};
export type PendingPkg = { id: string; name: string; status: string };
export type FailedPkg = { id: string; name: string; error: string | null };
export type LessonNode = {
  lessonId: string;
  order: number;
  title: string;
  giaoAn: GiaoAn | null;
  pending: PendingPkg | null;
  failed: FailedPkg | null;
};
export type CourseNode = {
  id: string;
  name: string;
  code: string | null;
  curriculumName: string | null;
  lessons: LessonNode[];
};

function fmtSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Upload zip qua presigned PUT với progress (XHR). Reject khi lỗi mạng/HTTP. */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/zip");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload thất bại (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Lỗi mạng khi upload"));
    xhr.send(file);
  });
}

export function ScormManager({ courses }: { courses: CourseNode[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [courseId, setCourseId] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const course = useMemo(() => courses.find((c) => c.id === courseId) ?? null, [courses, courseId]);
  const lessons = useMemo(() => course?.lessons ?? [], [course]);
  const lesson = useMemo(
    () => lessons.find((l) => l.lessonId === lessonId) ?? null,
    [lessons, lessonId],
  );

  // Tự làm mới khi buổi đang có bản XỬ LÝ → giáo án hiện ra ngay khi giải nén xong
  // (hoặc cron xử lý ở môi trường serverless). Dừng sau ~2 phút để khỏi poll vô hạn.
  const pendingId = lesson?.pending?.id ?? null;
  const pollCount = useRef(0);
  useEffect(() => {
    pollCount.current = 0;
    if (!pendingId) return;
    const t = setInterval(() => {
      pollCount.current += 1;
      if (pollCount.current > 30) {
        clearInterval(t);
        return;
      }
      router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [pendingId, router]);

  function resetUploadForm() {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleUpload() {
    // T5.1 — bỏ ô "tên giáo án": server đặt tên theo buổi/tệp (createScormPackage).
    if (!lessonId) return toast.error("Chọn buổi học");
    if (!file) return toast.error("Chọn tệp .pdf hoặc .zip");
    const lower = file.name.toLowerCase();
    const isPdf = lower.endsWith(".pdf");
    const isZip = lower.endsWith(".zip");
    if (!isPdf && !isZip) return toast.error("Chỉ nhận .pdf (slide) hoặc .zip (gói SCORM)");
    const kind = isPdf ? "PDF" : "SCORM";

    setUploading(true);
    setProgress(0);
    // Đã confirmUpload xong → tệp đã nhận, gói ở PROCESSING. Sau mốc này LUÔN refresh
    // ở finally để hiện thẻ "đang xử lý" + bật polling, kể cả khi processScormNow treo.
    let confirmedUpload = false;
    try {
      const created = await createScormPackage({
        lessonId,
        fileName: file.name,
        mimeType: file.type || (isPdf ? "application/pdf" : "application/zip"),
        sizeBytes: file.size,
        kind,
      });
      if (!created.ok) {
        toast.error(created.error);
        return;
      }
      await putWithProgress(created.data!.uploadUrl, file, setProgress);
      const confirmed = await confirmUpload(created.data!.id);
      if (!confirmed.ok) {
        toast.error(confirmed.error);
        return;
      }
      confirmedUpload = true;
      // Giải nén ngay để giáo án hiện liền. Nếu zip lớn → request có thể hết giờ:
      // KHÔNG coi là lỗi — cron sẽ hoàn tất & polling sẽ tự cập nhật.
      try {
        await processScormNow(created.data!.id);
      } catch {
        /* timeout/zip lớn → cron fallback */
      }
      toast.success(
        lesson?.giaoAn
          ? "Đã đẩy giáo án mới — đang xử lý & thay bản cũ"
          : "Đã đẩy giáo án — đang xử lý",
      );
      resetUploadForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi upload");
    } finally {
      setUploading(false);
      setProgress(0);
      // Chỉ refresh khi đã confirm (tránh hiện thẻ "đang xử lý" cho row UPLOADING mồ
      // côi khi PUT lỗi); sau confirm thì luôn refresh dù processScormNow treo.
      if (confirmedUpload) router.refresh();
    }
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const res = await deleteScormPackage(id);
      if (res.ok) {
        toast.success("Đã gỡ giáo án");
        setConfirmDelete(null);
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  if (courses.length === 0) {
    return (
      <p className="rounded-xl border border-state-warning-soft bg-state-warning-soft p-6 text-center text-sm text-state-warning-ink">
        <AlertCircle className="mr-1 inline h-4 w-4" />
        Chưa có khoá học nào bật chế độ dạy (isTeachable). Tạo/cấu hình khoá ở Quản lý khoá học
        trước.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Bước 1+2: chọn khoá học → buổi học */}
      <section className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Khoá học
          </span>
          <select
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              setLessonId("");
              setConfirmDelete(null);
            }}
            className="w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="">— Chọn khoá học —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.code ? ` (${c.code})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Buổi học
          </span>
          <select
            value={lessonId}
            onChange={(e) => {
              setLessonId(e.target.value);
              setConfirmDelete(null);
            }}
            disabled={!course}
            className="w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-primary disabled:bg-muted disabled:text-muted-foreground"
          >
            <option value="">
              {!course
                ? "— Chọn khoá học trước —"
                : lessons.length === 0
                  ? "— Khoá chưa có buổi học —"
                  : "— Chọn buổi học —"}
            </option>
            {lessons.map((l) => (
              <option key={l.lessonId} value={l.lessonId}>
                Buổi {l.order}: {l.title}
              </option>
            ))}
          </select>
        </label>

        {course && !course.curriculumName && (
          <p className="sm:col-span-2 text-xs text-state-warning-ink">
            <AlertCircle className="mr-1 inline h-3.5 w-3.5" />
            Khoá này chưa có khung chương trình đang dùng (ACTIVE) — chưa có buổi để gắn giáo án.
          </p>
        )}
        {course?.curriculumName && (
          <p className="sm:col-span-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" /> Khung chương trình: {course.curriculumName}
          </p>
        )}
      </section>

      {/* Bước 3: giáo án của buổi */}
      {!lesson ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Chọn khoá học và buổi học để xem giáo án.
        </p>
      ) : (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">
              Giáo án — Buổi {lesson.order}: {lesson.title}
            </h2>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Làm mới
            </button>
          </div>

          {/* Giáo án đang dùng */}
          {lesson.giaoAn ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-state-success-soft bg-state-success-soft/60 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileBox className="h-4 w-4 shrink-0 text-state-success-ink" />
                  <span className="truncate font-semibold text-foreground">{lesson.giaoAn.name}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-semibold ${ lesson.giaoAn.kind === "PDF" ? "bg-state-danger-soft text-state-danger-ink" : "bg-state-info-soft text-state-info-ink" }`}
                  >
                    {lesson.giaoAn.kind}
                  </span>
                  <span className="rounded bg-state-success-soft px-1.5 py-0.5 text-xs font-medium text-state-success-ink">
                    Đang dùng
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 pl-6 text-xs text-muted-foreground">
                  {lesson.giaoAn.kind === "SCORM" && lesson.giaoAn.scormVersion && (
                    <span>{lesson.giaoAn.scormVersion.replace("_", " ")}</span>
                  )}
                  <span>· {fmtSize(lesson.giaoAn.sizeBytes)}</span>
                  {lesson.giaoAn.kind === "SCORM" && lesson.giaoAn.fileCount != null && (
                    <span>· {lesson.giaoAn.fileCount} tệp</span>
                  )}
                  <span>· v{lesson.giaoAn.version}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Link
                  href={`/scorm/play/${lesson.giaoAn.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-primary-soft px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary-soft"
                >
                  <Play className="h-3.5 w-3.5" /> Xem thử
                </Link>
                {confirmDelete === lesson.giaoAn.id ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleDelete(lesson.giaoAn!.id)}
                    className="inline-flex items-center gap-1 rounded-md bg-state-danger-ink px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-state-danger-ink-hover disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Xác nhận gỡ
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirmDelete(lesson.giaoAn!.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-state-danger-soft px-2.5 py-1.5 text-xs font-medium text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Gỡ
                  </button>
                )}
              </div>
            </div>
          ) : lesson.pending ? null : (
            <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-center text-sm text-muted-foreground">
              Chưa có giáo án cho buổi này. Đẩy tệp .zip SCORM bên dưới.
            </p>
          )}

          {/* Bản đang xử lý */}
          {lesson.pending && (
            <div className="flex items-center gap-2 rounded-lg border border-state-info-soft bg-state-info-soft/60 p-3 text-sm text-state-info-ink">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                Đang xử lý <span className="font-medium">{lesson.pending.name}</span> — giáo án sẽ
                hiện sau giây lát…
              </span>
            </div>
          )}

          {/* Bản lỗi cần dọn */}
          {lesson.failed && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-state-danger-soft bg-state-danger-soft/60 p-3 text-sm">
              <span className="min-w-0 text-state-danger-ink">
                <AlertCircle className="mr-1 inline h-4 w-4" />
                Bản <span className="font-medium">{lesson.failed.name}</span> xử lý lỗi
                {lesson.failed.error ? `: ${lesson.failed.error}` : ""}.
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleDelete(lesson.failed!.id)}
                className="inline-flex items-center gap-1 rounded-md border border-state-danger-soft px-2 py-1 text-xs font-medium text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" /> Dọn bản lỗi
              </button>
            </div>
          )}

          {/* Đẩy / thay giáo án */}
          <div className="space-y-2 rounded-lg border border-dashed border-border bg-card p-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {lesson.giaoAn ? "Thay giáo án (đẩy bản mới)" : "Đẩy giáo án lên"}
            </h3>
            <p className="text-xs text-muted-foreground">
              Nhận <span className="font-medium">.pdf</span> (slide) hoặc{" "}
              <span className="font-medium">.zip</span> (gói SCORM) — cả hai trình chiếu cùng một
              khung slider.
            </p>
            {lesson.giaoAn && (
              <p className="text-xs text-state-warning-ink">
                Đẩy bản mới sẽ tự thay &amp; xoá giáo án hiện tại sau khi xử lý xong.
              </p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".zip,.pdf,application/zip,application/x-zip-compressed,application/pdf"
              disabled={uploading}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
            />
            {uploading && (
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Đang tải lên… {progress}%</p>
              </div>
            )}
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
            >
              <UploadCloud className="h-4 w-4" />
              {uploading ? "Đang xử lý…" : lesson.giaoAn ? "Đẩy & thay giáo án" : "Đẩy giáo án"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
