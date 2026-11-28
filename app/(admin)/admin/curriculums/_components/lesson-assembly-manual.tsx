"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Box, ExternalLink, Loader2, Save, Trash2 } from "lucide-react";
import {
  ASSEMBLY_NAME_MAX,
  ASSEMBLY_URL_MAX,
  checkAssemblyManualUrl,
  type AssemblyManual,
} from "@/lib/lms/assembly-manual";
import { updateLessonAssemblyManual } from "../_actions";

const INPUT =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

/**
 * Khối "Tài liệu lắp ráp 3D" của MỘT bài (Giáo án & bài tập). Lưu bằng nút "Lưu" riêng — tab này
 * không có form chung — qua `updateLessonAssemblyManual` (đường ghi riêng, không đụng nội dung buổi).
 *
 * Không tự truy cập ZMROBO, không gợi ý mô hình theo tên bài: người nhập tự dán đường dẫn.
 * Kiểm đường dẫn ở đây chỉ để báo lỗi sớm — server kiểm lại bằng CÙNG hàm (lib/lms/assembly-manual).
 */
export function LessonAssemblyManual({
  lessonId,
  initial,
}: {
  lessonId: string;
  initial: AssemblyManual | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<AssemblyManual | null>(initial);
  const [url, setUrl] = useState(initial?.url ?? "");
  const [setName, setSetName] = useState(initial?.setName ?? "");
  const [modelName, setModelName] = useState(initial?.modelName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  const urlTrim = url.trim();
  const urlCheck = urlTrim ? checkAssemblyManualUrl(urlTrim) : null;
  const urlHint = urlCheck && !urlCheck.ok ? urlCheck.error : null;

  const dirty =
    urlTrim !== (saved?.url ?? "") ||
    setName.trim() !== (saved?.setName ?? "") ||
    modelName.trim() !== (saved?.modelName ?? "");
  // Bỏ trống cả ba ô = gỡ liên kết — dùng nút "Gỡ liên kết" (có xác nhận), không lưu rỗng.
  const coNoiDung = Boolean(urlTrim || setName.trim() || modelName.trim());
  const canSave = dirty && coNoiDung && !urlHint && !pending;

  function apply(next: AssemblyManual | null) {
    setSaved(next);
    setUrl(next?.url ?? "");
    setSetName(next?.setName ?? "");
    setModelName(next?.modelName ?? "");
    setConfirmRemove(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateLessonAssemblyManual(lessonId, { url, setName, modelName });
      if (!res.ok) {
        // Giữ nguyên những gì người dùng đã gõ.
        setError(res.error);
        return;
      }
      apply(res.data ?? null);
      toast.success("Đã lưu tài liệu lắp ráp 3D");
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await updateLessonAssemblyManual(lessonId, {});
      if (!res.ok) {
        setError(res.error);
        setConfirmRemove(false);
        return;
      }
      apply(null);
      toast.success("Đã gỡ liên kết lắp ráp 3D");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border bg-muted/60 p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Box className="h-3.5 w-3.5" aria-hidden /> Tài liệu lắp ráp 3D
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Dán đường dẫn mô hình từ thư viện ZMROBO (zmrobo.net). Giáo viên thấy nút “Lắp ráp 3D” ở bài này;
        bài không có đường dẫn thì không hiện nút. Mỗi bài tối đa một đường dẫn.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink"
        >
          {error}
        </div>
      )}

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">
            Đường dẫn tài liệu lắp ráp
          </span>
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            maxLength={ASSEMBLY_URL_MAX + 100}
            placeholder="https://www.zmrobo.net/modelmanual/model?modelUrl=…"
            disabled={pending}
            aria-invalid={urlHint ? true : undefined}
            aria-describedby={urlHint ? `lr3d-hint-${lessonId}` : undefined}
            className={INPUT}
          />
          {urlHint && (
            <span id={`lr3d-hint-${lessonId}`} className="mt-1 block text-xs text-state-danger-ink">
              {urlHint}
            </span>
          )}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Tên bộ mô hình <span className="font-normal">(tuỳ chọn)</span>
            </span>
            <input
              type="text"
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
              maxLength={ASSEMBLY_NAME_MAX + 20}
              placeholder="VD: Alpha Set A"
              disabled={pending}
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Tên mô hình <span className="font-normal">(tuỳ chọn)</span>
            </span>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              maxLength={ASSEMBLY_NAME_MAX + 20}
              placeholder="VD: 03.Catapult Car"
              disabled={pending}
              className={INPUT}
            />
          </label>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
          {pending ? "Đang lưu..." : "Lưu"}
        </button>

        {urlCheck?.ok ? (
          <a
            href={urlCheck.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Mở kiểm tra
          </a>
        ) : (
          <span
            aria-disabled="true"
            title="Nhập đường dẫn hợp lệ để mở kiểm tra"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground opacity-50"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Mở kiểm tra
          </span>
        )}

        {saved &&
          (confirmRemove ? (
            <span className="ml-auto inline-flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Gỡ liên kết khỏi bài này?</span>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-md bg-state-danger-ink px-2 py-1 text-xs font-semibold text-white hover:bg-state-danger-ink-hover disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Xác nhận gỡ
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                disabled={pending}
                className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-40"
              >
                Huỷ
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={pending}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-state-danger-soft px-2 py-1 text-xs font-semibold text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Gỡ liên kết
            </button>
          ))}
      </div>

      {saved && (
        <p className="mt-2 text-xs text-muted-foreground">
          Đang gắn:{" "}
          <span className="font-medium text-foreground">
            {[saved.setName, saved.modelName].filter(Boolean).join(" · ") || "(chưa có tên đối chiếu)"}
          </span>
        </p>
      )}
    </div>
  );
}
