// lib/vin-hoadon/ky-usb.ts — ký bằng USB token với VIN-HOADON: HAI PHA, phần THUẦN (đọc phản hồi, so XML, hạn phiên).
//
// Luồng (hub/13 §4):
//   1. LapHoaDonGoc              → lưu NHÁP, ra `magiaodich`              (đo thật 03/11/2026: 01 + trangthai "0")
//   2. XuLyHoaDon/TaiXmlChuaKy   → XML TT78 chưa ký + `maphiengiaodich`   (sống 30 phút) [?: PDF ghi «KyHoaDonToken_TaiXmlChuaKy»; lấy theo bộ Postman v11]
//   3. (máy kế toán, Windows)    → ký XML bằng chứng thư trong kho Windows; PIN do driver token hỏi — KHÔNG đi qua máy chủ này
//   4. XuLyHoaDon/KyHoaDonToken_GuiXmlDaKy → gửi XML đã ký + `maphiengiaodich`
//
// ⚠️ CHƯA đo trên máy chủ thật (cần token + tài khoản VIN có chứng thư): mã thành công của bước 2 và 4, mã khi phiên hết hạn,
//   định dạng XML VIN chấp nhận. Mã dưới đây nhận cả `01` lẫn `31` ở bước 4 (như phát hành) và coi mọi mã lạ là KHÔNG_RÕ.
// ⚠️ Chưa-biết ⇒ KHÔNG_RÕ, không bao giờ gửi lại mù. Riêng bước 2 (tải XML) không tạo hoá đơn nên lỗi ở đó chỉ là LOI.

