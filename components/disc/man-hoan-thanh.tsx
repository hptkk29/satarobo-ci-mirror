"use client";

/**
 * Màn hoàn thành + form Lưu (PRD v2.0 Bước 3–4).
 *
 *  - KHÔNG hỏi lại tên/năm sinh: chỉ hiện tóm tắt đã nhập ở bước hồ sơ.
 *  - SĐT bắt buộc; email tuỳ chọn; hai ô đồng ý TÁCH RIÊNG và KHÔNG tích sẵn:
 *      · xử lý hồ sơ — BẮT BUỘC (không có thì không lưu được);
 *      · tiếp thị — TUỲ CHỌN, mặc định bỏ trống.
 *  - Lỗi/đang lưu là trạng thái của tầng trên (`trangThai`); form giữ nguyên ô đã nhập để thử lại.
 *    Màn này không bao giờ tự nói "đã lưu" — việc đó là của `ManThanhCong`, chỉ dựng khi server trả ok.
 */
import { useEffect, useId, useState } from "react";
import { NGAY_GIU_BAI_CHUA_NHAN } from "@/lib/disc/chinh-sach";
import { canonicalPhone } from "@/lib/phone";
import { operationalLocations } from "@/lib/locations";
import { goiDiaChiDisc, type DanhMucDiaChi, type GoiDiaChi } from "./api-client";
import { Ic } from "@/components/public/disc/bieu-tuong";
import type { LoiLuuHienThi } from "./loi-luu";

export type TomTatHoSo = { tenPhuHuynh: string; vaiTro: string; tenHocSinh: string; bacHoc: string };

/** Địa chỉ nơi ở của PHỤ HUYNH (không phải của con): thành phố mặc định «Tp Đà Nẵng», phường/xã BẮT BUỘC, số nhà tuỳ chọn, cơ sở gần nhà tuỳ chọn. */
export type DiaChiLuu = { thanhPho: string; phuong: string; soNha: string | null; coSoGanNha: string | null };

export type DuLieuLuu = { soDienThoai: string; email: string | null; xuLyHoSo: true; tiepThi: boolean; diaChi: DiaChiLuu };

