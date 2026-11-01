// lib/payments/pos/pham-vi-nhap.ts — Người import file POS phải NHÌN ĐƯỢC MỌI CƠ SỞ.
//
// Q-D (docs/pos-the-smartpos.md): chỉ Kế toán HO + Quản trị tối cao import. Quyền
// `payments:import-pos` KHÔNG tự nói điều đó: `can()` v2 trả true vô điều kiện cho scope GLOBAL,
// nên một vai CẤP CƠ SỞ được cấp quyền này (sửa RoleDef trên DB, hoặc v1 `ACCOUNTANT` ở
// local/dev / khi rollback cờ RBAC v2) sẽ ghi giao dịch và khớp tiền cho MỌI cơ sở — `nhapLoPos`
// dùng `db` trần vì một file chứa giao dịch của mọi máy.
//
// Cổng này đo PHẠM VI, không đo quyền: tầm nhìn của actor trên chính model mà lượt import ghi
// (`PosCardTransaction`, prefix `payments:`) phải là "ALL". Ca `[POS-PV-01..03]`.
import type { Actor } from "@/lib/auth/actor";
import { getModelVisibleCenterIds } from "@/lib/db-scope";

export const LOI_PHAM_VI_NHAP_POS =
  "Chỉ Kế toán Hội sở (nhìn được mọi cơ sở) mới import được giao dịch thẻ — một file chứa giao dịch của mọi máy";

export function nhapPosDuocMoiCoSo(actor: Actor): boolean {
  return getModelVisibleCenterIds("PosCardTransaction", actor) === "ALL";
}
