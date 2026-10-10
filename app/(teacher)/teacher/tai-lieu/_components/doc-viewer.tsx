"use client";

// doc-viewer.tsx — khung xem tài liệu buổi học toàn màn hình, nền tối (parity
// site GV 18/08, port từ satarobo-ui-giaovien materials/xem/pdf/page.tsx).
// `fixed inset-0 z-[100]` để phủ lên app shell (trang mở ở tab mới).
import { useRef, useState } from "react";
import { Download, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function DocViewer({
  title,
  typeLabel,
  isHomework,
  fileUrl,
  fileName,
  sizeLabel,
  lessonLabel,
  courseName,
}: {
  title: string;
  typeLabel: string;
  /** Phiếu bài tập → badge xanh dương; còn lại (giáo án) → badge đỏ như bản mock. */
  isHomework: boolean;
  fileUrl: string;
  fileName: string;
  sizeLabel: string | null;
  lessonLabel: string | null;
  courseName: string | null;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = async () => {
    if (!shellRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        await shellRef.current.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      /* trình duyệt từ chối fullscreen - bỏ qua, người dùng vẫn xem được */
    }
  };

  const subtitle = [courseName, sizeLabel].filter(Boolean).join(" · ");

  return (
    <div
      ref={shellRef}
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950 text-slate-100"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
              isHomework ? "bg-blue-500/20 text-blue-300" : "bg-red-500/20 text-red-300",
            )}
          >
            {typeLabel}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold">{lessonLabel ?? title}</h1>
            <p className="truncate text-[11px] text-slate-400">
              {lessonLabel ? title : ""}
              {lessonLabel && subtitle ? " · " : ""}
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Mở file gốc
          </a>
          <a
            href={fileUrl}
            download={fileName}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> Tải về
          </a>
          <button
            type="button"
            onClick={toggleFullscreen}
            title="Toàn màn hình"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-900 transition-colors hover:bg-white"
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            )}
            Toàn màn hình
          </button>
        </div>
      </header>

      <iframe
        src={fileUrl}
        title={fileName}
        className="min-h-0 flex-1 border-none bg-slate-800"
      />
    </div>
  );
}
