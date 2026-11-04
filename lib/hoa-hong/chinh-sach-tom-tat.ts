// lib/hoa-hong/chinh-sach-tom-tat.ts — TÓM TẮT một chính sách cho MỘT dòng bảng (06 §5.2). THUẦN.
//
// Dòng bảng nói về CHÍNH SÁCH, mà chính sách có nhiều phiên bản: phải chọn đúng phiên bản "hiện hành" để đại diện, và gộp
// tỉ lệ theo loại giao dịch (không in từng rule — một chính sách 5 vai × 2 loại là 10 con số, đọc không ra).
import type { TrangThaiPhienBan } from "./chon-quy-tac";
import { microSangPhanTram } from "./phan-tram";
import { tiLeSangMicro } from "./tien";

/** Phần tối thiểu để chọn phiên bản đại diện — dòng DB (khoá `id`) lẫn kiểu thuần (khoá `versionId`) đều thoả. */
export type PhienBanChon = {
  versionNo: number;
  status: TrangThaiPhienBan;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};
export type PhienBanTomTat = PhienBanChon & { versionId: string };

/**
 * Phiên bản đại diện cho chính sách. Thứ tự ưu tiên (luật): đang áp dụng → chờ hiệu lực → nháp mới nhất → bản cũ mới nhất →
 * đã huỷ. "Đang áp dụng" tính theo NGÀY (ACTIVE đã quá `effectiveTo` mà chưa ai đóng không còn đang áp dụng).
 */
export function chonPhienBanHienHanh<T extends PhienBanChon>(versions: readonly T[], now: Date): T | null {
  const t = now.getTime();
  const moiNhat = (xs: T[]): T | null => xs.reduce<T | null>((a, b) => (a === null || b.versionNo > a.versionNo ? b : a), null);

  const active = versions.filter((x) => x.status === "ACTIVE");
  const dang = active.filter((x) => x.effectiveFrom.getTime() <= t && (x.effectiveTo === null || x.effectiveTo.getTime() > t));
  if (dang.length > 0) return moiNhat(dang);
  const cho = active.filter((x) => x.effectiveFrom.getTime() > t);
  if (cho.length > 0) return moiNhat(cho);
  const nhap = versions.filter((x) => x.status === "DRAFT");
  if (nhap.length > 0) return moiNhat(nhap);
  const cu = versions.filter((x) => x.status !== "CANCELLED");
  if (cu.length > 0) return moiNhat(cu);
  return moiNhat([...versions]);
}

export type TomTatTiLe = { loai: string; tongPhanTram: string; khongTinDuoc: boolean };

/** Tổng tỉ lệ PERCENT theo loại giao dịch (NEW trước RENEWAL), bằng số nguyên micro. FIXED/TIER ⇒ `khongTinDuoc`. */
export function tomTatTiLe(rules: readonly { transactionTypeCode: string; calcKind: string; rate: string | null }[]): TomTatTiLe[] {
  const tong = new Map<string, { micro: bigint; khongTin: boolean }>();
  for (const r of rules) {
    const o = tong.get(r.transactionTypeCode) ?? { micro: BigInt(0), khongTin: false };
    if (r.calcKind === "PERCENT" && r.rate !== null) o.micro += tiLeSangMicro(r.rate);
    else if (r.calcKind !== "EXCLUDE") o.khongTin = true;
    tong.set(r.transactionTypeCode, o);
  }
  const thuTu = ["NEW", "RENEWAL"];
  return [...tong.entries()]
    .sort((a, b) => (thuTu.indexOf(a[0]) + 1 || 99) - (thuTu.indexOf(b[0]) + 1 || 99))
    .map(([loai, o]) => ({ loai, tongPhanTram: microSangPhanTram(o.micro), khongTinDuoc: o.khongTin }));
}

export const TRANG_THAI_LOC = ["dang-ap-dung", "cho-hieu-luc", "nhap", "het-hieu-luc"] as const;
export type TrangThaiLoc = (typeof TRANG_THAI_LOC)[number];

const KHOA_CUA_LOC: Record<TrangThaiLoc, string> = {
  "dang-ap-dung": "DANG_AP_DUNG",
  "cho-hieu-luc": "CHO_HIEU_LUC",
  nhap: "NHAP",
  "het-hieu-luc": "HET_HIEU_LUC",
};

/** Lọc theo URL. `nhap` lấy cả chính sách đang áp dụng mà đang có bản nháp kèm theo (việc dang dở). */
export function locChinhSach<T extends { khoa: string; vai: readonly { code: string }[]; /** Có bản nháp kèm theo (null = không). */ coBanNhap: unknown }>(
  dong: readonly T[],
  loc: { trangThai: TrangThaiLoc | null; vai: string | null },
): T[] {
  return dong.filter((d) => {
    if (loc.vai !== null && !d.vai.some((v) => v.code === loc.vai)) return false;
    if (loc.trangThai === null) return true;
    if (loc.trangThai === "nhap") return d.khoa === "NHAP" || !!d.coBanNhap;
    return d.khoa === KHOA_CUA_LOC[loc.trangThai];
  });
}
