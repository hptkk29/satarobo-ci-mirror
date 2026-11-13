"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { canonicalPhone, isValidPhoneVN } from "@/lib/phone";
import { readAttribution } from "@/lib/marketing/attribution";
import { SATA_ROBO_LOCATIONS } from "@/lib/locations";
import { Anh } from "./anh";
import { st } from "./st";

/**
 * Cửa "Đặt buổi học thử 1-1" của các trang khoá học: nút bấm mở hộp đăng ký (đúng bản thiết kế:
 * `.modal` + `.fld` + `.inp`) rồi gửi THẲNG vào `/api/leads` — cùng đường với /lien-he và modal tư
 * vấn cũ, kèm khoá quan tâm (`source` = slug khoá) để Sale biết khách xem khoá nào.
 *
 * Một hộp cho cả trang: `<DangKyHocThuProvider>` bọc nội dung, mọi `<NutDangKy>` gọi `mo()`.
 */
type Ngu = { mo: () => void };
const NguCanh = createContext<Ngu | null>(null);

export function useDangKyHocThu(): Ngu {
  const c = useContext(NguCanh);
  if (!c) throw new Error("useDangKyHocThu phải nằm trong <DangKyHocThuProvider>");
  return c;
}

type Props = {
  /** Slug khoá đang xem — vào `Lead.source` và ghi chú. null = trang danh sách (không gắn khoá). */
  khoaSlug: string | null;
  khoaTen: string;
  children: ReactNode;
};

const CS = SATA_ROBO_LOCATIONS.map((l) => ({
  ma: l.code,
  nhan: `${l.name.replace(/ - .*/, "")} - ${l.address}`,
}));

