"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Clock, MapPin, CalendarCheck, Phone, ArrowRight } from "lucide-react";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { PROGRAM_START, PROGRAM_END } from "@/lib/uu-dai";

// sessionStorage key — prevents re-showing within the same browsing session
// once the visitor dismisses the popup.
const STORAGE_KEY = "satarobo-popup-hoc-thu-1-1-dismissed";

// Cửa sổ hiển thị = cửa sổ chương trình "Ưu đãi Khai giảng Sata Robo 2026",
// lấy thẳng từ @/lib/uu-dai — KHÔNG khai lại mốc riêng ở đây, vì popup từng
// tự giữ 2 mốc ngày của mình nên lệch hạn với các bề mặt khác.
const INITIAL_DELAY_MS = 15_000; // first show 15s after page load

// Trang KHÔNG được bật popup. `/lien-he` CHÍNH LÀ form đăng ký — bật một overlay
// che kín form sau 15s là tự tay chặn đúng việc khách đang làm dở (phụ huynh mới
// gõ được tên con thì ăn ngay modal vào mặt). Popup gắn ở `app/(public)/layout.tsx`
// nên chạy trên MỌI trang public; layout là Server Component không biết pathname,
// vì vậy chặn ngay tại đây. Các trang còn lại giữ nguyên popup 15s.
const SUPPRESSED_PATH = "/lien-he";

// Popup chỉ MỜI ĐĂNG KÝ trải nghiệm 1-1 — KHÔNG in ngày khai giảng [chủ dự án chốt 02/10/2026].
// Bản trước tự tính 2 "khung khai giảng" (Thứ 7 + Thứ 2) từ lib/opening-date.ts, và khung
// Thứ 2 rơi đúng ngày nghỉ của công ty. Lịch buổi trải nghiệm do tư vấn viên xếp khi gọi lại.
const QUYEN_LOI = [
  { icon: Clock, text: "1 buổi 90 phút, học 1 kèm 1 cùng giáo viên" },
  { icon: CalendarCheck, text: "Sata Robo gọi lại để xếp giờ phù hợp với lịch của con" },
  { icon: MapPin, text: "Áp dụng cả 2 cơ sở: 211 Nguyễn Hữu Thọ & 114 Hoàng Diệu" },
] as const;

function hasBeenDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "true");
  } catch {
    /* sessionStorage blocked — popup will reappear next mount, acceptable */
  }
}

export function PopupHocThu11() {
  const [isOpen, setIsOpen] = useState(false);

  const pathname = usePathname() ?? "";
  const suppressed =
    pathname === SUPPRESSED_PATH || pathname.startsWith(`${SUPPRESSED_PATH}/`);

  useEffect(() => {
    // Layout của route group giữ component này SỐNG khi khách chuyển trang, nên
    // phải đóng luôn: đang mở popup ở trang chủ rồi bấm sang /lien-he mà chỉ
    // `return null` thì lúc quay ra nó bật lại ngay, không cần chờ 15s nữa.
    if (suppressed) {
      setIsOpen(false);
      return;
    }

    const now = new Date();
    if (now < PROGRAM_START || now > PROGRAM_END) return;
    if (hasBeenDismissed()) return;

    const id = window.setTimeout(() => setIsOpen(true), INITIAL_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [suppressed]);

  const handleDismiss = () => {
    markDismissed();
    setIsOpen(false);
  };

  if (suppressed || !isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="popup-hoc-thu-title"
      // Mobile: p-2 (8px) thay vì p-4 (16px) để khung popup rộng hơn.
      // KHÔNG dùng overflow-y-auto trên outer (gây tràn body khi content
      // dài) — thay vào đó, scroll riêng trên body section của modal.
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4"
      onClick={handleDismiss}
    >
      <div
        // Constrain max-height = 95vh trên mobile / 90vh trên desktop để
        // modal không bao giờ tràn viewport. flex flex-col + overflow-hidden
        // ở modal frame; header shrink-0 giữ nguyên kích thước; body
        // overflow-y-auto cho phép scroll nội dung khi cần.
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* X close — absolute top-right, smaller trên mobile, z-20 cao hơn
            mọi nội dung khác trong modal */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Đóng"
          className="absolute top-2 right-2 sm:top-3 sm:right-3 z-20 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white/95 hover:bg-white shadow-md flex items-center justify-center transition-colors ring-1 ring-black/5"
        >
          <X className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>

        {/* Header — không scroll, shrink-0. Bớt padding mobile để tiết kiệm
            không gian dọc. */}
        <div className="shrink-0 bg-gradient-to-br from-orange-500 to-red-500 text-white px-4 sm:px-6 py-4 sm:py-6 pr-12 sm:pr-14">
          <div className="text-[11px] sm:text-xs uppercase tracking-wider opacity-90 mb-1">
            🎁 Dành riêng cho phụ huynh mới
          </div>
          <h2
            id="popup-hoc-thu-title"
            className="text-xl sm:text-2xl md:text-3xl font-bold leading-tight"
          >
            Đăng ký trải nghiệm 1-1 miễn phí
          </h2>
          <p className="mt-2 text-xs sm:text-sm md:text-base opacity-95">
            Hoàn toàn 0 đồng, không ràng buộc.
          </p>
        </div>

        {/* Body — scrollable nếu content vượt phần còn lại của modal. min-h-0
            cho phép flex child shrink để overflow hoạt động đúng. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">
          <p className="text-sm text-gray-700">
            <strong>🤖 Buổi trải nghiệm 1-1</strong> — con làm quen Tư duy hệ thống
            và Lập trình tự động trên phần mềm <strong>RoboSim</strong>, có giáo
            viên kèm riêng suốt buổi.
          </p>

          <ul className="space-y-2.5 rounded-xl border border-orange-100 bg-orange-50/50 p-4">
            {QUYEN_LOI.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5 text-sm text-gray-700">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>

          <p className="text-xs text-gray-500">
            💻 Học sinh mang laptop cá nhân để cài đặt phần mềm và thực hành.
          </p>

          <div className="space-y-2 pt-1">
            <Link
              href="/lien-he?free-trial=true"
              onClick={handleDismiss}
              className="cta-shine flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-600 sm:text-base"
            >
              Đăng ký trải nghiệm miễn phí
              <ArrowRight className="h-4 w-4" />
            </Link>
            <div className="flex flex-col gap-2 sm:flex-row">
              <a
                href={SATA_ROBO_PHONE.zalo}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleDismiss}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border-2 border-orange-500 px-4 py-2.5 text-sm font-semibold text-orange-600 transition-colors hover:bg-orange-50"
              >
                💬 Nhắn Zalo
              </a>
              <a
                href={`tel:${SATA_ROBO_PHONE.tho}`}
                onClick={handleDismiss}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border-2 border-orange-500 px-4 py-2.5 text-sm font-semibold text-orange-600 transition-colors hover:bg-orange-50"
              >
                <Phone className="h-4 w-4" />
                {SATA_ROBO_PHONE.hien}
              </a>
            </div>
          </div>

          <p className="pt-1 text-center text-[11px] text-gray-500 sm:text-xs">
            Cú pháp nhắn Zalo:{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] sm:text-[11px]">
              [HỌC THỬ – Tên Cơ Sở]
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}
