// lib/misa/meinvoice/http.ts — cổng `CongHoaDon` gọi MISA meInvoice thật (ký HSM).
//
// Nguồn (đọc 30/09/2026):
//   [TOK]   https://doc.meinvoice.vn/api/Document/Login.html
//           POST <BaseURL>/auth/token, body { appid, taxcode, username, password }, Data = chuỗi JWT.
//           "Token của MISA 1 lần get về có thời hạn sử dụng 15 ngày"; hết hạn ⇒ ErrorCode TokenExpiredCode.
//   [HSM]   https://doc.meinvoice.vn/api/Document/InvoicePublishHSM.html
//           Không mã: POST <BaseURL>/itg/invoicepublishing/publishhsm
//           Có mã:    POST <BaseURL>/code/itg/invoicepublishing/publishhsm
//           Header: Authorization: Bearer <token> · CompanyTaxCode: <MST>
//   [REF]   https://doc.meinvoice.vn/api/Document/GetInvoiceInRefid.html
//           Không mã: POST <BaseURL>/invoicepublished/invoice-status/refid
//           Có mã:    POST <BaseURL>/code/invoicepublished/invoice-status/refid   body ["<refid>", …]
//   [DL]    https://doc.meinvoice.vn/api/Document/DownloadInvoice.html
//           Không mã: POST <BaseURL>/itg/invoicepublished/downloadinvoice?downloadDataType=PDF|XML|ALL
//           Có mã:    POST <BaseURL>/code/itg/invoicepublished/downloadinvoice?downloadDataType=…
//           body ["<TransactionID>", …] (≤ 50)
//   [DL2]   https://doc.meinvoice.vn/itg/Doc/DowloadInvoice.html — PDF "đã được chuyển đổi sang chuỗi
//           base64", XML "nội dung Xml".
//
// ⚠️ LUẬT KHÔNG THỬ LẠI PHÁT HÀNH: sau timeout / lỗi mạng / 5xx MISA có thể ĐÃ cấp số ⇒ trả
// `KHONG_RO`, không gửi lại. Chỉ gửi lại MỘT lần sau 401 / TokenExpiredCode / InvalidTokenCode —
// MISA từ chối xác thực TRƯỚC khi xử lý hoá đơn. (Kể cả khi đoán sai, RefID vẫn là khoá chống trùng.)
//
// ⚠️ KHÔNG LOG token/mật khẩu/appid. Log chỉ được mang RefID, mã lỗi, mã HTTP.

import type { CongHoaDon, KetQuaPhatHanh, KetQuaTraCuu, LoaiTep, PhieuPhatHanh } from "./cong";
import type { CauHinhHsm } from "./cau-hinh";
import {
  MA_TU_CHAN,
  coMaTheoKyHieu,
  docMangData,
  docPhanHoiPhatHanh,
  docPhanHoiTraCuu,
  kiemPhieu,
  maTokenTrongThan,
  moTaMa,
  phieuSangMisa,
} from "./anh-xa";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type TuyChonCongHsm = {
  cauHinh: CauHinhHsm;
  fetchImpl: FetchLike;
  /** Đồng hồ (ms) — chỉ để tính hạn token; test tiêm vào. */
  now?: () => number;
  /** Nơi ghi log. Mặc định console.warn. KHÔNG bao giờ nhận token/mật khẩu. */
  log?: (thongDiep: string) => void;
  /** Trần chờ (ms). Mặc định 30 000 phát hành, 15 000 tra cứu/tải/token. */
  thoiGianCho?: { phatHanh?: number; khac?: number };
};

/** Token 15 ngày [TOK]; giữ 14 ngày cho có biên. Hết hạn sớm hơn thì MISA báo TokenExpiredCode ⇒ làm mới. */
const HAN_TOKEN_MS = 14 * 24 * 60 * 60 * 1000;

type MucToken = { token: string; hetHan: number };
/** Bộ nhớ token của TIẾN TRÌNH — khoá theo (baseUrl, appId, username, MST); KHÔNG gồm mật khẩu. */
const boNhoToken = new Map<string, MucToken>();

