// lib/lead/pham-vi-so-chia.ts — phạm vi cơ sở + che PII của màn «Quản lý chia lead» (THUẦN, không DB).
//
// Vì sao tồn tại (rà độc lập 20/10/2026, M1 — cùng họ «tầm nhìn bị dùng làm quyền ghi/đọc» với N9):
//   · `visibleCenterIds` GỘP tầm nhìn của MỌI vai. Người kiêm CENTER_MANAGER@CS1 (giữ `lead_pool:manage`) + CENTER_SALES_CSM@CS2 «thấy» CS2,
//     nên cổng cũ `isSuperAdmin || isHoLevel || visibleCenterIds.includes(centerId)` cho họ tắt/bật người của CS2 và kéo sổ chia của CS2.
//     Phạm vi đúng = cơ sở nơi người này giữ ĐÚNG khoá đã gác màn (`tamNhinCuaKhoa`), không phải mọi cơ sở họ nhìn thấy.
//   · Bản cũ của hai nơi đọc (route xuất + trang lịch sử) viết `...(nhieuCoSo ? {} : {id:{in:…}}), ...(co_so ? {id: co_so} : {})` — spread thứ HAI
//     ĐÈ khoá `id` của spread thứ nhất, nên `?co_so=<cơ sở khác>` bỏ qua hoàn toàn danh sách cơ sở được phép (comment ghi «ra rỗng chứ không rò» là SAI).
//     `Center` ∈ SCOPE_EXEMPT ⇒ `scopedDb` không bù. `locCoSoTheoTamNhin` GIAO hai tập thay vì ghi đè.
import { maskPersonName, maskPhone } from "@/lib/lead/pii";

/** Các khoá gác TRANG «Quản lý chia lead» (+ trang lịch sử) — giữ khớp `PAGE_GATES["/quan-ly-chia-lead"]` (lưới `[CL-W1]` canh). */
export const KHOA_TRANG_CHIA_LEAD = ["lead_pool:manage", "leads:rotation-view"] as const;
/** Khoá gác ĐƯỜNG XUẤT sổ chia lead — `quyenGoc` của mã `so-chia-lead` trong danh mục xuất. */
export const KHOA_XUAT_SO_CHIA = "lead_pool:manage";

export type TamNhin = "ALL" | readonly string[];

/**
 * Điều kiện `where` cho `center.findMany`: các cơ sở người này ĐƯỢC PHÉP (`tam`) GIAO với cơ sở yêu cầu qua URL (`coSoYeuCau`, nếu có).
 * `coSoYeuCau` ngoài tầm nhìn ⇒ `{ in: [] }` (rỗng) — không bao giờ mở rộng tầm nhìn. Trả về MỘT khoá `id` duy nhất để không ai spread đè lên.
 */
export function locCoSoTheoTamNhin(tam: TamNhin, coSoYeuCau: string | null | undefined): { id?: string | { in: string[] } } {
  if (tam === "ALL") return coSoYeuCau ? { id: coSoYeuCau } : {};
  return { id: { in: coSoYeuCau ? tam.filter((c) => c === coSoYeuCau) : [...tam] } };
}

/** Một dòng sổ chia: chỉ hai cột PII. */
type DongCoPii = { parentName: string | null; phone: string | null };

/**
 * Che PII của sổ chia theo CÙNG luật với export lead (`/api/admin/leads/export`):
 *   · `xemPii` (= `leads:view-pii`) quyết định tên phụ huynh;
 *   · `xemSdt` (= `leads:view-pii` VÀ không bị DENY cấp trường `phone`) quyết định SĐT.
 * Che ở SERVER trước khi ghi tệp / truyền xuống client (không che ở JSX).
 */
export function anPiiSoChia<T extends DongCoPii>(rows: readonly T[], q: { xemPii: boolean; xemSdt: boolean }): T[] {
  return rows.map((r) => ({
    ...r,
    parentName: q.xemPii ? r.parentName : r.parentName == null ? null : maskPersonName(r.parentName),
    phone: q.xemSdt ? r.phone : r.phone == null ? null : maskPhone(r.phone),
  }));
}
