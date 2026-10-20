"use client";

// components/admin/scorm-player.tsx — R7-12: player SCORM (iframe) trong khung SlideStage.
//   • iframe sandbox trỏ asset resolver (vé trong query) — KHÔNG nút tải.
//   • window.API = adapter SCORM 1.2 (delivery tracking GV) — seed resume + POST runtime.
//   • Chống quay lén (watermark/blur) + nút toàn màn hình: do SlideStage lo (dùng chung PDF).
// Mọi hiệu ứng bảo vệ FAIL-OPEN: lỗi JS không được chặn việc dạy học.
import { useEffect } from "react";
import { mountScorm12Api, type ScormSeed } from "@/components/admin/scorm-api";
import { SlideStage, type SlideStageFit } from "@/components/admin/slide-stage";

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

/** Build src iframe: mã hoá từng segment, đính vé vào query. */
function buildAssetSrc(launchUrl: string, ticket: string): string {
  const clean = launchUrl.replace(/\\/g, "/").replace(/^\.?\//, "");
  const encoded = clean.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `/api/scorm/asset/${encoded}?t=${encodeURIComponent(ticket)}`;
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
  const src = buildAssetSrc(launchUrl, launchTicket);

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
        title={packageName}
        src={src}
        className="absolute inset-0 h-full w-full bg-card"
        // KHÔNG allow-downloads → ẩn khả năng tải; allow-scripts/forms cho nội dung chạy.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
      />
    </SlideStage>
  );
}
