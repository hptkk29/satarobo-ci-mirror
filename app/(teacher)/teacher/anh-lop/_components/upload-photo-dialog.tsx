// app/(teacher)/teacher/anh-lop/_components/upload-photo-dialog.tsx — "Đăng ảnh lớp".
//
// MỘT việc duy nhất: chọn BUỔI HỌC → chọn nhiều ảnh → gửi. Ảnh đi thẳng vào hàng chờ
// QLCS duyệt (uploadSessionMediaAction), không qua kho nữa.
//
// 25/08 — chủ dự án bỏ hai thứ khỏi hộp thoại này:
// • chế độ "Đăng ngay 1 ảnh" (kèm ô chú thích + chip gắn thẻ học viên + "ảnh chung cả
//   lớp"): việc gắn ảnh cho từng em nay là bước RIÊNG, làm bằng nút "Chọn ảnh" ở phiếu
//   nhận xét sau khi QLCS duyệt. Hệ quả PHẢI NHỚ: ảnh tải lên ở đây KHÔNG gắn thẻ và
//   KHÔNG "chung cả lớp" ⇒ theo bất biến C6.2 (lib/lms/media-consent) nó ẩn với phụ
//   huynh cho tới khi có người chọn. Đó là chủ đích (fail-closed), và cột "Chưa có" ở
//   bảng nhận xét là chỗ bày việc còn nợ ra.
// • ô "Ngày chụp": ảnh nay gom theo BUỔI, ngày chụp tự lấy theo ngày buổi ở server
//   (createDraftMediaBatch). Để ô đó lại chỉ đẻ ra ảnh gắn buổi A mà ghi ngày B.
//
// Buổi học là BẮT BUỘC — ảnh không gắn buổi rơi khỏi cả màn Ảnh lớp (gom theo buổi)
// lẫn hộp "Chọn ảnh" của phiếu nhận xét, tức là tải lên xong không ai tìm thấy.
//
// • Presign qua /api/admin/upload-url (TEACHER ∈ allowedRoles của route; path /api/*
//   chạy trên mọi host nên dùng được từ host giaovien) → PUT thẳng lên R2.
// ⚠️ Câu 46: context/payload chỉ chứa TÊN học viên — không SĐT/email/contact PH.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ImagePlus, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  getClassUploadContext,
  uploadSessionMediaAction,
  type ClassUploadContext,
} from "@/app/(admin)/admin/media/actions";

const selectCls =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50";

// Trần 1 lô — khớp DRAFT_BATCH_MAX server (lib/lms/media-publish.ts); không import
// từ file "use server" (chỉ async function được export qua ranh giới đó).
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

