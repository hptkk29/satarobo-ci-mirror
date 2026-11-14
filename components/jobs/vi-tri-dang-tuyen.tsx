"use client";

import { useState } from "react";
import Link from "next/link";
import { TrangThaiRong } from "@/components/blog/trang-thai-rong";
import {
  locViTri,
  tabLocTuDuLieu,
  type BieuTuong,
  type TabLoc,
  type ViTriItem,
} from "@/components/jobs/viec-lam-thuan";

const THUOC_TINH_SVG = {
  width: 26,
  height: 26,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function BieuTuongVT({ loai }: { loai: BieuTuong }) {
  switch (loai) {
    case "sach":
      return (
        <svg {...THUOC_TINH_SVG}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />
          <path d="M6.5 17A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20v-5" />
        </svg>
      );
    case "nguoi":
      return (
        <svg {...THUOC_TINH_SVG}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
        </svg>
      );
    case "chat":
      return (
        <svg {...THUOC_TINH_SVG}>
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
        </svg>
      );
    default:
      return (
        <svg {...THUOC_TINH_SVG}>
          <path d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 16.5 5.8 21l2.4-7.3L2 9.2h7.6z" />
        </svg>
      );
  }
}

function NhomTab({
  ten,
  tabs,
  chon,
  onChon,
}: {
  ten: string;
  tabs: TabLoc[];
  chon: string | null;
  onChon: (key: string | null) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="pill-tabs" role="tablist" aria-label={ten} style={{ margin: 0 }}>
      <button type="button" role="tab" aria-selected={chon === null} className={chon === null ? "pill on" : "pill"} onClick={() => onChon(null)}>
        Tất cả
      </button>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={chon === t.key} className={t.key === chon ? "pill on" : "pill"} onClick={() => onChon(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Danh sách vị trí đang tuyển + hai nhóm tab lọc (hình thức, địa điểm). Tab dựng từ giá trị CÓ THẬT
 * trong các tin đang mở — hình thức/địa điểm do nhân sự nhập tự do. Ít hơn 2 giá trị khác nhau thì
 * không vẽ nhóm tab đó. Không hoạt ảnh (luật trang tuyển dụng).
 */
export function ViTriDangTuyen({ items, email }: { items: ViTriItem[]; email: string }) {
  const tabHinhThuc = tabLocTuDuLieu(items.map((i) => i.hinhThuc));
  const tabDiaDiem = tabLocTuDuLieu(items.map((i) => i.diaDiem));
  const [hinhThuc, setHinhThuc] = useState<string | null>(null);
  const [diaDiem, setDiaDiem] = useState<string | null>(null);

  const hien = locViTri(items, hinhThuc, diaDiem);
  const coLoc = tabHinhThuc.length > 0 || tabDiaDiem.length > 0;

  return (
    <>
      {coLoc && (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, marginBottom: 22 }}>
          <NhomTab ten="Hình thức làm việc" tabs={tabHinhThuc} chon={hinhThuc} onChon={setHinhThuc} />
          <NhomTab ten="Địa điểm làm việc" tabs={tabDiaDiem} chon={diaDiem} onChon={setDiaDiem} />
        </div>
      )}

      {hien.length > 0 ? (
        <div style={{ display: "grid", gap: 14 }}>
          {hien.map((j) => (
            <Link key={j.slug} href={`/tuyen-dung/${j.slug}`} className="job" style={{ color: "var(--accT)" }}>
              <span className="jico" aria-hidden="true">
                <BieuTuongVT loai={j.bieuTuong} />
              </span>
              <span>
                <h3>{j.title}</h3>
                <span className="meta">
                  {j.boPhan && <span className="tag">{j.boPhan}</span>}
                  {j.hinhThuc && (
                    <span className="chip" style={{ padding: "4px 10px", fontSize: 13 }}>
                      {j.hinhThuc}
                    </span>
                  )}
                  {j.diaDiem && (
                    <span className="chip" style={{ padding: "4px 10px", fontSize: 13 }}>
                      {j.diaDiem}
                    </span>
                  )}
                  {j.luong && (
                    <span className="chip" style={{ padding: "4px 10px", fontSize: 13 }}>
                      {j.luong}
                    </span>
                  )}
                </span>
                {j.tomTat && <span style={{ display: "block", marginTop: 8, color: "var(--muted)", fontSize: 14 }}>{j.tomTat}</span>}
              </span>
              <span className="go">
                <b>Xem chi tiết →</b>
                {j.hanNop && <small>Hạn nộp {j.hanNop}</small>}
              </span>
            </Link>
          ))}
        </div>
      ) : items.length === 0 ? (
        <TrangThaiRong card tieuDe="Hiện chưa có vị trí đang mở">
          Bạn vẫn có thể gửi CV chủ động về <a href={`mailto:${email}`} style={{ fontWeight: 700 }}>{email}</a> – Sata Robo lưu hồ sơ và liên hệ khi có vị trí phù hợp.
        </TrangThaiRong>
      ) : (
        <TrangThaiRong card tieuDe="Chưa có vị trí phù hợp bộ lọc">
          Bạn vẫn có thể gửi CV chủ động về <a href={`mailto:${email}`} style={{ fontWeight: 700 }}>{email}</a> – Sata Robo lưu hồ sơ và liên hệ khi có vị trí phù hợp.
        </TrangThaiRong>
      )}
    </>
  );
}
