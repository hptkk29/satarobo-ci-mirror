import { db } from "@/lib/db";

// T3.2 — nguồn DUY NHẤT cho "sale có thể phụ trách học viên" (mirror
// lib/teachers/assignable.ts). Dùng cho picker "Sale phụ trách" ở màn HS của lớp.

export type AssignableSale = {
  id: string;
  name: string | null;
  centerId: string | null;
};

/**
 * Sale hợp lệ = active + chưa xoá + có role `SALES_CSM` (ở `roles[]` hoặc `role`
 * chính — user cũ chưa backfill `roles[]`).
 *
 * @param opts.centerIds cách ly cơ sở: lớp CS1 KHÔNG được gán sale CS2. Rỗng/không
 *   truyền = mọi cơ sở (SUPER_ADMIN / HO).
 * @param opts.includeIds luôn kèm các id này (sale ĐANG được gán, kể cả khi họ đã
 *   đổi vai/chuyển cơ sở) để `<select>` không tự rớt giá trị đang chọn.
 */
export async function getAssignableSales(opts?: {
  centerIds?: (string | null | undefined)[];
  includeIds?: (string | null | undefined)[];
}): Promise<AssignableSale[]> {
  const centerIds = (opts?.centerIds ?? []).filter(Boolean) as string[];
  const includeIds = [...new Set((opts?.includeIds ?? []).filter(Boolean) as string[])];
  const centerWhere = centerIds.length ? { centerId: { in: centerIds } } : {};

  return db.user.findMany({
    where: {
      deletedAt: null,
      OR: [
        { isActive: true, roles: { has: "SALES_CSM" }, ...centerWhere },
        { isActive: true, role: "SALES_CSM", ...centerWhere },
        ...(includeIds.length ? [{ id: { in: includeIds } }] : []),
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, centerId: true },
  });
}
