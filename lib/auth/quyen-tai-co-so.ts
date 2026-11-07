// lib/auth/quyen-tai-co-so.ts — "người này giữ ĐÚNG khoá `key` tại cơ sở `centerId` không" (THUẦN, không DB).
//
// Vì sao tồn tại (N9, đo 18/10/2026; họ lỗi này gặp lại ở khiếu nại / đề xuất / referral):
//   · `passesScope(model, …)` trả lời "người này NHÌN THẤY cơ sở đó không" — và nó GỘP tầm nhìn của MỌI quyền cùng tiền tố
//     (`commission:` + `commission_periods:`, `commission_disputes:` + `commission:`, `affiliate_referrals:` view-org + manage…).
//   · `can(actor, key)` GỌI TRẦN không có target thì với `scopeType: GLOBAL` (cách seed cấp quyền) luôn đúng — cơ sở nằm ở
//     NƠI NEO VAI (`centerScope`), không nằm ở `scopeType`.
//   ⇒ người giữ khoá GHI ở CS-A và chỉ khoá XEM ở CS-B "qua" cả hai cổng khi ghi vào CS-B. NHÌN THẤY ≠ ĐƯỢC GHI.
//
// Luật: mọi đường GHI lên đối tượng thuộc một cơ sở phải hỏi CẢ HAI — `passesScope` (nhìn thấy) VÀ hàm này (đúng khoá ghi).
// `centerId` null (đối tượng chưa quy được cơ sở) chỉ SUPER_ADMIN / quyền "ALL" / grant ALLOW. Per-user grant ALLOW là ngoại lệ
// toàn cục (cùng nghĩa với `getModelVisibleCenterIds`). Mặc định fail-closed: không khớp thì false.
import type { Actor } from "@/lib/auth/actor";

export function coQuyenTaiCoSo(actor: Actor, key: string, centerId: string | null): boolean {
  const tam = tamNhinCuaKhoa(actor, key); // MỘT định nghĩa «giữ ĐÚNG khoá» — hàm này chỉ hỏi «cơ sở này có nằm trong đó không»
  return tam === "ALL" || (centerId !== null && tam.includes(centerId));
}

/**
 * "người này giữ ĐÚNG khoá `key` ở TẦM TOÀN HỆ THỐNG không" — dành cho thao tác KHÔNG có cơ sở nào để hỏi (ghi lên danh mục dùng chung / chạy trên lead của MỌI cơ sở).
 * KHÁC `actor.isHoLevel` ("có MỘT vai nào đó neo ở Hội sở"): vai Hội sở ấy có thể chẳng giữ khoá này, còn khoá thì được giữ ở một cơ sở bởi vai khác ⇒ gộp hai thứ lại là nới quyền.
 * Chỉ SUPER_ADMIN · grant ALLOW per-user (toàn cục theo thiết kế) · một dòng quyền của CHÍNH khoá này có `centerScope === "ALL"`. Mặc định fail-closed.
 */
export function coQuyenToanHeThong(actor: Pick<Actor, "isSuperAdmin" | "grantsAllow" | "permissions">, key: string): boolean {
  if (actor.isSuperAdmin) return true;
  if (actor.grantsAllow.has(key)) return true;
  return actor.permissions.some((p) => p.action === key && p.centerScope === "ALL");
}

/**
 * "người này NHÌN được những cơ sở nào BẰNG CHÍNH các khoá `keys`" — tầm nhìn đo theo KHOÁ, không theo TIỀN TỐ.
 * `getModelVisibleCenterIds` gộp tầm nhìn của MỌI quyền cùng tiền tố model (`commission:` = view-self + view-center + …), nên người kiêm CENTER_MANAGER@CS1 (view-center) và CENTER_SALES_CSM@CS2 (chỉ view-self)
 * "thấy" cơ sở CS2 ở chỗ chỉ khoá view-center được phép mở — đọc sổ hoa hồng của người khác ở CS2 (rà độc lập 20/10/2026). Ở chỗ đọc đã gác bằng khoá K thì phạm vi cơ sở phải lấy từ CHÍNH K.
 * "ALL" khi SUPER_ADMIN · grant ALLOW per-user (toàn cục) · một dòng quyền của chính khoá có `centerScope === "ALL"`; ngược lại HỢP các `centerScope` mảng của chính các khoá đó. Không giữ khoá nào ⇒ `[]` (fail-closed, KHÔNG rơi về `visibleCenterIds`).
 * Là tầm NHÌN; thao tác GHI vẫn hỏi `coQuyenTaiCoSo` từng cơ sở.
 */
export function tamNhinCuaKhoa(actor: Pick<Actor, "isSuperAdmin" | "grantsAllow" | "permissions">, ...keys: readonly [string, ...string[]]): "ALL" | readonly string[] {
  if (actor.isSuperAdmin) return "ALL";
  const co = new Set<string>();
  for (const key of keys) {
    if (actor.grantsAllow.has(key)) return "ALL";
    for (const p of actor.permissions) {
      if (p.action !== key) continue;
      if (p.centerScope === "ALL") return "ALL";
      if (Array.isArray(p.centerScope)) for (const c of p.centerScope) co.add(c);
    }
  }
  return [...co];
}
