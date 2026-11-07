// lib/security/hop-bi-mat.ts — HỘP BÍ MẬT: mã hoá đối xứng AES-256-GCM cho bí mật do NGƯỜI DÙNG nhập trên màn hình
// (mật khẩu tài khoản nhà cung cấp hoá đơn, Invoice Hub — chủ dự án duyệt phương án (b) ngày 03/11/2026).
//
// THUẦN: không đọc env, không DB, không đồng hồ. Khoá gốc được TRUYỀN VÀO (nơi đọc env là lớp mỏng riêng, để test không phụ thuộc môi trường).
// Không `import "server-only"` để chạy được dưới tsx/vitest; chỉ `node:crypto`.
//
// Quy ước:
//  · Chuỗi lưu: `v1.<mã khoá>.<iv>.<ciphertext>.<tag>` (base64url). Mã khoá = dấu vân tay của khoá gốc (dẫn xuất HKDF, KHÔNG phải băm trần)
//    ⇒ xoay khoá được: giải mã chọn đúng khoá theo mã, mã hoá mới luôn dùng khoá hiện hành.
//  · Khoá AES = HKDF-SHA256(khoá gốc, info = mục đích) ⇒ khoá của mục đích này không dùng được cho mục đích khác.
//  · AAD = `mục đích | ngữ cảnh` (ngữ cảnh là id dòng) ⇒ chép chuỗi mã hoá từ dòng A sang dòng B thì KHÔNG giải được.
//  · IV 12 byte ngẫu nhiên MỖI lần mã hoá. Không bao giờ dùng lại IV với cùng khoá.
//  · Lỗi mang MÃ cố định, thông điệp cố định: không bao giờ chứa bản rõ, khoá gốc hay chuỗi mã hoá (Nền #9).
//  · Mọi thất bại giải mã gộp một mã `GIAI_MA_THAT_BAI` — không tiết lộ phần nào sai (chống oracle).

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** Cùng ngưỡng `lib/security/signing-key.ts`. */
export const DO_DAI_KHOA_GOC_TOI_THIEU = 32;

const PHIEN_BAN = "v1";
const SALT = Buffer.from("satarobo.hop-bi-mat.v1", "utf8");
const DO_DAI_IV = 12;
const DO_DAI_TAG = 16;

export type MaLoiHopBiMat = "KHOA_THIEU" | "BAN_RO_RONG" | "DINH_DANG" | "KHONG_CO_KHOA" | "GIAI_MA_THAT_BAI";

const THONG_DIEP: Record<MaLoiHopBiMat, string> = {
  KHOA_THIEU: "Khoá mã hoá bí mật chưa đặt hoặc ngắn hơn mức tối thiểu.",
  BAN_RO_RONG: "Bí mật cần mã hoá không được rỗng.",
  DINH_DANG: "Chuỗi bí mật đã mã hoá sai khuôn.",
  KHONG_CO_KHOA: "Không có khoá nào khớp với chuỗi bí mật đã mã hoá (khoá đã đổi hoặc chưa khai khoá cũ).",
  GIAI_MA_THAT_BAI: "Giải mã bí mật thất bại.",
};

export class LoiHopBiMat extends Error {
  constructor(readonly ma: MaLoiHopBiMat) {
    super(THONG_DIEP[ma]);
    this.name = "LoiHopBiMat";
  }
}

export type TuyChonMaHoa = {
  /** Khoá gốc (env), ≥ 32 ký tự. */
  khoaGoc: string;
  /** Mục đích dùng khoá, vd `hoa-don.ket-noi`. */
  mucDich: string;
  /** Ngữ cảnh buộc vào chuỗi mã hoá, vd `ketnoi:<id>`. */
  nguCanh: string;
};

export type TuyChonGiaiMa = {
  /** Danh sách khoá gốc: khoá HIỆN HÀNH đứng đầu, kèm khoá cũ khi đang xoay khoá. */
  cacKhoaGoc: readonly string[];
  mucDich: string;
  nguCanh: string;
};

