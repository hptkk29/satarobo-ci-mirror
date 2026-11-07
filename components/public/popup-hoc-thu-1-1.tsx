"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LienHeForm } from "@/components/public/lien-he-form";
import { GIO_LAM_VIEC } from "@/components/public/gio-lam-viec";
import { docDaGui, doTreKeTiep, ghiDaGui } from "@/components/public/popup-hen-gio";
import { laTrangRiengTu } from "@/lib/public/trang-rieng-tu";

// Trang KHÔNG được bật popup. `/lien-he` CHÍNH LÀ form đăng ký — bật một overlay
// che kín form sau 15s là tự tay chặn đúng việc khách đang làm dở (phụ huynh mới
// gõ được tên con thì ăn ngay modal vào mặt). Popup gắn ở `app/(public)/layout.tsx`
// nên chạy trên MỌI trang public; layout là Server Component không biết pathname,
// vì vậy chặn ngay tại đây. Các trang còn lại giữ nguyên popup 15s.
// Thêm /disc (làm bài về con), /portal, /kich-hoat (nhập mã/OTP): overlay z-110 chặn bấm giữa chừng — đo e2e 02/11/2026.
const SUPPRESSED_PATHS = ["/lien-he", "/disc", "/portal", "/kich-hoat"] as const;

/** Phần tử bấm/nhập được bên trong hộp thoại — để khoá Tab trong hộp (aria-modal). */
const CHON_FOCUS =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Popup mời đặt buổi học thử 1-1 miễn phí — giao diện `.modal` / `.modal-card` / `.modal-x` của
 * artifact "Sata Robo — Website mới"; form bên trong là `LienHeForm variant="popup"` (CÙNG đường
 * gửi `/api/leads` với trang /lien-he, kèm attribution). Hẹn giờ ĐÚNG artifact: lần đầu sau 20 giây;
 * đóng rồi 60 giây sau hiện lại; đã gửi form thì không hiện nữa (localStorage); tắt ở trang làm việc.
 */
export function PopupHocThu11() {
  const [isOpen, setIsOpen] = useState(false);
  const [daGui, setDaGui] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const truocKhiMo = useRef<HTMLElement | null>(null);

  const pathname = usePathname() ?? "";
  const suppressed =
    SUPPRESSED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
    ) || laTrangRiengTu(pathname);

  const timer = useRef<number | null>(null);
  const daGuiRef = useRef(false);

  const hen = useCallback((ms: number | null) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (ms === null || daGuiRef.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (!daGuiRef.current) setIsOpen(true);
    }, ms);
  }, []);

  useEffect(() => {
    // Layout của route group giữ component này SỐNG khi khách chuyển trang, nên phải đóng luôn:
    // đang mở popup ở trang chủ rồi bấm sang /lien-he mà chỉ `return null` thì lúc quay ra nó bật lại ngay.
    if (suppressed) {
      hen(null);
      setIsOpen(false);
      return;
    }
    daGuiRef.current = docDaGui(typeof window === "undefined" ? null : window.localStorage);
    hen(doTreKeTiep("vao-trang", daGuiRef.current));
    return () => hen(null);
  }, [suppressed, hen]);

  // Đóng (×, "Để sau", bấm nền, Esc) ⇒ 60 giây sau hiện lại, trừ khi đã gửi form.
  const handleDismiss = useCallback(() => {
    setIsOpen(false);
    hen(doTreKeTiep("dong", daGuiRef.current));
  }, [hen]);

  const khiGuiXong = useCallback(() => {
    daGuiRef.current = true;
    ghiDaGui(window.localStorage);
    hen(null);
    setDaGui(true);
  }, [hen]);

  const mo = isOpen && !suppressed;

  // Esc đóng · khoá Tab trong hộp · trả focus về chỗ cũ khi đóng.
  useEffect(() => {
    if (!mo) return;
    truocKhiMo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const card = cardRef.current;
    // Vào hộp: đưa focus vào ô đầu tiên (hoặc chính hộp) — không bật bàn phím ảo ép trên điện thoại.
    const dauTien = card?.querySelector<HTMLElement>('input:not([aria-hidden="true"]),select,textarea');
    const manHinhRong = typeof window.matchMedia === "function" && window.matchMedia("(min-width: 768px)").matches;
    if (manHinhRong && dauTien) dauTien.focus();
    else card?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleDismiss();
        return;
      }
      if (e.key !== "Tab" || !card) return;
      const cac = Array.from(card.querySelectorAll<HTMLElement>(CHON_FOCUS)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (cac.length === 0) return;
      const dau = cac[0];
      const cuoi = cac[cac.length - 1];
      if (!dau || !cuoi) return;
      if (e.shiftKey && (document.activeElement === dau || document.activeElement === card)) {
        e.preventDefault();
        cuoi.focus();
      } else if (!e.shiftKey && document.activeElement === cuoi) {
        e.preventDefault();
        dau.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      truocKhiMo.current?.focus?.();
    };
  }, [mo, handleDismiss]);

  if (!mo) return null;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="popup-hoc-thu-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div className="modal-card" ref={cardRef} tabIndex={-1} style={{ outline: "none" }}>
        <button type="button" className="modal-x" onClick={handleDismiss} aria-label="Đóng">
          ×
        </button>

        {daGui ? (
          <div style={{ textAlign: "center", padding: "12px 8px 4px" }} role="status">
            <Image src="/pub/da7446f042256bc74bcdfe2e701329c9.webp" alt="" aria-hidden="true" width={642} height={714} className="bob" style={{ width: "140px", height: "auto" }} />
            <p id="popup-hoc-thu-title" style={{ margin: "10px 0 6px", fontFamily: "var(--font-unbounded),'Unbounded',sans-serif", fontWeight: 600, fontSize: "22px" }}>
              Cảm ơn ba mẹ!
            </p>
            <p style={{ margin: "0 0 18px", color: "var(--muted)" }}>
              Sata Robo sẽ gọi lại trong 30 phút (trong giờ làm việc: {GIO_LAM_VIEC}).
            </p>
            <button type="button" onClick={handleDismiss} className="btn btn-line">
              Đóng
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "14px", margin: "-6px 40px 16px 0" }}>
              <Image src="/pub/9ae4558c2081175d5a405b660b794651.webp" alt="" aria-hidden="true" width={634} height={646} className="bob" style={{ width: "92px", height: "auto", flexShrink: 0, filter: "drop-shadow(0 10px 14px rgba(0,0,0,.3))" }} />
              <div>
                <span style={{ display: "inline-block", padding: "4px 12px", borderRadius: "999px", background: "rgba(254,143,45,.14)", border: "1px solid rgba(254,143,45,.5)", color: "var(--accT)", fontWeight: 700, fontSize: "12px" }}>
                  Miễn phí · 0 đồng
                </span>
                <p id="popup-hoc-thu-title" style={{ margin: "8px 0 0", fontFamily: "var(--font-unbounded),'Unbounded',sans-serif", fontWeight: 600, fontSize: "clamp(19px,2.4vw,23px)", lineHeight: 1.3 }}>
                  Cho con <span className="grad">học thử 1-1</span> với robot thật
                </p>
              </div>
            </div>
            <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: "14px" }}>
              Để lại số điện thoại, Sata Robo gọi lại trong 30 phút ({GIO_LAM_VIEC}).
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <LienHeForm variant="popup" onSuccess={khiGuiXong} />
              <button type="button" onClick={handleDismiss} className="pub-pop-x">
                Để sau
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
