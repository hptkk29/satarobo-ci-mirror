// lib/vin-hoadon/may-chu-vin-gia.ts — MÁY CHỦ VIN-HOADON GIẢ, chỉ cho test (KHÔNG import từ mã chạy thật).
//
// Dựng theo ĐÚNG những gì PDF VIN v13.0 mô tả (đường dẫn, khoá body, khoá phản hồi) — và MỌI chỗ tài liệu
// không nói (hành vi khi gửi trùng, mã thành công của GuiVaKy…) là GIẢ ĐỊNH của test này, không phải sự thật của
// VIN. Vì vậy test xanh trên máy chủ này chứng minh MÃ CỦA TA khớp tài liệu, KHÔNG chứng minh VIN thật chạy như vậy.
//
// Không có bí mật thật: tài khoản/mật khẩu/token ở đây là chuỗi giả, test dùng chúng để soát rò rỉ.

import { pdfMoPhong, xmlMoPhong } from "@/lib/misa/meinvoice/gia-lap";
import type { FetchLike } from "./http";

export type KichBanVinGia = "THANH_CONG" | "TIMEOUT_DA_GHI" | "TIMEOUT_CHUA_GHI" | "LOI_XAC_THUC";

export const TAI_KHOAN_VIN_GIA = {
  username: "tai-khoan-vin-bi-mat",
  password: "mat-khau-vin-bi-mat-9z",
  token: "token-vin-gia-bi-mat",
} as const;

export const NGAY_KY_VIN_GIA = "2026-09-30 10:15:00";

type BanGhi = {
  maHoaDon: string;
  maGiaoDich: string;
  soHoaDon: string;
  mauSo: string;
  kyHieu: string;
  ngayLap: string;
  tongTien: string;
  /** false = bản NHÁP (trangthai 0, chưa có số hoá đơn); true = đã ký (trangthai 3). */
  daKy: boolean;
};

export type CuocGoiVin = { duong: string; auth: string | null; body: unknown };

export type MayChuVinGia = {
  readonly fetchImpl: FetchLike;
  datKichBan(kichBan: KichBanVinGia): void;
  readonly daGhi: ReadonlyMap<string, BanGhi>;
  readonly cuocGoi: readonly CuocGoiVin[];
  /** Ép lời gọi kế tiếp tới đường này trả đúng phản hồi (một lần). */
  epMotLan(duong: string, phanHoi: () => Response): void;
};

const DUONG_GOC = "/api/services/hddtws";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=UTF-8" } });
}

