"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { laTrangRiengTu } from "@/lib/public/trang-rieng-tu";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { DISC_NAV } from "@/lib/disc/nav";

// Trang quản trị / đăng nhập / DISC không có nút nổi (trang khoá học laptrinhrobot + luyenthirobosim nay dùng giao diện chung nên CÓ nút nổi, 03/11/2026).
// `/disc`: nút DISC không tự chỉ vào chính trang đang đứng, và trang làm bài cần toàn màn hình.
const HIDDEN_PREFIXES = ["/admin", "/login", "/disc"];

/** Banner cookie (components/public/cookie-consent.tsx): thanh cố định đáy, z-70, cao 160–270px tuỳ độ rộng. */
const CHON_BANNER_COOKIE = '[aria-labelledby="cookie-consent-title"]';

/**
 * Chiều cao banner cookie đang hiện (0 nếu không có). Banner (z-70) phủ lên các nút nổi nên trước khi người dùng chọn,
 * viên thuốc DISC trên mobile nằm DƯỚI banner và không bấm được (đo 375x812: banner cao 243px, phủ hết viên thuốc). Đẩy nút nổi
 * và thanh đáy lên trên mép banner (qua biến CSS `--nang-banner`, xem `pub.css`); có quyết định cookie xong banner biến mất ⇒ về chỗ cũ.
 */
function useChieuCaoBannerCookie(): number {
  const [cao, setCao] = useState(0);
  useEffect(() => {
    let ro: ResizeObserver | null = null;
    const doc = () => {
      const el = document.querySelector<HTMLElement>(CHON_BANNER_COOKIE);
      ro?.disconnect();
      ro = null;
      if (!el) return setCao(0);
      setCao(Math.round(el.getBoundingClientRect().height));
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => setCao(Math.round(el.getBoundingClientRect().height)));
        ro.observe(el);
      }
    };
    doc();
    const mo = new MutationObserver(doc);
    mo.observe(document.body, { childList: true });
    return () => {
      mo.disconnect();
      ro?.disconnect();
    };
  }, []);
  return cao;
}

const IC = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/**
 * Cụm nút nổi (cột phải, từ 861px) + thanh đáy điện thoại (≤860px) của giao diện public mới.
 * Vẽ BÊN TRONG `.sr-pub` nên ăn đúng token chủ đề.
 */
export function FloatingCta({ discEnabled = false }: { discEnabled?: boolean } = {}) {
  const pathname = usePathname();
  const nang = useChieuCaoBannerCookie();
  if (pathname && (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p)) || laTrangRiengTu(pathname))) return null;
  const vars = { "--nang-banner": `${nang}px` } as React.CSSProperties;

  return (
    <>
      <div className="fab" style={vars}>
        {/* DISC nằm TRÊN CÙNG ngăn xếp: không đè Zalo/học thử. Hai biến thể (máy tính / điện thoại) như trước 02/11/2026 — lưới [DISC-QA-WIRE-04] và e2e đo từng biến thể. */}
        {discEnabled && (
          <Link href={DISC_NAV.href} className="disc-pill hide-sm" data-testid="disc-floating" aria-label={DISC_NAV.label}>
            <span className="dp-dots" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            {DISC_NAV.label}
          </Link>
        )}
        {discEnabled && (
          <Link href={DISC_NAV.href} className="disc-pill pub-show-sm" data-testid="disc-floating-mobile" aria-label={DISC_NAV.label}>
            <span className="dp-dots" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            {DISC_NAV.label}
          </Link>
        )}
        <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener noreferrer" className="hi" aria-label="Hỏi Sata Robo qua Zalo" style={{ background: "transparent", textDecoration: "none" }}>
          <span style={{ background: "var(--panel)", color: "var(--text)", border: "1px solid var(--line2)", borderRadius: "14px 14px 4px 14px", padding: "8px 12px", fontSize: 13, fontWeight: 700, boxShadow: "0 10px 24px var(--shadow)", marginBottom: 40 }}>
            Hỏi Sata Robo nhé!
          </span>
          <Image className="bob" src="/pub/d578e8d03331ab7e220e21254d352bfe.webp" alt="" aria-hidden="true" width={597} height={710} style={{ width: 76, height: "auto", filter: "drop-shadow(0 10px 14px rgba(0,0,0,.35))" }} />
        </a>
        <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener noreferrer" aria-label="Chat Zalo Sata Robo" style={{ background: "#0068ff", color: "#fff" }}>
          <svg {...IC}>
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.6-.8L3 21l1.9-5.1A8.4 8.4 0 1 1 21 11.5z" />
          </svg>
        </a>
        <a href="https://m.me/satarobo" target="_blank" rel="noopener noreferrer" aria-label="Nhắn Messenger" style={{ background: "linear-gradient(135deg,#00b2ff,#a334fa,#ff5280)", color: "#fff" }}>
          <svg {...IC}>
            <path d="M12 3C6.9 3 3 6.7 3 11.4c0 2.6 1.2 4.9 3.1 6.4V21l3-1.7c.9.3 1.9.4 2.9.4 5.1 0 9-3.7 9-8.4S17.1 3 12 3z" />
            <path d="M7.5 13.5l3-3.2 2 2 3.5-2.8-3 3.2-2-2z" />
          </svg>
        </a>
        <a href={`tel:${SATA_ROBO_PHONE.tho}`} aria-label={`Gọi ${SATA_ROBO_PHONE.hien}`} style={{ position: "relative", background: "#fe8f2d", color: "#241133" }}>
          <span className="ring" aria-hidden="true" />
          <svg {...IC}>
            <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
          </svg>
        </a>
        <a href="#top" aria-label="Lên đầu trang" style={{ background: "var(--panel)", color: "var(--text)", border: "1px solid var(--line2)", width: 44, height: 44 }}>
          <svg {...IC}>
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </a>
      </div>

      <div className="mbar" style={vars}>
        <a href={`tel:${SATA_ROBO_PHONE.tho}`} className="btn btn-line" style={{ flex: 1, padding: "0 10px" }}>
          Gọi ngay
        </a>
        <Link href="/lien-he?free-trial=true" className="btn btn-acc" style={{ flex: 2, padding: "0 10px" }}>
          Đặt học thử miễn phí
        </Link>
      </div>
    </>
  );
}
