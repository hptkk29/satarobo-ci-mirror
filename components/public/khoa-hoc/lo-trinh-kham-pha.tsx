"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Anh } from "./anh";
import { NutDangKy } from "./dang-ky-hoc-thu";
import {
  gioiHanChiSo,
  lopNhanBuoi,
  phanTramTienTrinh,
  thongKeHocPhan,
  tongBuoiCuaKhoa,
} from "./khoa-hoc-thuan";
import type { KhoaKhamPha } from "./khoa-hoc-loader";
import { st } from "./st";

type Props = {
  khoa: KhoaKhamPha[];
  /** "danh-sach": đủ hai loại khoá + thẻ chi tiết (trang /khoa-hoc). "trang-khoa": chỉ phần học phần của MỘT khoá. */
  che: "danh-sach" | "trang-khoa";
};

const KENH = [
  { ma: "thi", nhan: "Khoá luyện thi", phu: "RoboSim · Beta · Combo · Vé vàng" },
  { ma: "nam", nhan: "Khoá chuyên sâu 48 buổi", phu: "Lộ trình 5 năm Sata3 → Sata7" },
] as const;

const GIAY_DOI_ANH = 3500;

/**
 * Bộ khám phá lộ trình: chọn loại khoá → chọn khoá → xem thẻ chi tiết → duyệt từng học phần và từng
 * buổi. Toàn bộ số liệu (tên bài, học phí, ảnh) do server truyền xuống — component không tự bịa.
 */