function loiHuy(): Error {
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

function docBody(init: RequestInit | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(String(init?.body ?? "{}"));
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function boNho(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

/** XML TT78 GIẢ chưa ký — đủ để test so nội dung; KHÔNG phải định dạng thật của VIN [?]. */
export function xmlChuaKyGia(b: Pick<BanGhi, "maHoaDon" | "mauSo" | "kyHieu" | "tongTien">): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<HDon><DLHDon Id="data"><TTChung><KHMSHDon>${b.mauSo}</KHMSHDon><KHHDon>${b.kyHieu}</KHHDon>` +
    `<SHDon></SHDon><MaHoaDon>${b.maHoaDon}</MaHoaDon></TTChung><NDHDon><TgTTTBSo>${b.tongTien}</TgTTTBSo></NDHDon></DLHDon><DSCKS><NBan></NBan></DSCKS></HDon>`
  );
}

/**
 * Hai chứng thư THỬ tự ký (DER base64, KHÔNG có khoá riêng — khoá đã huỷ lúc sinh), chỉ để test đọc được serial / hạn từ chữ ký:
 *   · `CHUNG_THU_GIA_B64`      serial 5400FA1B2C3D, hết hạn 2126-10-11 — «chứng thư của pháp nhân» mặc định trong test.
 *   · `CHUNG_THU_KHAC_B64`     serial ABCD1234 — «chứng thư của pháp nhân khác» để thử chặn dùng nhầm chứng thư.
 */
export const SERIAL_CHUNG_THU_GIA = "5400FA1B2C3D";
export const SERIAL_CHUNG_THU_KHAC = "ABCD1234";
export const CHUNG_THU_GIA_B64 =
  "MIIDKTCCAhGgAwIBAgIGVAD6Gyw9MA0GCSqGSIb3DQEBCwUAMCoxGTAXBgNVBAMMEFNBVEEgVEVTVCBLWSBVU0IxDTALBgNVBAoMBFRlc3QwIBcNMjYxMTA0MTQ0MjAxWhgPMjEyNjEwMTExNDQyMDFaMCoxGTAXBgNVBAMMEFNBVEEgVEVTVCBLWSBVU0IxDTALBgNVBAoMBFRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDNVcDRHq6PK9xxMwHs/hOLeGiSHknbepoCPwcSce6fsGkCZrul2hI9lmOCuDptJLmxPUVQayKnkHqxnI49vQMA9LmnJ//Nxl6RNJRRPtjjHWth9NxB7TcQPiZ2Sr0ZnOyTsKgh/hYMavZOqN4pviQmnIbjA/1bZLiIkcuJVVPnD342919xXrEVdyvU+tD4Mh0GYEo0EdnwbdQcWoZ44LTlucFCguq0BmANLQ5iK/gvgUUr/ePJWI3YguuvkCK6Y/HqmuN7HwVVgzrH+fWJKnJn6q/xWJ2fcbygk5Yv73wv/h4657jisqX173++UuEXvzSxycC4sHt5h2PNIc29lZixAgMBAAGjUzBRMB0GA1UdDgQWBBQ/7TefwsvmSsGBKasyfChe7QobuTAfBgNVHSMEGDAWgBQ/7TefwsvmSsGBKasyfChe7QobuTAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQATnmIX4xreqrMPimNU2ySjIn0W+919eGrG8DO7U/nzpSgeu/Uf10aS0qjshMFgZcnzaUhnNznBO67XOKOhC0onLCu4fa6LGabV6vkGy1CIy+d1Iz4rkcDr5F4bdXI8Zwoio9xK4TGn6VcG/+f4u1QG9YIeN2B8QzVA8DkLH4MAWQUBRu21qa6u+Fl0vT517XY5y1i9CE9OqbQRr3L96YcZrtbMUoKyPTLBGezRSKWqjEMlryDusIAD0DYNAfWHNnmwr0fB1PrX+xLFCl/RJHrWLw5qc+gdn9awpfImyNm/hMcZJRjs/3CuP+1I4pYdS5ntfJX9M4DbVTUeHYM23/D1";
export const CHUNG_THU_KHAC_B64 =
  "MIIDJDCCAgygAwIBAgIFAKvNEjQwDQYJKoZIhvcNAQELBQAwKDEXMBUGA1UEAwwOU0FUQSBURVNUIEtIQUMxDTALBgNVBAoMBFRlc3QwIBcNMjYxMTA0MTQ0MjE1WhgPMjEyNjEwMTExNDQyMTVaMCgxFzAVBgNVBAMMDlNBVEEgVEVTVCBLSEFDMQ0wCwYDVQQKDARUZXN0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqmK4q+ZXgTebydU7OwxuDJ8DsTVlM4V+50ZXV86NYkqWJLdj+MziuEqgIDQ6OasdWmEJ9XBsGb+159QCkAnkQcx9zoAOKXJ3Zoo9ETZRdMJNPj6NCxk0u9f5ovrGkACxWDfYmEuWGf0zmzYuvpAboIvelAcFlySyJxKWpOEqOKx48UePdv9RHFXFnbBikw7X6ClLcjTguTNFC1aAkMtfE2Kb2LyYBjSlR7zrvAuttFgjeQq6yjwqs5hTooOn6vMtKzG5Rwf0G6dMtO4e7zGNaIdu3d+XW7YR2MBKzbp3JMADkvaoW2kt9tolNfsOMmyJMrFkdhV9rheFtMEdSMOXyQIDAQABo1MwUTAdBgNVHQ4EFgQUY3k/kN71aYf5h6nOYFoG6rXa2sowHwYDVR0jBBgwFoAUY3k/kN71aYf5h6nOYFoG6rXa2sowDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAVMfxwuN0cwmNZgF4Rwx+SJgI9HJBMP/j6plRpFqgKX0jcRhzRihHK+iL3vKVxUIsvFpsrPBSrKJOYJ7kCZ/luVOEaq+VWtucXFkZnM4trWHN0QxHXI/acue0hs0ZpDYuc/CGfb1k9MzbmBZRoCNRTkBJOZJhA+kktLBV5e/CN9YeXLwWK4TMT9EXy4RQZ7nZH0yd2stCRwDo7Gv9R+VyqjneUyhGAGVK5cGpBTYagJa48rQMMBwnt8W5DbHImxYQSufBJuVpy4DfJ9mz5OZ+0aHoGkan9401zxHnfXAtxtLOIBqaOBVJtGuNpHCcxznctVSQR1W8ptnPGb0rg+gc5w==";

/**
 * Ký GIẢ: chèn một khối <Signature> vào <NBan>, KÈM chứng thư thử (mặc định `CHUNG_THU_GIA_B64`; `null` = không kèm chứng thư).
 * Không có mật mã thật — chỉ để test đi qua luồng.
 */
export function kyXmlGiaChoTest(xml: string, chungThuB64: string | null = CHUNG_THU_GIA_B64): string {
  const keyInfo = chungThuB64 ? `<KeyInfo><X509Data><X509Certificate>${chungThuB64}</X509Certificate></X509Data></KeyInfo>` : "";
  const khoi = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo></SignedInfo><SignatureValue>ZmFrZQ==</SignatureValue>${keyInfo}</Signature>`;
  if (!xml.includes("<NBan></NBan>")) throw new Error("XML giả không có <NBan> rỗng để ký.");
  return xml.replace("<NBan></NBan>", `<NBan>${khoi}</NBan>`);
}

const thieuTruongBatBuoc = (hd: Record<string, unknown>): boolean =>
  typeof hd["ma_hoadon"] !== "string" || typeof hd["mauso"] !== "string" || typeof hd["kyhieu"] !== "string";

function phan08(): Response {
  // Body bọc kiểu {"hoadon": {…}} ⇒ máy chủ thật KHÔNG thấy trường nào và trả 08 «không được để trống» (HTTP 200, bọc ABP).
  return json({
    result: { maketqua: "08", motaketqua: "Dữ liệu hóa đơn không hợp lệ(Mã hóa đơn không được để trống.Mẫu số không được để trống.Ký hiệu không được để trống.)", magiaodich: null },
    targetUrl: null,
    success: true,
    error: null,
    unAuthorizedRequest: false,
    __abp: true,
  });
}

export function taoMayChuVinGia(kichBanDau: KichBanVinGia = "THANH_CONG"): MayChuVinGia {
  let kichBan = kichBanDau;
  let seq = 0;
  let soPhien = 0;
  /** maphiengiaodich còn hiệu lực → magiaodich của nó. */
  const phienConSong = new Map<string, string>();
  const daGhi = new Map<string, BanGhi>();
  const cuocGoi: CuocGoiVin[] = [];
  const ep = new Map<string, () => Response>();

  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url);
    const duong = u.pathname.startsWith(DUONG_GOC) ? u.pathname.slice(DUONG_GOC.length) : u.pathname;
    const body = docBody(init);
    const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"] ?? null;
    cuocGoi.push({ duong, auth, body });

    const epLan = ep.get(duong);
    if (epLan) {
      ep.delete(duong);
      return epLan();
    }

    if (duong === "/Authentication/GetToken") {
      const dung =
        kichBan !== "LOI_XAC_THUC" &&
        body["username"] === TAI_KHOAN_VIN_GIA.username &&
        body["password"] === TAI_KHOAN_VIN_GIA.password &&
        typeof body["doanhnghiep_mst"] === "string";
      if (!dung) return json({ error: "Unauthorized" }, 401);
      return json({ access_token: TAI_KHOAN_VIN_GIA.token, expire_in_seconds: 1_296_000, token_type: "bear" });
    }

    // Mọi đường còn lại cần Bearer đúng; kịch bản LOI_XAC_THUC từ chối cả token cũ.
    if (kichBan === "LOI_XAC_THUC" || auth !== `Bearer ${TAI_KHOAN_VIN_GIA.token}`) return json({ error: "Unauthorized" }, 401);

    if (duong === "/QuanLyHoaDon/GuiVaKyHoadonGocHSM") {
      // BODY PHẲNG như máy chủ thật; body bọc ⇒ 08 (bắt chước để test đỏ nếu mã quay lại gửi body bọc).
      const hd = body;
      if (thieuTruongBatBuoc(hd)) return phan08();
      const maHoaDon = hd["ma_hoadon"] as string;
      if (daGhi.has(maHoaDon)) return json({ maketqua: "03", motaketqua: "Trùng hóa đơn" });
      if (kichBan === "TIMEOUT_CHUA_GHI") throw loiHuy();
      seq += 1;
      const ban: BanGhi = {
        maHoaDon,
        maGiaoDich: `GD${String(seq).padStart(6, "0")}${maHoaDon.length}`,
        soHoaDon: String(seq).padStart(7, "0"),
        mauSo: hd["mauso"] as string,
        kyHieu: hd["kyhieu"] as string,
        ngayLap: String(hd["ngaylap"] ?? ""),
        tongTien: String(hd["tongtien_covat"] ?? ""),
        daKy: true,
      };
      daGhi.set(maHoaDon, ban);
      if (kichBan === "TIMEOUT_DA_GHI") throw loiHuy();
      return json({
        maketqua: "31",
        motaketqua: "Phát hành thành công",
        mauso: ban.mauSo,
        kyhieu: ban.kyHieu,
        sohoadon: ban.soHoaDon,
        trangthai: "3",
        ngayky: NGAY_KY_VIN_GIA,
        loaihoadon: "1",
        chuyendoi: "0",
        magiaodich: ban.maGiaoDich,
      });
    }

    if (duong === "/QuanLyHoaDon/LapHoaDonGoc") {
      // Đo thật 03/11/2026 (demo): 01 «Thành công», magiaodich 12 ký tự, trangthai "0" (lưu tạm).
      const hd = body;
      if (thieuTruongBatBuoc(hd)) return phan08();
      const maHoaDon = hd["ma_hoadon"] as string;
      if (daGhi.has(maHoaDon)) return json({ maketqua: "03", motaketqua: "Trùng hóa đơn" });
      if (kichBan === "TIMEOUT_CHUA_GHI") throw loiHuy();
      seq += 1;
      const ban: BanGhi = {
        maHoaDon,
        maGiaoDich: `GD${String(seq).padStart(6, "0")}${maHoaDon.length}`,
        soHoaDon: "",
        mauSo: hd["mauso"] as string,
        kyHieu: hd["kyhieu"] as string,
        ngayLap: String(hd["ngaylap"] ?? ""),
        tongTien: String(hd["tongtien_covat"] ?? ""),
        daKy: false,
      };
      daGhi.set(maHoaDon, ban);
      if (kichBan === "TIMEOUT_DA_GHI") throw loiHuy();
      return json({ maketqua: "01", motaketqua: "Thành công", magiaodich: ban.maGiaoDich, trangthai: "0", hoso_id: null });
    }

    const tim = (): BanGhi | null => {
      const gd = typeof body["magiaodich"] === "string" && body["magiaodich"] ? body["magiaodich"] : null;
      const ma = typeof body["ma_hoadon"] === "string" && body["ma_hoadon"] ? body["ma_hoadon"] : null;
      for (const b of daGhi.values()) {
        if ((gd && b.maGiaoDich === gd) || (!gd && ma && b.maHoaDon === ma)) return b;
      }
      return null;
    };

    if (duong === "/XuLyHoaDon/TaiXmlChuaKy") {
      // Đường dẫn theo bộ Postman v11 (PDF ghi «KyHoaDonToken_TaiXmlChuaKy») [?: chưa đo trên máy chủ thật].
      const b = tim();
      if (!b) return json({ maketqua: "11", motaketqua: "Không tìm thấy thông tin hóa đơn" });
      if (b.daKy) return json({ maketqua: "51", motaketqua: "Lỗi phát sinh trong quá trình ký" });
      soPhien += 1;
      const maPhien = `PHIEN${String(soPhien).padStart(4, "0")}`;
      phienConSong.set(maPhien, b.maGiaoDich);
      return json({ maketqua: "01", motaketqua: "Thành công", maphiengiaodich: maPhien, base64xml: boNho(xmlChuaKyGia(b)) });
    }
    if (duong === "/XuLyHoaDon/KyHoaDonToken_GuiXmlDaKy") {
      const b = tim();
      if (!b) return json({ maketqua: "11", motaketqua: "Không tìm thấy thông tin hóa đơn" });
      const maPhien = typeof body["maphiengiaodich"] === "string" ? body["maphiengiaodich"] : "";
      const xml = Buffer.from(typeof body["base64xml"] === "string" ? body["base64xml"] : "", "base64").toString("utf8");
      // Phiên lạ / hết hạn / XML chưa có chữ ký ⇒ 51 [?: mã thật chưa đo].
      if (!maPhien || phienConSong.get(maPhien) !== b.maGiaoDich || !/<(?:ds:)?Signature[\s>]/.test(xml)) {
        return json({ maketqua: "51", motaketqua: "Lỗi phát sinh trong quá trình ký" });
      }
      if (kichBan === "TIMEOUT_CHUA_GHI") throw loiHuy();
      if (b.daKy) return json({ maketqua: "03", motaketqua: "Trùng hóa đơn" });
      seq += 1;
      b.daKy = true;
      b.soHoaDon = String(seq).padStart(7, "0");
      phienConSong.delete(maPhien);
      if (kichBan === "TIMEOUT_DA_GHI") throw loiHuy();
      return json({
        maketqua: "01",
        motaketqua: "Thành công",
        mauso: b.mauSo,
        kyhieu: b.kyHieu,
        sohoadon: b.soHoaDon,
        trangthai: "3",
        ngayky: NGAY_KY_VIN_GIA,
        loaihoadon: "1",
        chuyendoi: "0",
        magiaodich: b.maGiaoDich,
      });
    }

    if (duong === "/TraCuuHoaDon/TraThongTinHoaDon") {
      const b = tim();
      if (!b) return json({ maketqua: "11", motaketqua: "Không tìm thấy thông tin hóa đơn" });
      return json({
        maketqua: "01",
        motaketqua: "Thành công",
        mahoadon: b.maHoaDon,
        mauso: b.mauSo,
        kyhieu: b.kyHieu,
        sohoadon: b.soHoaDon,
        ngaylap: b.ngayLap,
        trangthai: b.daKy ? "3" : "0",
        ngayky: b.daKy ? NGAY_KY_VIN_GIA : "",
        loaihoadon: "1",
        chuyendoi: "0",
        magiaodich: b.maGiaoDich,
        trangthaicqt: 0,
      });
    }
    if (duong === "/TraCuuHoaDon/TaiHoaDonPdfKhongCanThueDuyet") {
      const b = tim();
      if (!b || !b.daKy) return json({ maketqua: "11", motaketqua: "Không tìm thấy thông tin hóa đơn" });
      return json({ maketqua: "01", motaketqua: "Thành công", base64pdf: Buffer.from(pdfMoPhong(b.maGiaoDich)).toString("base64") });
    }
    if (duong === "/TraCuuHoaDon/TaiXmlDaKy") {
      const b = tim();
      if (!b || !b.daKy) return json({ maketqua: "11", motaketqua: "Không tìm thấy thông tin hóa đơn" });
      return json({ maketqua: "01", motaketqua: "Thành công", base64xml: boNho(Buffer.from(xmlMoPhong(b.maGiaoDich)).toString("utf8")) });
    }
    return json({ error: "NotFound" }, 404);
  };

  return {
    fetchImpl,
    datKichBan(k) {
      kichBan = k;
    },
    daGhi,
    cuocGoi,
    epMotLan(duong, phanHoi) {
      ep.set(duong, phanHoi);
    },
  };
}
