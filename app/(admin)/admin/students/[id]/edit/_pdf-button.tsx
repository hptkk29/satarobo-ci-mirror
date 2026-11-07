"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";

function safeFilename(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_");
}

export function GeneratePdfButton({
  studentId,
  classId,
  studentName,
  className,
}: {
  studentId: string;
  classId: string;
  studentName: string;
  className: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/reports/student-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, classId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Tạo PDF thất bại");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BaoCao-${safeFilename(studentName)}-${safeFilename(className)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading}
        className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        aria-label={`Tạo PDF tiến độ lớp ${className}`}
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Đang tạo...
          </>
        ) : (
          <>
            <FileText className="h-3.5 w-3.5" />
            Tạo PDF
          </>
        )}
      </button>
      {error && (
        <span role="alert" className="max-w-[14rem] text-right text-xs text-state-danger-ink">
          {error}
        </span>
      )}
    </div>
  );
}
