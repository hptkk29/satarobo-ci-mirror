// lib/hoa-hong/chu-so-huu.ts — MỖI bút toán có ĐÚNG MỘT CHỦ (engine cũ hoặc mới) — quyết ở MỘT hàm.
//
// Nguồn: docs/source-commission/04 §3.1, L10, 05 "Quy tắc cutover chính thức" (CUT-2..CUT-5). THUẦN.
//
// Hàm này là cổng chặn TRẢ HAI LẦN giữa hai engine: một bút toán thuộc engine cũ thì engine mới KHÔNG được tính
// (bảng kê cũ đã/sẽ trả nó), và ngược lại.
//
//   Kỳ tự nhiên k = kyCuaButToan(paidDate)   (tháng VN)
//     k ≥ mốc                                         → MOI
//     k < mốc  + kỳ cũ không có / DRAFT / REOPENED    → CU   (lần chốt lại kế tiếp của engine cũ sẽ thấy nó)
//     k < mốc  + APPROVED + id ∈ manifest             → CU   (đã nằm trong bảng kê đã duyệt)
//     k < mốc  + APPROVED + id ∉ manifest             → MOI  (đến muộn — bảng kê đã duyệt CHƯA TỪNG chứa nó; H22)
//     k < mốc  + APPROVED + manifest = null           → MANUAL_REVIEW_REQUIRED (không quyết được chủ ⇒ không đoán)
//
// ⚠️ Manifest (danh sách paymentId mà lần chốt cuối trước duyệt đã nạp): từ PR5c `chotKyHoaHong` ghi nó vào audit chốt
// (`newValues.paymentIds`) và bộ nạp DB (`cutover.ts:docKyCu`) đọc lại. Kỳ APPROVED mà KHÔNG có audit manifest (duyệt trước khi mã
// ghi manifest lên prod) ⇒ `manifest = null` ⇒ khoản của kỳ đó vào MANUAL_REVIEW — fail-closed, và `datMocCutover` từ chối đặt mốc.
import { kyCuaButToan } from "@/lib/crm/commission-thuc-thu";

export type KyCu = {
  trangThai: "DRAFT" | "APPROVED" | "REOPENED";
  /** `paymentId` mà lần chốt CUỐI trước khi duyệt đã nạp; `null` = không biết. */
  manifest: ReadonlySet<string> | null;
} | null;

export type ChuSoHuu = "CU" | "MOI";

export function chuSoHuuButToan(
  bt: { id: string; paidDate: Date },
  ctx: {
    /** "YYYY-MM" — `hoaHong.kyCutover`. BẮT BUỘC (luật 7): engine không có mốc thì không được hỏi hàm này. */
    kyCutover: string;
    kyCu: (ky: string) => KyCu;
  },
): ChuSoHuu | { giu: "MANUAL_REVIEW_REQUIRED" } {
  const k = kyCuaButToan(bt.paidDate);
  if (k >= ctx.kyCutover) return "MOI";
  const cu = ctx.kyCu(k);
  if (cu === null || cu.trangThai !== "APPROVED") return "CU";
  if (cu.manifest === null) return { giu: "MANUAL_REVIEW_REQUIRED" };
  return cu.manifest.has(bt.id) ? "CU" : "MOI";
}

/**
 * "Tháng này thuộc sổ MỚI không" — MỘT hàm cho năm cổng đường cũ, `datMocCutover` và engine (04 §3.2).
 * `k ≥ mốc` HOẶC tháng k đã có ít nhất một dòng sổ mới. Vế hai giữ đúng cả khi ai đó lách được cổng đặt mốc bằng SQL tay.
 */
export function thangThuocSoMoi(
  k: string,
  ctx: { kyCutover: string | null; coDongSoMoi: boolean },
): boolean {
  if (ctx.coDongSoMoi) return true;
  return ctx.kyCutover !== null && k >= ctx.kyCutover;
}
