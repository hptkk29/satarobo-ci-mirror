// lib/hoa-hong/khieu-nai-ma.ts — HẰNG DÙNG CHUNG của khiếu nại hoa hồng (service · action · màn · thông báo). THUẦN, không import nặng.
//
// Một nơi khai KEY quyền mà nút VẼ và mà Server Action ĐÒI (luật 12: nút vẽ bằng quyền A, action hỏi quyền B là lời hứa suông). Lưới
// `[NHH-DSP-W*]` so hai bên với hằng này.

/** Mở khiếu nại: người HƯỞNG (xem dòng của mình). Không có key riêng để tạo (05 §1.2) — điều kiện sở hữu kiểm ở tầng dữ liệu. */
export const KEY_TAO_KHIEU_NAI = "commission:view-self" as const;
/** Nhận · giao lại · quyết định · đóng khiếu nại: HR. */
export const KEY_DUYET_KHIEU_NAI = "commission_disputes:review" as const;

/** `AuditLog.module` của mọi dòng khiếu nại — cùng chuỗi với engine (`quet-khoan`, `ky-service`) để Nhật ký đọc MỘT module. */
export const MODULE_AUDIT_HOA_HONG = "hoa-hong" as const;
export const ENTITY_KHIEU_NAI = "CommissionDispute" as const;

/** `reasonCode` của dòng `DISPUTE_ADJUSTMENT` do khiếu nại điều chỉnh tiền sinh ra (khác `MA_KHOI_PHUC_HOAN_LEGACY` — kind mượn). */
export const MA_KHIEU_NAI_DIEU_CHINH = "KHIEU_NAI_DIEU_CHINH" as const;

/**
 * `reasonCode` của dòng TRẢ LẠI hoa hồng đã thu hồi bằng `LEGACY_REVERSAL` khi khoản hoàn bị bác (kind mượn `DISPUTE_ADJUSTMENT`: CHECK `loai_dong_chk` cấm `LEGACY_REVERSAL` dương và không có migration).
 * Sống ở LÁ này (không import gì) để `vi-sao.ts` đọc được mà không phải nhập `kieu.ts` — `kieu.ts` nhập kiểu từ `chon-quy-tac.ts`, mà `chon-quy-tac.ts` nhập `vi-sao.ts` (định dạng số) ⇒ vòng
 * `chon-quy-tac → vi-sao → kieu → chon-quy-tac` (dependency-cruiser `no-circular`, cổng Quality). `kieu.ts` xuất lại nên nơi gọi cũ không đổi.
 */
export const MA_KHOI_PHUC_HOAN_LEGACY = "KHOAN_HOAN_LEGACY_BI_RUT_KHOI_PHUC";

/** Hành động audit — 05 §4: tạo · nhận · quyết (+ giao lại, đóng là hệ quả của quyết định). */
export const HANH_DONG_KHIEU_NAI = {
  TAO: "CREATE",
  NHAN: "ASSIGN",
  GIAO_LAI: "REASSIGN",
  QUYET: "DECIDE",
  DONG: "CLOSE",
} as const;

/**
 * Nút «Khiếu nại dòng này» (ngăn «Vì sao» của tab Sổ) có được VẼ cho dòng này không? MỘT chỗ quyết, để màn hình và Server Action không lệch (luật 12):
 * action đòi `KEY_TAO_KHIEU_NAI` ∧ dòng là CỦA MÌNH (`laDongCuaToi`: người hưởng là USER mang đúng `beneficiaryUserId`). `nguoiHuong.id` của dòng sổ chính là
 * `beneficiaryUserId` (doc-so.ts `anhXa`) — lưới DB `[NHH-SO-DB-16]` ghim hai phía cùng một id thật.
 */
export function veNutKhieuNaiDong(d: { nguoiHuong: { kind: string; id: string } }, nguoiXemId: string, coKey: boolean): boolean {
  return coKey && d.nguoiHuong.kind === "USER" && d.nguoiHuong.id === nguoiXemId;
}
