"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Paperclip, Plus, X } from "lucide-react";
import { attachDocument, detachDocument } from "../_actions";

interface DocumentOption {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  type: string;
  fileUrl: string;
}

interface AttachedDoc {
  id: string; // AssignmentDocument id (not Document id)
  documentId: string;
  title: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  type: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const TYPE_LABEL: Record<string, string> = {
  PDF: "PDF",
  IMAGE: "Ảnh",
  VIDEO: "Video",
  SLIDE: "Slide",
  WORKSHEET: "Worksheet",
  AUDIO: "Audio",
  OTHER: "Khác",
};

export function DocumentPicker({
  assignmentId,
  documentBank,
  initialAttached,
}: {
  assignmentId: string;
  documentBank: DocumentOption[];
  initialAttached: AttachedDoc[];
}) {
  const router = useRouter();
  const [attached, setAttached] = useState<AttachedDoc[]>(initialAttached);

  // Cập nhật lạc quan bên dưới gán id giả `temp-<documentId>`; nếu không đồng bộ lại từ
  // server thì (a) danh sách đứng im tới khi F5, và (b) gỡ ngay tài liệu vừa đính sẽ gọi
  // detachDocument("temp-…") → lỗi. Nhận id thật ngay khi router.refresh() trả prop mới.
  useEffect(() => {
    setAttached(initialAttached);
  }, [initialAttached]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const attachedIds = useMemo(
    () => new Set(attached.map((a) => a.documentId)),
    [attached],
  );

  const filteredBank = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documentBank.filter((d) => {
      if (attachedIds.has(d.id)) return false;
      if (typeFilter && d.type !== typeFilter) return false;
      if (q) {
        const blob = `${d.title} ${d.fileName}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [documentBank, attachedIds, search, typeFilter]);

  function handleAttach(doc: DocumentOption) {
    setError(null);
    startTransition(async () => {
      const res = await attachDocument({
        assignmentId,
        documentId: doc.id,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // optimistic update; the server refresh is canonical
      setAttached((prev) => [
        ...prev,
        {
          id: `temp-${doc.id}`,
          documentId: doc.id,
          title: doc.title,
          fileName: doc.fileName,
          fileSize: doc.fileSize,
          fileUrl: doc.fileUrl,
          type: doc.type,
        },
      ]);
      router.refresh();
    });
  }

  function handleDetach(adId: string) {
    setError(null);
    startTransition(async () => {
      const res = await detachDocument(adId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAttached((prev) => prev.filter((a) => a.id !== adId));
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Tài liệu tham khảo ({attached.length})
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Đính kèm tài liệu từ ngân hàng (E4) để HS xem khi làm bài.
        </p>
      </header>

      {error && (
        <div className="border-b border-state-danger-soft bg-state-danger-soft px-4 py-2 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        {/* Attached list */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Đã đính kèm
          </h3>
          {attached.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Chưa có tài liệu nào.
            </div>
          ) : (
            <ul className="space-y-2">
              {attached.map((a) => (
                <li
                  key={a.id}
                  className="flex items-start gap-2 rounded-lg border border-border bg-muted p-2.5"
                >
                  <FileText className="h-4 w-4 flex-shrink-0 text-state-info-ink mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {a.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {TYPE_LABEL[a.type] ?? a.type} · {formatBytes(a.fileSize)}
                    </div>
                    <a
                      href={a.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-block text-xs font-semibold text-state-info-ink hover:underline"
                    >
                      Mở ↗
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDetach(a.id)}
                    disabled={pending}
                    aria-label="Gỡ đính kèm"
                    className="rounded p-1 text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-30"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Bank picker */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Ngân hàng tài liệu ({filteredBank.length})
          </h3>
          <div className="mb-2 flex gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tiêu đề / tên file..."
              className="flex-1 rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">Mọi loại</option>
              {Object.entries(TYPE_LABEL).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border">
            {filteredBank.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Không có tài liệu phù hợp.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filteredBank.map((d) => (
                  <li key={d.id} className="flex items-start gap-2 p-2.5">
                    <Paperclip className="h-4 w-4 flex-shrink-0 text-muted-foreground mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {d.title}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {TYPE_LABEL[d.type] ?? d.type} · {formatBytes(d.fileSize)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAttach(d)}
                      disabled={pending}
                      className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3 inline" /> Đính kèm
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