const ICON = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export function DangKyHocThuProvider({ khoaSlug, khoaTen, children }: Props) {
  const [mo, setMo] = useState(false);
  const [xong, setXong] = useState(false);
  const [dangGui, setDangGui] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [form, setForm] = useState<{ con: string; phuHuynh: string; sdt: string; cs: string; dongY: boolean; bay: string }>({ con: "", phuHuynh: "", sdt: "", cs: CS[0]?.ma ?? "", dongY: false, bay: "" });
  const tuLucMo = useRef(0);

  const dong = useCallback(() => {
    setMo(false);
  }, []);
  const ngu = useMemo<Ngu>(
    () => ({
      mo: () => {
        tuLucMo.current = Date.now();
        setXong(false);
        setLoi(null);
        setMo(true);
      },
    }),
    [],
  );

  useEffect(() => {
    if (!mo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dangGui) setMo(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mo, dangGui]);

  async function gui(e: FormEvent) {
    e.preventDefault();
    if (dangGui) return;
    if (form.phuHuynh.trim().length < 2) return setLoi("Vui lòng nhập họ tên ba/mẹ.");
    if (!isValidPhoneVN(form.sdt)) return setLoi("Số điện thoại không hợp lệ (VD: 0912345678).");
    if (!form.dongY) return setLoi("Vui lòng đọc và đồng ý với Chính sách bảo mật.");
    setLoi(null);
    setDangGui(true);
    const slug = khoaSlug ?? "lien-he";
    const eventId = `hoc-thu-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const note = [
      `[ĐĂNG KÝ HỌC THỬ TỪ TRANG ${khoaSlug ? `/khoa-hoc/${khoaSlug}` : "/khoa-hoc"}]`,
      khoaSlug ? `Khóa quan tâm: ${khoaTen}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentName: form.phuHuynh.trim(),
          childName: form.con.trim() || undefined,
          phone: canonicalPhone(form.sdt) ?? form.sdt.trim(),
          centerCode: form.cs || undefined,
          source: slug,
          note,
          consentMarketing: true,
          dongYChinhSachBaoMat: true,
          eventId,
          landingPage: window.location.href,
          referrer: document.referrer,
          ...readAttribution(),
          timeOnPage: Math.floor((Date.now() - tuLucMo.current) / 1000),
          website: form.bay,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Lỗi hệ thống");
      if (typeof window.fbq === "function") {
        window.fbq("track", "Lead", { content_name: khoaTen, content_category: slug, value: 0, currency: "VND" }, { eventID: eventId });
      }
      if (typeof window.gtag === "function") {
        window.gtag("event", "generate_lead", { source: "dang-ky-hoc-thu", course_slug: slug, course_name: khoaTen });
      }
      setXong(true);
      setForm({ con: "", phuHuynh: "", sdt: "", cs: CS[0]?.ma ?? "", dongY: false, bay: "" });
    } catch (err) {
      setLoi(err instanceof Error ? err.message : "Gửi chưa được, ba mẹ thử lại giúp Sata Robo nhé.");
    } finally {
      setDangGui(false);
    }
  }

  return (
    <NguCanh.Provider value={ngu}>
      {children}
      {mo && (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget && !dangGui) dong();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="popup-title"
        >
          <div className="modal-card">
            <button type="button" className="modal-x" onClick={dong} aria-label="Đóng">
              ×
            </button>
            {!xong ? (
              <form onSubmit={gui} noValidate>
                <div style={st("display: flex; align-items: flex-end; gap: 14px; margin: -6px 40px 16px 0")}>
                  <Anh h="9ae4558c2081175d5a405b660b794651" aria-hidden="true" className="bob" sizes="92px" style={st("width: 92px; height: auto; flex-shrink: 0; filter: drop-shadow(0 10px 14px rgba(0,0,0,.3))")} />
                  <div>
                    <span style={st("display: inline-block; padding: 4px 12px; border-radius: 999px; background: rgba(254,143,45,.14); border: 1px solid rgba(254,143,45,.5); color: var(--accT); font-weight: 700; font-size: 12px")}>Miễn phí · 0 đồng</span>
                    <p id="popup-title" style={st("margin: 8px 0 0; font-family: 'Unbounded', sans-serif; font-weight: 600; font-size: clamp(19px,2.4vw,23px); line-height: 1.3")}>
                      Cho con <span className="grad">học thử 1-1</span> với robot thật
                    </p>
                  </div>
                </div>
                <p style={st("margin: 0 0 16px; color: var(--muted); font-size: 14px")}>Để lại số điện thoại, Sata Robo gọi lại trong 30 phút (8h – 21h, Thứ 3 – Chủ nhật).</p>
                <div style={st("display: flex; flex-direction: column; gap: 14px")}>
                  <div className="fld">
                    <label htmlFor="p-con">
                      <svg {...ICON}>
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      Họ và tên con
                    </label>
                    <input id="p-con" className="inp" type="text" autoComplete="off" placeholder="VD: Nguyễn Minh Khoa" value={form.con} onChange={(e) => setForm({ ...form, con: e.target.value })} />
                  </div>
                  <div className="fld">
                    <label htmlFor="p-ph">
                      <svg {...ICON}>
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
                      </svg>
                      Họ và tên ba/mẹ <span className="req">*</span>
                    </label>
                    <input id="p-ph" className="inp" type="text" required autoComplete="name" placeholder="VD: Trần Thu Hà" value={form.phuHuynh} onChange={(e) => setForm({ ...form, phuHuynh: e.target.value })} />
                  </div>
                  <div className="fld">
                    <label htmlFor="p-sdt">
                      <svg {...ICON}>
                        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
                      </svg>
                      ĐT di động phụ huynh <span className="req">*</span>
                    </label>
                    <input id="p-sdt" className="inp" type="tel" required autoComplete="tel" inputMode="tel" placeholder="VD: 09xx xxx xxx" value={form.sdt} onChange={(e) => setForm({ ...form, sdt: e.target.value })} />
                  </div>
                  <div className="fld">
                    <label htmlFor="p-cs">
                      <svg {...ICON}>
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      Chọn cơ sở học <span className="req">*</span>
                    </label>
                    <select id="p-cs" className="inp" required value={form.cs} onChange={(e) => setForm({ ...form, cs: e.target.value })}>
                      {CS.map((c) => (
                        <option key={c.ma} value={c.ma}>
                          {c.nhan}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Bẫy bot: người thật không thấy, không tab tới. */}
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.bay} onChange={(e) => setForm({ ...form, bay: e.target.value })} style={st("position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0")} />
                  <label htmlFor="p-ok" style={st("display: flex; gap: 10px; align-items: flex-start; font-size: 13px; cursor: pointer")}>
                    <input id="p-ok" type="checkbox" required checked={form.dongY} onChange={(e) => setForm({ ...form, dongY: e.target.checked })} style={st("width: 18px; height: 18px; margin: 1px 0 0; accent-color: #f97316; flex-shrink: 0")} />
                    <span>
                      Tôi đã đọc và đồng ý với <Link href="/chinh-sach-bao-mat">Chính sách bảo mật</Link>
                    </span>
                  </label>
                  {loi && (
                    <p role="alert" style={st("margin: 0; font-size: 13px; font-weight: 700; color: #ff6b5a")}>
                      {loi}
                    </p>
                  )}
                  <button type="submit" disabled={dangGui} className="btn btn-acc" style={st("width: 100%; min-height: 54px; font-size: 15px; box-shadow: 0 14px 30px rgba(249,115,22,.35)")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                    </svg>
                    {dangGui ? "ĐANG GỬI…" : "ĐẶT BUỔI HỌC THỬ 1-1 MIỄN PHÍ"}
                  </button>
                  <button type="button" onClick={dong} style={st("background: none; border: 0; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; text-decoration: underline")}>
                    Để sau
                  </button>
                </div>
              </form>
            ) : (
              <div style={st("text-align: center; padding: 12px 8px 4px")}>
                <Anh h="da7446f042256bc74bcdfe2e701329c9" aria-hidden="true" className="bob" sizes="140px" style={st("width: 140px; height: auto")} />
                <p style={st("margin: 10px 0 6px; font-family: 'Unbounded', sans-serif; font-weight: 600; font-size: 22px")}>Cảm ơn ba mẹ!</p>
                <p style={st("margin: 0 0 18px; color: var(--muted)")}>Sata Robo sẽ gọi lại trong 30 phút (trong giờ 8h – 21h, Thứ 3 – Chủ nhật).</p>
                <button type="button" onClick={dong} className="btn btn-line">
                  Đóng
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </NguCanh.Provider>
  );
}

type NutProps = { className?: string; style?: React.CSSProperties; children: ReactNode };

/** Nút/liên kết mở hộp đăng ký học thử (giữ `href="#dang-ky"` để vẫn bấm được khi chưa nạp JS). */
export function NutDangKy({ className, style, children }: NutProps) {
  const { mo } = useDangKyHocThu();
  return (
    <a
      href="#dang-ky"
      className={className}
      style={style}
      onClick={(e) => {
        e.preventDefault();
        mo();
      }}
    >
      {children}
    </a>
  );
}
