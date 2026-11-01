import "server-only";
// lib/payments/pos/nguoi-nhan-bao-pos.ts — AI nhận "báo admin" của phiếu thu thẻ POS (GĐ1, T17).
//
// Kế toán HO (vai `HO_ACCOUNTANT` CÒN HIỆU LỰC — người nhập file) ∪ Quản trị tối cao (`SUPER_ADMIN`
// — người sửa hạ tầng). Đọc từ VAI (`UserOrgRole`, nguồn quyền thật của RBAC v2 — luật cứng #6),
// KHÔNG từ `User.role`. Tài khoản khoá / đã xoá thì loại dù dòng vai còn.
import { db } from "@/lib/db";

export async function nguoiNhanBaoPos(now: Date): Promise<string[]> {
  const vai = await db.userOrgRole.findMany({
    where: {
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      role: { code: { in: ["HO_ACCOUNTANT", "SUPER_ADMIN"] } },
    },
    select: { userId: true },
  });
  if (vai.length === 0) return [];
  const conHieuLuc = await db.user.findMany({
    where: { id: { in: [...new Set(vai.map((v) => v.userId))] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  return conHieuLuc.map((u) => u.id);
}
