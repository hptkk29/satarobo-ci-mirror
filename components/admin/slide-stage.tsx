"use client";

// components/admin/slide-stage.tsx — khung trình chiếu DÙNG CHUNG cho giáo án PDF & SCORM.
//   • Thanh tiêu đề (luôn hiện kể cả full màn hình): tên + toolbar + nút full + nhãn loại.
//   • Khung đen chứa nội dung (iframe SCORM hoặc canvas PDF) truyền qua children.
//   • Watermark theo câu 56 (Toại, tối giản để không phá trải nghiệm bé): 1 chữ "SataRobo"
//     cỡ LỚN + rất mờ ở giữa (vẫn đọc slide được) + ID giáo viên (mã NV) nhỏ ở góc, kèm dấu
//     giờ để truy vết; React dựng lại mỗi giây nếu lớp watermark bị can thiệp DOM.
//   • Blur overlay CHỈ khi RỜI THẬT (đổi tab / thu nhỏ / chuyển ứng dụng) — KHÔNG ẩn khi
//     bấm nút/next hay click vào nội dung (focus vào iframe) hay lúc bật/tắt full màn hình.
//   Lưu ý: KHÔNG thể chặn chụp màn hình OS (PrintScreen / Win+Shift+S) từ web — watermark
//   là biện pháp răn đe chính.
//
// ⚠️ 23/08/2026 — nút TOÀN MÀN HÌNH vốn đã có từ đầu nhưng GV báo "chưa có": nó là một
// icon 3,5×3,5 không nhãn, lọt giữa hàng chữ xám cạnh badge trạng thái ⇒ không ai thấy.
// Nay nó là nút CÓ NHÃN CHỮ + nền tương phản, nhãn hiện ở MỌI bề rộng (kể cả 375px — ẩn
// nhãn ở màn hẹp là tái lập đúng vấn đề gốc), kèm phím tắt **F**. Đừng "dọn cho gọn" về
// icon trần lần nữa, cũng đừng gắn lại `hidden sm:inline` cho nhãn.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Cách khung chiếm chỗ ở chế độ THƯỜNG (lúc full màn hình thì luôn phủ kín, không tính):
 *  - `"inline"` (mặc định) — nằm trong luồng trang, cao gần trọn khung nhìn. Hành vi cũ,
 *    dùng cho khu admin (`<main>` của admin tự cuộn nên khung vừa khít ở đó).
 *  - `"viewport"` — phủ kín khung nhìn (`fixed inset-0`). Dùng cho site giáo viên: trang
 *    trình chiếu bị bọc trong AppShell (Topbar + padding của `<main>`), nên khung theo
 *    luồng sẽ cộng thêm chiều cao ⇒ trang cuộn dọc và bài giảng bị bóp nhỏ lại.
 */
export type SlideStageFit = "inline" | "viewport";

