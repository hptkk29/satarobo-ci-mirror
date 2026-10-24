import "server-only";
// lib/notifications/nguoi-nhan-phia-sale.ts — AI ở PHÍA SALE nhận báo về một ĐƠN.
//
// Dời NGUYÊN VĂN khỏi `lib/finance/hoa-don/gui-email.ts` [GĐ1 POS · 06/10/2026] để handler tiền phiếu
// gộp (`lib/payments/sau-da-chia.ts`) dùng CHUNG một luật người nhận với hoá đơn điện tử — hai bản
// chép là hai danh sách lệch nhau ở lần ai đó sửa một bên. `gui-email.ts` import lại; hành vi không
// đổi (bộ `tests/finance/hoa-don-email.test.ts` canh).
import { db } from "@/lib/db";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

/**
 * Người phía SALE nhận báo về một đơn: sale phụ trách lead → người lập đơn → mọi Quản lý cơ sở của
 * cơ sở. MỘT chỗ cho hoá đơn điện tử ("khách không có email" / "email không tới được") và tiền phiếu
 * gộp về (GĐ1 POS).
 */
export async function nguoiNhanPhiaSale(hd: {
  centerId: string;
  order: { createdById: string | null; lead: { assignedToId: string | null } | null };
}): Promise<string[]> {
  if (hd.order.lead?.assignedToId) return [hd.order.lead.assignedToId];
  if (hd.order.createdById) return [hd.order.createdById];
  return quanLyCoSo(hd.centerId);
}

/**
 * Quản lý cơ sở của MỘT cơ sở = HỢP của hai nguồn, bỏ trùng:
 *   · vai `CENTER_MANAGER` còn hiệu lực trong `UserOrgRole` NEO TẠI đơn vị của cơ sở — nguồn quyền thật
 *     của RBAC v2 (luật cứng #6); người được gán vai ở màn nhân sự mà `User.roles` / `User.centerId`
 *     không đổi theo thì chỉ nguồn này thấy;
 *   · tập CŨ (`User.roles` có CENTER_MANAGER + `User.centerId`) — giữ để không ai đang nhận báo hôm nay
 *     bị rơi khỏi danh sách.
 * Đơn vị của cơ sở tra THẲNG khoá ngoại `OrgUnit.centerId` (`orgUnitIdForCenter`) — không dùng cầu theo
 * `code` (chỉ sống trong `ORG_UNIT_FOR_CENTER_SQL`, lib/org/center-bridge.ts). Vai neo ở HO/khối KHÔNG
 * tính: báo này là việc của cơ sở. Tài khoản khoá / đã xoá thì loại, dù dòng vai còn.
 */
export async function quanLyCoSo(centerId: string): Promise<string[]> {
  const now = new Date();
  const [cu, donVi] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, deletedAt: null, roles: { has: "CENTER_MANAGER" }, centerId },
      select: { id: true },
    }),
    orgUnitIdForCenter(centerId),
  ]);
  const vai = donVi
    ? await db.userOrgRole.findMany({
        where: {
          orgUnitId: donVi,
          status: "ACTIVE",
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          role: { code: "CENTER_MANAGER" },
        },
        select: { userId: true },
      })
    : [];
  const conHieuLuc =
    vai.length === 0
      ? []
      : await db.user.findMany({
          where: { id: { in: [...new Set(vai.map((v) => v.userId))] }, isActive: true, deletedAt: null },
          select: { id: true },
        });
  return [...new Set([...cu, ...conHieuLuc].map((u) => u.id))];
}
