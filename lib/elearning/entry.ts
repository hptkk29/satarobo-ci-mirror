import "server-only";

import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { elearningHomeUrl } from "@/lib/auth/hosts";
import { isElearningEnabled } from "@/lib/flags";

/**
 * EL-01 (AC1 bản sửa) — lối vào khu đào tạo nội bộ trên menu tài khoản.
 *
 * Trả URL nếu tài khoản ĐƯỢC PHÉP thấy mục menu, `null` nếu không. Gọi trong RSC
 * của layout admin / layout site GV; `null` ⇒ layout không render mục menu.
 *
 * HAI điều kiện (đúng thứ tự, rẻ trước đắt sau):
 *   1. Cờ `ELEARNING_ENABLED` ON — mặc định OFF (`lib/flags.ts`).
 *   2. Tài khoản có hồ sơ `Employee` đang làm việc.
 *
 * ⚠️ Đây KHÔNG phải cổng bảo vệ. Nó chỉ quyết định có VẼ mục menu hay không.
 * Cổng thật nằm ở `app/(elearning)/elearning/layout.tsx` (EL-01 PR2) và ở từng
 * Server Action của module. Giấu mục menu mà quên gác cổng = ai gõ thẳng URL là vào.
 *
 * 📌 EL-02 sẽ thêm điều kiện thứ ba `can(actor, "elearning:portal:access")` NGAY TẠI
 * ĐÂY — khoá quyền chưa tồn tại nên chưa gọi được (`can()` với khoá lạ trả false ⇒
 * gọi sớm là ẩn mục menu của tất cả mọi người). Sửa ở một chỗ này, không rải ra
 * hai layout.
 */
export async function elearningEntryUrl(userId: string): Promise<string | null> {
  if (!isElearningEnabled()) return null;

  const actor = await resolveActor(userId);

  // `bypass: true` có chủ đích, giống cổng ở layout khu e-learning: đây là truy vấn
  // TỰ TRA hồ sơ của chính mình, khoá theo quan hệ 1-1 duy nhất `userAccount.id`,
  // nên không có đường lộ dữ liệu cơ sở khác. Dùng scopedDb thường thì 10/14 nhân sự
  // prod đang có `centerId = null` (nhân sự Hội sở, `actions.ts:220-222` cố ý set vậy)
  // sẽ bị chính bộ lọc cơ sở nuốt mất ⇒ menu biến mất đúng với nhóm Hội sở.
  const sdb = scopedDb(actor, { bypass: true });
  const employee = await sdb.employee.findFirst({
    where: { userAccount: { id: userId }, isActive: true, status: "ACTIVE" },
    select: { id: true },
  });

  return employee ? elearningHomeUrl() : null;
}
