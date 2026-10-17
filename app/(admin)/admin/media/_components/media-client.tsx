"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, Check, X, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  uploadClassMedia,
  uploadClassMediaBatch,
  deleteDraftMediaAction,
  reviewMedia,
  deleteMedia,
  getClassUploadContext,
} from "../actions";
import { formatDateVN } from "@/lib/format/date";

// Trần 1 lô — khớp DRAFT_BATCH_MAX server (lib/lms/media-publish.ts); không import
// từ file "use server" (chỉ async function đi qua được ranh giới đó).
const BATCH_MAX = 40;

type UploadedFile = { fileUrl: string; fileName: string };

/** Presign qua /api/admin/upload-url → PUT thẳng R2. Ném lỗi khi 1 bước fail. */
async function presignAndPut(f: File): Promise<UploadedFile> {
  const sign = await fetch("/api/admin/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "image",
      filename: f.name,
      mimeType: f.type,
      sizeBytes: f.size,
    }),
  });
  if (!sign.ok) throw new Error("Không ký được URL");
  const { uploadUrl, publicUrl } = (await sign.json()) as {
    uploadUrl: string;
    publicUrl: string;
  };
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": f.type },
    body: f,
  });
  if (!put.ok) throw new Error("Tải ảnh thất bại");
  return { fileUrl: publicUrl, fileName: f.name };
}

// QA 20/07 — ảnh seed (seed-placeholder://) hoặc URL hỏng không resolve được →
// hiển thị placeholder thay vì icon ảnh vỡ của trình duyệt.
const FALLBACK_IMG =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" font-family="sans-serif" font-size="14" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">Ảnh không tải được</text></svg>',
  );

function swapToFallback(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.src !== FALLBACK_IMG) img.src = FALLBACK_IMG;
}

/**
 * <img> kèm fallback 2 lớp: onError cho lỗi sau hydration + ref callback bắt ảnh
 * ĐÃ hỏng từ lúc SSR (error event bắn trước khi React gắn handler nên onError
 * một mình không đủ — 12 ảnh seed-placeholder:// vẫn vỡ).
 */
