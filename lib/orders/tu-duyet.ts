// lib/orders/tu-duyet.ts — AI ĐƯỢC TỰ DUYỆT ĐƠN DO CHÍNH MÌNH TẠO. THUẦN, không DB, không `server-only` (nút duyệt và máy chủ cùng hỏi).
//
// ── QUYẾT ĐỊNH [chủ dự án, 20/10/2026, trong chat — trả lời câu hỏi "chưa có gì chặn người tạo đơn tự duyệt"] ─────────────────────────────────
//   > "admin, qlcs thì không cần chặn, còn các role khác thì chặn hết"
// ⇒ Quản trị hệ thống (SUPER_ADMIN) và Quản lý cơ sở (CENTER_MANAGER) tự duyệt đơn mình tạo được; MỌI vai khác có quyền duyệt (kế toán…)
// KHÔNG duyệt được đơn do chính họ tạo. Đây là rule TÁCH NGƯỜI GHI / NGƯỜI XÁC NHẬN áp cho khâu duyệt đơn.
//
// ⚠️ Đơn không có `createdById` (đơn cũ, đường convert/backfill không ghi người tạo) ⇒ KHÔNG chặn: không biết ai tạo thì không có "chính mình"
// để so. Chặn mù ở đây là nhốt đơn cũ vào hàng chờ vĩnh viễn.

/** Vai được tự duyệt đơn mình tạo. Thêm vai vào đây là NỚI quyền tiền — phải có chốt của chủ dự án. */
export const VAI_TU_DUYET_DON: ReadonlySet<string> = new Set(["SUPER_ADMIN", "CENTER_MANAGER"]);

export const LY_DO_KHONG_TU_DUYET =
  "Bạn là người tạo đơn này nên không tự duyệt được. Nhờ Quản lý cơ sở hoặc người khác có quyền duyệt bấm giúp.";

/**
 * Phần của `Actor` (RBAC v2) mà luật này cần. MỘT nguồn vai cho CẢ máy chủ (`approveOrder`) lẫn nút Duyệt (`du-lieu-the-duyet.ts`):
 * máy chủ từng dễ đọc `session.user.role(s)` (cột User) còn nút đọc `orgRoles` (UserOrgRole) — hai nguồn đó lệch nhau ở repo này
 * (RC-A: admin thiếu UserOrgRole), nút hứa một đằng máy chủ làm một nẻo (luật 12). Đừng đọc vai từ chỗ khác.
 */
export type ActorTuDuyet = {
  isSuperAdmin: boolean;
  orgRoles: readonly { roleCode: string }[];
};

/**
 * Trả câu từ chối nếu `actor` đang duyệt đơn do CHÍNH MÌNH tạo mà không thuộc vai được miễn; ngược lại `null`.
 * `actorId` là `Actor.userId`; vai lấy từ `actor` (cùng một đối tượng đã `resolveActor`).
 */
export function chanTuDuyetDon(params: {
  nguoiTaoId: string | null | undefined;
  actorId: string;
  actor: ActorTuDuyet;
}): string | null {
  if (!params.nguoiTaoId) return null;
  if (params.nguoiTaoId !== params.actorId) return null;
  if (params.actor.isSuperAdmin) return null;
  if (params.actor.orgRoles.some((r) => VAI_TU_DUYET_DON.has(r.roleCode))) return null;
  return LY_DO_KHONG_TU_DUYET;
}
