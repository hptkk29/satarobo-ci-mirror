"use client";

import Link from "next/link";
import { useLaHostCongKhai } from "@/components/not-found/host-cong-khai";
import { useSyncExternalStore } from "react";
import { chonDichDen404, DICH_DEN_MAC_DINH } from "@/lib/routing/dich-den-404";

const khongDangKy = () => () => {};
const docHostTrinhDuyet = () => window.location.host;
const docHostServer = () => "";

const ICON = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const CARD = { padding: "18px", gap: "6px", textDecoration: "none", color: "var(--text)" } as const;

/**
 * Các lối thoát của trang 404 (artifact board NotFound): nút "Về trang chủ / Xem khoá học / Đặt học thử"
 * và ba thẻ Tin tức · Liên hệ · Về chúng tôi. Đích của nút đầu theo HOST (admin → Dashboard, giáo viên →
 * /teacher, cổng PH → /portal) — cùng quy tắc `chonDichDen404` như bản cũ; ở host không công khai các
 * liên kết tiếp thị bị ẩn (chúng trỏ vào site public, không có ở host đó).
 */
export function LoiThoat404() {
  const host = useSyncExternalStore(khongDangKy, docHostTrinhDuyet, docHostServer);
  const dest = chonDichDen404(host);
  const laCongKhai = useLaHostCongKhai();

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center", marginTop: "26px" }}>
        <Link href={dest.href} className="btn btn-acc">
          {dest.label}
        </Link>
        {laCongKhai ? (
          <>
            <Link href="/khoa-hoc" className="btn btn-line">
              Xem khoá học
            </Link>
            <Link href="/lien-he?free-trial=true" className="btn btn-line">
              Đặt học thử
            </Link>
          </>
        ) : (
          <Link href={DICH_DEN_MAC_DINH.href} className="btn btn-line">
            {DICH_DEN_MAC_DINH.label}
          </Link>
        )}
      </div>
      {laCongKhai ? (
        <div className="g3" style={{ margin: "44px auto 0", maxWidth: "900px", textAlign: "left" }}>
          <Link href="/tin-tuc" className="card lift" style={CARD}>
            <svg {...ICON}>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />
              <path d="M6.5 17A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20v-5" />
            </svg>
            <b>Tin tức</b>
            <span style={{ color: "var(--muted)", fontSize: "14px" }}>Sự kiện, ưu đãi mới nhất</span>
          </Link>
          <Link href="/lien-he" className="card lift" style={CARD}>
            <svg {...ICON}>
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
            </svg>
            <b>Liên hệ</b>
            <span style={{ color: "var(--muted)", fontSize: "14px" }}>Hotline, Zalo, địa chỉ 2 cơ sở</span>
          </Link>
          <Link href="/ve-chung-toi" className="card lift" style={CARD}>
            <svg {...ICON}>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
            </svg>
            <b>Về chúng tôi</b>
            <span style={{ color: "var(--muted)", fontSize: "14px" }}>Câu chuyện Sata Robo</span>
          </Link>
        </div>
      ) : null}
    </>
  );
}