function MediaImg({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  const checkBroken = (img: HTMLImageElement | null) => {
    if (
      img &&
      img.complete &&
      img.naturalWidth === 0 &&
      img.src !== FALLBACK_IMG
    ) {
      img.src = FALLBACK_IMG;
    }
  };
  return (
    <img
      src={src}
      alt={alt}
      ref={checkBroken}
      onError={swapToFallback}
      className={className}
    />
  );
}

type Opt = { id: string; label: string };
type SessionOpt = { id: string; label: string; date: string };
type MediaItem = {
  id: string;
  fileUrl: string;
  caption: string | null;
  status: string;
  className: string;
  uploadedByName: string | null;
  /** Ai đưa ảnh này lên — để hiện nút xoá ảnh CỦA MÌNH trong kho (server chốt lại). */
  uploadedById: string | null;
  tagNames: string[];
  takenAt: string | null;
  hasSession: boolean;
  createdAt: string;
};

const inputCls =
  "w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none";

export function MediaClient({
  items,
  classes,
  canApprove,
  currentUserId,
}: {
  items: MediaItem[];
  classes: Opt[];
  canApprove: boolean;
  /** id người đang đăng nhập — xoá được ảnh CỦA MÌNH trong kho (server chốt lại). */
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);
  const [nonConsent, setNonConsent] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [sessions, setSessions] = useState<SessionOpt[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [takenAt, setTakenAt] = useState("");
  const [tagged, setTagged] = useState<string[]>([]);
  const [wholeClass, setWholeClass] = useState(false);
  const [caption, setCaption] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // KHO ẢNH (11/08) — 2 chế độ như dialog site GV: "Đưa vào kho" (nhiều ảnh, DRAFT,
  // PH không thấy — GV chọn gửi sau) và "Đăng ngay 1 ảnh" (flow cũ, tới thẳng PH).
  // Vai chỉ-góp-ảnh (Marketing/Giáo vụ) chỉ có chế độ kho — canPublish từ server.
  // Mặc định GIỮ NGUYÊN hành vi cũ ("đăng ngay 1 ảnh") cho người được gửi PH —
  // onClass đặt lại theo canPublish của lớp vừa chọn (KHÔNG để kẹt ở "batch" sau khi
  // chạm một lớp mình không được gửi PH).
  const [mode, setMode] = useState<"batch" | "single">("single");
  // false tới khi server trả lời cho LỚP cụ thể — tránh hứa sai quyền lúc chưa chọn lớp.
  const [canPublish, setCanPublish] = useState(false);
  // Chống đua: (a) ctx của lớp cũ về sau đè lên lớp đang chọn; (b) lô ảnh đang tải
  // dở của lớp cũ rơi vào lớp mới sau khi người dùng đổi lớp giữa chừng.
  const ctxReqRef = useRef(0);
  const classIdRef = useRef("");
  const [batchFiles, setBatchFiles] = useState<UploadedFile[]>([]);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  // Xoá ảnh khỏi KHO (2-click confirm) — khác deleteMedia (ảnh đã vào luồng duyệt).
  const [confirmDraftDelete, setConfirmDraftDelete] = useState<string | null>(
    null,
  );
  // QA 20/07 — xoá ảnh phải qua xác nhận (trước đây xoá ngay 1 click, không confirm).
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null);
  // KHO ẢNH (DRAFT): mặc định thư viện GIỮ NHƯ CŨ (ẩn kho); chọn "Trong kho" để QL
  // nhìn ảnh GV chưa gửi — VIEW-ONLY, không duyệt/xoá (đường rời kho là GV gửi).
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "DRAFT">(
    "ACTIVE",
  );
  const visible = items.filter((m) =>
    statusFilter === "DRAFT" ? m.status === "DRAFT" : m.status !== "DRAFT",
  );

  function handleDeleteConfirm() {
    const target = deleteTarget;
    if (!target) return;
    startTransition(async () => {
      const res = await deleteMedia(target.id);
      if (!res.ok) {
        toast.error(res.error ?? "Không xoá được ảnh");
        setDeleteTarget(null);
        return;
      }
      toast.success("Đã xoá ảnh");
      setDeleteTarget(null);
      router.refresh();
    });
  }

  const nonConsentIds = new Set(nonConsent.map((s) => s.id));

  async function onClass(id: string) {
    setClassId(id);
    classIdRef.current = id;
    setTagged([]);
    setWholeClass(false);
    setSessionId("");
    setTakenAt("");
    setBatchFiles([]);
    setFileUrl("");
    setFileName("");
    setCanPublish(false);
    const my = ++ctxReqRef.current;
    if (!id) {
      setStudents([]);
      setNonConsent([]);
      setSessions([]);
      setBlocked(false);
      return;
    }
    let ctx;
    try {
      ctx = await getClassUploadContext(id);
    } catch {
      if (my !== ctxReqRef.current) return;
      setBlocked(true);
      setStudents([]);
      setNonConsent([]);
      setSessions([]);
      toast.error("Không tải được thông tin lớp — thử lại");
      return;
    }
    // Lượt cũ về sau lượt mới → bỏ, nếu không students/canPublish sẽ là của lớp khác.
    if (my !== ctxReqRef.current) return;
    setBlocked(!ctx.canUpload);
    setStudents(ctx.students);
    setNonConsent(ctx.nonConsent);
    setSessions(ctx.sessions);
    setCanPublish(ctx.canPublish);
    // Không được gửi PH → chỉ còn đường đưa vào kho (server cũng chặn lại).
    setMode(ctx.canPublish ? "single" : "batch");
    if (!ctx.canUpload) toast.error("Bạn không đăng được ảnh cho lớp này");
  }

  function onSession(id: string) {
    setSessionId(id);
    // Mặc định ngày chụp = ngày buổi đã chọn (có thể chỉnh tay).
    const ses = sessions.find((s) => s.id === id);
    if (ses && !takenAt) setTakenAt(ses.date.slice(0, 10));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("Chỉ chọn ảnh");
    // input nằm trong <label> nên vẫn bấm được dù nút submit đã khoá (mirror bản GV).
    if (uploading) return toast.error("Đang tải ảnh — chờ xong rồi chọn lại");
    setUploading(true);
    try {
      const up = await presignAndPut(f);
      setFileUrl(up.fileUrl);
      setFileName(up.fileName);
      toast.success("Đã tải ảnh");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi tải ảnh");
    } finally {
      setUploading(false);
    }
  }

  /**
   * Chọn NHIỀU ảnh cho lô kho: worker pool 3 (không bắn 40 PUT cùng lúc), file
   * hỏng báo tên rồi TIẾP TỤC — mirror dialog site GV (upload-photo-dialog.tsx).
   */
  async function onBatchFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files ? [...e.target.files] : [];
    if (e.target) e.target.value = "";
    if (list.length === 0) return;
    if (uploading)
      return toast.error("Đang tải lô ảnh — chờ xong rồi chọn thêm");

    const images = list.filter((f) => f.type.startsWith("image/"));
    if (images.length < list.length) toast.error("Bỏ qua file không phải ảnh");
    if (images.length === 0) return;

    const room = BATCH_MAX - batchFiles.length;
    if (room <= 0) {
      return toast.error(
        `Tối đa ${BATCH_MAX} ảnh mỗi lô — đưa lô này vào kho trước`,
      );
    }
    const queue = images.slice(0, room);
    if (queue.length < images.length) {
      toast.error(`Chỉ nhận thêm ${room} ảnh (tối đa ${BATCH_MAX}/lô)`);
    }

    // Chốt lớp cho lô này: người dùng đổi lớp giữa chừng thì ảnh của lớp CŨ không
    // được rơi vào lô của lớp MỚI (submitBatch gửi theo `classId` hiện tại).
    const forClass = classId;
    setUploading(true);
    setProgress({ done: 0, total: queue.length });
    const okFiles: UploadedFile[] = [];
    const failed: string[] = [];
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const f = queue[next++]!;
        try {
          okFiles.push(await presignAndPut(f));
        } catch {
          failed.push(f.name);
        } finally {
          setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, () => worker()),
    );
    setProgress(null);
    setUploading(false);
    if (classIdRef.current !== forClass) {
      toast.error("Đã đổi lớp giữa chừng — bỏ lô ảnh vừa tải");
      return;
    }
    if (okFiles.length > 0) {
      setBatchFiles((prev) => [...prev, ...okFiles]);
      toast.success(`Đã tải ${okFiles.length} ảnh`);
    }
    if (failed.length > 0) {
      toast.error(`Không tải được ${failed.length} ảnh: ${failed.join(", ")}`);
    }
  }

  /** Đưa cả lô vào KHO (DRAFT): không tag, PH không thấy — GV chọn gửi sau. */
  function submitBatch() {
    if (!classId) return toast.error("Chọn lớp");
    if (batchFiles.length === 0) return toast.error("Tải ảnh trước");
    startTransition(async () => {
      const res = await uploadClassMediaBatch({
        classId,
        files: batchFiles,
        classSessionId: sessionId || null,
        takenAt: takenAt ? new Date(takenAt).toISOString() : null,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Lỗi đưa ảnh vào kho");
        return;
      }
      toast.success(
        `Đã đưa ${res.count ?? batchFiles.length} ảnh vào kho — giáo viên sẽ chọn ảnh gửi phụ huynh`,
      );
      setBatchFiles([]);
      setSessionId("");
      setTakenAt("");
      router.refresh();
    });
  }

  /** Xoá 1 ảnh khỏi kho (2-click). Server: không có media:approve → chỉ ảnh của mình. */
  function removeDraft(id: string) {
    if (confirmDraftDelete !== id) {
      setConfirmDraftDelete(id);
      return;
    }
    startTransition(async () => {
      const res = await deleteDraftMediaAction({ mediaIds: [id] });
      setConfirmDraftDelete(null);
      if (!res.ok) {
        toast.error(res.error ?? "Không xoá được ảnh");
        return;
      }
      toast.success("Đã xoá ảnh khỏi kho");
      router.refresh();
    });
  }

  function submit() {
    if (!classId) return toast.error("Chọn lớp");
    if (!fileUrl) return toast.error("Tải ảnh trước");
    if (!wholeClass && tagged.length === 0) {
      return toast.error('Gắn thẻ học sinh hoặc chọn "Ảnh chung cả lớp"');
    }
    startTransition(async () => {
      const res = await uploadClassMedia({
        classId,
        fileUrl,
        fileName,
        caption,
        // Ảnh chung cả lớp = đánh dấu isClassWide (không gắn thẻ HS cụ thể).
        isClassWide: wholeClass,
        studentIds: wholeClass ? [] : tagged,
        classSessionId: sessionId || null,
        takenAt: takenAt ? new Date(takenAt).toISOString() : null,
      });
      if (res.ok) {
        toast.success("Đã đăng ảnh");
        setFileUrl("");
        setFileName("");
        setCaption("");
        setTagged([]);
        setWholeClass(false);
        setSessionId("");
        setTakenAt("");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">
          {!classId
            ? "Đăng ảnh lớp"
            : canPublish
              ? "Đăng ảnh lớp"
              : "Góp ảnh vào kho của lớp"}
        </h2>
        <div className="space-y-3">
          {/* Khoá lúc đang tải lô: đổi lớp giữa chừng là nguồn của lỗi "ảnh lớp cũ
              rơi vào lớp mới" (onBatchFiles còn 1 chốt nữa bằng classIdRef). */}
          <select
            value={classId}
            disabled={uploading}
            onChange={(e) => onClass(e.target.value)}
            className={inputCls}
          >
            <option value="">— Chọn lớp —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>

          {blocked && (
            <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft p-2.5 text-xs text-state-danger-ink">
              Bạn không đăng được ảnh cho lớp này.
            </div>
          )}

          {/* Chế độ: KHO (nhiều ảnh, PH chưa thấy) vs đăng thẳng 1 ảnh tới PH.
              Vai chỉ-góp-ảnh (Marketing/Giáo vụ) không có lựa chọn — chỉ kho. */}
          {classId &&
            !blocked &&
            (canPublish ? (
              <div
                className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
                role="tablist"
              >
                {(
                  [
                    ["batch", "Đưa vào kho (nhiều ảnh)"],
                    ["single", "Đăng ngay 1 ảnh"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    disabled={pending || uploading}
                    onClick={() => setMode(m)}
                    className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-state-info-soft bg-state-info-soft p-2.5 text-xs text-state-info-ink">
                Ảnh bạn tải lên vào <strong>kho của lớp</strong> — phụ huynh
                chưa nhìn thấy. Giáo viên phụ trách sẽ chọn ảnh, gắn thẻ học
                viên rồi gửi.
              </div>
            ))}

          {/* Banner cảnh báo HS chưa đồng ý dùng hình ảnh (consent). */}
          {classId && !blocked && nonConsent.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-state-warning-soft bg-state-warning-soft p-2.5 text-xs text-state-warning-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">
                  Học viên CHƯA đồng ý dùng hình ảnh:
                </p>
                <p className="mt-0.5">
                  {nonConsent.map((s) => s.name).join(", ")}
                </p>
                <p className="mt-1 text-state-warning-ink">
                  Vui lòng làm mờ thủ công hoặc loại các em này khỏi khung hình.
                  Không thể gắn thẻ các em này.
                </p>
              </div>
            </div>
          )}

          {classId && !blocked && sessions.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <select
                value={sessionId}
                onChange={(e) => onSession(e.target.value)}
                className={inputCls}
              >
                <option value="">— Buổi học (tuỳ chọn) —</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={takenAt}
                onChange={(e) => setTakenAt(e.target.value)}
                className={inputCls}
                aria-label="Ngày chụp"
              />
            </div>
          )}

          {mode === "batch" ? (
            <>
              {/* Lưới ảnh của LÔ + gỡ từng ảnh (gỡ khỏi lô, file trên R2 giữ nguyên) */}
              {batchFiles.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5">
                  {batchFiles.map((f, i) => (
                    <div key={`${f.fileUrl}-${i}`} className="group relative">
                      <MediaImg
                        src={f.fileUrl}
                        alt={f.fileName}
                        className="aspect-square w-full rounded-md object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Bỏ ảnh ${f.fileName} khỏi lô`}
                        disabled={pending}
                        onClick={() =>
                          setBatchFiles((prev) =>
                            prev.filter((_, j) => j !== i),
                          )
                        }
                        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-sm text-muted-foreground hover:bg-muted">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {progress
                  ? `Đang tải ${progress.done}/${progress.total}…`
                  : batchFiles.length > 0
                    ? `Thêm ảnh (${batchFiles.length}/${BATCH_MAX})`
                    : "Chọn nhiều ảnh"}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploading}
                  onChange={onBatchFiles}
                  className="hidden"
                />
              </label>
            </>
          ) : (
            <>
              {fileUrl ? (
                <MediaImg
                  src={fileUrl}
                  alt="preview"
                  className="h-40 w-full rounded-lg object-cover"
                />
              ) : (
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-sm text-muted-foreground hover:bg-muted">
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploading ? "Đang tải…" : "Chọn ảnh"}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploading}
                    onChange={onFile}
                    className="hidden"
                  />
                </label>
              )}

              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={2}
                placeholder="Chú thích (tuỳ chọn)"
                className={inputCls}
              />
            </>
          )}

          {mode === "single" && students.length > 0 && (
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={wholeClass}
                  onChange={(e) => {
                    setWholeClass(e.target.checked);
                    if (e.target.checked) setTagged([]);
                  }}
                  className="h-4 w-4 rounded border-border text-primary-ink focus:ring-primary"
                />
                Ảnh chung cả lớp (mọi phụ huynh trong lớp đều xem được)
              </label>

              {!wholeClass && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Gắn thẻ học sinh (chỉ phụ huynh được gắn thẻ mới thấy ảnh)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {students.map((s) => {
                      const on = tagged.includes(s.id);
                      const noConsent = nonConsentIds.has(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={noConsent}
                          title={
                            noConsent ? "Chưa đồng ý dùng hình ảnh" : undefined
                          }
                          onClick={() =>
                            setTagged((p) =>
                              on ? p.filter((x) => x !== s.id) : [...p, s.id],
                            )
                          }
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${noConsent ? "cursor-not-allowed bg-muted text-muted-foreground line-through" : on ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={mode === "batch" ? submitBatch : submit}
            disabled={
              pending ||
              uploading ||
              blocked ||
              !classId ||
              (mode === "batch" && batchFiles.length === 0)
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
          >
            {mode === "batch"
              ? `Đưa vào kho${batchFiles.length > 0 ? ` (${batchFiles.length})` : ""}`
              : "Đăng ảnh"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Thư viện ({visible.length})
          </h2>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "ACTIVE" | "DRAFT")
            }
            className="rounded-lg border border-border px-2 py-1 text-xs focus:border-primary focus:outline-none"
            aria-label="Lọc trạng thái ảnh"
          >
            <option value="ACTIVE">Chờ duyệt / Đã duyệt / Từ chối</option>
            <option value="DRAFT">Trong kho (GV chưa gửi)</option>
          </select>
        </div>
        {statusFilter === "DRAFT" && visible.length > 0 && (
          <p className="mb-2 rounded-lg bg-state-info-soft p-2 text-xs text-state-info-ink">
            Ảnh trong kho (giáo viên / marketing / giáo vụ tải lên), CHƯA gửi
            phụ huynh. Giáo viên phụ trách lớp là người chọn ảnh gửi đi; khi
            gửi, ảnh vào hàng chờ duyệt.
          </p>
        )}
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {statusFilter === "DRAFT" ? "Kho trống." : "Chưa có ảnh."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visible.map((m) => (
              <div
                key={m.id}
                className="overflow-hidden rounded-lg border border-border"
              >
                <MediaImg
                  src={m.fileUrl}
                  alt={m.caption ?? ""}
                  className="h-28 w-full object-cover"
                />
                <div className="p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      {m.className}
                    </span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${m.status === "APPROVED" ? "bg-state-success-soft text-state-success-ink" : m.status === "REJECTED" ? "bg-state-danger-soft text-state-danger-ink" : m.status === "DRAFT" ? "bg-state-info-soft text-state-info-ink" : "bg-state-warning-soft text-state-warning-ink"}`}
                    >
                      {m.status === "APPROVED"
                        ? "Duyệt"
                        : m.status === "REJECTED"
                          ? "Từ chối"
                          : m.status === "DRAFT"
                            ? "Trong kho"
                            : "Chờ"}
                    </span>
                  </div>
                  {m.takenAt && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Buổi {formatDateVN(m.takenAt)}
                    </p>
                  )}
                  {m.caption && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {m.caption}
                    </p>
                  )}
                  {m.tagNames.length > 0 && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Tag: {m.tagNames.join(", ")}
                    </p>
                  )}
                  {/* Ai đưa lên — trong kho có ảnh của nhiều vai (GV/marketing/giáo vụ) */}
                  {m.status === "DRAFT" && m.uploadedByName && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Tải lên: {m.uploadedByName}
                    </p>
                  )}
                  {/* DRAFT: KHÔNG duyệt/từ chối (server chặn reviewMedia trên DRAFT — đường
                      rời kho duy nhất là GV gửi). Chỉ cho DỌN kho: người duyệt xoá được mọi
                      ảnh, người khác chỉ ảnh của chính mình (server chốt lại). */}
                  {m.status === "DRAFT" &&
                    (canApprove || m.uploadedById === currentUserId) && (
                      <div className="mt-1.5">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => removeDraft(m.id)}
                          className="text-[11px] font-semibold text-state-danger-ink hover:text-state-danger-ink-hover disabled:opacity-60"
                        >
                          {confirmDraftDelete === m.id
                            ? "Chắc chắn xoá?"
                            : "Xoá khỏi kho"}
                        </button>
                      </div>
                    )}
                  {canApprove && m.status !== "DRAFT" && (
                    <div className="mt-1.5 flex gap-2">
                      {m.status !== "APPROVED" && (
                        <button
                          type="button"
                          onClick={() =>
                            startTransition(async () => {
                              await reviewMedia({
                                id: m.id,
                                decision: "APPROVED",
                              });
                              router.refresh();
                            })
                          }
                          className="text-state-success-ink hover:text-state-success-ink-hover"
                          aria-label="Duyệt"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                      {m.status !== "REJECTED" && (
                        <button
                          type="button"
                          onClick={() =>
                            startTransition(async () => {
                              await reviewMedia({
                                id: m.id,
                                decision: "REJECTED",
                              });
                              router.refresh();
                            })
                          }
                          className="text-state-warning-ink hover:text-state-warning-ink-hover"
                          aria-label="Từ chối"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(m)}
                        className="text-state-danger-ink hover:text-state-danger-ink-hover"
                        aria-label="Xoá"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        pending={pending}
        title="Xoá ảnh này?"
        description={
          deleteTarget ? (
            <>
              Ảnh của lớp <strong>{deleteTarget.className}</strong>
              {deleteTarget.caption ? ` — "${deleteTarget.caption}"` : ""} sẽ bị
              xoá vĩnh viễn (phụ huynh cũng không còn thấy). Hành động không thể
              hoàn tác.
            </>
          ) : undefined
        }
        confirmLabel="Xoá ảnh"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
