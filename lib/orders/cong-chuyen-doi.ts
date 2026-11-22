import "server-only";
import {
  duocChuyenDoi,
  lyDoChuaChuyenDoiDuoc,
  type TienWebhookCuaDon,
} from "@/lib/payments/tien-webhook-vao-don";

// lib/orders/cong-chuyen-doi.ts — CỔNG "đơn này mở được màn Chuyển đổi chưa" [27/10/2026].
//
// Điều kiện gốc (29/09): có tiền THẬT về tài khoản khớp mã đơn (`duocChuyenDoi`). Chủ dự án thêm một lối thứ hai (27/10): đơn HỌC BỔNG 100% do Quản trị tối cao
// đánh dấu trên trang đơn — đơn 0đ không bao giờ có tiền về, nên không có lối này thì học bổng không vào lớp được.
//
// ⚠️ MỘT vị từ, ba nơi gọi (nút ở trang đơn · trang chuyển đổi · action chốt) — tự viết điều kiện riêng ở chỗ gọi là mở đường cho chúng lệch nhau.
// ⚠️ File này CỐ Ý nằm ngoài `lib/payments/**`: học bổng không phải đường đối khớp tiền, và chạm `lib/payments/**` buộc chạy bộ R7.

export function duocChuyenDoiDon(tien: TienWebhookCuaDon, donHocBong: boolean): boolean {
  return donHocBong || duocChuyenDoi(tien);
}

export function lyDoChuaChuyenDoiDuocDon(tien: TienWebhookCuaDon, donHocBong: boolean): string | null {
  if (duocChuyenDoiDon(tien, donHocBong)) return null;
  return lyDoChuaChuyenDoiDuoc(tien);
}

// ── VAI + TRẦN HỌC VƯỢT CỦA NGƯỜI ĐANG CHUYỂN ĐỔI ────────────────────────────────────────────────────────
import { docCauHinhPhamVi } from "@/lib/entitlements/feature";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import type { VaiXepLop } from "@/lib/lms/xep-lop-theo-buoi-bat-dau";

/**
 * Vai xếp lớp từ HAI quyền có sẵn (không đẻ quyền mới — quyền mới cần chạy `seed-prod-roles.yml`):
 *   · `enrollments:override-progress` (Quản trị tối cao) ⇒ ADMIN: thấy và xếp được MỌI lớp của khoá, mọi cơ sở;
 *   · `makeup:waive` (Quản lý cơ sở) ⇒ QLCS: lớp cùng cơ sở, kể cả lớp vượt trần học vượt;
 *   · còn lại ⇒ SALE.
 */
export function vaiXepLop(q: { laAdmin: boolean; laQlcs: boolean }): VaiXepLop {
  return q.laAdmin ? "ADMIN" : q.laQlcs ? "QLCS" : "SALE";
}

/**
 * Bối cảnh cơ sở của đơn: `OrgUnit.id` (cho ghi kép + đọc cài đặt) và trần học vượt `enrollment.catchUpMaxSessions` ĐỌC THEO CƠ SỞ — QLCS chỉnh riêng cơ sở mình.
 * ⚠️ Bỏ `orgUnitId` thì chỉ đọc mức toàn cục: QLCS chỉnh mà màn này vẫn xét số chung, không lỗi nào báo (cùng bài học `billing.scopeMaxDiscountPercent`).
 */
export async function docBoiCanhCoSoDon(centerId: string | null): Promise<{ orgUnitId: string | null; tran: number }> {
  const orgUnitId = await orgUnitIdForCenter(centerId);
  const cauHinh = await docCauHinhPhamVi(orgUnitId);
  return { orgUnitId, tran: cauHinh.catchUpMaxSessions };
}