import { X509Certificate } from "node:crypto";
import type { KetQuaPhatHanh, PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import { chuanHoaMa, docDoiTuong, laMaTrungVin, laMaTuChoiChacChanVin, moTaMa } from "./anh-xa";

export type KetQuaLuuNhapVin =
  | { loai: "DA_LUU"; maGiaoDich: string }
  | { loai: "TU_CHOI"; ma: string; thongDiep: string }
  | { loai: "KHONG_RO"; thongDiep: string };

export type KetQuaTaiXmlChuaKy =
  | { loai: "OK"; xmlBase64: string; maPhien: string }
  | { loai: "LOI"; ma: string; thongDiep: string };

/** Ba kết quả CHUNG với phát hành: DA_PHAT_HANH / TU_CHOI / KHONG_RO. */
export type KetQuaGuiXmlDaKy = KetQuaPhatHanh;

export type DauVaoGuiXmlDaKy = {
  phieu: Pick<PhieuPhatHanh, "refId" | "kyHieu" | "ngayHoaDon" | "mstNguoiBan">;
  maGiaoDich: string;
  maPhien: string;
  xmlChuaKyBase64: string;
  xmlDaKyBase64: string;
};

export interface KyUsbVin {
  /** Lưu NHÁP (không ký). Gửi lại cùng `refId` an toàn: VIN báo trùng ⇒ tự tra cứu lấy đúng `magiaodich` cũ. */
  luuNhap(phieu: PhieuPhatHanh): Promise<KetQuaLuuNhapVin>;
  /** Tải XML chưa ký + mở phiên ký 30 phút. Không tạo hoá đơn ⇒ lỗi ở đây chỉ là LOI, được phép thử lại (mỗi lần là một phiên mới). */
  taiXmlChuaKy(a: { mstNguoiBan: string; refId: string; maGiaoDich: string }): Promise<KetQuaTaiXmlChuaKy>;
  /** Gửi XML đã ký. Tự kiểm XML TRƯỚC khi gửi; sau khi gửi, mọi điều không chắc là KHONG_RO (không gửi lại). */
  guiXmlDaKy(a: DauVaoGuiXmlDaKy): Promise<KetQuaGuiXmlDaKy>;
}

// ─── Hạn phiên ────────────────────────────────────────────────────────────────────────────────────

/** `maphiengiaodich` hiệu lực 30 phút (PDF v13) [?: chưa đo hạn thật]. */
export const HAN_PHIEN_KY_USB_MS = 30 * 60 * 1000;
/** Chừa thời gian cho kế toán nhập PIN và cho mạng: phiên còn dưới ngần này thì coi như hết. */
export const BIEN_AN_TOAN_PHIEN_MS = 2 * 60 * 1000;

/** Phiên còn dùng được không. Đồng hồ lùi (lấy phiên "trong tương lai") ⇒ không tin (fail-closed). */
export function phienConDungDuoc(layLuc: Date, now: Date): boolean {
  const troi = now.getTime() - layLuc.getTime();
  return troi >= 0 && troi < HAN_PHIEN_KY_USB_MS - BIEN_AN_TOAN_PHIEN_MS;
}

// ─── Đọc phản hồi ──────────────────────────────────────────────────────────────────────────────────

const chuoi = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

export function docPhanHoiLuuNhap(body: unknown): KetQuaLuuNhapVin | { loai: "TRUNG"; thongDiep: string } {
  const o = docDoiTuong(body);
  if (!o) return { loai: "KHONG_RO", thongDiep: "VIN trả phản hồi lưu nháp không đọc được — chưa rõ đã lưu hay chưa, cần tra cứu." };
  const ma = chuanHoaMa(o["maketqua"]);
  if (ma === "01") {
    const maGiaoDich = chuoi(o["magiaodich"]);
    if (maGiaoDich) return { loai: "DA_LUU", maGiaoDich };
    return { loai: "KHONG_RO", thongDiep: "VIN báo lưu nháp thành công nhưng không trả mã giao dịch — cần tra cứu." };
  }
  if (laMaTrungVin(ma)) return { loai: "TRUNG", thongDiep: `VIN báo ${moTaMa(ma)}.` };
  if (laMaTuChoiChacChanVin(ma)) return { loai: "TU_CHOI", ma: `VIN_${ma}`, thongDiep: `VIN từ chối: ${moTaMa(ma)}.` };
  return { loai: "KHONG_RO", thongDiep: `VIN trả ${moTaMa(ma)} — chưa rõ đã lưu nháp hay chưa, cần tra cứu.` };
}

/**
 * Bản nháp đã có (sau "trùng") — lấy lại `magiaodich`. CHỈ nhận bản CHƯA ký: đã ký rồi thì không phải việc của luồng lưu nháp.
 */
export function docPhanHoiTraCuuNhap(body: unknown, refId: string): { loai: "NHAP"; maGiaoDich: string } | { loai: "KHONG"; thongDiep: string } {
  const o = docDoiTuong(body);
  if (!o) return { loai: "KHONG", thongDiep: "Tra cứu VIN không đọc được." };
  const ma = chuanHoaMa(o["maketqua"]);
  if (ma !== "01") return { loai: "KHONG", thongDiep: `Tra cứu VIN trả ${moTaMa(ma)}.` };
  const maHoaDon = chuoi(o["mahoadon"]);
  if (maHoaDon && maHoaDon !== refId.trim()) return { loai: "KHONG", thongDiep: "Tra cứu VIN trả hoá đơn mang khoá khác khoá đã hỏi." };
  const trangThai = chuoi(o["trangthai"]);
  if (trangThai === "3" || chuoi(o["sohoadon"])) return { loai: "KHONG", thongDiep: "VIN đã có hoá đơn đã ký mang khoá này — không lưu nháp lại." };
  const maGiaoDich = chuoi(o["magiaodich"]);
  if (!maGiaoDich) return { loai: "KHONG", thongDiep: "Tra cứu VIN thiếu mã giao dịch của bản nháp." };
  return { loai: "NHAP", maGiaoDich };
}

/** Dấu BOM UTF-8 (viết bằng mã để không nhúng ký tự vô hình vào mã nguồn). */
const BOM = String.fromCharCode(0xfeff);
const boBom = (s: string): string => (s.startsWith(BOM) ? s.slice(1) : s);
const moDauXml = (s: string): boolean => boBom(s).trimStart().startsWith("<");

/** Giải base64 → chuỗi; không phải base64 hợp lệ ⇒ null. */
function giaiB64(b64: unknown): string | null {
  if (typeof b64 !== "string" || !b64.trim() || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return null;
  const s = Buffer.from(b64, "base64").toString("utf8");
  return s.trim() ? s : null;
}

export function docPhanHoiTaiXmlChuaKy(body: unknown): KetQuaTaiXmlChuaKy {
  const o = docDoiTuong(body);
  if (!o) return { loai: "LOI", ma: "VIN_KHONG_DOC_DUOC", thongDiep: "VIN trả phản hồi tải XML chưa ký không đọc được." };
  const ma = chuanHoaMa(o["maketqua"]);
  if (ma !== "01") return { loai: "LOI", ma: `VIN_${ma || "TRONG"}`, thongDiep: `VIN từ chối tải XML chưa ký: ${moTaMa(ma)}.` };
  const maPhien = chuoi(o["maphiengiaodich"]);
  if (!maPhien) return { loai: "LOI", ma: "VIN_THIEU_PHIEN", thongDiep: "VIN trả XML nhưng không có mã phiên giao dịch — không ký được." };
  const xml = giaiB64(o["base64xml"]);
  if (!xml || !moDauXml(xml)) return { loai: "LOI", ma: "VIN_XML_HONG", thongDiep: "VIN trả XML chưa ký rỗng hoặc không phải XML." };
  return { loai: "OK", xmlBase64: chuoi(o["base64xml"]), maPhien };
}

// ─── So XML đã ký với XML chưa ký ──────────────────────────────────────────────────────────────────

const KHOI_CHU_KY = /<((?:[\w.-]+:)?Signature)\b[\s\S]*?<\/\1\s*>/g;

/** Bỏ khối chữ ký, khai báo xml, khoảng trắng giữa thẻ; thẻ tự đóng `<a/>` → `<a></a>` — để so NỘI DUNG chứ không so cách trình bày. */
function chuanHoaNoiDung(xml: string): string {
  return boBom(xml)
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(KHOI_CHU_KY, "")
    .replace(/<([\w:.-]+)((?:\s[^<>]*?)?)\s*\/>/g, "<$1$2></$1>")
    .replace(/>\s+</g, "><")
    .trim();
}

/**
 * XML đã ký có phải đúng XML đã tải, thêm chữ ký không. Trả `null` nếu ổn, ngược lại là câu lý do (không chứa nội dung XML).
 * ⚠️ So theo NỘI DUNG đã chuẩn hoá, không so từng byte: bộ ký của VIN có thể xuống dòng/đổi khai báo. [?: chưa đo bộ ký thật.]
 */
export function kiemXmlDaKy(xmlChuaKyBase64: string, xmlDaKyBase64: string): string | null {
  const chua = giaiB64(xmlChuaKyBase64);
  if (!chua || !moDauXml(chua)) return "Không có XML chưa ký hợp lệ để đối chiếu.";
  const da = giaiB64(xmlDaKyBase64);
  if (!da || !moDauXml(da)) return "XML đã ký rỗng hoặc không phải XML.";
  const khoi = da.match(KHOI_CHU_KY);
  const coChuKy = (khoi ?? []).some((k) => /<(?:[\w.-]+:)?SignatureValue\b[^>]*>\s*[^<\s][^<]*<\/(?:[\w.-]+:)?SignatureValue\s*>/.test(k));
  if (!coChuKy) return "XML đã ký chưa có chữ ký số (khối Signature trống hoặc không có).";
  if (chuanHoaNoiDung(chua) !== chuanHoaNoiDung(da)) return "Nội dung XML đã ký khác XML đã tải — có thể bị sửa sau khi tải.";
  return null;
}


// ─── Chứng thư THỰC TẾ trong chữ ký (BGĐ 04/11/2026: «không thể dùng nhầm chứng thư HO, CS1 hay CS2») ───────────────────────────────────

export type ChungThuTrongXml = { serial: string; hetHan: string };

/**
 * Chứng thư đã DÙNG để ký, đọc từ khối `X509Certificate` trong chữ ký của XML đã ký: số serial (hex HOA, bỏ số 0 đầu) + ngày hết hạn (YYYY-MM-DD, UTC).
 * `null` nếu XML không mang chứng thư đọc được (người gọi coi là KHÔNG ĐẠT — chữ ký không nói được ai ký thì không biết có đúng chứng thư không).
 * ⚠️ Chỉ ĐỌC chứng thư; KHÔNG kiểm chữ ký mật mã (VIN kiểm khi nhận). Không nhận mật khẩu / khoá riêng — chứng thư là thông tin công khai trong chính XML.
 */
export function docChungThuTuXmlDaKy(xmlDaKyBase64: string): ChungThuTrongXml | null {
  const xml = giaiB64(xmlDaKyBase64);
  if (!xml) return null;
  const m = xml.match(/<(?:[\w.-]+:)?X509Certificate\b[^>]*>\s*([A-Za-z0-9+/=\s]+?)\s*<\/(?:[\w.-]+:)?X509Certificate\s*>/);
  if (!m?.[1]) return null;
  try {
    const c = new X509Certificate(Buffer.from(m[1].replace(/\s+/g, ""), "base64"));
    const han = new Date(c.validTo);
    if (Number.isNaN(han.getTime())) return null;
    return { serial: chuanHoaSerial(c.serialNumber), hetHan: han.toISOString().slice(0, 10) };
  } catch {
    return null;
  }
}

/** Serial dạng hex: chỉ giữ 0-9A-F, HOA, bỏ số 0 đầu — «01:A2», «01a2», «1A2» là MỘT chứng thư. */
export function chuanHoaSerial(s: string): string {
  const hex = s.replace(/[^0-9A-Fa-f]/g, "").toUpperCase().replace(/^0+/, "");
  return hex === "" ? "0" : hex;
}

export const cungSerial = (a: string, b: string): boolean => chuanHoaSerial(a) === chuanHoaSerial(b);
