"use client";

// kiosk-stage.tsx — chế độ TRÌNH CHIẾU của màn QR quầy: lớp phủ toàn màn hình + thang chữ TV.
//
// VÌ SAO TỒN TẠI: màn này vốn render BÊN TRONG khung admin, nên trên TV phòng chờ khách nhìn
// thấy sidebar quản trị, tên người đang đăng nhập và chuông thông báo, còn QR thì lọt thỏm.
// Lớp phủ `fixed inset-0` che hết vỏ admin mà KHÔNG đổi route và KHÔNG đụng layout admin —
// route `/cham-cong/man-hinh?centerId=` vẫn là một, chỉ đổi chế độ hiển thị.
//
// ĐIỀU DỄ VỠ:
//  - `requestFullscreen()` phải gọi TRONG cử chỉ bấm. Gọi trong `useEffect` sau khi đổi state
//    là trình duyệt coi như không có cử chỉ và từ chối im lặng.
//  - Esc trong chế độ toàn màn hình KHÔNG luôn phát `keydown` — đường đóng đáng tin là
//    `fullscreenchange`. Vẫn nghe cả hai vì có máy chặn toàn màn hình (khi đó chỉ còn Esc).
//  - TUYỆT ĐỐI không in tên người lên đây: đây là màn hướng ra chỗ khách ngồi.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, Monitor, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, PILL } from "@/components/admin/cham-cong/classes";
import { Skeleton } from "@/components/ui/skeleton";
import {
  KioskFailView,
  StaleBanner,
  loginHrefFor,
  useKioskQr,
  vnHhMm,
  type KioskFailProps,
} from "./qr-screen";

export type KioskStageProps = KioskFailProps & {
  /** Tên đầy đủ của cơ sở — dòng to nhất trên TV. */
  centerName: string;
  /** Tên điểm chấm công đọc từ máy chủ; poll sau đó có thể làm mới nó. */
  locationName: string;
  geofenceEnabled: boolean;
};

/**
 * Nút "Trình chiếu" ở đầu trang + lớp phủ khi bật.
 *
 * Lớp phủ chỉ được mount khi mở, nên lúc đóng chỉ có DUY NHẤT thẻ xem trước gọi API — không
 * có hai vòng poll chạy song song suốt ngày trên máy để bàn.
 */
export function KioskLauncher(props: KioskStageProps) {
  const [open, setOpen] = useState(false);

  const openStage = useCallback(() => {
    // Trong cử chỉ bấm — xem ghi chú đầu file. Máy từ chối thì vẫn mở lớp phủ.
    document.documentElement.requestFullscreen?.().catch(() => {});
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onFullscreen = () => {
      if (!document.fullscreenElement) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button type="button" onClick={openStage} className={BTN_PRIMARY}>
        <Monitor aria-hidden className="h-4 w-4" />
        Trình chiếu
      </button>
      {open && <KioskStage {...props} onExit={close} />}
    </>
  );
}

function KioskStage({ onExit, ...props }: KioskStageProps & { onExit: () => void }) {
  const { centerId, centerName, locationName, geofenceEnabled } = props;
  const qr = useKioskQr(centerId);
  const diem = qr.snap?.locationName || locationName;
  const geofence = qr.snap ? qr.snap.geofenceEnabled : geofenceEnabled;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Trình chiếu mã QR chấm công"
      className="fixed inset-0 z-50 overflow-hidden bg-background text-foreground"
    >
      <button
        type="button"
        onClick={onExit}
        aria-label="Thoát trình chiếu (hoặc bấm Esc)"
        className={cn(BTN_OUTLINE, "absolute right-6 top-6 z-10 h-11 px-5 text-base")}
      >
        <LogOut aria-hidden className="h-5 w-5" />
        Thoát
      </button>

      {qr.status === "error" ? (
        // Cỡ TV: phóng chữ của khối trạng thái dùng chung thay vì dựng một khối riêng lệch kiểu.
        <div className="flex h-full items-center justify-center p-12">
          <div className="w-full max-w-3xl [&_code]:text-xl [&_p]:text-2xl [&_p]:leading-relaxed">
            <KioskFailView {...props} fail={qr.fail} onRetry={qr.retry} />
            {qr.fail?.kind === "AUTH" && (
              <p className="mt-6 text-center text-xl text-muted-foreground">
                Mở{" "}
                <Link href={loginHrefFor(centerId)} className="font-semibold text-primary-ink hover:underline">
                  trang đăng nhập
                </Link>{" "}
                trên chính TV này rồi quay lại.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="grid h-full grid-cols-[3fr_2fr] gap-12 p-12">
          <div className="flex min-w-0 items-center justify-center">
            {qr.status === "loading" || !qr.snap ? (
              <Skeleton
                aria-busy
                aria-label="Đang tải mã QR…"
                className="aspect-square w-full max-w-[min(70vh,720px)] rounded-2xl"
              />
            ) : (
              // `<img>` thuần: nguồn là data URL sinh tại chỗ, không có gì để tối ưu.
              <img
                src={qr.snap.qrDataUrl}
                alt="Mã QR chấm công"
                className="aspect-square w-full max-w-[min(70vh,720px)] rounded-2xl border-8 border-card bg-card p-4"
              />
            )}
          </div>

          <div className="flex min-w-0 flex-col justify-center gap-6">
            <p className="truncate text-5xl font-bold leading-tight">{centerName}</p>
            {diem && <p className="truncate text-3xl text-muted-foreground">{diem}</p>}

            <p className="text-6xl font-bold tabular-nums leading-none">
              {qr.nowMs === 0 ? "--:--" : vnHhMm(qr.nowMs)}
            </p>

            {qr.status === "stale" && qr.fail && qr.snap ? (
              <StaleBanner fail={qr.fail} className="text-2xl" />
            ) : (
              // Mã TĨNH (07/09): không đếm ngược nữa. Đếm ngược một con số không bao giờ đổi
              // thứ gì là nói dối người đứng ở quầy — họ sẽ đợi "mã mới" mãi không thấy.
              <p className="flex items-center gap-3 text-3xl text-muted-foreground">
                <QrCode aria-hidden className="h-7 w-7" />
                Quét mã để chấm công
              </p>
            )}

            <span
              className={cn(
                PILL,
                "w-fit px-4 py-1 text-2xl",
                geofence
                  ? "bg-state-success-soft text-state-success-ink"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {geofence ? "Có kiểm định vị" : "Không kiểm định vị"}
            </span>

            <p className="text-4xl font-semibold leading-snug text-primary-ink">
              Quét mã bằng điện thoại để chấm công
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