const laKhoaHopLe = (k: unknown): k is string => typeof k === "string" && k.length >= DO_DAI_KHOA_GOC_TOI_THIEU;

function dayKhoa(khoaGoc: string, mucDich: string, nhan: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(khoaGoc, "utf8"), SALT, Buffer.from(`${nhan}:${mucDich}`, "utf8"), 32));
}

/** Dấu vân tay 8 ký tự hex của khoá gốc — dẫn xuất HKDF (không phải băm trần), chỉ để chọn khoá khi giải mã. */
export function maKhoaGoc(khoaGoc: string): string {
  if (!laKhoaHopLe(khoaGoc)) throw new LoiHopBiMat("KHOA_THIEU");
  return Buffer.from(hkdfSync("sha256", Buffer.from(khoaGoc, "utf8"), SALT, Buffer.from("kid", "utf8"), 4)).toString("hex");
}

const aad = (mucDich: string, nguCanh: string): Buffer => Buffer.from(`${mucDich}|${nguCanh}`, "utf8");
const B64URL = /^[A-Za-z0-9_-]+$/;

export function maHoaBiMat(banRo: string, tuyChon: TuyChonMaHoa): string {
  if (!laKhoaHopLe(tuyChon.khoaGoc)) throw new LoiHopBiMat("KHOA_THIEU");
  if (typeof banRo !== "string" || banRo.length === 0) throw new LoiHopBiMat("BAN_RO_RONG");
  const iv = randomBytes(DO_DAI_IV);
  const cipher = createCipheriv("aes-256-gcm", dayKhoa(tuyChon.khoaGoc, tuyChon.mucDich, "key"), iv);
  cipher.setAAD(aad(tuyChon.mucDich, tuyChon.nguCanh));
  const ct = Buffer.concat([cipher.update(banRo, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PHIEN_BAN, maKhoaGoc(tuyChon.khoaGoc), iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

type ChuoiTach = { kid: string; iv: Buffer; ct: Buffer; tag: Buffer };

function tach(chuoi: unknown): ChuoiTach | null {
  if (typeof chuoi !== "string") return null;
  const p = chuoi.split(".");
  if (p.length !== 5 || p[0] !== PHIEN_BAN) return null;
  const [, kid, iv, ct, tag] = p as [string, string, string, string, string];
  if (!/^[0-9a-f]{8}$/.test(kid) || !B64URL.test(iv) || !B64URL.test(ct) || !B64URL.test(tag)) return null;
  const ivB = Buffer.from(iv, "base64url");
  const tagB = Buffer.from(tag, "base64url");
  if (ivB.length !== DO_DAI_IV || tagB.length !== DO_DAI_TAG) return null;
  return { kid, iv: ivB, ct: Buffer.from(ct, "base64url"), tag: tagB };
}

/** Chuỗi có đúng khuôn của hộp bí mật không (KHÔNG kiểm giải mã được). */
export const laChuoiBiMatHopLe = (chuoi: unknown): boolean => tach(chuoi) !== null;

export function giaiMaBiMat(chuoi: string, tuyChon: TuyChonGiaiMa): string {
  const t = tach(chuoi);
  if (!t) throw new LoiHopBiMat("DINH_DANG");
  const khoa = tuyChon.cacKhoaGoc.find((k) => laKhoaHopLe(k) && maKhoaGoc(k) === t.kid);
  if (khoa === undefined) throw new LoiHopBiMat("KHONG_CO_KHOA");
  try {
    const decipher = createDecipheriv("aes-256-gcm", dayKhoa(khoa, tuyChon.mucDich, "key"), t.iv);
    decipher.setAAD(aad(tuyChon.mucDich, tuyChon.nguCanh));
    decipher.setAuthTag(t.tag);
    return Buffer.concat([decipher.update(t.ct), decipher.final()]).toString("utf8");
  } catch {
    // Cố ý nuốt lỗi gốc: thông điệp của Node có thể gợi ý phần nào sai.
    throw new LoiHopBiMat("GIAI_MA_THAT_BAI");
  }
}
