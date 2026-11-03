// lib/finance/hoa-don/lenh-ky-bo-ky.ts — GIAO DIỆN BỘ KÝ (nhà ký) của Signature Engine (Invoice Hub S9). THUẦN: không DB, không mạng, KHÔNG ký thật.
//
// Hệ thống này KHÔNG giữ PIN, khoá riêng hay chứng thư: nó chỉ đưa cho bộ ký MỘT chuỗi hash (SHA-256 hex) của dữ liệu cần ký và nhận lại mã giao dịch +
// hạn chứng thư. Bộ ký thật (HSM nhà cung cấp, USB token, ký từ xa) là việc của đợt sau; ở đây chỉ có hợp đồng + bộ chuẩn hoá kết quả.
//
// Năng lực: tái dùng KIỂU `KhaiNangLuc` của `nha-cung-cap/nang-luc.ts` (TD-05: `providerSupports` ≠ `adapterImplements`), KHÔNG thêm mục vào `NANG_LUC`
// (danh sách đó là của adapter hoá đơn; cần thêm "KY" thì lead sửa). Engine chỉ tin `duocPhepKy` — đọc `providerSupports` để hiện nút là hứa suông.

import { createHash } from "node:crypto";
import type { KhaiNangLuc } from "./nha-cung-cap/nang-luc";

export type KetQuaKy =
  | { ok: true; maGiaoDich: string; /** Hạn chứng thư số, dạng YYYY-MM-DD (cột `@db.Date`). */ chungThuHetHan: string }
  | { ok: false; ma: string; thongDiepNgan: string };

export interface BoKy {
  readonly nangLuc: Readonly<KhaiNangLuc>;
  /** Chỉ nhận hash (SHA-256 hex). Bộ ký thật không bao giờ được nhận dữ liệu thô / PIN từ hệ thống này. */
  ky(duLieuCanKyHash: string): Promise<KetQuaKy>;
}

const HASH_HEX_64 = /^[0-9a-f]{64}$/;

/** Hash dữ liệu cần ký — thứ DUY NHẤT được lưu và đưa cho bộ ký. */
export function bamDuLieuCanKy(duLieu: string): string {
  return createHash("sha256").update(duLieu, "utf8").digest("hex");
}

export const laHashHopLe = (s: string): boolean => HASH_HEX_64.test(s);

/** Được phép gọi bộ ký này không: chỉ khi nhà ký CÓ hỗ trợ ∧ adapter của hệ thống ĐÃ nối. Khai bậy (adapter nối mà nhà ký không có) ⇒ false. */
export function duocPhepKy(bo: Pick<BoKy, "nangLuc">): boolean {
  return bo.nangLuc.adapterImplements === true && bo.nangLuc.providerSupports === "CO";
}

// ── Mã lỗi của hệ thống (liệt kê hữu hạn) + lý do CỐ ĐỊNH ────────────────────
// Thông điệp của nhà ký / lỗi ném KHÔNG bao giờ được lưu hay trả ra: chúng có thể mang PIN, tên người, dữ liệu chứng thư. Chỉ mã trong danh sách này đi qua.

const LY_DO_LOI_KY = {
  TU_CHOI: "Bộ ký từ chối lệnh ký.",
  CHUNG_THU_HET_HAN: "Chứng thư số đã hết hạn.",
  KHONG_KET_NOI: "Không kết nối được bộ ký.",
  QUA_THOI_GIAN: "Bộ ký không trả lời kịp.",
  NGUOI_DUNG_HUY: "Người ký đã huỷ thao tác ký.",
  NEM_LOI: "Bộ ký gặp lỗi (chi tiết chỉ nằm ở nhật ký máy chủ).",
  PHAN_HOI_KHONG_HOP_LE: "Bộ ký trả kết quả không đúng khuôn.",
  KHONG_RO: "Bộ ký báo lỗi không rõ nguyên nhân.",
} as const;

export type MaLoiKy = keyof typeof LY_DO_LOI_KY;
export const MA_LOI_KY = Object.keys(LY_DO_LOI_KY) as MaLoiKy[];
const laMaLoiKy = (s: unknown): s is MaLoiKy => typeof s === "string" && Object.hasOwn(LY_DO_LOI_KY, s);

/** Chuỗi lưu vào `lyDo` của lệnh LOI_KY: "MÃ — lý do cố định". Không chứa gì động. */
export function lyDoLoiKy(ma: MaLoiKy): string {
  return `${ma} — ${LY_DO_LOI_KY[ma]}`;
}

export type KetQuaKyDaChuanHoa = { ok: true; maGiaoDich: string; chungThuHetHan: string } | { ok: false; ma: MaLoiKy };

const MA_GIAO_DICH = /^[A-Za-z0-9._:-]{1,100}$/;
const NGAY_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function laNgayThat(s: string): boolean {
  const m = NGAY_ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Không tin nguyên văn kết quả của bộ ký: kiểm khuôn, mã lỗi lạ ⇒ KHONG_RO, thông điệp ngắn của nhà ký bị bỏ. Không bao giờ ném. */
export function chuanHoaKetQuaKy(raw: unknown): KetQuaKyDaChuanHoa {
  if (!raw || typeof raw !== "object") return { ok: false, ma: "PHAN_HOI_KHONG_HOP_LE" };
  const r = raw as { ok?: unknown; maGiaoDich?: unknown; chungThuHetHan?: unknown; ma?: unknown };
  if (r.ok === true) {
    if (typeof r.maGiaoDich !== "string" || !MA_GIAO_DICH.test(r.maGiaoDich)) return { ok: false, ma: "PHAN_HOI_KHONG_HOP_LE" };
    if (typeof r.chungThuHetHan !== "string" || !laNgayThat(r.chungThuHetHan)) return { ok: false, ma: "PHAN_HOI_KHONG_HOP_LE" };
    return { ok: true, maGiaoDich: r.maGiaoDich, chungThuHetHan: r.chungThuHetHan };
  }
  if (r.ok === false) return { ok: false, ma: laMaLoiKy(r.ma) ? r.ma : "KHONG_RO" };
  return { ok: false, ma: "PHAN_HOI_KHONG_HOP_LE" };
}
