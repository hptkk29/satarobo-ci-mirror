// lib/trial/notify-training.ts — GĐ3.
//
// Tìm người của bộ phận ĐÀO TẠO để báo khi có ca trải nghiệm cần phân công giáo viên.
//
// ⚠️ Vì sao tra theo `User.roles` (enum v1) chứ không theo `UserOrgRole` (v2):
// máy local, CI và dev chạy RBAC v1, chỉ prod bật v2. Tra bằng `UserOrgRole` thì ở
// mọi nơi trừ prod danh sách người nhận sẽ RỖNG, và thông báo im lặng không đến ai —
// đúng loại hỏng câm khó phát hiện nhất. Cột `roles` có ở cả hai chế độ.
//
// Đổi lại, ai được nhận tin phụ thuộc cột `roles` chứ không phụ thuộc bảng quyền động.
// Đó là đánh đổi có chủ đích: thông báo là tiện ích nhắc việc, không phải cổng bảo mật.
//
// ⚠️ ĐÍNH CHÍNH 17/09/2026 — câu cũ ở đây chỉ sai chỗ: "cổng bảo mật vẫn là
// `checkPermission("trials:assign-teacher")` ở action". KHÔNG action nào gọi khoá đó (grep
// toàn repo: khoá này chỉ còn trong ma trận quyền `lib/auth/permissions.ts`, registry và
// `prisma/seed-roles.ts`). Màn `/lop-trial/[id]` đã CỐ Ý thôi dùng nó từ 28/08 khi giáo viên
// chuyển từ cấp học viên xuống TỪNG BUỔI.
//
// Cổng THẬT của đường ghi này là `checkPermission("trials:manage")` ở
// `app/(admin)/admin/lop-trial/_actions.ts` (`addLopTrialSessionAction`), cộng
// `loadScopedTrialClass` gác cách ly cơ sở. Ghi sai tên cổng nguy hiểm hơn không ghi: người
// rà quyền đi kiểm `trials:assign-teacher`, thấy nó có người giữ, rồi kết luận đường này đã
// được gác — trong khi cổng thật nằm ở khoá khác.
import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";

/** Vai được báo khi có ca chờ phân công. Đào tạo là người quyết; Admin để dự phòng. */
const VAI_NHAN_TIN = ["TRAINING", "SUPER_ADMIN"] as const;

/**
 * Người của bộ phận Đào tạo. `centerId` chỉ dùng để THU HẸP khi có người Đào tạo gắn
 * cơ sở; người Đào tạo Hội sở (`centerId` null) LUÔN nhận, vì họ phụ trách mọi cơ sở.
 */
export async function layNguoiDaoTao(centerId: string | null): Promise<string[]> {
  const rows = await db.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      roles: { hasSome: [...VAI_NHAN_TIN] },
      ...(centerId ? { OR: [{ centerId }, { centerId: null }] } : {}),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Báo Đào tạo có BUỔI trải nghiệm chưa có giáo viên.
 *
 * ── VÌ SAO VIẾT LẠI 14/09/2026 ──────────────────────────────────────────────────────────
 * Bản cũ nhận `trialEnrollmentId` và nói về "ca" của luồng GĐ3 — luồng đó đã bị gỡ 28/08, ba
 * Server Action bọc nó không còn, và hàm này thành HÀM CHẾT: grep toàn repo không nơi nào gọi.
 * Trong khi đó tiền tố `trial.cho-phan-cong:` vẫn nằm trong danh mục, nên màn cấu hình bày ra
 * một công tắc không nối vào đâu.
 *
 * Nay nó phục vụ đúng cái lỗ CÓ THẬT: ô "Giáo viên" ở khối Thêm buổi học mặc định TRỐNG
 * (`add-session-form.tsx`), lớp trải nghiệm thì sinh ra đã `teacherId: null` và không màn nào
 * gán giáo viên cấp lớp — nên đường mặc định của người dùng là tạo ra một buổi KHÔNG AI DẠY,
 * và trước đợt này việc đó im lặng hoàn toàn. Chủ dự án đã đi đúng vào đường ấy ngày 13/09.
 *
 * Non-fatal: hỏng chuông KHÔNG được làm hỏng việc xếp lịch. `dedupeKey` gắn theo BUỔI nên sửa
 * đi sửa lại cùng một buổi không dội chuông nhiều lần; `reopen` bật để lần sửa sau kéo tin về
 * chưa đọc (việc đã đổi, người ta cần thấy lại).
 */
export async function baoDaoTaoBuoiChuaCoGiaoVien(params: {
  sessionId: string;
  centerId: string | null;
  className: string;
  /** Buổi, dạng người đọc — vd "05/09/2026 18:00–19:30". */
  moTaBuoi: string;
}): Promise<void> {
  try {
    const userIds = await layNguoiDaoTao(params.centerId);
    if (userIds.length === 0) return;

    await notifyStaff({
      userIds,
      dedupeKey: `trial.cho-phan-cong:${params.sessionId}`,
      category: "TRIAL",
      title: "Buổi trải nghiệm chưa có giáo viên",
      body: `Lớp ${params.className} — ${params.moTaBuoi}. Cần phân công giáo viên.`,
      href: "/lop-trial",
      entityId: params.sessionId,
      reopen: true,
    });
  } catch (e) {
    console.error("[trial:baoDaoTaoBuoiChuaCoGiaoVien]", e);
  }
}
