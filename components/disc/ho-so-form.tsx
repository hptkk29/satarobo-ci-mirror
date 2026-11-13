"use client";

/**
 * Bước 1 — "Nhà mình": hồ sơ gia đình (1 phụ huynh/người giám hộ + 1 học sinh).
 *
 * Luật hiển thị:
 *  - Nói THẲNG vì sao hỏi từng thứ và dữ liệu đi đâu (không giấu việc thu dữ liệu).
 *  - Chỉ hỏi NĂM sinh. Năm sinh ↔ lớp lệch ⇒ chặn tới khi người dùng xác nhận, không tự đoán tuổi.
 *  - Thiếu/sai hồ sơ ⇒ KHÔNG cho tiếp, và nói rõ ô nào. Luật nằm ở `kiemTraHoSo` (một nguồn),
 *    form chỉ chuyển chuỗi gõ vào thành số rồi hỏi nó.
 */
import { useId, useMemo, useState } from "react";
import { BAC_HOC, VAI_TRO_PHU_HUYNH, bacHocTuNamSinh, kiemTraHoSo, namHocBatDauVN, type BacHoc, type HocSinh, type PhuHuynh } from "@/lib/disc/ho-so";
import { Ic } from "@/components/public/disc/bieu-tuong";

export type HoSoNhap = {
  phuHuynh: { hoTen: string; vaiTro: string; namSinh: string };
  hocSinh: { hoTen: string; namSinh: string; bacHoc: string };
  xacNhanLech: boolean;
};

export const HO_SO_TRONG: HoSoNhap = {
  phuHuynh: { hoTen: "", vaiTro: "", namSinh: "" },
  hocSinh: { hoTen: "", namSinh: "", bacHoc: "" },
  xacNhanLech: false,
};

export const NHAN_VAI_TRO: Record<(typeof VAI_TRO_PHU_HUYNH)[number], string> = {
  BO: "Bố",
  ME: "Mẹ",
  NGUOI_GIAM_HO: "Người giám hộ",
};

export function nhanBacHoc(b: string): string {
  return b === "MN" ? "Mầm non" : `Lớp ${b}`;
}

/** Chuỗi gõ vào → số nguyên, hoặc NaN. Chỉ nhận đúng 4 chữ số. */
function namTuChuoi(s: string): number {
  return /^\d{4}$/.test(s.trim()) ? Number(s.trim()) : Number.NaN;
}

export type HoSoHopLe = { phuHuynh: PhuHuynh; hocSinh: HocSinh; nguoiLonTraLoiHo: boolean };

export function kiemTraHoSoNhap(v: HoSoNhap, namNay: number): { ok: true; hoSo: HoSoHopLe; canhBao: string[] } | { ok: false; loi: Record<string, string> } {
  const loi: Record<string, string> = {};
  if (!VAI_TRO_PHU_HUYNH.includes(v.phuHuynh.vaiTro as never)) loi["phuHuynh.vaiTro"] = "Vui lòng chọn bạn là bố, mẹ hay người giám hộ";
  if (!BAC_HOC.includes(v.hocSinh.bacHoc as never)) loi["hocSinh.bacHoc"] = "Vui lòng chọn lớp/bậc học của con";
  const nsPH = namTuChuoi(v.phuHuynh.namSinh);
  const nsHS = namTuChuoi(v.hocSinh.namSinh);
  if (Number.isNaN(nsPH)) loi["phuHuynh.namSinh"] = "Vui lòng nhập năm sinh gồm 4 chữ số (ví dụ 1988)";
  if (Number.isNaN(nsHS)) loi["hocSinh.namSinh"] = "Vui lòng nhập năm sinh gồm 4 chữ số (ví dụ 2016)";

  const kq = kiemTraHoSo(
    {
      phuHuynh: { hoTen: v.phuHuynh.hoTen, vaiTro: v.phuHuynh.vaiTro, namSinh: nsPH },
      hocSinh: { hoTen: v.hocSinh.hoTen, namSinh: nsHS, bacHoc: v.hocSinh.bacHoc },
    },
    namNay,
  );
  if (!kq.ok) {
    for (const l of kq.loi) {
      // Số không đọc được đã có thông báo riêng ở trên — đừng đè bằng thông báo của zod về "number".
      if (!loi[l.truong]) loi[l.truong] = /number|NaN/i.test(l.thongBao) ? "Vui lòng nhập năm sinh gồm 4 chữ số" : l.thongBao;
    }
  }
  if (Object.keys(loi).length || !kq.ok) return { ok: false, loi };
  return {
    ok: true,
    canhBao: kq.canhBao.map((c) => c.thongBao),
    hoSo: {
      phuHuynh: { hoTen: v.phuHuynh.hoTen.trim(), vaiTro: v.phuHuynh.vaiTro as PhuHuynh["vaiTro"], namSinh: nsPH },
      hocSinh: { hoTen: v.hocSinh.hoTen.trim(), namSinh: nsHS, bacHoc: v.hocSinh.bacHoc as BacHoc },
      nguoiLonTraLoiHo: kq.nguoiLonQuanSatHocSinh,
    },
  };
}

