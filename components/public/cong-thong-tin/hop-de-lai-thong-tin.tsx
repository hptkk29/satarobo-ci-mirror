"use client";
/**
 * HỘP «ĐỂ LẠI THÔNG TIN» dùng chung của Tủ sách + Sức khỏe (07/11/2026).
 *
 * Giao diện chép từ artifact «Sata Robo — Website mới» (khối lead-gate trong `TuSach.dc.html`/`SucKhoe.dc.html`), CSS ở `pub-design/cong-thong-tin.css`.
 * Hành vi theo đúng thiết kế: «Miễn phí · một lần cho cả trang» — đã để lại thông tin thì mọi nơi cần mở khoá chạy ngay; chưa thì mở hộp, gửi xong mới chạy.
 *
 * Phiếu CHỈ gồm thông tin liên hệ (xem `lib/cong-thong-tin/phieu.ts`): họ tên · SĐT · tỉnh/thành · phường/xã (bắt buộc) · số nhà (tuỳ chọn) · hai ô đồng ý.
 * Không có đường nào để câu trả lời/kết quả sức khỏe đi qua hộp này.
 *
 * Trạng thái «đã mở khoá» thật nằm ở cookie httpOnly do máy chủ đặt (`sr_ctt`); `daMoKhoaBanDau` do trang (server) đọc cookie rồi truyền xuống. Cờ ở trình duyệt
 * chỉ để giao diện biết nên mở hộp hay chạy ngay — các đường cần mở khoá vẫn được máy chủ kiểm lại.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type NguonHop = "tu-sach" | "suc-khoe";
export type CauHinhHop = { tieuDe: string; moTa: string; nut: string; okMoTa: string; okNut: string };

type DanhMuc = { thanhPho: string[]; macDinh: string; phuong: string[] };
type TruongLoi = "hoTen" | "soDienThoai" | "thanhPho" | "phuong" | "soNha" | "dongY" | "khac";

type CongThongTin = {
  /** Đã để lại thông tin (hoặc đã có thẻ từ trước). */
  daMo: boolean;
  /** Đã mở khoá ⇒ chạy `viec` ngay; chưa ⇒ mở hộp, gửi xong mới chạy. `nguCanh` (vd `ebook:12`) chỉ để ghi chú lead. */
  yeuCau: (viec: () => void, nguCanh?: string) => void;
  /** Mở lại hộp để SỬA thông tin đã để lại (không gửi lại ⇒ không chạy việc nào). */
  suaThongTin: () => void;
};

const Ctx = createContext<CongThongTin | null>(null);

export function useCongThongTin(): CongThongTin {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCongThongTin phải nằm trong <CongThongTinProvider>");
  return c;
}

const khoa = (s: string) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const boTienTo = (s: string) => s.replace(/^(phuong|xa|dac khu|thi tran)\s+/, "");

const TINH_MAC_DINH = "Tp Đà Nẵng";
const RIENG_TU =
  "Phiếu chỉ gồm thông tin liên hệ ở trên — không kèm câu trả lời hay kết quả. Thông tin được xử lý theo Luật Bảo vệ dữ liệu cá nhân 2025 và Nghị định 356/2025/NĐ-CP.";

type Gia = { ten: string; sdt: string; tinh: string; phuong: string; q: string; dc: string; dy: boolean; tt: boolean; bay: string };
const GIA_TRI_DAU: Gia = { ten: "", sdt: "", tinh: TINH_MAC_DINH, phuong: "", q: "", dc: "", dy: false, tt: false, bay: "" };

