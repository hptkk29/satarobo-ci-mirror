"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Layers, Loader2 } from "lucide-react";
import {
  applyMergeLessons,
  listMergeSources,
  previewMergeLessons,
  type MergePreviewRow,
} from "../_actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

// 08/08/2026 — khoá Combo là khoá GỘP (Sata 1 buổi 1–16 + Sata 2 buổi 17–32).
// Panel này nạp nội dung bài từ một giáo trình khác vào giáo trình đang mở, GHI ĐÈ TẠI
// CHỖ nên `Lesson.id` không đổi — lớp đang chạy vẫn trỏ đúng buổi.

type SourceOption = { id: string; label: string; lessonCount: number };

export function CurriculumMergeForm({
  curriculumId,
  currentCount,
}: {
  curriculumId: string;
  currentCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sources, setSources] = useState<SourceOption[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [startOrder, setStartOrder] = useState("1");
  const [preview, setPreview] = useState<{
    rows: MergePreviewRow[];
    errors: string[];
    warnings: string[];
    overwriteCount: number;
    createCount: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    listMergeSources(curriculumId).then((res) => {
      if (!alive) return;
      if (res.ok) setSources(res.data ?? []);
      else toast.error(res.error);
    });
    return () => {
      alive = false;
    };
  }, [curriculumId]);

  const picked = sources?.find((s) => s.id === sourceId) ?? null;
  const start = Number.parseInt(startOrder, 10);

  function runPreview() {
    if (!sourceId) return toast.error("Chọn giáo trình nguồn");
    if (!Number.isInteger(start) || start < 1) return toast.error("Nhập buổi bắt đầu ≥ 1");
    startTransition(async () => {
      const res = await previewMergeLessons({
        targetCurriculumId: curriculumId,
        sourceCurriculumId: sourceId,
        startOrder: start,
      });
      if (!res.ok) {
        toast.error(res.error);
        setPreview(null);
        return;
      }
      setPreview(res.data ?? null);
    });
  }

  function runApply() {
    startTransition(async () => {
      const res = await applyMergeLessons({
        targetCurriculumId: curriculumId,
        sourceCurriculumId: sourceId,
        startOrder: start,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Đã gộp: ghi đè ${res.data?.overwritten ?? 0} buổi, tạo mới ${res.data?.created ?? 0} buổi`,
      );
      setPreview(null);
      router.refresh();
    });
  }

  const blocked = (preview?.errors.length ?? 0) > 0;

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
        <Layers className="h-4 w-4" /> Gộp bài từ giáo trình khác
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Dùng cho khoá gộp (vd Combo = Sata 1 buổi 1–16 + Sata 2 buổi 17–32). Chép NỘI DUNG bài
        (tên, mô tả, giáo án, mục tiêu, thiết bị, bài tập mặc định…) đè lên buổi đích, giữ nguyên
        buổi nên lớp đang chạy không bị lệch. KHÔNG chép học liệu SCORM / bài tập / đề thi / tài
        liệu đã gắn theo buổi.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[260px] flex-1 flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground">Giáo trình nguồn</span>
          <select
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setPreview(null);
            }}
            disabled={pending || sources === null}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">{sources === null ? "Đang tải…" : "— Chọn giáo trình —"}</option>
            {(sources ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} · {s.lessonCount} bài
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-40 flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground">Chèn từ buổi số</span>
          <input
            type="number"
            min={1}
            value={startOrder}
            onChange={(e) => {
              setStartOrder(e.target.value);
              setPreview(null);
            }}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-2 text-sm tabular-nums"
          />
        </label>

        <button
          type="button"
          onClick={runPreview}
          disabled={pending}
          className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Xem trước"}
        </button>
      </div>

      {picked && (
        <p className="mt-2 text-xs text-muted-foreground">
          Sẽ ghi vào buổi {start || "?"} → {Number.isInteger(start) ? start + picked.lessonCount - 1 : "?"}{" "}
          (giáo trình này đang có {currentCount} buổi).
        </p>
      )}

      {preview && (
        <div className="mt-4">
          {preview.errors.length > 0 && (
            <div className="mb-3 rounded-lg border border-state-danger-soft bg-state-danger-soft p-3 text-sm text-state-danger-ink">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> Không gộp được
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                {preview.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {preview.warnings.length > 0 && (
            <div className="mb-3 rounded-lg border border-state-warning-soft bg-state-warning-soft p-3 text-xs text-state-warning-ink">
              <p className="font-semibold">Cần biết trước khi gộp:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
            <PhanTrangBang>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Buổi</th>
                    <th className="px-3 py-2">Đang là</th>
                    <th className="px-3 py-2">Sẽ thành</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((r) => (
                    <tr key={r.targetOrder}>
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{r.targetOrder}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {r.action === "create" ? (
                          <span className="italic text-state-success-ink">(tạo mới)</span>
                        ) : (
                          r.currentTitle
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-medium text-foreground">{r.sourceTitle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={runApply}
              disabled={pending || blocked}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Đang gộp…" : "Gộp vào giáo trình này"}
            </button>
            <span className="text-xs text-muted-foreground">
              Ghi đè {preview.overwriteCount} buổi · tạo mới {preview.createCount} buổi
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