export type TrangThaiLuu = { kieu: "nhap" } | { kieu: "dangLuu" } | { kieu: "loi"; loi: LoiLuuHienThi };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ManHoanThanh({
  tomTat,
  trangThai,
  onLuu,
  onSuaHoSo,
  onSuaBai,
  ngayGiu = NGAY_GIU_BAI_CHUA_NHAN,
  layDiaChi = goiDiaChiDisc,
}: {
  tomTat: TomTatHoSo;
  trangThai: TrangThaiLuu;
  onLuu: (d: DuLieuLuu) => void;
  onSuaHoSo: () => void;
  /** Quay về làm lại bài của phụ huynh hoặc học sinh (câu trả lời được giữ nguyên để sửa). */
  onSuaBai: (ai: "phuHuynh" | "hocSinh") => void;
  /** Số ngày giữ bài CHƯA được nhận về tài khoản. Chính sách do pháp chế chốt — truyền từ nguồn chính thức. */
  ngayGiu?: number;
  /** Lấy danh mục địa chỉ (thay được khi test). */
  layDiaChi?: GoiDiaChi;
}) {
  const id = useId();
  const [sdt, setSdt] = useState("");
  const [email, setEmail] = useState("");
  const [dongYXuLy, setDongYXuLy] = useState(false);
  const [dongYTiepThi, setDongYTiepThi] = useState(false);
  const [loi, setLoi] = useState<{ soDienThoai?: string; email?: string; xuLy?: string; phuong?: string }>({});

  // Địa chỉ nơi ở: thành phố chọn sẵn Tp Đà Nẵng (đổi được); phường/xã BẮT BUỘC; số nhà/đường không bắt buộc; «cơ sở gần nhà» tuỳ chọn.
  const [thanhPho, setThanhPho] = useState("");
  const [phuong, setPhuong] = useState("");
  const [soNha, setSoNha] = useState("");
  const [coSo, setCoSo] = useState("");
  const [danhMuc, setDanhMuc] = useState<DanhMucDiaChi | null>(null);
  const [loiDanhMuc, setLoiDanhMuc] = useState(false);
  const [lanThuLai, setLanThuLai] = useState(0);
  useEffect(() => {
    const huy = new AbortController();
    setLoiDanhMuc(false);
    void layDiaChi(thanhPho || undefined, huy.signal).then((r) => {
      if (huy.signal.aborted) return;
      if (!r.ok) {
        setLoiDanhMuc(true);
        return;
      }
      setDanhMuc(r.danhMuc);
      if (!thanhPho) setThanhPho(r.danhMuc.macDinh);
    });
    return () => huy.abort();
  }, [thanhPho, lanThuLai, layDiaChi]);
  const coSoChon = operationalLocations();

  const dangLuu = trangThai.kieu === "dangLuu";
  const loiServer = trangThai.kieu === "loi" ? trangThai.loi : null;
  const loiO = { ...(loiServer?.truong ?? {}), ...loi };

  const gui = (e: React.FormEvent) => {
    e.preventDefault();
    if (dangLuu) return;
    const l: typeof loi = {};
    if (!sdt.trim()) l.soDienThoai = "Vui lòng nhập số điện thoại để lưu kết quả";
    else if (!canonicalPhone(sdt)) l.soDienThoai = "Số điện thoại chưa đúng. Ví dụ: 0905 123 456";
    const em = email.trim();
    if (em && !EMAIL_RE.test(em)) l.email = "Email chưa đúng định dạng — vui lòng sửa hoặc để trống";
    if (!phuong) l.phuong = "Vui lòng chọn phường/xã nơi nhà bạn ở";
    if (!dongYXuLy) l.xuLy = "Cần đồng ý để chúng tôi xử lý hồ sơ thì mới lưu được kết quả";
    setLoi(l);
    if (Object.keys(l).length) return;
    onLuu({
      soDienThoai: sdt.trim(),
      email: em ? em : null,
      xuLyHoSo: true,
      tiepThi: dongYTiepThi,
      diaChi: { thanhPho, phuong, soNha: soNha.trim() ? soNha.trim() : null, coSoGanNha: coSo ? coSo : null },
    });
  };

  const moTa = (k: string, co: boolean) => (co ? { "aria-invalid": true as const, "aria-describedby": `${id}-${k}-loi` } : {});

  return (
    <section aria-labelledby={`${id}-t`} data-testid="disc-hoan-thanh" className="dj-card">
      <div>
        <h2 id={`${id}-t`} className="dok">
          <span className="okc">
            <Ic ten="tick" size={26} />
          </span>
          <span>
            Bạn và bé đã làm xong <span className="grad">cả hai bài</span>
          </span>
        </h2>
        <p className="dj-lead">Câu trả lời đang nằm trên thiết bị này và chưa được gửi đi. Để chúng tôi chấm điểm, lưu và để bạn xem lại về sau, hãy lưu bằng số điện thoại của bạn.</p>
      </div>
      <div className="dsum" data-testid="disc-tom-tat">
        <p style={{ margin: "0", fontWeight: "800", fontSize: "14px" }}>Sẽ lưu cho</p>
        <p style={{ margin: "4px 0 0" }}>
          {tomTat.vaiTro} <strong>{tomTat.tenPhuHuynh}</strong> và bé <strong>{tomTat.tenHocSinh}</strong> ({tomTat.bacHoc})
        </p>
        <button type="button" className="linkbtn" onClick={onSuaHoSo} disabled={dangLuu} style={{ marginTop: "8px", color: "var(--purT)", minHeight: "32px" }}>
          Sửa thông tin nhà mình
        </button>
      </div>
      <form onSubmit={gui} noValidate style={{ display: "grid", gap: "16px" }} aria-busy={dangLuu} data-testid="disc-form-luu">
        <div className="dj-fld">
          <label htmlFor={`${id}-sdt`}>
            Số điện thoại <span style={{ fontWeight: "400", color: "var(--muted)" }}>(bắt buộc)</span>
          </label>
          <input
            id={`${id}-sdt`}
            className={loiO.soDienThoai ? "inp bad" : "inp"}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={sdt}
            onChange={(e) => setSdt(e.target.value)}
            disabled={dangLuu}
            placeholder="0905 123 456"
            {...moTa("sdt", !!loiO.soDienThoai)}
          />
          <p className="hint">Dùng để giữ kết quả cho bạn và để bạn xác minh, đăng nhập xem lại sau. Chúng tôi không gọi điện nếu bạn không đồng ý nhận tư vấn bên dưới.</p>
          {loiO.soDienThoai && (
            <p id={`${id}-sdt-loi`} className="dj-err" role="alert">
              {loiO.soDienThoai}
            </p>
          )}
        </div>
        <div className="dj-fld">
          <label htmlFor={`${id}-email`}>
            Email <span style={{ fontWeight: "400", color: "var(--muted)" }}>(không bắt buộc)</span>
          </label>
          <input
            id={`${id}-email`}
            className={loiO.email ? "inp bad" : "inp"}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={dangLuu}
            {...moTa("email", !!loiO.email)}
          />
          {loiO.email && (
            <p id={`${id}-email-loi`} className="dj-err" role="alert">
              {loiO.email}
            </p>
          )}
        </div>
        <fieldset style={{ border: "0", margin: "0", padding: "0", display: "grid", gap: "12px" }} data-testid="disc-dia-chi">
          <legend style={{ fontWeight: "800", fontSize: "14px", marginBottom: "6px" }}>Nhà bạn ở đâu?</legend>
          <p className="hint" style={{ margin: "0" }}>
            Để xếp bạn về cơ sở Sata Robo gần nhà hơn. Chỉ cần chọn phường/xã; số nhà, đường bạn có thể để trống.
          </p>
          <div className="dj-fld">
            <label htmlFor={`${id}-tp`}>Thành phố / tỉnh</label>
            <select
              id={`${id}-tp`}
              className="inp"
              value={thanhPho}
              onChange={(e) => {
                setThanhPho(e.target.value);
                setPhuong(""); // phường của thành phố cũ không còn đúng
              }}
              disabled={dangLuu || !danhMuc}
            >
              {(danhMuc?.thanhPho ?? (thanhPho ? [thanhPho] : [])).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="dj-fld">
            <label htmlFor={`${id}-phuong`}>
              Phường / xã <span style={{ fontWeight: "400", color: "var(--muted)" }}>(bắt buộc)</span>
            </label>
            <select
              id={`${id}-phuong`}
              className={loiO.phuong ? "inp bad" : "inp"}
              value={phuong}
              onChange={(e) => setPhuong(e.target.value)}
              disabled={dangLuu || !danhMuc}
              aria-required="true"
              {...moTa("phuong", !!loiO.phuong)}
            >
              <option value="">{danhMuc ? "Chọn phường/xã" : "Đang tải danh sách…"}</option>
              {(danhMuc?.phuong ?? []).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {loiDanhMuc && (
              <p role="alert" className="dj-err">
                Chưa tải được danh sách phường/xã.{" "}
                <button type="button" className="linkbtn" onClick={() => setLanThuLai((n) => n + 1)} style={{ color: "var(--purT)" }}>
                  Thử lại
                </button>
              </p>
            )}
            {loiO.phuong && (
              <p id={`${id}-phuong-loi`} className="dj-err" role="alert">
                {loiO.phuong}
              </p>
            )}
          </div>
          <div className="dj-fld">
            <label htmlFor={`${id}-sonha`}>
              Số nhà, đường <span style={{ fontWeight: "400", color: "var(--muted)" }}>(không bắt buộc)</span>
            </label>
            <input id={`${id}-sonha`} className="inp" type="text" autoComplete="street-address" maxLength={200} value={soNha} onChange={(e) => setSoNha(e.target.value)} disabled={dangLuu} />
          </div>
          <div className="dj-fld">
            <label htmlFor={`${id}-coso`}>
              Cơ sở nào gần nhà bạn? <span style={{ fontWeight: "400", color: "var(--muted)" }}>(không bắt buộc)</span>
            </label>
            <select id={`${id}-coso`} className="inp" value={coSo} onChange={(e) => setCoSo(e.target.value)} disabled={dangLuu}>
              <option value="">Chưa chắc — để Sata Robo xếp giúp</option>
              {coSoChon.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} — {c.address}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
        <fieldset style={{ border: "0", margin: "0", padding: "0", display: "grid", gap: "8px" }}>
          <legend style={{ fontWeight: "800", fontSize: "14px", marginBottom: "6px" }}>Đồng ý của bạn</legend>
          <label className="dck">
            <input type="checkbox" checked={dongYXuLy} onChange={(e) => setDongYXuLy(e.target.checked)} disabled={dangLuu} aria-required="true" {...moTa("xuly", !!loiO.xuLy)} />
            <span>
              <strong>Bắt buộc:</strong> Tôi đồng ý để Sata Robo lưu và xử lý hồ sơ gồm tên, năm sinh, lớp và kết quả DISC của tôi và của con, cùng địa chỉ nơi ở của tôi (phường/xã, và số nhà nếu tôi nhập), nhằm hiển thị kết quả cho tôi và xếp tôi về cơ sở Sata Robo gần nhà hơn. Bài chưa được nhận về tài khoản sẽ được giữ tối đa {ngayGiu} ngày. Xem{" "}
              <a href="/chinh-sach-bao-mat" target="_blank" rel="noopener noreferrer" style={{ fontWeight: "700", color: "var(--purT)" }}>
                chính sách bảo mật
              </a>
              .
            </span>
          </label>{" "}
          {loiO.xuLy && (
            <p id={`${id}-xuly-loi`} className="dj-err" role="alert">
              {loiO.xuLy}
            </p>
          )}{" "}
          <label className="dck">
            <input type="checkbox" checked={dongYTiepThi} onChange={(e) => setDongYTiepThi(e.target.checked)} disabled={dangLuu} />
            <span>
              <strong>Tuỳ chọn:</strong> Tôi đồng ý nhận tư vấn, thông tin khoá học và ưu đãi từ Sata Robo qua điện thoại, Zalo hoặc email. Tôi có thể rút lại bất cứ lúc nào, và không chọn mục này vẫn lưu được kết quả bình thường.
            </span>
          </label>
        </fieldset>
        {loiServer && (
          <div role="alert" className="dnote re" data-testid="disc-loi-luu">
            <Ic ten="canhBao" />
            <span>
              {loiServer.thongBao}
              {loiServer.cachSua === "SUA_BAI" && loiServer.baiCanSua && (
                <>
                  <br />
                  <button type="button" className="btn btn-line" style={{ marginTop: 12, minHeight: "44px" }} onClick={() => onSuaBai(loiServer.baiCanSua!)}>
                    {loiServer.baiCanSua === "phuHuynh" ? "Quay lại bài của ba/mẹ" : "Quay lại bài của con"}
                  </button>
                </>
              )}
              {loiServer.cachSua === "SUA_HO_SO" && (
                <>
                  <br />
                  <button type="button" className="btn btn-line" style={{ marginTop: 12, minHeight: "44px" }} onClick={onSuaHoSo}>
                    Quay lại sửa hồ sơ
                  </button>
                </>
              )}
            </span>
          </div>
        )}
        <div className="dj-act">
          <p className="dj-note" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Ic ten="khoa" size={16} /> Không cần mật khẩu. Chỉ bạn xác minh được số này mới xem lại được.
          </p>
          <button type="submit" className="btn btn-acc" disabled={dangLuu} aria-busy={dangLuu} style={{ minHeight: "52px", whiteSpace: "nowrap" }} data-testid="disc-luu-gui">
            {dangLuu ? "Đang lưu…" : loiServer && loiServer.cachSua !== "SUA_HO_SO" ? "Thử lại" : "Lưu và xuất kết quả"}
          </button>
        </div>
      </form>
    </section>
  );
}