export function UploadPhotoDialog({
  classId,
  // Preselect buổi (bảng buổi ở màn điểm danh gọi theo từng dòng). compact = nút nhỏ
  // nhãn "Tải ảnh" thay "Đăng ảnh lớp".
  initialSessionId,
  compact = false,
}: {
  classId: string;
  initialSessionId?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Bối cảnh upload từ action admin — null = chưa tải (tải lười khi mở dialog).
  const [ctx, setCtx] = useState<ClassUploadContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);

  const [sessionId, setSessionId] = useState(initialSessionId ?? "");
  // Danh sách file đã PUT xong + tiến độ đang tải.
  const [batchFiles, setBatchFiles] = useState<UploadedFile[]>([]);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const uploading = progress !== null;

  // Server nói không được đăng (không phụ trách / lớp ngoài tầm nhìn) → khoá form.
  const blocked = ctx !== null && !ctx.canUpload;

  async function loadContext() {
    setLoadingCtx(true);
    try {
      const c = await getClassUploadContext(classId);
      setCtx(c);
      if (!c.canUpload) toast.error("Bạn không thể đăng ảnh cho lớp này");
    } catch {
      toast.error("Không tải được thông tin lớp — thử lại");
    } finally {
      setLoadingCtx(false);
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && ctx === null && !loadingCtx) void loadContext();
  }

  // Chọn file: nhiều file, concurrency 3, file hỏng báo tên và TIẾP TỤC.
  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files ? [...e.target.files] : [];
    if (e.target) e.target.value = "";
    if (list.length === 0) return;
    // Đang tải lô → chặn lượt chọn mới (input hidden trong label vẫn bấm được dù
    // nút submit đã khoá): 2 lượt chồng nhau làm vượt trần lô + cờ uploading của
    // lượt trước tắt sớm + ảnh "ma" chen vào sau khi reset form (review 02/08).
    if (uploading) {
      toast.error("Đang tải lô ảnh — chờ xong rồi chọn thêm");
      return;
    }

    const images = list.filter((f) => f.type.startsWith("image/"));
    if (images.length < list.length) toast.error("Bỏ qua file không phải ảnh");
    if (images.length === 0) return;

    const room = BATCH_MAX - batchFiles.length;
    if (room <= 0) {
      toast.error(
        `Tối đa ${BATCH_MAX} ảnh mỗi lô — gửi lô này trước rồi tải tiếp`,
      );
      return;
    }
    const queue = images.slice(0, room);
    if (queue.length < images.length) {
      toast.error(`Chỉ nhận thêm ${room} ảnh (tối đa ${BATCH_MAX}/lô)`);
    }

    setProgress({ done: 0, total: queue.length });
    const okFiles: UploadedFile[] = [];
    const failed: string[] = [];
    let next = 0;
    // Worker pool concurrency 3 — không bắn 40 PUT cùng lúc (mạng lớp học yếu).
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
    if (okFiles.length > 0) setBatchFiles((prev) => [...prev, ...okFiles]);
    if (failed.length > 0) {
      toast.error(`Không tải được ${failed.length} ảnh: ${failed.join(", ")}`);
    }
    if (okFiles.length > 0) toast.success(`Đã tải ${okFiles.length} ảnh`);
  }

  function resetForm() {
    setSessionId(initialSessionId ?? "");
    setBatchFiles([]);
  }

  function submit() {
    if (!sessionId) {
      toast.error("Chọn buổi học trước");
      return;
    }
    if (batchFiles.length === 0) {
      toast.error("Tải ảnh trước");
      return;
    }
    startTransition(async () => {
      const res = await uploadSessionMediaAction({
        classId,
        classSessionId: sessionId,
        files: batchFiles,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Lỗi đăng ảnh");
        return;
      }
      const n = res.count ?? batchFiles.length;
      toast.success(
        res.status === "APPROVED"
          ? `Đã đăng ${n} ảnh — phụ huynh xem được sau khi bạn chọn ảnh cho từng em`
          : res.status === "DRAFT"
            ? `Đã đưa ${n} ảnh vào kho — giáo viên phụ trách lớp sẽ chọn ảnh gửi phụ huynh`
            : `Đã gửi ${n} ảnh — chờ quản lý cơ sở duyệt`,
      );
      resetForm();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {/* Dialog controlled (open/onOpenChange) theo pattern site GV — không DialogTrigger */}
      <Button
        onClick={() => onOpenChange(true)}
        size={compact ? "sm" : "default"}
        variant={compact ? "outline" : "default"}
      >
        <ImagePlus
          className={compact ? "mr-1 h-3.5 w-3.5" : "mr-1.5 h-4 w-4"}
          aria-hidden
        />
        {compact ? "Tải ảnh" : "Đăng ảnh lớp"}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Đăng ảnh lớp</DialogTitle>
            <DialogDescription>
              Chọn buổi học rồi tải toàn bộ ảnh của buổi đó. Ảnh chuyển thẳng cho
              quản lý cơ sở duyệt từng tấm; duyệt xong bạn vào phiếu nhận xét bấm
              “Chọn ảnh” để gán ảnh cho từng học viên.
            </DialogDescription>
          </DialogHeader>

          {loadingCtx || ctx === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Đang tải
              thông tin lớp…
            </div>
          ) : blocked ? (
            <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft p-3 text-sm text-state-danger-ink dark:border-state-danger">
              Bạn không phụ trách lớp này nên không thể đăng ảnh.
            </div>
          ) : (
            <div className="space-y-3">
              {/* Banner HS CHƯA đồng ý dùng hình ảnh (consent) — mirror admin media-client.
                  Vẫn cần dù hộp thoại không còn gắn thẻ: người duy nhất kiểm được KHUNG
                  HÌNH là giáo viên, ngay lúc chọn ảnh để tải lên. */}
              {ctx.nonConsent.length > 0 && (
                <div className="flex gap-2 rounded-lg border border-state-warning-soft bg-state-warning-soft p-2.5 text-xs text-state-warning-ink dark:border-state-warning">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden
                  />
                  <div>
                    <p className="font-semibold">
                      Học viên CHƯA đồng ý dùng hình ảnh:
                    </p>
                    <p className="mt-0.5">
                      {ctx.nonConsent.map((s) => s.name).join(", ")}
                    </p>
                    <p className="mt-1 text-state-warning-ink">
                      Vui lòng làm mờ thủ công hoặc loại các em này khỏi khung
                      hình. Không thể chọn ảnh cho các em này.
                    </p>
                  </div>
                </div>
              )}

              {/* Vai chỉ-góp-ảnh (Marketing/Giáo vụ) KHÔNG đẩy thẳng vào hàng duyệt được
                  — nói trước ở đây thay vì để họ ngạc nhiên ở thông báo sau khi gửi. */}
              {!ctx.canPublish && (
                <p className="rounded-lg border border-state-info-soft bg-state-info-soft p-2.5 text-xs text-state-info-ink dark:border-state-info">
                  Bạn góp ảnh cho lớp: ảnh vào <strong>kho của lớp</strong>, giáo
                  viên phụ trách là người chọn ảnh gửi phụ huynh.
                </p>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="media-session">Buổi học (bắt buộc)</Label>
                <select
                  id="media-session"
                  value={sessionId}
                  disabled={pending}
                  onChange={(e) => setSessionId(e.target.value)}
                  className={selectCls}
                >
                  <option value="" disabled>
                    — Chọn buổi học —
                  </option>
                  {ctx.sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {ctx.sessions.length === 0 && (
                  <p className="text-xs text-state-danger-ink">
                    Lớp chưa có buổi học nào — chưa đăng ảnh được.
                  </p>
                )}
              </div>

              {/* Lưới ảnh đã tải của LÔ + nút gỡ từng ảnh (gỡ khỏi lô, file R2 giữ nguyên) */}
              {batchFiles.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5">
                  {batchFiles.map((f, i) => (
                    <div key={`${f.fileUrl}-${i}`} className="group relative">
                      <img
                        src={f.fileUrl}
                        alt={f.fileName}
                        className="aspect-square w-full rounded-md object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Bỏ ảnh ${f.fileName} khỏi lô`}
                        disabled={pending}
                        onClick={() =>
                          setBatchFiles((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-sm text-muted-foreground hover:bg-muted">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-4 w-4" aria-hidden />
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
                  onChange={onFiles}
                  disabled={uploading}
                  className="hidden"
                />
              </label>

              {/* Nói RÕ vì sao nút khoá: hộp thoại mở ra là ô buổi trống, không có dòng
                  này thì người dùng chỉ thấy một nút xám không lý do. */}
              {!sessionId && (
                <p className="text-xs text-muted-foreground">
                  Chọn buổi học để gửi ảnh.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={submit}
              disabled={
                pending ||
                uploading ||
                loadingCtx ||
                ctx === null ||
                blocked ||
                !sessionId ||
                batchFiles.length === 0
              }
            >
              {pending
                ? "Đang gửi…"
                : `Gửi duyệt${batchFiles.length > 0 ? ` (${batchFiles.length})` : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
