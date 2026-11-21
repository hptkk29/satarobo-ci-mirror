// lib/vin-hoadon/http.ts — cổng `CongHoaDon` gọi VIN-HOADON thật (ký HSM, một lời gọi).
//
// Nguồn: "Hàm tích hợp hóa đơn điện tử — Version 13.0" (xem anh-xa.ts). Địa chỉ gốc do VIN cấp, lấy từ env.
//   [TOK]  POST <gốc>/api/services/hddtws/Authentication/GetToken          body { doanhnghiep_mst, username, password }
//          → { access_token, expire_in_seconds, … }  (p4-5; 401 = sai xác thực)
//   [GUI]  POST <gốc>/api/services/hddtws/QuanLyHoaDon/GuiVaKyHoadonGocHSM  Authorization: Bearer <token>
//          ⚠️ BODY PHẲNG: các trường hoá đơn nằm ở CẤP NGOÀI CÙNG, KHÔNG bọc trong `{"hoadon": …}` (PDF v13 ghi `hoadon` là TÊN KIỂU, không phải khoá;
//          bộ Postman của VIN gửi phẳng, và máy chủ demo từ chối body bọc: maketqua 08 «mã hoá đơn/ngày lập/mẫu số… không được để trống», đo 03/11/2026).
//   [TRA]  POST <gốc>/api/services/hddtws/TraCuuHoaDon/TraThongTinHoaDon
//   [PDF]  POST <gốc>/api/services/hddtws/TraCuuHoaDon/TaiHoaDonPdfKhongCanThueDuyet
//   [XML]  POST <gốc>/api/services/hddtws/TraCuuHoaDon/TaiXmlDaKy
//   [USB]  LapHoaDonGoc → XuLyHoaDon/TaiXmlChuaKy → (ký ở máy kế toán) → XuLyHoaDon/KyHoaDonToken_GuiXmlDaKy — xem ky-usb.ts
//
// ⚠️ LUẬT KHÔNG THỬ LẠI PHÁT HÀNH: sau timeout / lỗi mạng / 5xx VIN có thể ĐÃ lưu hoặc ký ⇒ trả `KHONG_RO`,
// không gửi lại. Chỉ gửi lại MỘT lần sau 401 (VIN từ chối xác thực TRƯỚC khi xử lý hoá đơn). `ma_hoadon` là
// khoá chống trùng: gửi lại cùng khoá mà VIN đã có ⇒ báo trùng (mã 03/26) ⇒ ta tự tra cứu rồi mới kết luận.
//
// ⚠️ KHÔNG LOG token/mật khẩu. Log chỉ mang RefID, mã kết quả, mã HTTP.
// ⚠️ Chưa từng chạy với dịch vụ thật (chưa có sandbox) — các điểm [?] ở anh-xa.ts vẫn mở.

