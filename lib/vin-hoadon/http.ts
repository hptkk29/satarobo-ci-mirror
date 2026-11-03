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

export function taoCongVin(tc: TuyChonCongVin): CongHoaDon {
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

  return { cheDo: "HSM", moiTruong: cauHinh.cheDo, phatHanh, traCuu, taiTep };
}
