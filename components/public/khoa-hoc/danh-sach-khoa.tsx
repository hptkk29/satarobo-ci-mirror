"use client";

import { useState } from "react";
import Link from "next/link";
import { Anh } from "./anh";
import { locThe, lopTabLoc } from "./khoa-hoc-thuan";
import type { TheDanhSach } from "./kieu";
import { st } from "./st";

export type TheHienThi = TheDanhSach & { giaSo: string; giaDonVi: string };

type Props = {
  tabs: readonly (readonly [string, string])[];
  the: TheHienThi[];
};

/** Thẻ lọc + lưới thẻ khoá học của /khoa-hoc. Lọc phía trình duyệt trên dữ liệu server đã dựng. */
export function DanhSachKhoa({ tabs, the }: Props) {
  const [tab, setTab] = useState("all");
  const hien = locThe(the, tab);
  return (
    <>
      <div className="pill-tabs" role="tablist" aria-label="Lọc khoá học">
        {tabs.map(([ma, nhan]) => (
          <button key={ma} type="button" role="tab" aria-selected={tab === ma} className={lopTabLoc(ma, tab)} onClick={() => setTab(ma)}>
            {nhan}
          </button>
        ))}
        <span className="mono" style={st("align-self: center; margin-left: auto; font-size: 12px; color: var(--muted)")}>
          {hien.length} khoá
        </span>
      </div>
      <div className="g4">
        {hien.map((c) => (
          <article key={c.slug} className="course-card">
            <div className="top">
              <Anh h={c.img} alt={`${c.name} – khoá học tại Sata Robo`} loading="lazy" sizes="(max-width: 640px) 90vw, (max-width: 1100px) 45vw, 300px" />
              {c.badge && (
                <span className="badge mono" style={st("background: #fe8f2d; color: #241133; font-size: 11px; padding: 4px 9px; border-radius: 8px")}>
                  {c.badge}
                </span>
              )}
            </div>
            <div style={st("padding: 18px; display: flex; flex-direction: column; gap: 12px; flex-grow: 1")}>
              <span className="tag" style={st("align-self: flex-start")}>
                {c.code}
              </span>
              <h3>
                <Link href={`/khoa-hoc/${c.slug}`} style={st("color: inherit; text-decoration: none")}>
                  {c.name}
                </Link>
              </h3>
              <div className="meta">
                <span>
                  <b>{c.sessions}</b>Thời lượng
                </span>
                <span>
                  <b>{c.dur}</b>Mỗi buổi
                </span>
                <span>
                  <b>{c.grade}</b>Đối tượng
                </span>
              </div>
              <ul>
                {c.b.map((y) => (
                  <li key={y}>{y}</li>
                ))}
              </ul>
              <div style={st("margin-top: auto; padding-top: 14px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 8px")}>
                <span>
                  <strong style={st("font-size: 18px")}>{c.giaSo}</strong>
                  <span style={st("font-size: 13px; color: var(--muted)")}>{c.giaDonVi}</span>
                </span>
                <Link href={`/khoa-hoc/${c.slug}`} style={st("font-size: 14px; font-weight: 700; text-decoration: none; white-space: nowrap")}>
                  Xem chi tiết →
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
