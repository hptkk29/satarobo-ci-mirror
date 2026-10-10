import "server-only";
import { db } from "@/lib/db";

/**
 * AI GIỮ MỘT QUYỀN TẠI MỘT CƠ SỞ — kể cả người neo vai ở đơn vị CHA (REGION/HO).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TÁCH RA [25/09/2026]
 *
 * Thuật toán này vốn nằm trong `approversOfCenter` của module chấm công, với chuỗi
 * `"hr_attendance:approve"` ĐÓNG CỨNG. Nay màn Đơn hàng cần đúng thuật toán ấy cho
 * `discounts:approve` / `installments:approve` (chủ dự án: *"khi có đơn cần được duyệt
 * thì phải gửi thông báo về ngay cho quản lý"*).
 *
 * Chép sang một bản thứ hai là chép cả phần dễ sai nhất — leo cây tổ tiên. Một bản quên
 * leo thì người neo vai ở Hội sở **không bao giờ nhận được thông báo** của cơ sở nào, và
 * lỗi ấy câm: không ai báo "tôi thiếu thông báo", họ chỉ không biết có việc.
 *
 * ⚠️ `actions` là tham số BẮT BUỘC, không mặc định (luật 7). Mặc định ở đây nguy hiểm
 * theo chiều NỚI: quên truyền thì rơi về một quyền nào đó và gửi thông báo cho nhầm
 * nhóm người — mà thông báo sai người là rò thông tin, không phải phiền toái.
 *
 * ⚠️ Nguồn quyền là DB (luật cứng #6 của Nền Hệ thống), KHÔNG đọc JWT.
 */
export async function nguoiGiuQuyenTaiCoSo(
  centerId: string,
  actions: readonly string[],
): Promise<string[]> {
  if (!centerId || actions.length === 0) return [];

  const unit = await db.orgUnit.findFirst({
    where: { centerId },
    select: { id: true, path: true },
  });
  if (!unit) return [];

  // Leo cây: `/ho/danang/cs1/` ⇒ `/ho/`, `/ho/danang/`, `/ho/danang/cs1/`. Người neo vai
  // ở Hội sở hay Khối vẫn là người duyệt hợp lệ của cơ sở con.
  const ancestors = unit.path
    ? await db.orgUnit.findMany({
        where: {
          OR: unit.path
            .split("/")
            .filter(Boolean)
            .map((_, i, arr) => ({ path: "/" + arr.slice(0, i + 1).join("/") + "/" })),
        },
        select: { id: true },
      })
    : [];

  const unitIds = [...new Set([unit.id, ...ancestors.map((a) => a.id)])];
  const now = new Date();
  const rows = await db.userOrgRole.findMany({
    where: {
      orgUnitId: { in: unitIds },
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      role: { permissions: { some: { action: { in: [...actions] } } } },
    },
    select: { userId: true },
    // Trần 50 giữ nguyên từ bản gốc: một cơ sở có hơn 50 người duyệt là cấu hình sai,
    // và gửi thông báo cho hàng trăm người thì không ai đọc nữa.
    take: 50,
  });
  return [...new Set(rows.map((r) => r.userId))];
}
