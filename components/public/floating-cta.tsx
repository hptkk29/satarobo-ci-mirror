"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { laTrangRiengTu } from "@/lib/public/trang-rieng-tu";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { mucGocGiaDinh } from "@/lib/public/goc-gia-dinh";
import type { CoCongThongTin } from "@/lib/cong-thong-tin/nav";
import { NutGocGiaDinh } from "@/components/public/nut-goc-gia-dinh";
import { ChatbotWidget, type DuLieuChatbot } from "@/components/public/chatbot/chatbot-widget";

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
const KHOA_PHIEN_CHATBOT = "satarobo-chatbot-bat";

/**
 * Chatbot có đang chạy không (bật + có API key) — hỏi `GET /api/public/chatbot` MỘT lần mỗi phiên.
 * Hỏi ở trình duyệt chứ không ở layout: trang tĩnh dựng lúc build (không DB) sẽ đóng băng "tắt" sau mỗi lần deploy.
 * Chưa có câu trả lời / lỗi ⇒ `false` ⇒ nhân vật mở Zalo như trước (không bao giờ mở khung chat chắc chắn lỗi).
 */
function useChatbotBat(): boolean {
  const [bat, setBat] = useState(false);
  useEffect(() => {
    try {
      const nho = window.sessionStorage.getItem(KHOA_PHIEN_CHATBOT);
      if (nho !== null) return setBat(nho === "1");
    } catch {
      /* sessionStorage bị chặn ⇒ hỏi máy chủ */
    }
    let huy = false;
    fetch("/api/public/chatbot")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { bat?: boolean } | null) => {
        if (huy) return;
        const b = j?.bat === true;
        setBat(b);
        try {
          window.sessionStorage.setItem(KHOA_PHIEN_CHATBOT, b ? "1" : "0");
        } catch {
          /* bỏ qua */
        }
      })
      .catch(() => undefined);
    return () => {
      huy = true;
    };
  }, []);
  return bat;
}

/**
 * `chatbot`: dữ liệu TĨNH của khung chat AI (cơ sở + danh sách khoá — `duLieuChatbot()`). BẮT BUỘC truyền (luật 11:
 * prop tuỳ chọn mà layout quên truyền là tính năng chết câm). Bật/tắt thật hỏi qua `useChatbotBat()`.
 */
export function FloatingCta({ discEnabled, congThongTin, chatbot: duChatbot }: { discEnabled: boolean; congThongTin: CoCongThongTin; chatbot: DuLieuChatbot }) {
  const pathname = usePathname();
  const nang = useChieuCaoBannerCookie();
  const [moChat, setMoChat] = useState(false);
  const [moGoc, setMoGoc] = useState(false);
  const chatbot = useChatbotBat() ? duChatbot : null;
  const goc = mucGocGiaDinh(discEnabled, congThongTin);
  // Bảng «Góc gia đình» và khung chat không mở cùng lúc: mở cái nào thì cái kia đóng.
  useEffect(() => {
    if (moChat) setMoGoc(false);
  }, [moChat]);
  useEffect(() => {
    if (moGoc) setMoChat(false);
  }, [moGoc]);
  if (pathname && (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p)) || laTrangRiengTu(pathname))) return null;
  const vars = { "--nang-banner": `${nang}px` } as React.CSSProperties;

  return (
    <>
      <div className="fab" style={vars}>
        {/* «Góc gia đình» (DISC · Tủ sách · Sức khỏe) nằm TRÊN CÙNG ngăn xếp: không đè Zalo/học thử. Một nút cho cả máy tính lẫn điện thoại (10/11/2026; trước đó là hai viên thuốc DISC riêng) — lưới [GOC-WIRE-*]. Không mục nào bật ⇒ không vẽ gì. */}
        {goc.length > 0 && <NutGocGiaDinh goc={goc} mo={moGoc} setMo={setMoGoc} />}
        {/* Điện thoại: nhân vật (.hi) bị ẩn dưới 861px ⇒ nút tròn riêng, chỉ hiện dưới 861px (phan-bo-sung.css). */}
        {chatbot && (
          <button type="button" onClick={() => setMoChat((v) => !v)} className="chatbot-nut-sm" aria-label="Hỏi Sata Robo" aria-expanded={moChat} data-testid="chatbot-mo-mobile" style={{ width: 52, height: 52, borderRadius: 999, border: 0, alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#7c3aed,#fe8f2d)", color: "#fff", boxShadow: "0 10px 24px rgba(0,0,0,.28)", cursor: "pointer", fontSize: 22 }}>
            💬
          </button>
        )}
        {chatbot ? (
          <button type="button" onClick={() => setMoChat((v) => !v)} className="hi" aria-label="Hỏi Sata Robo" aria-expanded={moChat} data-testid="chatbot-mo" style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer" }}>
            <NhanVatHoi />
          </button>
        ) : (
          <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener noreferrer" className="hi" aria-label="Hỏi Sata Robo qua Zalo" style={{ background: "transparent", textDecoration: "none" }}>
            <NhanVatHoi />
          </a>
        )}
        <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener noreferrer" aria-label="Chat Zalo Sata Robo" style={{ background: "#0068ff", color: "#fff" }}>
          <svg {...IC}>
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.6-.8L3 21l1.9-5.1A8.4 8.4 0 1 1 21 11.5z" />
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

      {chatbot && (
        <>
          <div style={vars}>
            <ChatbotWidget du={chatbot} mo={moChat} onDong={() => setMoChat(false)} />
          </div>
        </>
      )}

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

/** Bong bóng "Hỏi Sata Robo nhé!" + nhân vật robot — dùng chung cho hai chế độ (mở Zalo / mở chatbot). */
function NhanVatHoi() {
  return (
    <>
      <span style={{ background: "var(--panel)", color: "var(--text)", border: "1px solid var(--line2)", borderRadius: "14px 14px 4px 14px", padding: "8px 12px", fontSize: 13, fontWeight: 700, boxShadow: "0 10px 24px var(--shadow)", marginBottom: 40 }}>
        Hỏi Sata Robo nhé!
      </span>
      <Image className="bob" src="/pub/d578e8d03331ab7e220e21254d352bfe.webp" alt="" aria-hidden="true" width={597} height={710} style={{ width: 76, height: "auto", filter: "drop-shadow(0 10px 14px rgba(0,0,0,.35))" }} />
    </>
  );
}
