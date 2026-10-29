import "server-only";
// lib/ai-lead/dich-vu/nguoi-duyet-co-so.ts — NGƯỜI XỬ LÝ hồ sơ AI của MỘT cơ sở = người GIỮ QUYỀN `ai-leads:review` qua vai còn hiệu lực NEO TẠI đơn vị của cơ sở đó (nguồn quyền RBAC v2).
//
// Thay `quanLyCoSo` (lib/notifications/nguoi-nhan-phia-sale.ts) CHO RIÊNG AI Lead. `quanLyCoSo` là hợp của hai nguồn: cột vai cũ (`User.roles has CENTER_MANAGER` + `User.centerId`) VÀ UserOrgRole — cố ý
// chuyển tiếp cho cả hệ thống thông báo (đơn hàng, lead…) nên KHÔNG sửa ở đó. Với AI Lead nguồn cột cũ là vô nghĩa: màn AI Lead và mọi action gác bằng `can()` v2, nên người chỉ có cột vai cũ không mở được
// hồ sơ mà vẫn nhận chuông («báo cho người không xử lý được»). Đo PROD 28/10/2026 (chỉ đọc): 1 tài khoản CENTER_MANAGER còn hoạt động, 0 tài khoản chỉ-có-cột-cũ ⇒ đổi nguồn KHÔNG đổi người nhận hôm nay.
//
// Chỉ vai neo ĐÚNG đơn vị của cơ sở: vai neo ở HO/khối KHÔNG tính (báo này là việc của cơ sở; người Hội sở có đường riêng `HO_REVIEWERS`). Tài khoản khoá / đã xoá bị loại.
import { db } from "@/lib/db";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

export async function nguoiDuyetCoSo(centerId: string, now: Date = new Date()): Promise<string[]> {
  const donVi = await orgUnitIdForCenter(centerId);
  if (!donVi) return [];
  const vai = await db.userOrgRole.findMany({
    where: {
      orgUnitId: donVi,
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      role: { isActive: true, permissions: { some: { action: "ai-leads:review" } } },
    },
    select: { userId: true },
  });
  if (vai.length === 0) return [];
  const con = await db.user.findMany({
    where: { id: { in: [...new Set(vai.map((v) => v.userId))] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  return con.map((u) => u.id);
}
