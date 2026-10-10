/**
 * lib/nguon/kiem-nguon.ts — CỔNG chọn nguồn bằng tay: giải trình nhóm 11, người giới thiệu nhóm ✅ (03 §2.8, §9). THUẦN.
 *
 * Hành vi đi theo THUỘC TÍNH của nhóm (`requiresNote`, `referrerRequirement`), không theo mã (03 T3): danh mục mở.
 * Trả `string | null` — null là hợp lệ, chuỗi là câu lỗi tiếng Việt cho người nhập (chạy TRƯỚC transaction).
 */
import type { ReferrerKind, SourceReferrerRequirement } from "@prisma/client";

/** Người giới thiệu do người nhập CHỌN — các id; đúng một nhóm cột có giá trị (hoặc user+student cho PH). */
export type ThamChieuNguon = {
  employeeId: string | null;
  parentUserId: string | null;
  studentId: string | null;
  affiliateId: string | null;
};

export const DO_DAI_GIAI_TRINH_TOI_THIEU = 10;

export function kiemGiaiTrinh(nhom: { requiresNote: boolean }, giaiTrinh: string | null | undefined): string | null {
  if (!nhom.requiresNote) return null;
  const n = (giaiTrinh ?? "").trim().length;
  return n >= DO_DAI_GIAI_TRINH_TOI_THIEU
    ? null
    : `Nguồn này bắt buộc giải trình từ ${DO_DAI_GIAI_TRINH_TOI_THIEU} ký tự (hiện ${n}).`;
}

export function kiemThamChieu(
  nhom: { referrerRequirement: SourceReferrerRequirement },
  ref: ThamChieuNguon | null,
): string | null {
  const coNhanSu = !!ref?.employeeId;
  const coPhuHuynh = !!ref?.parentUserId || !!ref?.studentId;
  const coDoiTac = !!ref?.affiliateId;
  switch (nhom.referrerRequirement) {
    case "EMPLOYEE":
      return coNhanSu && !coPhuHuynh && !coDoiTac ? null : "Nguồn này cần chọn nhân sự giới thiệu.";
    case "PARENT":
      return coPhuHuynh && !coNhanSu && !coDoiTac ? null : "Nguồn này cần chọn phụ huynh giới thiệu.";
    case "AFFILIATE_ORG":
      return coDoiTac && !coNhanSu && !coPhuHuynh ? null : "Nguồn này cần chọn đối tác giới thiệu.";
    case "EVENT":
    case "NONE":
      // Không bắt người — nhưng KHÔNG nhận người lạc loại: bỏ qua im lặng rồi ghi lệch là nuốt dữ liệu.
      return coNhanSu || coPhuHuynh || coDoiTac ? "Nguồn này không có người giới thiệu — bỏ phần đã chọn." : null;
    default:
      return "Loại người giới thiệu của nguồn không hợp lệ.";
  }
}

export type CotNguoiGioiThieu = {
  referrerKind: ReferrerKind | null;
  referrerEmployeeId: string | null;
  referrerParentUserId: string | null;
  referrerStudentId: string | null;
  referrerAffiliateId: string | null;
};

/** ThamChieuNguon ⇒ cột `referrer*` (khớp CHECK `LeadAttribution_nguoi_gioi_thieu_chk`). null ⇒ không người. */
export function thamChieuSangNguoi(ref: ThamChieuNguon | null): CotNguoiGioiThieu {
  if (ref?.employeeId) {
    return { referrerKind: "EMPLOYEE", referrerEmployeeId: ref.employeeId, referrerParentUserId: null, referrerStudentId: null, referrerAffiliateId: null };
  }
  if (ref?.parentUserId || ref?.studentId) {
    return { referrerKind: "PARENT", referrerEmployeeId: null, referrerParentUserId: ref.parentUserId ?? null, referrerStudentId: ref.studentId ?? null, referrerAffiliateId: null };
  }
  if (ref?.affiliateId) {
    return { referrerKind: "AFFILIATE", referrerEmployeeId: null, referrerParentUserId: null, referrerStudentId: null, referrerAffiliateId: ref.affiliateId };
  }
  return { referrerKind: null, referrerEmployeeId: null, referrerParentUserId: null, referrerStudentId: null, referrerAffiliateId: null };
}
