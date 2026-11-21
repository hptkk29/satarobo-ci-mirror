"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { GOC_GIA_DINH_NHAN, mucGocDangDung, type MucGoc } from "@/lib/public/goc-gia-dinh";
import { BieuTuongGoc } from "@/components/public/goc-bieu-tuong";

/**
 * Nút «Góc gia đình» trong cụm nút nổi (thay viên thuốc DISC + nút Messenger cũ): một viên thuốc ở ĐẦU ngăn xếp,
 * bấm ra bảng nhỏ mở LÊN TRÊN có các lối vào DISC / Tủ sách / Sức khỏe. Đúng một mục bật ⇒ chỉ một viên thuốc liên kết thẳng
 * (không dựng bảng một dòng). Không mục nào ⇒ component này không được render (cha kiểm).
 *
 * Trạng thái mở do CHA giữ (`FloatingCta`) để bảng và khung chat không mở cùng lúc. Bảng nằm TRONG `.fab` (không portal) nên
 * ăn đúng token chủ đề và dịch lên theo biến `--nang-banner` khi banner cookie đang hiện. CSS: `phan-bo-sung.css` (`.goc-nut*`).
 */
export function NutGocGiaDinh({ goc, mo, setMo }: { goc: readonly MucGoc[]; mo: boolean; setMo: (v: boolean) => void }) {
  const pathname = usePathname();
  const vung = useRef<HTMLDivElement>(null);
  const nut = useRef<HTMLButtonElement>(null);

  useEffect(() => setMo(false), [pathname, setMo]);
  useEffect(() => {
    if (!mo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMo(false);
      nut.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (vung.current && !vung.current.contains(e.target as Node)) setMo(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [mo, setMo]);

  if (goc.length === 1) {
    const m = goc[0]!;
    return (
      <Link href={m.href} className="goc-pill" data-testid="goc-floating" aria-label={m.label}>
        <span className="goc-pill-bt">
          <BieuTuongGoc ma={m.ma} />
        </span>
        {m.label}
      </Link>
    );
  }

  return (
    <div
      className="goc-nut"
      ref={vung}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMo(false);
      }}
    >
      {mo && (
        <div className="goc-nut-panel" id="menu-goc-nut" data-testid="goc-floating-panel">
          {goc.map((m) => {
            const on = mucGocDangDung(pathname, m.href);
            return (
              <Link key={m.ma} href={m.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined} data-testid={`goc-floating-${m.ma}`}>
                <span className="goc-bt">
                  <BieuTuongGoc ma={m.ma} />
                </span>
                {m.label}
              </Link>
            );
          })}
        </div>
      )}
      <button type="button" ref={nut} className="goc-pill" aria-expanded={mo} aria-controls="menu-goc-nut" aria-label={GOC_GIA_DINH_NHAN} data-testid="goc-floating" onClick={() => setMo(!mo)}>
        <span className="goc-pill-bt" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
            <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
            <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
          </svg>
        </span>
        {GOC_GIA_DINH_NHAN}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="goc-pill-mui" style={{ rotate: mo ? "180deg" : "0deg" }}>
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>
    </div>
  );
}