export function HoSoGiaDinhForm({
  giaTri,
  onDoi,
  onTiep,
  namNay,
  homNay,
  loiNgoai,
  dangTai = false,
}: {
  giaTri: HoSoNhap;
  onDoi: (v: HoSoNhap) => void;
  onTiep: (h: HoSoHopLe) => void;
  namNay: number;
  /** Thời điểm hiện tại (tiêm được để test); mặc định giờ máy. Dùng tính lớp theo năm học. */
  homNay?: Date;
  /** Lỗi từ tầng trên (ví dụ chưa chọn được bộ câu hỏi theo tuổi). */
  loiNgoai?: string | null;
  /** Đang lấy bộ câu hỏi từ máy chủ: khoá nút và nói rõ, để bấm lặp không gửi thêm yêu cầu. */
  dangTai?: boolean;
}) {
  const id = useId();
  const bayGio = homNay ?? new Date();
  const [loi, setLoi] = useState<Record<string, string>>({});
  const [thuTiep, setThuTiep] = useState(false);

  const ket = useMemo(() => kiemTraHoSoNhap(giaTri, namNay), [giaTri, namNay]);
  const canhBao = ket.ok ? ket.canhBao : [];
  const bac = giaTri.hocSinh.bacHoc;
  const beNho = ket.ok ? ket.hoSo.nguoiLonTraLoiHo : bac === "MN" || (bac !== "" && Number(bac) <= 2);

  const cap = <K extends "phuHuynh" | "hocSinh">(nhom: K, truong: keyof HoSoNhap[K], v: string) => {
    onDoi({ ...giaTri, [nhom]: { ...giaTri[nhom], [truong]: v }, xacNhanLech: false });
    if (thuTiep) setLoi({});
  };

  /** Gõ đủ 4 chữ số năm sinh của bé ⇒ tự điền lớp theo năm học (sửa tay được). Chưa đủ 4 số ⇒ giữ nguyên lớp đang chọn. */
  const capNamSinhBe = (v: string) => {
    const lop = /^\d{4}$/.test(v) ? bacHocTuNamSinh(Number(v), bayGio) : null;
    onDoi({ ...giaTri, hocSinh: { ...giaTri.hocSinh, namSinh: v, bacHoc: lop ?? giaTri.hocSinh.bacHoc }, xacNhanLech: false });
    if (thuTiep) setLoi({});
  };

  const tiep = (e: React.FormEvent) => {
    e.preventDefault();
    if (dangTai) return;
    setThuTiep(true);
    const k = kiemTraHoSoNhap(giaTri, namNay);
    if (!k.ok) {
      setLoi(k.loi);
      return;
    }
    if (k.canhBao.length && !giaTri.xacNhanLech) {
      setLoi({ xacNhanLech: "Vui lòng tích xác nhận bên dưới, hoặc sửa lại năm sinh/lớp của con" });
      return;
    }
    setLoi({});
    onTiep(k.hoSo);
  };

  const o = (k: string) => ({ "aria-invalid": loi[k] ? (true as const) : undefined, "aria-describedby": loi[k] ? `${id}-${k}-loi` : undefined });
  const baoLoi = (k: string) =>
    loi[k] ? (
      <p id={`${id}-${k}-loi`} className="dj-err" role="alert">
        {loi[k]}
      </p>
    ) : null;
  const lop = (k: string) => (loi[k] ? "inp bad" : "inp");

  const nhieuLoi = Object.keys(loi).length > 0;

  return (
    <form onSubmit={tiep} noValidate aria-busy={dangTai} aria-labelledby={`${id}-tieu-de`} data-testid="disc-ho-so" className="dj-card">
      <div>
        <h2 id={`${id}-tieu-de`}>
          Cho chúng tôi biết <span className="grad">nhà mình</span>
        </h2>
        <p className="dj-lead">
          Chúng tôi hỏi tên và <strong>năm</strong> sinh (không hỏi ngày tháng) để chọn đúng bộ câu hỏi theo độ tuổi và viết kết quả cho đúng người. Bài làm cần có ít nhất một ba/mẹ (hoặc người giám hộ) và một bé.
        </p>
      </div>
      {nhieuLoi && (
        <p role="alert" className="dnote re" data-testid="disc-ho-so-loi-tong">
          <Ic ten="canhBao" />
          <span>Còn thông tin chưa đúng hoặc chưa điền. Vui lòng xem các ô được đánh dấu bên dưới để tiếp tục.</span>
        </p>
      )}
      {loiNgoai && (
        <p role="alert" className="dnote re">
          <Ic ten="canhBao" />
          <span>{loiNgoai}</span>
        </p>
      )}
      <fieldset className="dj-fs">
        <legend>Ba/mẹ hoặc người giám hộ</legend>
        <div className="dj-fld">
          <span className="lb" id={`${id}-vai`}>
            Bạn là
          </span>
          <div className="dpicks" role="radiogroup" aria-labelledby={`${id}-vai`} {...o("phuHuynh.vaiTro")}>
            {VAI_TRO_PHU_HUYNH.map((v) => (
              <label key={v} className={"dpick" + (giaTri.phuHuynh.vaiTro === v ? " on" : "")} style={{ display: "inline-flex", alignItems: "center", position: "relative" }}>
                <input
                  type="radio"
                  name={`${id}-vai`}
                  value={v}
                  checked={giaTri.phuHuynh.vaiTro === v}
                  onChange={() => cap("phuHuynh", "vaiTro", v)}
                  style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                />
                {NHAN_VAI_TRO[v]}
              </label>
            ))}
          </div>
          {baoLoi("phuHuynh.vaiTro")}
        </div>
        <div className="dj-2">
          <div className="dj-fld">
            <label htmlFor={`${id}-ph-ten`}>Họ và tên</label>
            <input id={`${id}-ph-ten`} className={lop("phuHuynh.hoTen")} autoComplete="name" maxLength={80} value={giaTri.phuHuynh.hoTen} onChange={(e) => cap("phuHuynh", "hoTen", e.target.value)} {...o("phuHuynh.hoTen")} />
            {baoLoi("phuHuynh.hoTen")}
          </div>
          <div className="dj-fld">
            <label htmlFor={`${id}-ph-ns`}>Năm sinh</label>
            <input
              id={`${id}-ph-ns`}
              className={lop("phuHuynh.namSinh")}
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="Ví dụ 1988"
              value={giaTri.phuHuynh.namSinh}
              onChange={(e) => cap("phuHuynh", "namSinh", e.target.value.replace(/\D/g, ""))}
              {...o("phuHuynh.namSinh")}
            />
            {baoLoi("phuHuynh.namSinh")}
          </div>
        </div>
      </fieldset>
      <fieldset className="dj-fs">
        <legend>Bé (học sinh)</legend>
        <div className="dj-2">
          <div className="dj-fld">
            <label htmlFor={`${id}-hs-ten`}>Tên của bé</label>
            <input id={`${id}-hs-ten`} className={lop("hocSinh.hoTen")} autoComplete="off" maxLength={80} value={giaTri.hocSinh.hoTen} onChange={(e) => cap("hocSinh", "hoTen", e.target.value)} {...o("hocSinh.hoTen")} />
            {baoLoi("hocSinh.hoTen")}
          </div>
          <div className="dj-fld">
            <label htmlFor={`${id}-hs-ns`}>Năm sinh của bé</label>
            <input
              id={`${id}-hs-ns`}
              className={lop("hocSinh.namSinh")}
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="Ví dụ 2016"
              value={giaTri.hocSinh.namSinh}
              onChange={(e) => capNamSinhBe(e.target.value.replace(/\D/g, ""))}
              {...o("hocSinh.namSinh")}
            />
            {baoLoi("hocSinh.namSinh")}
          </div>
        </div>
        <div className="dj-fld">
          <label htmlFor={`${id}-hs-lop`}>Lớp / bậc học hiện tại</label>
          <select id={`${id}-hs-lop`} className={lop("hocSinh.bacHoc")} value={giaTri.hocSinh.bacHoc} onChange={(e) => cap("hocSinh", "bacHoc", e.target.value)} {...o("hocSinh.bacHoc")}>
            <option value="">Chọn lớp/bậc học</option>
            {BAC_HOC.map((b) => (
              <option key={b} value={b}>
                {nhanBacHoc(b)}
              </option>
            ))}
          </select>
          <p className="hint">
            Tự tính từ năm sinh theo năm học {namHocBatDauVN(bayGio)}–{namHocBatDauVN(bayGio) + 1} (năm học bắt đầu từ tháng 9). Nếu con học lệch lớp, bạn chọn lại lớp ở trên.
          </p>
          {baoLoi("hocSinh.bacHoc")}
        </div>
        {canhBao.length > 0 && (
          <div className="dnote am" role="group" aria-label="Cần xác nhận" style={{ display: "grid", gap: "8px" }} data-testid="disc-canh-bao-lech">
            <p style={{ margin: "0", display: "flex", gap: "8px", fontWeight: "700" }}>
              <Ic ten="canhBao" /> {canhBao[0]}
            </p>
            <label className="dck">
              <input type="checkbox" checked={giaTri.xacNhanLech} onChange={(e) => onDoi({ ...giaTri, xacNhanLech: e.target.checked })} />
              <span>Tôi xác nhận năm sinh và lớp của con như đã nhập là đúng.</span>
            </label>
            {baoLoi("xacNhanLech")}
          </div>
        )}{" "}
        {beNho && (
          <p className="dnote vi" data-testid="disc-hop-be-nho">
            <Ic ten="thongTin" />
            <span>
              <strong>Bé còn nhỏ nên ba/mẹ sẽ quan sát và trả lời hộ.</strong> Chúng tôi không bắt trẻ nhỏ tự đánh giá bản thân. Bạn chỉ cần trả lời theo những gì thường thấy ở bé trong sinh hoạt hằng ngày.
            </span>
          </p>
        )}
      </fieldset>
      <p className="dnote" style={{ padding: "0", color: "var(--muted)" }}>
        <Ic ten="thongTin" />
        <span>
          Bạn có thể làm tiếp mà chưa cần cho số điện thoại. Chỉ đến bước cuối, khi muốn lưu và xem lại kết quả, chúng tôi mới hỏi số điện thoại và nói rõ dữ liệu nào được lưu, trong bao lâu.
        </span>
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" className="btn btn-acc" disabled={dangTai} aria-busy={dangTai} style={{ minHeight: "52px" }} data-testid="disc-ho-so-tiep">
          {dangTai ? "Đang tải câu hỏi…" : "Tiếp tục"}
          <Ic ten="phai" />
        </button>
      </div>
    </form>
  );
}