export function LoTrinhKhamPha({ khoa, che }: Props) {
  const kenhMacDinh = che === "danh-sach" ? "nam" : khoa[0]?.theoNam ? "nam" : "thi";
  const [kenh, setKenh] = useState<"nam" | "thi">(kenhMacDinh);
  const [slugChon, setSlugChon] = useState<string | null>(null);
  const [hp, setHp] = useState(0);
  const [anh, setAnh] = useState(0);
  const dangDe = useRef(false);

  const danhSach = che === "danh-sach" ? khoa.filter((k) => k.theoNam === (kenh === "nam")) : khoa;
  const k = danhSach.find((x) => x.slug === slugChon) ?? danhSach[0];

  // Ảnh dự án tự chuyển mỗi 3,5s ở trang danh sách; dừng khi rê chuột lên ảnh.
  const soAnh = k?.thuVien.length ?? 0;
  useEffect(() => {
    if (che !== "danh-sach" || soAnh < 2) return;
    const t = window.setInterval(() => {
      if (!dangDe.current) setAnh((a) => a + 1);
    }, GIAY_DOI_ANH);
    return () => window.clearInterval(t);
  }, [che, soAnh]);

  if (!k) return null;

  const nHp = k.hocPhan.length;
  const hpHienTai = gioiHanChiSo(hp, nHp);
  const P = k.hocPhan[hpHienTai];
  const tk = thongKeHocPhan(P?.baiHoc ?? [], k.theoNam);
  const tong = tongBuoiCuaKhoa(k.hocPhan);
  const gi = soAnh > 0 ? anh % soAnh : 0;
  const ci = Math.max(0, danhSach.findIndex((x) => x.slug === k.slug));

  const doiKenh = (m: "nam" | "thi") => {
    setKenh(m);
    setSlugChon(null);
    setHp(0);
    setAnh(0);
  };
  const doiKhoa = (s: string) => {
    setSlugChon(s);
    setHp(0);
    setAnh(0);
  };

  return (
    <>
      {che === "danh-sach" && (
        <>
          <div className="ex-tracks" role="tablist" aria-label="Loại khoá">
            {KENH.map((t) => (
              <button
                key={t.ma}
                type="button"
                role="tab"
                aria-selected={kenh === t.ma}
                className={kenh === t.ma ? "ex-track on" : "ex-track"}
                onClick={() => doiKenh(t.ma)}
              >
                <b>{t.nhan}</b>
                <small>{t.phu}</small>
              </button>
            ))}
          </div>
          <div className="ex-courses" role="tablist" aria-label="Khoá học">
            {danhSach.map((x) => (
              <button
                key={x.slug}
                type="button"
                role="tab"
                aria-selected={x.slug === k.slug}
                className={x.slug === k.slug ? "ex-ctab on" : "ex-ctab"}
                style={st(`--c: ${x.mau}`)}
                onClick={() => doiKhoa(x.slug)}
              >
                <Anh h={x.anhBo} aria-hidden="true" sizes="44px" />
                <span>
                  <small>{x.ma}</small>
                  <b>{x.ten}</b>
                  <em>{x.lop}</em>
                </span>
              </button>
            ))}
          </div>
          <div className={`ex-card k${ci % 2}`} style={st(`--c: ${k.mau}`)}>
            <div className="ex-main">
              <div className="ex-id">
                <span className="ex-ico">
                  <Anh h={k.anhBo} aria-hidden="true" sizes="44px" />
                </span>
                <span className="ex-code">{k.ma}</span>
                <span style={st("color: var(--muted); font-size: 14px")}>{k.lop}</span>
              </div>
              <h3>{k.ten}</h3>
              <span className="ex-meta">
                {tong} buổi · 90 phút/buổi · {String(tong * 1.5).replace(".", ",")} giờ
              </span>
              <p>{k.moTa}</p>
              <div className="ex-boxes">
                <div className="ex-box">
                  <small>Thiết bị học cụ</small>
                  <p>{k.thietBi}</p>
                </div>
                <div className="ex-box alt">
                  <small>Sứ mệnh khoá học</small>
                  <p>{k.suMenh}</p>
                </div>
              </div>
              <p className="ex-sk-h">Kỹ năng con đạt được</p>
              <div className="ex-skills">
                {k.kyNang.map((s) => (
                  <span key={s} className="ex-sk">
                    {s}
                  </span>
                ))}
              </div>
              <div className="ex-cta">
                <Link href={`/khoa-hoc/${k.slug}`} className="btn btn-acc">
                  Xem chi tiết khoá học →
                </Link>
                <NutDangKy className="btn btn-line">Học thử 1-1 miễn phí</NutDangKy>
              </div>
            </div>
            <aside className="ex-side">
              {k.gia && (
                <div className="ex-price">
                  <small>Học phí khoá học</small>
                  <div>
                    <b>{k.gia}</b>
                    <span>{k.donVi}</span>
                  </div>
                  <p>{k.ghiChu}</p>
                </div>
              )}
              <div className="ex-inst">
                <b>{k.uuDaiTieuDe}</b>
                <span>{k.uuDai}</span>
              </div>
              <div className="ex-gal">
                <div className="ex-gh">
                  <b>Dự án tiêu biểu</b>
                  <small>{k.thuVien.length} ảnh từ lớp học</small>
                </div>
                <div
                  className={`ex-photo k${gi % 2}`}
                  onMouseEnter={() => {
                    dangDe.current = true;
                  }}
                  onMouseLeave={() => {
                    dangDe.current = false;
                  }}
                >
                  <Anh h={k.thuVien[gi]} alt={`Dự án tiêu biểu khoá ${k.ma}`} sizes="(max-width: 860px) 90vw, 380px" />
                  <span>
                    Ảnh {gi + 1}/{k.thuVien.length} · lớp {k.ma}
                  </span>
                  <i className="ex-dots">
                    {k.thuVien.map((g, i) => (
                      <b key={g} className={i === gi ? "ex-dot on" : "ex-dot"} />
                    ))}
                  </i>
                  <i className="ex-bar" />
                </div>
                <div className="ex-thumbs">
                  {k.thuVien.map((g, i) => (
                    <button key={g} type="button" className={i === gi ? "ex-th on" : "ex-th"} onClick={() => setAnh(i)} aria-label="Xem ảnh">
                      <Anh h={g} sizes="64px" />
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </>
      )}

      {P && (
        <>
          <div
            className="ex-steps"
            role="tablist"
            aria-label="Học phần"
            style={che === "trang-khoa" ? st("margin-top: 0") : undefined}
          >
            <span className="ex-line" aria-hidden="true">
              <b style={{ width: `${phanTramTienTrinh(hpHienTai, nHp)}%` }} />
            </span>
            {k.hocPhan.map((p, i) => (
              <button
                key={p.ma + i}
                type="button"
                role="tab"
                aria-selected={i === hpHienTai}
                className={i < hpHienTai ? "ex-step done" : i === hpHienTai ? "ex-step on" : "ex-step"}
                // Tailwind preflight xoá đệm mặc định của <button>; artifact để nguyên đệm của trình duyệt (1px 6px).
                style={{ padding: "1px 6px" }}
                onClick={() => setHp(i)}
              >
                <i>
                  <span>{i + 1}</span>
                </i>
                <small>
                  <span>{p.ma}</span>
                </small>
              </button>
            ))}
          </div>
          <div className="ex-cur">
            <div className="ex-list">
              {k.hocPhan.map((p, i) => (
                <button key={p.ma + i} type="button" className={i === hpHienTai ? "ex-hp on" : "ex-hp"} onClick={() => setHp(i)}>
                  <span className="row">
                    <span className="ex-chip">{p.ma}</span>
                    <small>{p.baiHoc.length} buổi · 90 phút/buổi</small>
                  </span>
                  <b>{p.tieuDe}</b>
                  <span>{p.tomTat}</span>
                </button>
              ))}
            </div>
            <div className={`ex-detail k${hpHienTai % 2}`}>
              <div className="ex-chips">
                <span className="ex-chip on">{P.ma}</span>
                <span className="ex-chip alt">
                  {k.ma} · {k.lop}
                </span>
              </div>
              <h3>{P.tieuDe}</h3>
              <p>{P.tomTat}</p>
              <div className="ex-stats">
                <div>
                  <b>{tk.soBuoi}</b>
                  <small>Buổi học</small>
                </div>
                <div>
                  <b>{tk.gio}</b>
                  <small>Giờ học</small>
                </div>
                <div>
                  <b>{tk.soDuAn}</b>
                  <small>{tk.nhanDuAn}</small>
                </div>
              </div>
              <p className="ex-sk-h">{tk.tieuDeBai}</p>
              <ol className="ex-sess">
                {P.baiHoc.map((b, i) => (
                  <li key={`${i}-${b.ten}`} className={i % 2 ? "ex-row" : "ex-row odd"} style={{ animationDelay: `${(i * 0.03).toFixed(2)}s` }}>
                    <i>{i + 1}</i>
                    <span className="ex-sn">{b.ten}</span>
                    <em className={lopNhanBuoi(b.loai)}>{b.loai}</em>
                  </li>
                ))}
              </ol>
              <div className="ex-out">
                <span aria-hidden="true">🏆</span>
                <div>
                  <b>{tk.tieuDeKetQua}</b>
                  <p>{P.ketQua}</p>
                </div>
              </div>
              <div className="ex-nav">
                <button type="button" className={hpHienTai > 0 ? "btn btn-line ex-nb" : "btn btn-line ex-nb off"} onClick={() => hpHienTai > 0 && setHp(hpHienTai - 1)}>
                  ‹ Trước
                </button>
                <small>
                  {hpHienTai + 1} / {nHp}
                </small>
                <button type="button" className={hpHienTai < nHp - 1 ? "btn btn-acc ex-nb" : "btn btn-acc ex-nb off"} onClick={() => hpHienTai < nHp - 1 && setHp(hpHienTai + 1)}>
                  Tiếp theo ›
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
