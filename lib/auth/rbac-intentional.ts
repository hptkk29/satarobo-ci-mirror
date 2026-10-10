// #09 — danh sách THU HẸP CÓ CHỦ ĐÍCH khi flip RBAC v2 (nguồn sự thật DUY NHẤT).
//
// Trước đây nằm trong rbac-parity.test.ts; tách ra vì shadow-report cũng cần nó:
// v1 runtime (đang authoritative) vẫn cấp các quyền này và UI vẫn hiện nút, nên người
// giữ role bị siết sẽ ĐẺ LỆCH `v1=true/v2=false` MỖI LẦN chạm trang cho tới khi flip.
// Đó là lệch ĐÚNG THIẾT KẾ — cổng flip phải đếm "lệch cần xử lý" (ngoài danh sách này),
// không phải đếm thô, nếu không cổng không bao giờ về 0.
//
// ⚠️ Mỗi dòng ở đây là một quyền NGƯỜI THẬT sẽ MẤT ngay khi flip — chỉ thêm khi đã
// được ký (phiếu/chat chốt), ghi rõ nguồn.
import type { Role } from "@prisma/client";

/**
 * INTENTIONAL[role] = các action role đó có ở v1 nhưng CỐ Ý không có ở v2.
 * Nguồn: de-xuat-scope-v2-center-manager-teacher.md (Kiệt duyệt 09/07/2026)
 * + addendum HR Phương án A (06/07) + user chốt leads:delete (09/07), câu 5-6 (09/07).
 */
export const INTENTIONAL: Partial<Record<Role, readonly string[]>> = {
  HR: [
    "employees:create",
    "employees:view-personal",
    "employees:view-salary",
    "payroll:view",
    // TTS Nhân sự không phụ trách nội dung marketing / vinh danh.
    "blog:view",
    "courses:view",
    "honors:create",
    "honors:edit",
    "honors:view",
    "news:view",
  ],
  /** Kiệt duyệt 09/07/2026 — de-xuat-scope-v2-center-manager-teacher.md §3.3. */
  CENTER_MANAGER: [
    // Nội dung đối ngoại → HO_MARKETING
    "blog:create", "blog:edit",
    "news:create", "news:edit", "news:publish", "news:delete",
    "site-content:view", "site-content:edit",
    "honors:create", "honors:edit", "honors:settings",
    "emails:view", "emails:manage",
    // Chương trình & giáo án → TRAINING. courses:create/edit + course-packages:edit
    // nay GỠ HẲN khỏi CM ở CẢ v1 lẫn v2 (24/07). trials:config TRẢ VỀ CM (v1+v2) khi
    // gỡ khỏi Đào tạo → không còn diff.
    // 03/08: lesson-change:approve cũng ĐÃ về v2 (seed-roles.ts) — QĐ-T3b trả CM CẢ
    // HAI việc, để sót một cái ở v1-only là bỏ quên chứ không phải quyết định.
    // ── Chủ dự án chốt 03/08/2026 (chat): siết vai Quản lý cơ sở ──────────────
    // Gỡ ở CẢ v1 LẪN v2 (không còn là "mất khi flip") → không cần khai ở đây:
    // LMS (curriculum/courses/documents/assignments/teaching-materials/lesson-change/
    // exams/questions), employees:view-all, audit-logs:*, settings:view, payments:manage.
    // Tiền & kho tập trung → HO_ACCOUNTANT
    "payments:manage", "orders:manage", "installments:approve",
    "products:manage",
    "inventory:edit", "inventory:audit", "kits:edit",
    // Nhân sự & tuyển dụng → CENTER_HR
    "employees:edit", "jobs:create", "jobs:edit",
    // Cấu hình toàn hệ thống → SUPER_ADMIN
    "holidays:edit",
    // Xoá cứng → SUPER_ADMIN. QL dùng enrollments:cancel (CLAUDE.md).
    "students:delete", "enrollments:delete",
    // User chốt 09/07 (đồng ý sau khi được hỏi lại): không hard-delete lead.
    "leads:delete",
  ],
  /** Kiệt duyệt 09/07/2026 — §4.4 + câu 5 (giữ satacoin) và câu 6 (bỏ inventory:movement). */
  TEACHER: [
    "completions:manage", // QL cơ sở xác nhận hoàn thành khoá
    "sessions:create", // GV chốt buổi (sessions:edit), không xếp lịch — câu 48
    "inventory:movement", // câu 6: "không"
  ],
};

/**
 * Mismatch (v1=true, v2=false) của user có ĐÚNG THIẾT KẾ không: mọi role v1 cấp
 * action đó cho user đều đã ký siết. Còn ≥1 nguồn cấp không nằm trong danh sách
 * → lệch THẬT, phải xử lý.
 */
export function isIntentionalMismatch(
  action: string,
  userRoles: readonly string[],
  v1Permissions: Record<string, readonly string[]>,
): boolean {
  const sources = (v1Permissions[action] ?? []).filter(
    (r) => r !== "SUPER_ADMIN" && userRoles.includes(r),
  );
  if (sources.length === 0) return false; // v1 không cấp qua role thường → không phải narrowing
  return sources.every((r) => INTENTIONAL[r as Role]?.includes(action) ?? false);
}
