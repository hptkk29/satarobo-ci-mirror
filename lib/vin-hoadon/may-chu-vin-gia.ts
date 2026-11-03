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

export function taoMayChuVinGia(kichBanDau: KichBanVinGia = "THANH_CONG"): MayChuVinGia {
  let kichBan = kichBanDau;
  let seq = 0;
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
      // BODY PHẲNG như máy chủ thật. Body bọc kiểu {"hoadon": {…}} ⇒ máy chủ thật KHÔNG thấy trường nào và trả 08 «không được để trống»
      // (HTTP 200, bọc ABP) — bắt chước đúng để test đỏ nếu mã quay lại gửi body bọc.
      const hd = body;
      if (typeof hd["ma_hoadon"] !== "string" || typeof hd["mauso"] !== "string" || typeof hd["kyhieu"] !== "string") {
        return json({
          result: { maketqua: "08", motaketqua: "Dữ liệu hóa đơn không hợp lệ(Mã hóa đơn không được để trống.Mẫu số không được để trống.Ký hiệu không được để trống.)", magiaodich: null },
          targetUrl: null,
          success: true,
          error: null,
          unAuthorizedRequest: false,
          __abp: true,
        });
      }
      const maHoaDon = hd["ma_hoadon"];
      if (daGhi.has(maHoaDon)) return json({ maketqua: "03", motaketqua: "Trùng hóa đơn" });
      if (kichBan === "TIMEOUT_CHUA_GHI") throw loiHuy();
      seq += 1;
      const ban: BanGhi = {
        maHoaDon,
        maGiaoDich: `GD${String(seq).padStart(6, "0")}${maHoaDon.length}`,
        soHoaDon: String(seq).padStart(7, "0"),
        mauSo: hd["mauso"],
        kyHieu: hd["kyhieu"],
        ngayLap: String(hd["ngaylap"] ?? ""),
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

    const tim = (): BanGhi | null => {
      const gd = typeof body["magiaodich"] === "string" && body["magiaodich"] ? body["magiaodich"] : null;
      const ma = typeof body["ma_hoadon"] === "string" && body["ma_hoadon"] ? body["ma_hoadon"] : null;
      for (const b of daGhi.values()) {
        if ((gd && b.maGiaoDich === gd) || (!gd && ma && b.maHoaDon === ma)) return b;
      }
      return null;
    };

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
        trangthai: "3",
        ngayky: NGAY_KY_VIN_GIA,
        loaihoadon: "1",
        chuyendoi: "0",
        magiaodich: b.maGiaoDich,
        trangthaicqt: 0,
      });
    }
    if (duong === "/TraCuuHoaDon/TaiHoaDonPdfKhongCanThueDuyet") {
      const b = tim();
      if (!b) return json({ maketqua: "11", motaketqua: "Không tìm thấy thông tin hóa đơn" });
      return json({ maketqua: "01", motaketqua: "Thành công", base64pdf: Buffer.from(pdfMoPhong(b.maGiaoDich)).toString("base64") });
    }
    if (duong === "/TraCuuHoaDon/TaiXmlDaKy") {
      const b = tim();
      if (!b) return json({ maketqua: "11", motaketqua: "Không tìm thấy thông tin hóa đơn" });
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
