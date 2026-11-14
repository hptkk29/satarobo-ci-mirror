import "server-only";
// lib/entitlements/hoc-vuot-da-hoc.ts — "mỗi quyền học đã HỌC VƯỢT bao nhiêu bài?" — đọc sổ cái, chỉ đọc.
//
// Học vượt = dòng sổ cái nguồn `CATCH_UP` còn hiệu lực (chưa vô hiệu). Số này ĐÃ nằm trong `consumedSessions` (QĐ-16: học vượt được tính là đã
// học bài tương ứng); cổng phụ huynh chỉ cần nó để HIỂN THỊ RIÊNG, không cộng thêm.
//
// Đặt ở `lib/entitlements/**` vì `[ENT-USAGE-PIN-01]` (INV-32b) chỉ cho thư mục này chạm bảng sổ cái. Chỉ ĐỌC: không ghi, không khoá.
import { db } from "@/lib/db";

export async function demHocVuotTheoQuyen(entitlementIds: readonly string[]): Promise<Map<string, number>> {
  if (entitlementIds.length === 0) return new Map();
  const rows = await db.studyEntitlementUsage.groupBy({
    by: ["entitlementId"],
    where: { entitlementId: { in: [...entitlementIds] }, source: "CATCH_UP", voidedAt: null },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.entitlementId, r._count._all]));
}