function hhmmss(d: Date): string {
  return d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function SlideStage({
  title,
  kindLabel,
  name,
  employeeCode,
  statusLabel,
  lastAccessedLabel,
  toolbar,
  fit = "inline",
  exitHref,
  children,
}: {
  title: string;
  /** Nhãn loại hiển thị góc phải: "SCORM" | "PDF". */
  kindLabel: string;
  name: string;
  employeeCode: string;
  statusLabel?: string;
  lastAccessedLabel?: string;
  /** Điều khiển riêng theo loại (vd PDF: ‹ 3/12 ›). */
  toolbar?: ReactNode;
  /** Xem `SlideStageFit`. Mặc định giữ nguyên hành vi cũ của khu admin. */
  fit?: SlideStageFit;
  /**
   * Lối thoát khi khung phủ kín khung nhìn (`fit="viewport"`): khung phủ kín che mất
   * sidebar — thiếu chỗ này là GV bị kẹt, không còn lối điều hướng nào.
   * Không truyền = không hiện (khu admin vẫn còn sidebar bên cạnh).
   */
  exitHref?: string;
  children: ReactNode;
}) {
  const [blurred, setBlurred] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clock, setClock] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const label = `${employeeCode}${employeeCode ? " · " : ""}${name}`.trim();
  const watermark = `${label}${label ? " · " : ""}${clock}`;

  // Blur overlay khi RỜI THẬT khỏi cửa sổ học (đổi tab/thu nhỏ/sang app khác). Bỏ qua:
  //  - focus chuyển VÀO iframe (click nội dung SCORM) → activeElement là IFRAME.
  //  - thời điểm bật/tắt full màn hình (focus chuyển tạm) → guard 700ms.
  useEffect(() => {
    let fsGuardUntil = 0;
    const onVisibility = () => setBlurred(document.hidden);
    const onWinBlur = () => {
      if (Date.now() < fsGuardUntil) return;
      if (document.activeElement?.tagName === "IFRAME") return;
      setBlurred(true);
    };
    const onWinFocus = () => setBlurred(false);
    const onFsChange = () => {
      fsGuardUntil = Date.now() + 700;
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    try {
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("blur", onWinBlur);
      window.addEventListener("focus", onWinFocus);
      document.addEventListener("fullscreenchange", onFsChange);
    } catch {
      /* fail-open */
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onWinBlur);
      window.removeEventListener("focus", onWinFocus);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);

  // Đồng hồ watermark — cập nhật mỗi giây (dấu thời gian để truy vết ai chụp/lộ).
  // Re-render mỗi giây cũng giúp React dựng lại lớp watermark nếu bị can thiệp.
  useEffect(() => {
    const upd = () => setClock(hhmmss(new Date()));
    upd();
    const t = window.setInterval(upd, 1000);
    return () => window.clearInterval(t);
  }, []);

  // Deterrent (best-effort, KHÔNG tuyệt đối): chặn chuột phải + Ctrl/Cmd+P/S + cố vô hiệu
  // PrintScreen (ghi đè clipboard + blur). Win+Shift+S do OS bắt → web KHÔNG chặn được.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        try {
          void navigator.clipboard?.writeText("");
        } catch {
          /* clipboard API có thể bị chặn — bỏ qua */
        }
        setBlurred(true);
        window.setTimeout(() => setBlurred(false), 800);
        return;
      }
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === "p" || k === "s")) {
        e.preventDefault();
      }
    };
    document.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // GIỮ NGUYÊN cách bật/tắt (requestFullscreen/exitFullscreen trên chính rootRef) — guard
  // 700ms chống blur giả ở effect trên bám vào sự kiện `fullscreenchange`, nên mọi lối vào
  // (nút bấm, phím F, Esc của trình duyệt) đều đi qua đúng một cửa và guard vẫn chạy.
  // useCallback để effect phím tắt bên dưới không phải gắn/gỡ listener mỗi lần render
  // (component này re-render MỖI GIÂY vì đồng hồ watermark).
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    // `try/catch` KHÔNG bắt được lỗi của hai hàm này: chúng trả về Promise và báo lỗi
    // bằng REJECT (trình duyệt từ chối, đã có phần tử khác đang full, bấm dồn hai nhịp).
    // Không gắn .catch thì thành "unhandled rejection" đỏ console giữa giờ dạy — nuốt
    // đúng theo tinh thần fail-open của cả file này.
    const swallow = () => {
      /* fail-open — không chặn việc dạy học */
    };
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(swallow);
      else void el.requestFullscreen().catch(swallow);
    } catch {
      /* fail-open */
    }
  }, []);

  // Phím tắt F — bật/tắt toàn màn hình (Esc thoát là hành vi sẵn có của trình duyệt, KHÔNG
  // tự xử lý). Để riêng khỏi effect chống chụp màn hình ở trên vì effect đó còn nghe cả
  // `keyup` — nhét chung thì phím F kích hoạt hai lần một nhịp bấm.
  // Bỏ qua khi con trỏ đang ở ô nhập liệu: GV gõ chữ "f" vào ô tìm kiếm không được nhảy
  // toàn màn hình. Cũng bỏ qua khi có Ctrl/Cmd/Alt để không cướp Ctrl+F (tìm trong trang).
  // Lưu ý: khi tiêu điểm nằm TRONG iframe SCORM thì keydown KHÔNG tới document cha ⇒ phím
  // F đi thẳng vào nội dung bài giảng. Đó là điều mong muốn — đừng "vá" bằng cách bắt phím
  // hộ iframe, sẽ chặn mất phím tắt của chính gói SCORM.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Giữ phím (hoặc bút trình chiếu kẹt) sinh ~30 keydown/giây với `repeat=true` —
      // không chặn thì bật/tắt full màn hình 30 lần/giây, màn hình nháy loạn và trình
      // duyệt bắt đầu từ chối yêu cầu. Chỉ nhận nhịp bấm ĐẦU TIÊN.
      if (e.repeat) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (el?.isContentEditable) return;
      e.preventDefault();
      toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen]);

  const fsTitle = isFullscreen
    ? "Thoát toàn màn hình (F)"
    : "Toàn màn hình (F)";

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex flex-col gap-2 p-2",
        isFullscreen
          ? "h-screen w-screen bg-black"
          : fit === "viewport"
            ? // 100dvh chứ không phải 100vh: trên trình duyệt di động thanh địa chỉ co/giãn,
              // 100vh tính theo lúc thanh ẩn ⇒ đáy khung bị cắt mất một dải.
              "fixed inset-0 z-50 h-[100dvh] bg-background"
            : "h-[calc(100dvh-2rem)]",
      )}
    >
      {/* Ở 375px hàng này (tên bài + badge trạng thái + toolbar + nút full + nút Đóng) dài
          hơn bề ngang màn hình. Cách chia: dưới 640px tên bài chiếm trọn dòng đầu
          (`w-full`) để cụm nút được nguyên 1 dòng và tự xuống hàng bên trong (`flex-wrap`)
          — thay vì tràn ra ngoài. Từ 640px trở lên quay về hành vi cũ: `flex-1` cơ sở 0 nên
          cụm nút không bao giờ bị đẩy xuống, tên bài dài thì cắt bớt (`truncate`). */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h1
          className={cn(
            "w-full min-w-0 truncate text-sm font-medium sm:w-auto sm:flex-1",
            isFullscreen ? "text-white/90" : "text-foreground",
          )}
        >
          {title}
        </h1>
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center justify-end gap-2 text-xs",
            isFullscreen ? "text-white/70" : "text-muted-foreground",
          )}
        >
          {statusLabel ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              Giảng: {statusLabel}
              {lastAccessedLabel ? ` · ${lastAccessedLabel}` : ""}
            </span>
          ) : null}
          {toolbar}
          {/* Nút chính của thanh này — cỡ bấm ≥32px, nền + viền tương phản hẳn với hàng chữ
              xám xung quanh, và nhãn chữ HIỆN Ở MỌI BỀ RỘNG. Ở chế độ toàn màn hình nền là
              ĐEN nên phải có bảng màu riêng, không dùng token sáng. */}
          <button
            type="button"
            onClick={toggleFullscreen}
            title={fsTitle}
            aria-label={fsTitle}
            // KHÔNG dùng `aria-pressed`: nhãn ở đây ĐÃ đổi theo trạng thái
            // ("Toàn màn hình" ↔ "Thoát toàn màn hình"). Gắn thêm aria-pressed thì trình
            // đọc màn hình đọc "Thoát toàn màn hình, nút, đã bật" — trạng thái bị nói hai
            // lần và ngược nghĩa nhau. WAI-ARIA APG: đổi nhãn HOẶC aria-pressed, không cả hai.
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
              isFullscreen
                ? "border-white/40 bg-white/15 text-white hover:bg-white/25"
                : "border-primary-soft bg-primary-soft text-primary-ink hover:bg-primary-soft-hover dark:border-primary",
            )}
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" aria-hidden />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden />
            )}
            {/* ⚠️ KHÔNG bọc `hidden sm:inline` như trước: dưới 640px nút thu về icon trần —
                đúng lại cái vấn đề gốc "GV không thấy nút toàn màn hình". Nhãn phải ĐỌC
                ĐƯỢC LÀ CHỮ ở mọi bề rộng, kể cả 375px.
                Đo chỗ trống ở 375px: 375 − p-2 (16) − px-1 (8) = 351px cho hàng tiêu đề;
                dưới 640px thẻ <h1> đã chiếm trọn dòng riêng (`w-full`) và cụm nút thì
                `flex-wrap`, nên nút được nguyên một dòng. Bản thân nút ở trạng thái dài
                nhất ("Thoát toàn màn hình", 19 ký tự text-xs) chỉ ~165px = px-2.5 (20) +
                icon (16) + gap (6) + chữ (~120) ⇒ dư chỗ, không tràn.
                `whitespace-nowrap` để nhãn không xuống hai dòng bên trong nút cao h-8
                (sẽ bị cắt chữ) nếu chỗ trống hẹp hơn tính toán trên. */}
            <span className="whitespace-nowrap">
              {isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
            </span>
          </button>
          {/* Lối thoát cho khung phủ kín (site GV): khung này che mất sidebar. Dùng
              next/link vì từ 24/08 viewer mở CÙNG TAB — `<a>` trần sẽ nạp lại toàn trang
              tài liệu thay vì điều hướng phía client. Ẩn khi đang toàn màn hình — lúc đó
              thoát bằng chính nút trên (hoặc Esc), tránh bấm nhầm rời trang giữa giờ dạy.
              Nhãn nút này VẪN ẩn dưới 640px (khác nút Toàn màn hình ở trên) — CÓ CHỦ ĐÍCH:
              nó là nút phụ, thu về icon để nhường chỗ trên dòng cho nhãn của nút chính. */}
          {exitHref && !isFullscreen ? (
            <Link
              href={exitHref}
              title="Đóng trình chiếu"
              aria-label="Đóng trình chiếu"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Đóng</span>
            </Link>
          ) : null}
          <span>{kindLabel}</span>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-md border border-border bg-black">
        {children}

        {/* Watermark theo câu 56 (Toại — tối giản, không phá trải nghiệm bé):
            1 chữ "SataRobo" cỡ LỚN + rất mờ ở giữa (vẫn đọc slide được) + ID giáo viên
            (mã NV · tên · giờ) nhỏ ở góc để truy vết người trình chiếu. pointer-events:none
            → KHÔNG chặn thao tác. Re-render mỗi giây (đồng hồ) giúp React dựng lại lớp này
            nếu bị can thiệp DOM. (Web không chặn được chụp màn hình OS — đây là răn đe/truy vết.) */}
        <div className="pointer-events-none absolute inset-0 z-10 select-none overflow-hidden">
          {/* Chữ "SataRobo" lớn, rất mờ, giữa khung — vẫn nhìn thấy nhưng không cản đọc slide */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              aria-hidden
              className="select-none whitespace-nowrap font-bold uppercase tracking-[0.15em] text-muted-foreground"
              style={{ opacity: 0.07, fontSize: "clamp(2.5rem, 11vw, 9rem)" }}
            >
              SataRobo
            </span>
          </div>
          {/* ID giáo viên đang chiếu (nhỏ) + giờ ở góc — vệt truy vết ai lộ nội dung */}
          {watermark ? (
            <span
              aria-hidden
              className="absolute bottom-1.5 right-2.5 whitespace-nowrap text-[11px] font-medium text-muted-foreground"
              style={{ opacity: 0.35 }}
            >
              {watermark}
            </span>
          ) : null}
        </div>

        {/* Blur overlay khi rời cửa sổ học thật sự */}
        {blurred ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-xl">
            <p className="px-4 text-center text-sm text-muted-foreground">
              Nội dung tạm ẩn khi rời khỏi cửa sổ học. Quay lại để tiếp tục.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