import type { CongHoaDon, KetQuaPhatHanh, KetQuaTraCuu, LoaiTep, PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import type { CauHinhVin } from "./cau-hinh";
import {
  MA_TU_CHAN,
  docDoiTuong,
  docPhanHoiPhatHanh,
  docPhanHoiTep,
  docPhanHoiTraCuu,
  giaiMaTepVin,
  kiemPhieuVin,
  phieuSangVin,
} from "./anh-xa";
import {
  docPhanHoiLuuNhap,
  docPhanHoiTaiXmlChuaKy,
  docPhanHoiTraCuuNhap,
  kiemXmlDaKy,
  type DauVaoGuiXmlDaKy,
  type KetQuaGuiXmlDaKy,
  type KetQuaLuuNhapVin,
  type KetQuaTaiXmlChuaKy,
  type KyUsbVin,
} from "./ky-usb";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type TuyChonCongVin = {
  cauHinh: CauHinhVin;
  fetchImpl: FetchLike;
  /** Đồng hồ (ms) — chỉ để tính hạn token; test tiêm vào. */
  now?: () => number;
  /** Nơi ghi log. Mặc định console.warn. KHÔNG bao giờ nhận token/mật khẩu. */
  log?: (thongDiep: string) => void;
  /** Trần chờ (ms). Mặc định 30 000 phát hành, 15 000 tra cứu/tải/token. */
  thoiGianCho?: { phatHanh?: number; khac?: number };
};

const DUONG_DAN = "/api/services/hddtws";
/** Theo bộ Postman v11; PDF v13 ghi «KyHoaDonToken_TaiXmlChuaKy». [?: chưa đo trên máy chủ thật — đổi MỘT chỗ này nếu sai.] */
const DUONG_TAI_XML_CHUA_KY = "/XuLyHoaDon/TaiXmlChuaKy";
const DUONG_GUI_XML_DA_KY = "/XuLyHoaDon/KyHoaDonToken_GuiXmlDaKy";
const DUONG_LUU_NHAP = "/QuanLyHoaDon/LapHoaDonGoc";

/** Không biết `expire_in_seconds` là giây hay mili-giây (tài liệu ghi "ms") ⇒ không tin con số, luôn giữ NGẮN. */
const HAN_TOKEN_TOI_DA_MS = 30 * 60 * 1000;
const HAN_TOKEN_MAC_DINH_MS = 5 * 60 * 1000;

type MucToken = { token: string; hetHan: number };
/** Bộ nhớ token của TIẾN TRÌNH — khoá theo (gốc, tài khoản, MST); KHÔNG gồm mật khẩu. */
const boNhoToken = new Map<string, MucToken>();

/** Chỉ cho test. */
export function _xoaBoNhoTokenVinChoTest(): void {
  boNhoToken.clear();
}

class LoiXacThuc extends Error {
  constructor(readonly ma: string) {
    super(`Không lấy được token VIN-HOADON (${ma}).`);
  }
}

type PhanHoi =
  | { kieu: "OK"; status: number; body: unknown }
  | { kieu: "HTTP"; status: number; body: unknown }
  | { kieu: "MANG"; thongDiep: string };

function laLoiHuy(e: unknown): boolean {
  return (
    (typeof e === "object" && e !== null && "name" in e && (e as { name: unknown }).name === "AbortError") ||
    (e instanceof Error && /abort/i.test(e.message))
  );
}

/** Hạn token (ms) từ `expire_in_seconds`: nhận cả giây lẫn mili-giây (≥ 10^7 coi là ms), rồi KẸP trần 30 phút. */
export function hanTokenMs(expire: unknown): number {
  const n = typeof expire === "number" ? expire : typeof expire === "string" ? Number(expire) : NaN;
  if (!Number.isFinite(n) || n <= 0) return HAN_TOKEN_MAC_DINH_MS;
  const ms = n >= 10_000_000 ? n : n * 1000;
  return Math.min(Math.floor(ms * 0.8), HAN_TOKEN_TOI_DA_MS);
}

/**
 * Kết quả "Kiểm tra kết nối" — MÃ CỐ ĐỊNH, không bao giờ chứa token/mật khẩu/địa chỉ.
 * Chỉ chứng minh: địa chỉ máy chủ tới được + MST/tài khoản/mật khẩu được VIN chấp nhận (GetToken). Không chứng minh chứng thư/ký.
 */
export type MaKiemTraKetNoi = "OK" | "DANG_NHAP_SAI" | "LOI_MAY_CHU" | "MANG" | "PHAN_HOI_LA";

/** Cổng VIN: hợp đồng chung `CongHoaDon` (ký HSM) + đường ký USB token + kiểm tra đăng nhập. */
export type CongVin = CongHoaDon & { kyUsb: KyUsbVin; kiemTraDangNhap(mstNguoiBan: string): Promise<MaKiemTraKetNoi> };

export function taoCongVin(tc: TuyChonCongVin): CongVin {
  const { cauHinh, fetchImpl } = tc;
  const now = tc.now ?? (() => Date.now());
  const log = tc.log ?? ((s: string) => console.warn(s));
  const choPhatHanh = tc.thoiGianCho?.phatHanh ?? 30_000;
  const choKhac = tc.thoiGianCho?.khac ?? 15_000;
  const goc = `${cauHinh.baseUrl}${DUONG_DAN}`;

  async function goi(url: string, init: { headers: Record<string, string>; body: string }, ms: number): Promise<PhanHoi> {
    const ac = new AbortController();
    const hen = setTimeout(() => ac.abort(), ms);
    try {
      const res = await fetchImpl(url, { method: "POST", headers: init.headers, body: init.body, signal: ac.signal });
      let body: unknown = null;
      try {
        const text = await res.text();
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return res.ok ? { kieu: "OK", status: res.status, body } : { kieu: "HTTP", status: res.status, body };
    } catch (e) {
      return { kieu: "MANG", thongDiep: laLoiHuy(e) ? `quá ${Math.round(ms / 1000)} giây không phản hồi` : "lỗi mạng" };
    } finally {
      clearTimeout(hen);
    }
  }

  function khoaToken(mst: string): string {
    return `${goc}|${cauHinh.username}|${mst}`;
  }

  async function layToken(mst: string, lamMoi: boolean): Promise<string> {
    const k = khoaToken(mst);
    const co = boNhoToken.get(k);
    if (!lamMoi && co && co.hetHan > now()) return co.token;
    boNhoToken.delete(k);
    const ph = await goi(
      `${goc}/Authentication/GetToken`,
      {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doanhnghiep_mst: mst, username: cauHinh.username, password: cauHinh.password }),
      },
      choKhac,
    );
    if (ph.kieu === "MANG") throw new LoiXacThuc(ph.thongDiep);
    if (ph.kieu === "HTTP") throw new LoiXacThuc(`HTTP ${ph.status}`);
    const o = docDoiTuong(ph.body);
    const token = o && typeof o["access_token"] === "string" ? (o["access_token"] as string) : "";
    if (!token) throw new LoiXacThuc("phản hồi không có token");
    boNhoToken.set(k, { token, hetHan: now() + hanTokenMs(o?.["expire_in_seconds"]) });
    return token;
  }

  function headers(token: string): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }

  /** Gọi có token; 401 ⇒ làm mới token MỘT lần rồi gửi lại. Lỗi lấy token ⇒ ném LoiXacThuc. */
  async function goiCoToken(duong: string, body: unknown, mst: string, ms: number): Promise<PhanHoi> {
    const chuoiBody = JSON.stringify(body);
    const t1 = await layToken(mst, false);
    const ph1 = await goi(`${goc}${duong}`, { headers: headers(t1), body: chuoiBody }, ms);
    if (ph1.kieu === "MANG" || ph1.status !== 401) return ph1;
    const t2 = await layToken(mst, true);
    return goi(`${goc}${duong}`, { headers: headers(t2), body: chuoiBody }, ms);
  }

  async function traCuu(refId: string, mstNguoiBan: string): Promise<KetQuaTraCuu> {
    const mst = mstNguoiBan.trim();
    let ph: PhanHoi;
    try {
      ph = await goiCoToken("/TraCuuHoaDon/TraThongTinHoaDon", { doanhnghiep_mst: mst, ma_hoadon: refId.trim() }, mst, choKhac);
    } catch (e) {
      const ma = e instanceof LoiXacThuc ? e.ma : "không rõ";
      log(`[vin-hoadon] tra cứu RefID=${refId}: lỗi token (${ma})`);
      return { loai: "KHONG_RO", thongDiep: `Không đăng nhập được VIN-HOADON để tra cứu (${ma}).` };
    }
    if (ph.kieu === "MANG") {
      log(`[vin-hoadon] tra cứu RefID=${refId}: ${ph.thongDiep}`);
      return { loai: "KHONG_RO", thongDiep: `Tra cứu VIN-HOADON thất bại: ${ph.thongDiep}.` };
    }
    if (ph.kieu === "HTTP") {
      log(`[vin-hoadon] tra cứu RefID=${refId}: HTTP ${ph.status}`);
      return { loai: "KHONG_RO", thongDiep: `Tra cứu VIN-HOADON trả HTTP ${ph.status}.` };
    }
    return docPhanHoiTraCuu(ph.body, refId);
  }

  async function phatHanh(phieu: PhieuPhatHanh): Promise<KetQuaPhatHanh> {
    // 1) Tự chặn TRƯỚC khi gửi — chắc chắn chưa có hoá đơn.
    const loi = kiemPhieuVin(phieu);
    if (loi) return { loai: "TU_CHOI", ma: MA_TU_CHAN, thongDiep: loi };

    const mst = phieu.mstNguoiBan.trim();
    let ph: PhanHoi;
    try {
      ph = await goiCoToken("/QuanLyHoaDon/GuiVaKyHoadonGocHSM", phieuSangVin(phieu), mst, choPhatHanh);
    } catch (e) {
      // Lỗi ở khâu LẤY TOKEN (lần đầu hoặc lần làm mới sau 401) ⇒ body hoá đơn chưa được VIN nhận xử lý.
      const ma = e instanceof LoiXacThuc ? e.ma : "không rõ";
      log(`[vin-hoadon] phát hành RefID=${phieu.refId}: lỗi token (${ma})`);
      return {
        loai: "TU_CHOI",
        ma: "VIN_DANG_NHAP",
        thongDiep: `Không đăng nhập được VIN-HOADON (${ma}) — chưa gửi hoá đơn. Kiểm tài khoản rồi thử lại.`,
      };
    }

    if (ph.kieu === "MANG") {
      log(`[vin-hoadon] phát hành RefID=${phieu.refId}: ${ph.thongDiep} ⇒ KHONG_RO`);
      return { loai: "KHONG_RO", thongDiep: `VIN-HOADON ${ph.thongDiep} — chưa rõ đã phát hành hay chưa, cần tra cứu.` };
    }
    if (ph.kieu === "HTTP") {
      if (ph.status === 401) {
        // Đã làm mới token mà vẫn 401 ⇒ VIN từ chối xác thực, không xử lý hoá đơn.
        log(`[vin-hoadon] phát hành RefID=${phieu.refId}: 401 sau khi làm mới token`);
        return { loai: "TU_CHOI", ma: "VIN_DANG_NHAP", thongDiep: "VIN-HOADON từ chối xác thực (401) — chưa gửi được hoá đơn." };
      }
      if (ph.status === 400) {
        // BadFormat / InvalidInputData: VIN từ chối đầu vào TRƯỚC khi xử lý [GUI p16].
        log(`[vin-hoadon] phát hành RefID=${phieu.refId}: HTTP 400`);
        return { loai: "TU_CHOI", ma: "VIN_400", thongDiep: "VIN-HOADON từ chối dữ liệu (400: sai cú pháp hoặc sai quy định nghiệp vụ)." };
      }
      log(`[vin-hoadon] phát hành RefID=${phieu.refId}: HTTP ${ph.status} ⇒ KHONG_RO`);
      return { loai: "KHONG_RO", thongDiep: `VIN-HOADON trả HTTP ${ph.status} — chưa rõ đã phát hành hay chưa, cần tra cứu.` };
    }

    const kq = docPhanHoiPhatHanh(ph.body, phieu);
    if (kq.loai === "TRUNG") {
      // Tự tra cứu ngay trong phatHanh — nơi gọi nhận thẳng DA_PHAT_HANH (số thật) nếu tra được.
      log(`[vin-hoadon] phát hành RefID=${phieu.refId}: trùng ⇒ tự tra cứu`);
      const tc = await traCuu(phieu.refId, mst);
      if (tc.loai === "DA_PHAT_HANH") return tc;
      return { loai: "KHONG_RO", thongDiep: `${kq.thongDiep} Tra cứu lại chưa ra số hoá đơn.` };
    }
    if (kq.loai === "CHUNG_THU") {
      // Lỗi chứng thư (13/27): không tin mã — tra cứu theo khoá. 11 ⇒ chắc chắn chưa có gì ⇒ TU_CHOI cấu hình.
      log(`[vin-hoadon] phát hành RefID=${phieu.refId}: ${kq.ma} ⇒ tự tra cứu`);
      const tc = await traCuu(phieu.refId, mst);
      if (tc.loai === "DA_PHAT_HANH") return tc;
      if (tc.loai === "CHUA_CO") return { loai: "TU_CHOI", ma: kq.ma, thongDiep: kq.thongDiep };
      return { loai: "KHONG_RO", thongDiep: `${kq.thongDiep} Tra cứu lại chưa chắc chắn: ${tc.thongDiep}` };
    }
    if (kq.loai !== "DA_PHAT_HANH") {
      log(`[vin-hoadon] phát hành RefID=${phieu.refId}: ${kq.loai}${kq.loai === "TU_CHOI" ? ` ${kq.ma}` : ""}`);
    }
    return kq;
  }

  async function taiTep(maTraCuu: string, loai: LoaiTep, mstNguoiBan: string): Promise<Uint8Array> {
    const mst = mstNguoiBan.trim();
    const duong = loai === "pdf" ? "/TraCuuHoaDon/TaiHoaDonPdfKhongCanThueDuyet" : "/TraCuuHoaDon/TaiXmlDaKy";
    let ph: PhanHoi;
    try {
      ph = await goiCoToken(duong, { doanhnghiep_mst: mst, magiaodich: maTraCuu.trim() }, mst, choKhac);
    } catch (e) {
      throw new Error(`Không đăng nhập được VIN-HOADON để tải tệp (${e instanceof LoiXacThuc ? e.ma : "không rõ"}).`, { cause: e });
    }
    if (ph.kieu === "MANG") throw new Error(`Tải tệp VIN-HOADON thất bại: ${ph.thongDiep}.`);
    if (ph.kieu === "HTTP") throw new Error(`Tải tệp VIN-HOADON trả HTTP ${ph.status}.`);
    const doc = docPhanHoiTep(ph.body, loai);
    if (!doc.ok) throw new Error(doc.thongDiep);
    return giaiMaTepVin(doc.base64, loai);
  }

  // ─── Ký USB token ─────────────────────────────────────────────────────────────────────────────────

  async function luuNhap(phieu: PhieuPhatHanh): Promise<KetQuaLuuNhapVin> {
    const loi = kiemPhieuVin(phieu);
    if (loi) return { loai: "TU_CHOI", ma: MA_TU_CHAN, thongDiep: loi };
    const mst = phieu.mstNguoiBan.trim();
    let ph: PhanHoi;
    try {
      ph = await goiCoToken(DUONG_LUU_NHAP, phieuSangVin(phieu), mst, choPhatHanh);
    } catch (e) {
      const ma = e instanceof LoiXacThuc ? e.ma : "không rõ";
      log(`[vin-hoadon] lưu nháp RefID=${phieu.refId}: lỗi token (${ma})`);
      return { loai: "TU_CHOI", ma: "VIN_DANG_NHAP", thongDiep: `Không đăng nhập được VIN-HOADON (${ma}) — chưa lưu nháp.` };
    }
    if (ph.kieu === "MANG") {
      log(`[vin-hoadon] lưu nháp RefID=${phieu.refId}: ${ph.thongDiep} ⇒ KHONG_RO`);
      return { loai: "KHONG_RO", thongDiep: `VIN-HOADON ${ph.thongDiep} — chưa rõ đã lưu nháp hay chưa, cần tra cứu.` };
    }
    if (ph.kieu === "HTTP") {
      log(`[vin-hoadon] lưu nháp RefID=${phieu.refId}: HTTP ${ph.status}`);
      if (ph.status === 401) return { loai: "TU_CHOI", ma: "VIN_DANG_NHAP", thongDiep: "VIN-HOADON từ chối xác thực (401) — chưa lưu nháp." };
      if (ph.status === 400) return { loai: "TU_CHOI", ma: "VIN_400", thongDiep: "VIN-HOADON từ chối dữ liệu (400)." };
      return { loai: "KHONG_RO", thongDiep: `VIN-HOADON trả HTTP ${ph.status} — chưa rõ đã lưu nháp hay chưa, cần tra cứu.` };
    }
    const kq = docPhanHoiLuuNhap(ph.body);
    if (kq.loai !== "TRUNG") {
      if (kq.loai !== "DA_LUU") log(`[vin-hoadon] lưu nháp RefID=${phieu.refId}: ${kq.loai}`);
      return kq;
    }
    // Trùng khoá: bản nháp (hoặc hoá đơn) đã có. Tra cứu lấy đúng magiaodich cũ — không tạo bản thứ hai.
    log(`[vin-hoadon] lưu nháp RefID=${phieu.refId}: trùng ⇒ tự tra cứu`);
    let tc: PhanHoi;
    try {
      tc = await goiCoToken("/TraCuuHoaDon/TraThongTinHoaDon", { doanhnghiep_mst: mst, ma_hoadon: phieu.refId.trim() }, mst, choKhac);
    } catch {
      return { loai: "KHONG_RO", thongDiep: `${kq.thongDiep} Tra cứu lại không đăng nhập được.` };
    }
    if (tc.kieu !== "OK") return { loai: "KHONG_RO", thongDiep: `${kq.thongDiep} Tra cứu lại thất bại.` };
    const nhap = docPhanHoiTraCuuNhap(tc.body, phieu.refId);
    return nhap.loai === "NHAP" ? { loai: "DA_LUU", maGiaoDich: nhap.maGiaoDich } : { loai: "KHONG_RO", thongDiep: `${kq.thongDiep} ${nhap.thongDiep}` };
  }

  async function taiXmlChuaKy(a: { mstNguoiBan: string; refId: string; maGiaoDich: string }): Promise<KetQuaTaiXmlChuaKy> {
    const mst = a.mstNguoiBan.trim();
    let ph: PhanHoi;
    try {
      ph = await goiCoToken(DUONG_TAI_XML_CHUA_KY, { doanhnghiep_mst: mst, magiaodich: a.maGiaoDich.trim(), ma_hoadon: a.refId.trim() }, mst, choKhac);
    } catch (e) {
      return { loai: "LOI", ma: "VIN_DANG_NHAP", thongDiep: `Không đăng nhập được VIN-HOADON để tải XML (${e instanceof LoiXacThuc ? e.ma : "không rõ"}).` };
    }
    if (ph.kieu === "MANG") return { loai: "LOI", ma: "VIN_MANG", thongDiep: `Tải XML chưa ký thất bại: ${ph.thongDiep}.` };
    if (ph.kieu === "HTTP") return { loai: "LOI", ma: `VIN_HTTP_${ph.status}`, thongDiep: `Tải XML chưa ký trả HTTP ${ph.status}.` };
    return docPhanHoiTaiXmlChuaKy(ph.body);
  }

  async function guiXmlDaKy(a: DauVaoGuiXmlDaKy): Promise<KetQuaGuiXmlDaKy> {
    // 1) Tự kiểm TRƯỚC khi gửi — chắc chắn chưa có gì thay đổi trên VIN.
    const loiXml = kiemXmlDaKy(a.xmlChuaKyBase64, a.xmlDaKyBase64);
    if (loiXml) return { loai: "TU_CHOI", ma: "XML_DA_KY_KHONG_HOP_LE", thongDiep: loiXml };
    const mst = a.phieu.mstNguoiBan.trim();
    const refId = a.phieu.refId.trim();
    let ph: PhanHoi;
    try {
      ph = await goiCoToken(
        DUONG_GUI_XML_DA_KY,
        { doanhnghiep_mst: mst, magiaodich: a.maGiaoDich.trim(), ma_hoadon: refId, base64xml: a.xmlDaKyBase64, maphiengiaodich: a.maPhien },
        mst,
        choPhatHanh,
      );
    } catch (e) {
      const ma = e instanceof LoiXacThuc ? e.ma : "không rõ";
      log(`[vin-hoadon] gửi XML đã ký RefID=${refId}: lỗi token (${ma})`);
      return { loai: "TU_CHOI", ma: "VIN_DANG_NHAP", thongDiep: `Không đăng nhập được VIN-HOADON (${ma}) — chưa gửi XML đã ký.` };
    }
    if (ph.kieu === "MANG") {
      log(`[vin-hoadon] gửi XML đã ký RefID=${refId}: ${ph.thongDiep} ⇒ KHONG_RO`);
      return { loai: "KHONG_RO", thongDiep: `VIN-HOADON ${ph.thongDiep} — chưa rõ đã nhận chữ ký hay chưa, cần tra cứu (không gửi lại).` };
    }
    if (ph.kieu === "HTTP") {
      log(`[vin-hoadon] gửi XML đã ký RefID=${refId}: HTTP ${ph.status}`);
      if (ph.status === 401) return { loai: "TU_CHOI", ma: "VIN_DANG_NHAP", thongDiep: "VIN-HOADON từ chối xác thực (401) — chưa nhận XML đã ký." };
      if (ph.status === 400) return { loai: "TU_CHOI", ma: "VIN_400", thongDiep: "VIN-HOADON từ chối dữ liệu (400: sai cú pháp hoặc sai quy định nghiệp vụ)." };
      return { loai: "KHONG_RO", thongDiep: `VIN-HOADON trả HTTP ${ph.status} — chưa rõ đã nhận chữ ký hay chưa, cần tra cứu (không gửi lại).` };
    }
    const kq = docPhanHoiPhatHanh(ph.body, a.phieu);
    if (kq.loai === "TRUNG") {
      log(`[vin-hoadon] gửi XML đã ký RefID=${refId}: trùng ⇒ tự tra cứu`);
      const tc = await traCuu(refId, mst);
      if (tc.loai === "DA_PHAT_HANH") return tc;
      return { loai: "KHONG_RO", thongDiep: `${kq.thongDiep} Tra cứu lại chưa ra số hoá đơn.` };
    }
    if (kq.loai === "CHUNG_THU") {
      // Với đường token, lỗi chứng thư của TÀI KHOẢN chưa chắc áp dụng; hoá đơn vẫn là bản nháp ⇒ để nơi gọi tra cứu.
      log(`[vin-hoadon] gửi XML đã ký RefID=${refId}: ${kq.ma}`);
      return { loai: "KHONG_RO", thongDiep: `${kq.thongDiep} (đường ký USB — cần tra cứu trạng thái hoá đơn)` };
    }
    if (kq.loai !== "DA_PHAT_HANH") log(`[vin-hoadon] gửi XML đã ký RefID=${refId}: ${kq.loai}${kq.loai === "TU_CHOI" ? ` ${kq.ma}` : ""}`);
    return kq;
  }

  async function kiemTraDangNhap(mstNguoiBan: string): Promise<MaKiemTraKetNoi> {
    try {
      await layToken(mstNguoiBan.trim(), true); // luôn lấy token MỚI — không tin bộ nhớ đệm
      return "OK";
    } catch (e) {
      const ma = e instanceof LoiXacThuc ? e.ma : "";
      log(`[vin-hoadon] kiểm tra kết nối: ${ma || "lỗi lạ"}`);
      if (/^HTTP (400|401|403)$/.test(ma)) return "DANG_NHAP_SAI";
      if (/^HTTP \d+$/.test(ma)) return "LOI_MAY_CHU";
      if (ma === "phản hồi không có token") return "PHAN_HOI_LA";
      return "MANG";
    }
  }

  return { cheDo: "HSM", moiTruong: cauHinh.cheDo, phatHanh, traCuu, taiTep, kyUsb: { luuNhap, taiXmlChuaKy, guiXmlDaKy }, kiemTraDangNhap };
}
