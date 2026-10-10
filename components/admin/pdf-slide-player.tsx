"use client";

// components/admin/pdf-slide-player.tsx — trình chiếu giáo án PDF dạng slider (pdf.js).
// Mỗi trang PDF = 1 slide; prev/next + phím mũi tên + đếm trang + toàn màn hình (SlideStage).
// ⚠️ Phím tắt ở đây (←/→/Space/PageUp/PageDown) phải KHÔNG đụng phím **F** — F là bật/tắt
// toàn màn hình do SlideStage nghe; đừng thêm F vào danh sách lật trang bên dưới.
// Tải PDF qua asset resolver (vé), render từng trang vào canvas, fit khung. Worker = /public.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { SlideStage, type SlideStageFit } from "@/components/admin/slide-stage";

interface PdfSlidePlayerProps {
  launchTicket: string;
  /** Đường dẫn PDF tương đối trong prefix (vd "source.pdf"). */
  launchUrl: string;
  packageName: string;
  name: string;
  employeeCode: string;
  /** Chuyển tiếp cho SlideStage — site GV dùng "viewport" + lối thoát (xem SlideStageFit). */
  fit?: SlideStageFit;
  exitHref?: string;
}

/** Build URL asset: mã hoá từng segment, đính vé vào query (giống ScormPlayer). */
function buildAssetSrc(launchUrl: string, ticket: string): string {
  const clean = launchUrl.replace(/\\/g, "/").replace(/^\.?\//, "");
  const encoded = clean.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `/api/scorm/asset/${encoded}?t=${encodeURIComponent(ticket)}`;
}

export function PdfSlidePlayer({
  launchTicket,
  launchUrl,
  packageName,
  name,
  employeeCode,
  fit,
  exitHref,
}: PdfSlidePlayerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  // Chống đua render: mỗi lần gọi renderPage tăng gen; lần cũ (đang await getPage)
  // thấy gen lệch → bỏ trước khi render → tối đa 1 render task/canvas (lật trang nhanh).
  const renderGenRef = useRef(0);

  // Nạp pdf.js + tài liệu (1 lần). Tải nguyên file qua asset (vé) → tránh range-request.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const res = await fetch(buildAssetSrc(launchUrl, launchTicket));
        if (!res.ok) throw new Error(`Không tải được PDF (HTTP ${res.status})`);
        const data = await res.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        setPageNum(1);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Lỗi đọc PDF");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        renderTaskRef.current?.cancel();
      } catch {
        /* noop */
      }
      try {
        void loadingTaskRef.current?.destroy();
      } catch {
        /* noop */
      }
      docRef.current = null;
      loadingTaskRef.current = null;
    };
  }, [launchUrl, launchTicket]);

  // Vẽ 1 trang vào canvas, scale fit khung (giữ tỉ lệ) + nét theo devicePixelRatio.
  const renderPage = useCallback(async (n: number) => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!doc || !canvas || !container) return;
    const gen = ++renderGenRef.current;
    try {
      renderTaskRef.current?.cancel();
    } catch {
      /* noop */
    }
    try {
      const page = await doc.getPage(n);
      // Lần gọi cũ (bị lật trang đè lên) → dừng TRƯỚC khi render để không có 2 task/canvas.
      if (gen !== renderGenRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const cw = container.clientWidth || 1;
      const ch = container.clientHeight || 1;
      const fit = Math.max(0.1, Math.min(cw / base.width, ch / base.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: fit * dpr });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      const task = page.render({ canvas, canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
    } catch {
      /* render bị huỷ khi đổi trang nhanh — bỏ qua */
    }
  }, []);

  useEffect(() => {
    if (!loading && !error) void renderPage(pageNum);
  }, [pageNum, loading, error, renderPage]);

  // Vẽ lại khi đổi kích thước khung (resize / vào-ra toàn màn hình).
  useEffect(() => {
    const onResize = () => void renderPage(pageNum);
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onResize);
    };
  }, [pageNum, renderPage]);

  const go = useCallback(
    (delta: number) => setPageNum((p) => Math.min(Math.max(1, p + delta), numPages || 1)),
    [numPages],
  );

  // Phím mũi tên / PageUp-Down / Space.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // Cỡ nút khớp nút "Toàn màn hình" bên cạnh (h-8) — cùng một hàng thì phải cùng chiều
  // cao, và ở 375px đây cũng là vùng bấm đủ rộng cho ngón tay.
  const toolbar = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => go(-1)}
        disabled={pageNum <= 1 || loading}
        title="Trang trước (←)"
        aria-label="Trang trước"
        className="inline-flex h-8 items-center rounded-md border border-border px-2 text-muted-foreground hover:bg-muted disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <span className="min-w-[3rem] text-center tabular-nums text-muted-foreground">
        {numPages ? `${pageNum} / ${numPages}` : "…"}
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        disabled={pageNum >= numPages || loading}
        title="Trang sau (→)"
        aria-label="Trang sau"
        className="inline-flex h-8 items-center rounded-md border border-border px-2 text-muted-foreground hover:bg-muted disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );

  return (
    <SlideStage
      title={packageName}
      kindLabel="PDF"
      name={name}
      employeeCode={employeeCode}
      toolbar={toolbar}
      fit={fit}
      exitHref={exitHref}
    >
      <div ref={containerRef} className="absolute inset-0 flex items-center justify-center p-2">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-white/80">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải slide…
          </p>
        ) : error ? (
          <p className="px-4 text-center text-sm text-state-danger-ink">{error}</p>
        ) : (
          <canvas ref={canvasRef} className="max-h-full max-w-full rounded bg-card shadow-lg" />
        )}
      </div>

      {/* Vùng bấm trái/phải để lật trang (ẩn, hiện mũi tên khi hover) */}
      {!loading && !error && numPages > 1 ? (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={pageNum <= 1}
            aria-label="Trang trước"
            className="group absolute inset-y-0 left-0 z-[15] flex w-16 items-center justify-start pl-2 disabled:pointer-events-none"
          >
            <ChevronLeft className="h-8 w-8 text-white/0 transition group-hover:text-white/70" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={pageNum >= numPages}
            aria-label="Trang sau"
            className="group absolute inset-y-0 right-0 z-[15] flex w-16 items-center justify-end pr-2 disabled:pointer-events-none"
          >
            <ChevronRight className="h-8 w-8 text-white/0 transition group-hover:text-white/70" />
          </button>
        </>
      ) : null}
    </SlideStage>
  );
}
