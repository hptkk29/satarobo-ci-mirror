"use client";

// components/admin/scorm-player.tsx — R7-12: player SCORM (iframe) trong khung SlideStage.
//   • iframe sandbox trỏ asset resolver (vé trong query) — KHÔNG nút tải.
//   • window.API = adapter SCORM 1.2 (delivery tracking GV) — seed resume + POST runtime.
//   • Chống quay lén (watermark/blur) + nút toàn màn hình: do SlideStage lo (dùng chung PDF).
// Mọi hiệu ứng bảo vệ FAIL-OPEN: lỗi JS không được chặn việc dạy học.
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { mountScorm12Api, type ScormSeed } from "@/components/admin/scorm-api";
import { SlideStage, type SlideStageFit } from "@/components/admin/slide-stage";
import { taoUrlAssetScorm } from "@/lib/scorm/asset-url";

interface ScormPlayerProps {
  launchTicket: string;
  /** href launch tương đối trong gói (vd "res/index.html"). */
  launchUrl: string;
  packageName: string;
  name: string;
  employeeCode: string;
  /** Gói + buổi để adapter POST /api/scorm/runtime (learner = GV, KHÔNG HV). */
  packageId: string;
  classSessionId: string | null;
  /** Dữ liệu resume từ ScormAttempt của GV (bookmark + suspend + trạng thái). */
  seed: ScormSeed;
  /** Nhãn trạng thái giảng hiện tại (resume) + lần mở gần nhất — hiển thị cho GV. */
  statusLabel?: string;
  lastAccessedLabel?: string;
  /** Chuyển tiếp cho SlideStage — site GV dùng "viewport" + lối thoát (xem SlideStageFit). */
  fit?: SlideStageFit;
  exitHref?: string;
}

export function ScormPlayer({
  launchTicket,
  launchUrl,
  packageName,
  name,
  employeeCode,
  packageId,
  classSessionId,
  seed,
  statusLabel,
  lastAccessedLabel,
  fit,
  exitHref,
}: ScormPlayerProps) {
  // URL mang MÃ GÓI (cache + cookie vé theo gói) — xem lib/scorm/asset-url.ts.
  const src = taoUrlAssetScorm(packageId, launchUrl, launchTicket);

  // Lớp phủ "đang tải" (12/10/2026): gói thật ~30–150MB / 400–570 tệp, mạng yếu thì màn đen quay hoài mà không ai biết
  // đang đợi gì. Hiện trạng thái, sau 12s nói rõ "mạng yếu" và cho nút Tải lại (reload CẢ TRANG — cấp vé mới; chỉ nạp lại
  // iframe sẽ dùng lại vé có thể đã hết hạn) + nút ẩn thông báo (không để lớp phủ chặn nội dung đã dùng được).
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [daTai, setDaTai] = useState(false);
  const [cham, setCham] = useState(false);
  useEffect(() => {
    if (daTai) return;
    // `onLoad` có thể đã chạy TRƯỚC khi React gắn handler (iframe nằm sẵn trong HTML SSR) ⇒ kiểm trực tiếp, nếu không lớp phủ
    // kẹt mãi. `about:blank` ban đầu cũng báo "complete" nên loại ra.
    try {
      const w = iframeRef.current?.contentWindow;
      if (w && w.location.href !== "about:blank" && w.document.readyState === "complete") {
        setDaTai(true);
        return;
      }
    } catch {
      /* fail-open: không đọc được thì chờ onLoad */
    }
    const hen = window.setTimeout(() => setCham(true), 12000);
    return () => window.clearTimeout(hen);
  }, [daTai]);

  // SCORM 1.2 API adapter: set window.API TRƯỚC khi iframe content chạy LMSInitialize.
  // Seed resume + POST runtime trên Commit/Finish/unload. learner = GV; KHÔNG ghi điểm HV.
  useEffect(() => {
    const teardown = mountScorm12Api({
      packageId,
      classSessionId,
      seed,
      learnerId: employeeCode || "",
      learnerName: name || "",
    });
    // Gói SCORM 2004 (API_1484_11): stub no-op fail-open (tracking chỉ làm cho 1.2).
    try {
      const w = window as unknown as Record<string, unknown>;
      if (!w.API_1484_11) {
        const noop = () => "true";
        const empty = () => "";
        w.API_1484_11 = {
          Initialize: noop,
          Terminate: noop,
          GetValue: empty,
          SetValue: noop,
          Commit: noop,
          GetLastError: () => "0",
          GetErrorString: empty,
          GetDiagnostic: empty,
        };
      }
    } catch {
      /* fail-open */
    }
    return teardown;
  }, [packageId, classSessionId, seed, employeeCode, name]);

  return (
    <SlideStage
      title={packageName}
      kindLabel="SCORM"
      name={name}
      employeeCode={employeeCode}
      statusLabel={statusLabel}
      lastAccessedLabel={lastAccessedLabel}
      fit={fit}
      exitHref={exitHref}
    >
      <iframe
        ref={iframeRef}
        onLoad={() => setDaTai(true)}
        title={packageName}
        src={src}
        className="absolute inset-0 h-full w-full bg-card"
        // KHÔNG allow-downloads → ẩn khả năng tải; allow-scripts/forms cho nội dung chạy.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
      />
      {!daTai && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/90 px-6 text-center"
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary-ink" aria-hidden />
          <p className="text-sm font-semibold text-foreground">Đang tải bài giảng…</p>
          {cham && (
            <>
              <p className="max-w-sm text-sm text-muted-foreground">
                Mạng đang yếu nên bài tải lâu hơn bình thường. Bài giảng khá nặng — vui lòng chờ thêm, hoặc tải lại nếu quá lâu.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Tải lại
                </button>
                <button
                  type="button"
                  onClick={() => setDaTai(true)}
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Ẩn thông báo
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </SlideStage>
  );
}
