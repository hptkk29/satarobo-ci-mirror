"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { mucGocDangDung, type MucGoc } from "@/lib/public/goc-gia-dinh";
import { BieuTuongGoc } from "@/components/public/goc-bieu-tuong";

/**
 * Mục «Góc gia đình» trên thanh trên (≥1181px): một nút, bấm ra bảng nhỏ có các lối vào DISC / Tủ sách / Sức khỏe.
 * Thay ba mục riêng làm hàng menu bị cắt ở 1181–1360px.
 *
 * - KHÔNG dùng portal / Radix: bảng là `position: absolute` BÊN TRONG thanh trên (cùng lý do với `.mnav` của menu điện thoại —
 *   portal ra <body> sẽ mất token chủ đề `.page`). CSS ở `components/public/pub-design/phan-bo-sung.css` (`.nav-goc*`).
 * - Mở bằng bấm / bàn phím (không chỉ rê chuột); Esc, bấm ra ngoài, rời tiêu điểm hoặc đổi trang ⇒ đóng.
 * - SSR + lần render đầu không đánh dấu «đang đứng» (HTML khớp lúc hydrate — trang chủ là ISR).
 */
export function NhomGocGiaDinh({ nhan, nhom }: { nhan: string; nhom: readonly MucGoc[] }) {
  const pathname = usePathname();
  const [mo, setMo] = useState(false);
  const [mounted, setMounted] = useState(false);
  const goc = useRef<HTMLSpanElement>(null);
  const nut = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => setMo(false), [pathname]);
  useEffect(() => {
    if (!mo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMo(false);
      nut.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (goc.current && !goc.current.contains(e.target as Node)) setMo(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [mo]);

  const dangO = mounted && nhom.some((m) => mucGocDangDung(pathname, m.href));

  return (
    <span
      className="nav-goc"
      ref={goc}
      onBlur={(e) => {
        // Tab ra khỏi cả nút lẫn bảng ⇒ đóng (người dùng bàn phím không bị bảng treo lại).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMo(false);
      }}
    >
      <button
        type="button"
        ref={nut}
        className={dangO ? "nav-goc-btn on" : "nav-goc-btn"}
        aria-expanded={mo}
        aria-controls="menu-goc"
        data-testid="goc-header"
        onClick={() => setMo((v) => !v)}
      >
        {nhan}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="nav-goc-mui">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {mo && (
        <div className="nav-goc-panel" id="menu-goc" data-testid="goc-header-panel">
          {nhom.map((m) => {
            const on = mounted && mucGocDangDung(pathname, m.href);
            return (
              <Link key={m.ma} href={m.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined} data-testid={`goc-header-${m.ma}`}>
                <span className="goc-bt">
                  <BieuTuongGoc ma={m.ma} />
                </span>
                {m.label}
              </Link>
            );
          })}
        </div>
      )}
    </span>
  );
}
