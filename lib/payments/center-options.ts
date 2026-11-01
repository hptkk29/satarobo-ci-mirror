import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import type { CenterPaymentOption } from "./method-scope";

export type { CenterPaymentOption };

/**
 * Cơ sở CHỌN ĐƯỢC ở ô "Cơ sở áp dụng" của form phương thức thanh toán.
 *
 * ⚠️ `Center` ∈ SCOPE_EXEMPT (lib/db-scope.ts) — scopedDb KHÔNG tự lọc model này, nên
 * phải lọc TAY, y như app/(admin)/admin/centers/page.tsx đang làm. Bỏ qua bước này là
 * dropdown liệt kê mọi cơ sở cho người chỉ quản một cơ sở (rồi Server Action mới chặn —
 * chọn được mà không lưu được là trải nghiệm tệ và làm người dùng tưởng hệ thống hỏng).
 *
 * ⚠️ 31/08/2026 — hàm này KHÔNG còn đọc kho VietQR. Tài khoản nhận tiền nay khai ngay
 * trên dòng phương thức (`PaymentMethod.bank*`), nên form tự có sẵn, không phải tra thêm.
 */
export async function loadCenterPaymentOptions(
  actor: Actor,
): Promise<CenterPaymentOption[]> {
  const sdb = scopedDb(actor);
  const centerScope =
    actor.isSuperAdmin || actor.isHoLevel
      ? {}
      : { id: { in: actor.visibleCenterIds } };

  return sdb.center.findMany({
    where: { isActive: true, ...centerScope },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}