/** Chỉ cho test. */
export function _xoaBoNhoTokenChoTest(): void {
  boNhoToken.clear();
}

class LoiXacThuc extends Error {
  constructor(readonly ma: string) {
    super(`Không lấy được token MISA (${ma}).`);
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

export function taoCongHsm(tc: TuyChonCongHsm): CongHoaDon {
  const { cauHinh, fetchImpl } = tc;
  const now = tc.now ?? (() => Date.now());
  const log = tc.log ?? ((s: string) => console.warn(s));
  const choPhatHanh = tc.thoiGianCho?.phatHanh ?? 30_000;
  const choKhac = tc.thoiGianCho?.khac ?? 15_000;
  const tienTo = cauHinh.loaiHoaDon === "co-ma" ? "/code" : "";
  const base = cauHinh.baseUrl;

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
    return `${base}|${cauHinh.appId}|${cauHinh.username}|${mst}`;
  }

  async function layToken(mst: string, lamMoi: boolean): Promise<string> {
    const k = khoaToken(mst);
    const co = boNhoToken.get(k);
    if (!lamMoi && co && co.hetHan > now()) return co.token;
    boNhoToken.delete(k);
    const ph = await goi(
      `${base}/auth/token`,
      {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appid: cauHinh.appId,
          taxcode: mst,
          username: cauHinh.username,
          password: cauHinh.password,
        }),
      },
      choKhac,
    );
    if (ph.kieu === "MANG") throw new LoiXacThuc(ph.thongDiep);
    const body = ph.body as { Success?: unknown; Data?: unknown; ErrorCode?: unknown } | null;
    if (ph.kieu === "HTTP" || !body || body.Success !== true || typeof body.Data !== "string" || !body.Data) {
      const ma = body && typeof body.ErrorCode === "string" && body.ErrorCode ? body.ErrorCode : `HTTP ${ph.status}`;
      throw new LoiXacThuc(ma);
    }
    boNhoToken.set(k, { token: body.Data, hetHan: now() + HAN_TOKEN_MS });
    return body.Data;
  }

  function headers(token: string, mst: string): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}`, CompanyTaxCode: mst };
  }

  function canLamMoiToken(ph: PhanHoi): boolean {
    if (ph.kieu === "MANG") return false;
    return ph.status === 401 || maTokenTrongThan(ph.body);
  }

  /** Gọi có token; 401/mã token ⇒ làm mới token MỘT lần rồi gửi lại. Lỗi lấy token ⇒ ném LoiXacThuc. */
  async function goiCoToken(url: string, body: string, mst: string, ms: number): Promise<PhanHoi> {
    const t1 = await layToken(mst, false);
    const ph1 = await goi(url, { headers: headers(t1, mst), body }, ms);
    if (!canLamMoiToken(ph1)) return ph1;
    const t2 = await layToken(mst, true);
    return goi(url, { headers: headers(t2, mst), body }, ms);
  }

  async function traCuu(refId: string, mstNguoiBan: string): Promise<KetQuaTraCuu> {
    const mst = mstNguoiBan.trim();
    let ph: PhanHoi;
    try {
      ph = await goiCoToken(`${base}${tienTo}/invoicepublished/invoice-status/refid`, JSON.stringify([refId]), mst, choKhac);
    } catch (e) {
      const ma = e instanceof LoiXacThuc ? e.ma : "không rõ";
      log(`[misa-meinvoice] tra cứu RefID=${refId}: lỗi token (${ma})`);
      return { loai: "KHONG_RO", thongDiep: `Không đăng nhập được MISA để tra cứu (${ma}).` };
    }
    if (ph.kieu === "MANG") {
      log(`[misa-meinvoice] tra cứu RefID=${refId}: ${ph.thongDiep}`);
      return { loai: "KHONG_RO", thongDiep: `Tra cứu MISA thất bại: ${ph.thongDiep}.` };
    }
    if (ph.kieu === "HTTP") {
      log(`[misa-meinvoice] tra cứu RefID=${refId}: HTTP ${ph.status}`);
      return { loai: "KHONG_RO", thongDiep: `Tra cứu MISA trả HTTP ${ph.status}.` };
    }
    return docPhanHoiTraCuu(ph.body, refId);
  }

  async function phatHanh(phieu: PhieuPhatHanh): Promise<KetQuaPhatHanh> {
    // 1) Tự chặn TRƯỚC khi gửi — chắc chắn chưa có hoá đơn.
    const loi = kiemPhieu(phieu);
    if (loi) return { loai: "TU_CHOI", ma: MA_TU_CHAN, thongDiep: loi };
    const coMa = coMaTheoKyHieu(phieu.kyHieu);
    if (coMa !== (cauHinh.loaiHoaDon === "co-ma")) {
      return {
        loai: "TU_CHOI",
        ma: MA_TU_CHAN,
        thongDiep:
          `Ký hiệu ${phieu.kyHieu} là hoá đơn ${coMa ? "CÓ mã" : "KHÔNG mã"} nhưng cổng MISA cấu hình ` +
          `${cauHinh.loaiHoaDon === "co-ma" ? "có mã" : "không mã"} (MISA_EINVOICE_LOAI_HOA_DON).`,
      };
    }

    const mst = phieu.mstNguoiBan.trim();
    const body = JSON.stringify([phieuSangMisa(phieu)]);
    let ph: PhanHoi;
    try {
      ph = await goiCoToken(`${base}${tienTo}/itg/invoicepublishing/publishhsm`, body, mst, choPhatHanh);
    } catch (e) {
      // Lỗi ở khâu LẤY TOKEN (lần đầu hoặc lần làm mới sau 401) ⇒ body hoá đơn chưa được MISA nhận xử lý.
      const ma = e instanceof LoiXacThuc ? e.ma : "không rõ";
      log(`[misa-meinvoice] phát hành RefID=${phieu.refId}: lỗi token (${ma})`);
      return {
        loai: "TU_CHOI",
        ma: "MISA_DANG_NHAP",
        thongDiep: `Không đăng nhập được MISA (${ma}) — chưa gửi hoá đơn. Kiểm tài khoản/AppID rồi thử lại.`,
      };
    }

    if (ph.kieu === "MANG") {
      log(`[misa-meinvoice] phát hành RefID=${phieu.refId}: ${ph.thongDiep} ⇒ KHONG_RO`);
      return { loai: "KHONG_RO", thongDiep: `MISA ${ph.thongDiep} — chưa rõ đã phát hành hay chưa, cần tra cứu.` };
    }
    if (ph.kieu === "HTTP") {
      if (ph.status === 401) {
        // Đã làm mới token mà vẫn 401 ⇒ MISA từ chối xác thực, không xử lý hoá đơn.
        log(`[misa-meinvoice] phát hành RefID=${phieu.refId}: 401 sau khi làm mới token`);
        return { loai: "TU_CHOI", ma: "MISA_DANG_NHAP", thongDiep: "MISA từ chối xác thực (401) — chưa gửi được hoá đơn." };
      }
      log(`[misa-meinvoice] phát hành RefID=${phieu.refId}: HTTP ${ph.status} ⇒ KHONG_RO`);
      return {
        loai: "KHONG_RO",
        thongDiep: `MISA trả HTTP ${ph.status} — chưa rõ đã phát hành hay chưa, cần tra cứu.`,
      };
    }

    const kq = docPhanHoiPhatHanh(ph.body, phieu);
    if (kq.loai === "TOKEN") {
      log(`[misa-meinvoice] phát hành RefID=${phieu.refId}: ${kq.ma} sau khi làm mới token`);
      return { loai: "TU_CHOI", ma: "MISA_DANG_NHAP", thongDiep: `${moTaMa(kq.ma)} — chưa gửi được hoá đơn.` };
    }
    if (kq.loai === "TRUNG") {
      // CHỌN: tự tra cứu ngay trong phatHanh — nơi gọi nhận thẳng DA_PHAT_HANH (số thật) nếu tra được.
      log(`[misa-meinvoice] phát hành RefID=${phieu.refId}: trùng RefID ⇒ tự tra cứu`);
      const tc = await traCuu(phieu.refId, mst);
      if (tc.loai === "DA_PHAT_HANH") return tc;
      return { loai: "KHONG_RO", thongDiep: `${kq.thongDiep} Tra cứu lại chưa ra số hoá đơn.` };
    }
    if (kq.loai !== "DA_PHAT_HANH") {
      log(
        `[misa-meinvoice] phát hành RefID=${phieu.refId}: ${kq.loai}${kq.loai === "TU_CHOI" ? ` ${kq.ma}` : ""}`,
      );
    }
    return kq;
  }

  async function taiTep(maTraCuu: string, loai: LoaiTep, mstNguoiBan: string): Promise<Uint8Array> {
    const mst = mstNguoiBan.trim();
    const kieu = loai === "pdf" ? "PDF" : "XML";
    const url = `${base}${tienTo}/itg/invoicepublished/downloadinvoice?downloadDataType=${kieu}`;
    let ph: PhanHoi;
    try {
      ph = await goiCoToken(url, JSON.stringify([maTraCuu]), mst, choKhac);
    } catch (e) {
      throw new Error(`Không đăng nhập được MISA để tải tệp (${e instanceof LoiXacThuc ? e.ma : "không rõ"}).`, { cause: e });
    }
    if (ph.kieu === "MANG") throw new Error(`Tải tệp MISA thất bại: ${ph.thongDiep}.`);
    if (ph.kieu === "HTTP") throw new Error(`Tải tệp MISA trả HTTP ${ph.status}.`);
    const body = ph.body as { Success?: unknown; ErrorCode?: unknown; Data?: unknown } | null;
    if (!body || body.Success !== true || (typeof body.ErrorCode === "string" && body.ErrorCode)) {
      const ma = body && typeof body.ErrorCode === "string" ? body.ErrorCode : "";
      throw new Error(`MISA từ chối tải tệp${ma ? `: ${moTaMa(ma)}` : ""}.`);
    }
    const mang = docMangData(body.Data);
    const item = mang?.find((x) => String(x.TransactionID ?? "").trim() === maTraCuu.trim());
    if (!item) throw new Error("Phản hồi tải tệp MISA không có bản ghi mang đúng mã tra cứu.");
    const maTrong = typeof item.ErrorCode === "string" ? item.ErrorCode.trim() : "";
    if (maTrong) throw new Error(`MISA từ chối tải tệp: ${moTaMa(maTrong)}.`);
    if (typeof item.Data !== "string" || !item.Data) throw new Error("MISA trả tệp rỗng.");
    return giaiMaTep(item.Data, loai);
  }

  return { cheDo: "HSM", moiTruong: cauHinh.cheDo, phatHanh, traCuu, taiTep };
}

/**
 * [DL2]: PDF là base64, XML là chuỗi XML thô. ⚠️ CHƯA XÁC MINH cho API v3 (trang [DL] không nói
 * mã hoá) ⇒ nhận cả hai dạng cho XML, và KIỂM chữ ký tệp: PDF phải bắt đầu "%PDF", XML phải bắt
 * đầu "<". Sai ⇒ ném — không lưu một tệp hỏng làm bản chính thức.
 */
export function giaiMaTep(data: string, loai: LoaiTep): Uint8Array {
  const tho = data.trimStart();
  if (loai === "xml" && tho.startsWith("<")) return new Uint8Array(Buffer.from(tho, "utf8"));
  const bytes = /^[A-Za-z0-9+/=\s]+$/.test(tho) ? Buffer.from(tho, "base64") : Buffer.alloc(0);
  if (loai === "pdf") {
    if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("Tệp PDF MISA trả về không hợp lệ.");
    return new Uint8Array(bytes);
  }
  const s = bytes.toString("utf8").trimStart();
  if (!s.startsWith("<")) throw new Error("Tệp XML MISA trả về không hợp lệ.");
  return new Uint8Array(bytes);
}