export function CongThongTinProvider({
  nguon,
  daMoKhoaBanDau,
  cauHinh,
  children,
}: {
  nguon: NguonHop;
  daMoKhoaBanDau: boolean;
  cauHinh: CauHinhHop;
  children: ReactNode;
}) {
  const [daMo, setDaMo] = useState(daMoKhoaBanDau);
  const [mo, setMo] = useState(false);
  const [daGui, setDaGui] = useState(false);
  const [thu, setThu] = useState(false);
  const [dangGui, setDangGui] = useState(false);
  const [loiMay, setLoiMay] = useState<Partial<Record<TruongLoi, string>>>({});
  const [v, setV] = useState<Gia>(GIA_TRI_DAU);
  const [danhMuc, setDanhMuc] = useState<DanhMuc | null>(null);
  const [loiDanhMuc, setLoiDanhMuc] = useState(false);
  const [lanThuLai, setLanThuLai] = useState(0);
  const sau = useRef<(() => void) | null>(null);
  const nguCanhRef = useRef<string | undefined>(undefined);
  const oTen = useRef<HTMLInputElement | null>(null);

  // Danh mục tỉnh/phường: chỉ tải KHI hộp mở lần đầu (người chưa cần mở khoá không tốn một byte nào).
  useEffect(() => {
    if (!mo) return;
    const huy = new AbortController();
    setLoiDanhMuc(false);
    fetch(`/api/cong-thong-tin/dia-chi?thanhPho=${encodeURIComponent(v.tinh)}`, { signal: huy.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("dm"))))
      .then((b: { ok: boolean } & DanhMuc) => {
        if (!b.ok) throw new Error("dm");
        setDanhMuc({ thanhPho: b.thanhPho, macDinh: b.macDinh, phuong: b.phuong });
      })
      .catch(() => {
        if (!huy.signal.aborted) setLoiDanhMuc(true);
      });
    return () => huy.abort();
  }, [mo, v.tinh, lanThuLai]);

  useEffect(() => {
    if (mo && !daGui) oTen.current?.focus();
  }, [mo, daGui]);

  const dong = useCallback(() => {
    sau.current = null;
    setMo(false);
    setDaGui(false);
    setThu(false);
  }, []);

  useEffect(() => {
    if (!mo) return;
    const bam = (e: KeyboardEvent) => {
      if (e.key === "Escape") dong();
    };
    document.addEventListener("keydown", bam);
    return () => document.removeEventListener("keydown", bam);
  }, [mo, dong]);

  const yeuCau = useCallback(
    (viec: () => void, nguCanh?: string) => {
      if (daMo) {
        viec();
        return;
      }
      sau.current = viec;
      nguCanhRef.current = nguCanh;
      setMo(true);
      setDaGui(false);
      setThu(false);
    },
    [daMo],
  );

  const dsPhuong = danhMuc?.phuong ?? [];
  const sdtSach = v.sdt.replace(/[\s.\-()]/g, "");
  const loi = {
    ten: v.ten.trim().length < 2 ? "Anh chị nhập họ và tên giúp Sata Robo nhé." : "",
    sdt: !sdtSach ? "Anh chị nhập số điện thoại nhé." : /^0\d{9}$/.test(sdtSach) ? "" : "Số điện thoại gồm 10 chữ số, bắt đầu bằng 0.",
    tinh: v.tinh ? "" : "Anh chị chọn tỉnh/thành phố nhé.",
    phuong: !v.phuong
      ? "Anh chị chọn phường/xã trong danh sách — Sata Robo cần thông tin này để kết nối cơ sở gần nhà."
      : danhMuc && dsPhuong.indexOf(v.phuong) < 0
        ? "Phường/xã không thuộc tỉnh/thành phố đã chọn."
        : "",
    dy: v.dy ? "" : "Anh chị cần đồng ý để Sata Robo gửi kết quả.",
  };
  const hien = (k: keyof typeof loi) => (thu && !!loi[k]) || !!(k === "phuong" && loiMay.phuong) || !!(k === "sdt" && loiMay.soDienThoai) || !!(k === "ten" && loiMay.hoTen);
  const thongBao = (k: keyof typeof loi, truong: TruongLoi) => loiMay[truong] || loi[k];

  const qk = boTienTo(khoa(v.q));
  const goiY = !v.phuong && qk.length >= 1 ? dsPhuong.filter((w) => boTienTo(khoa(w)).indexOf(qk) >= 0 || khoa(w).indexOf(qk) >= 0).slice(0, 8) : [];
  const goiYMo = !v.phuong && qk.length >= 1;

  const datV = (p: Partial<Gia>) => {
    setV((cu) => ({ ...cu, ...p }));
    setLoiMay({});
  };

  async function gui() {
    if (Object.values(loi).some(Boolean)) {
      setThu(true);
      return;
    }
    setDangGui(true);
    setLoiMay({});
    try {
      const r = await fetch("/api/cong-thong-tin/de-lai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hoTen: v.ten.trim(),
          soDienThoai: sdtSach,
          thanhPho: v.tinh,
          phuong: v.phuong,
          soNha: v.dc.trim() || null,
          dongY: { xuLyHoSo: true, tiepThi: v.tt },
          nguon,
          nguCanh: nguCanhRef.current ?? null,
          bay: v.bay,
        }),
      });
      const b = (await r.json().catch(() => null)) as { ok?: boolean; loi?: { truong: TruongLoi; thongBao: string }[] } | null;
      if (r.ok && b?.ok) {
        setDaMo(true);
        setDaGui(true);
        setThu(false);
        return;
      }
      const m: Partial<Record<TruongLoi, string>> = {};
      for (const l of b?.loi ?? []) m[l.truong] = l.thongBao;
      if (Object.keys(m).length === 0) m.khac = "Hệ thống đang bận, anh chị thử lại giúp Sata Robo nhé.";
      setLoiMay(m);
      setThu(true);
    } catch {
      setLoiMay({ khac: "Chưa gửi được — anh chị kiểm tra kết nối mạng rồi thử lại nhé." });
    } finally {
      setDangGui(false);
    }
  }

  const tiepTuc = () => {
    const f = sau.current;
    sau.current = null;
    setMo(false);
    setDaGui(false);
    if (f) setTimeout(f, 0);
  };

  const suaThongTin = useCallback(() => {
    sau.current = null;
    setMo(true);
    setDaGui(false);
    setThu(false);
  }, []);

  const ctx = useMemo<CongThongTin>(() => ({ daMo, yeuCau, suaThongTin }), [daMo, yeuCau, suaThongTin]);

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {mo && (
        <div
          className="modal lg-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lg-t"
          data-testid="hop-de-lai-thong-tin"
          onClick={(e) => {
            if (e.target === e.currentTarget) dong();
          }}
        >
          <div className="modal-card lg-card">
            <button type="button" className="modal-x" onClick={dong} aria-label="Đóng">
              ×
            </button>
            {!daGui ? (
              <>
                <p className="lg-eyebrow">Miễn phí · một lần cho cả trang</p>
                <h2 id="lg-t" className="lg-t">
                  {cauHinh.tieuDe}
                </h2>
                <p className="lg-p">{cauHinh.moTa}</p>
                <div className="lg-f">
                  <div className="fld">
                    <label htmlFor="lg-ten">
                      Họ và tên{" "}
                      <i className="lg-bb" aria-hidden="true">
                        *
                      </i>
                    </label>
                    <input
                      id="lg-ten"
                      ref={oTen}
                      className={"inp" + (hien("ten") ? " lg-sai" : "")}
                      autoComplete="name"
                      placeholder="VD: Nguyễn Thị Lan"
                      value={v.ten}
                      onChange={(e) => datV({ ten: e.target.value })}
                      aria-invalid={hien("ten")}
                    />
                    {hien("ten") && (
                      <span className="lg-loi" role="alert">
                        {thongBao("ten", "hoTen")}
                      </span>
                    )}
                  </div>
                  <div className="fld">
                    <label htmlFor="lg-sdt">
                      Số điện thoại{" "}
                      <i className="lg-bb" aria-hidden="true">
                        *
                      </i>
                    </label>
                    <input
                      id="lg-sdt"
                      className={"inp" + (hien("sdt") ? " lg-sai" : "")}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="VD: 0905 123 456"
                      value={v.sdt}
                      onChange={(e) => datV({ sdt: e.target.value })}
                      aria-invalid={hien("sdt")}
                    />
                    {hien("sdt") && (
                      <span className="lg-loi" role="alert">
                        {thongBao("sdt", "soDienThoai")}
                      </span>
                    )}
                  </div>
                  <div className="lg-hai">
                    <div className="fld">
                      <label htmlFor="lg-tinh">
                        Tỉnh / Thành phố{" "}
                        <i className="lg-bb" aria-hidden="true">
                          *
                        </i>
                      </label>
                      <select
                        id="lg-tinh"
                        className={"inp" + (hien("tinh") ? " lg-sai" : "")}
                        value={v.tinh}
                        onChange={(e) => datV({ tinh: e.target.value, phuong: "", q: "" })}
                      >
                        {(danhMuc?.thanhPho ?? [v.tinh]).map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="fld lg-phuong">
                      <label htmlFor="lg-phuong">
                        Phường / Xã{" "}
                        <i className="lg-bb" aria-hidden="true">
                          *
                        </i>
                        <span className="lg-batbuoc">Bắt buộc</span>
                      </label>
                      <div className="lg-cb">
                        <input
                          id="lg-phuong"
                          className={"inp" + (hien("phuong") ? " lg-sai" : v.phuong ? " lg-dung" : "")}
                          role="combobox"
                          aria-expanded={goiYMo}
                          aria-controls="lg-phuong-ds"
                          aria-autocomplete="list"
                          autoComplete="off"
                          placeholder="Gõ tên phường/xã, không cần dấu"
                          value={v.q}
                          onChange={(e) => {
                            const t = e.target.value;
                            datV({ q: t, phuong: dsPhuong.indexOf(t) >= 0 ? t : "" });
                          }}
                          aria-invalid={hien("phuong")}
                        />
                        {!!v.phuong && (
                          <button type="button" className="lg-cb-x" onClick={() => datV({ phuong: "", q: "" })} aria-label="Chọn lại phường/xã">
                            ×
                          </button>
                        )}
                        {goiYMo && (
                          <ul id="lg-phuong-ds" className="lg-cb-ds" role="listbox" aria-label="Phường/xã phù hợp">
                            {goiY.map((w) => (
                              <li key={w} role="option" aria-selected="false">
                                <button type="button" className="lg-cb-o" onClick={() => datV({ phuong: w, q: w })}>
                                  {w}
                                </button>
                              </li>
                            ))}
                            {goiY.length === 0 && <li className="lg-cb-rong">Không thấy phường/xã nào khớp trong {v.tinh}. Kiểm tra lại tỉnh/thành phố.</li>}
                          </ul>
                        )}
                      </div>
                      <span className="lg-help">Dùng để Sata Robo kết nối cơ sở gần nhà anh chị. Tên theo danh mục hành chính mới (2025).</span>
                      {loiDanhMuc && (
                        <span className="lg-loi" role="alert">
                          Chưa tải được danh sách phường/xã.{" "}
                          <button type="button" className="linkbtn" onClick={() => setLanThuLai((n) => n + 1)}>
                            Thử lại
                          </button>
                        </span>
                      )}
                      {hien("phuong") && (
                        <span className="lg-loi" role="alert">
                          {thongBao("phuong", "phuong")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="fld">
                    <label htmlFor="lg-dc">
                      Số nhà, tên đường <small className="lg-tuy">(không bắt buộc)</small>
                    </label>
                    <input id="lg-dc" className="inp" autoComplete="street-address" placeholder="VD: 12 Nguyễn Văn Linh" value={v.dc} onChange={(e) => datV({ dc: e.target.value })} />
                  </div>
                  {/* Ô BẪY: ẩn khỏi người dùng (không dùng display:none để bot điền thử). Người thật luôn để trống. */}
                  <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
                    <label htmlFor="lg-web">Trang web</label>
                    <input id="lg-web" name="website" tabIndex={-1} autoComplete="off" value={v.bay} onChange={(e) => datV({ bay: e.target.value })} />
                  </div>
                  <label className="lg-ck">
                    <input type="checkbox" checked={v.dy} onChange={(e) => datV({ dy: e.target.checked })} aria-invalid={hien("dy")} />
                    <span>
                      Tôi đồng ý cho Sata Robo xử lý thông tin liên hệ này để gửi tài liệu và tư vấn.{" "}
                      <i className="lg-bb" aria-hidden="true">
                        *
                      </i>
                    </span>
                  </label>
                  {hien("dy") && (
                    <span className="lg-loi" role="alert">
                      {loi.dy}
                    </span>
                  )}
                  <label className="lg-ck">
                    <input type="checkbox" checked={v.tt} onChange={(e) => datV({ tt: e.target.checked })} />
                    <span>Nhận thông tin chương trình học từ Sata Robo (không bắt buộc).</span>
                  </label>
                  {loiMay.khac && (
                    <span className="lg-loi" role="alert">
                      {loiMay.khac}
                    </span>
                  )}
                  <button type="button" className="btn btn-acc lg-gui" onClick={gui} disabled={dangGui}>
                    {dangGui ? "Đang gửi…" : cauHinh.nut}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </button>
                  <p className="lg-rieng">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 3.2 19 6v5.4c0 4.1-2.9 7.5-7 8.4-4.1-.9-7-4.3-7-8.4V6l7-2.8Z" />
                      <path d="m9.1 12.1 2 2 3.8-4.1" />
                    </svg>
                    <span>{RIENG_TU}</span>
                  </p>
                </div>
              </>
            ) : (
              <div className="lg-ok" role="status">
                <span className="lg-ok-ic" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <h2 className="lg-t">Đã nhận thông tin</h2>
                <p className="lg-p">
                  Cảm ơn {v.ten.trim()}. {cauHinh.okMoTa}
                </p>
                <button type="button" className="btn btn-acc" onClick={tiepTuc}>
                  {cauHinh.okNut}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
