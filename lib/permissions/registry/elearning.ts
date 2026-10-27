// Registry quyền — module Đào tạo nội bộ (e-learning). EL-02.
//
// ⛔ BP-2 (a) — QĐ-CDA-13: TOÀN BỘ 17 key nằm gọn trong file này, không rải sang
// file dùng chung. Bề mặt xung đột với các luồng đang chạy song song (chat realtime,
// parity site giáo viên) vì thế thu về đúng một dòng `import` + một phần tử trong
// `ALL_MODULE_DECLS` của `registry/index.ts`.
//
// Vì sao đây là ràng buộc chứ không phải gu code: hai luồng cùng thêm phần tử vào
// MỘT mảng dùng chung là kiểu xung đột tốn nhất — git nối hai nửa lại thành một
// bảng quyền SAI MÀ VẪN BIÊN DỊCH ĐƯỢC, và bảng quyền sai thì không test nào của
// luồng kia bắt được, vì nó không biết key của luồng này tồn tại.
//
// ─── Key 3 đoạn, trường `action` 1 đoạn ────────────────────────────────────────
// `types.ts` giữ format v1 `resource:verb`, nên `action` của `PermissionDecl` là
// ĐOẠN CUỐI: { key: "elearning:progress:view-all", action: "view-all" }.
// Prefix `elearning:` phải là duy nhất trong `ALL_MODULE_DECLS`, nếu không
// `collectDescriptors()` ném `DuplicatePermissionKeyError`.
//
// ─── Hai điều KHÔNG có ở đây, có chủ đích ─────────────────────────────────────
//  1. `elearning:audit:view` KHÔNG tồn tại. R8 (AuditLog) chỉ SUPER_ADMIN trong
//     toàn cửa sổ GĐ0→GĐ5: `AuditLog` không nằm trong `SCOPED_MODELS` và
//     `page-gates.ts` ghi thẳng "AuditLog không có centerId" ⇒ một key GLOBAL cho
//     vai Kiểm toán là mở nhật ký TOÀN HỆ, kể cả module ngoài e-learning.
//  2. Không key nào dành cho danh sách loại trừ của EL-05. `can()` v2 là ALLOW-wins
//     thuần (`lib/auth/can.ts` — "OI-7 ALLOW-wins, KHÔNG DENY"), nên một grant DENY
//     sẽ bị BỎ QUA IM LẶNG. Loại trừ hiện thực bằng bảng dữ liệu
//     `TrnAssignmentExclude` (mang `reason` + `addedByUserId`), không bằng quyền.
//
// ⚠️ 17 key này còn PHẢI được khai vào matrix v1 `PERMISSIONS`
// (`lib/auth/permissions.ts`). Registry chỉ MÔ TẢ quyền; `ALL_ACTIONS` sinh từ
// `Object.keys(PERMISSIONS)`, và `buildActor()` lọc grant theo đúng tập đó
// (`.filter(g => g.grant === "ALLOW" && validActions.has(g.action))`). Quyền đi qua
// `RoleDef` chạy được cả khi không khai; quyền đi qua `PermissionGrant` /
// `UserPermissionGrant` thì bị lọc mất KHÔNG BÁO GÌ — đúng cái bẫy đã đốt 114 tài
// khoản PARENT ngày 10/08/2026.
import type { ModuleDecl } from "./types";

export const elearningModule: ModuleDecl = {
  module: "elearning",
  permissions: [
    {
      key: "elearning:portal:access",
      action: "access",
      description: "Vào host e-learning và xem danh mục khoá.",
    },
    {
      key: "elearning:lesson:learn",
      action: "learn",
      description: "Học bài và ghi tiến độ của chính mình.",
    },
    {
      key: "elearning:program:manage",
      action: "manage",
      description:
        "Tạo/sửa chương trình, phiếu nhu cầu, thẻ phân loại, cấu hình khoá.",
    },
    {
      key: "elearning:content:author",
      action: "author",
      description: "Biên soạn khoá/chương/bài, tạo phiên bản nháp.",
    },
    {
      key: "elearning:content:publish",
      action: "publish",
      description: "Xuất bản phiên bản khoá (qua 6 cổng chất lượng).",
    },
    {
      key: "elearning:assignment:create",
      action: "create",
      description: "Tạo lượt giao (tĩnh/động) sau khi xem trước danh sách.",
    },
    {
      key: "elearning:assignment:extend",
      action: "extend",
      description:
        "Sửa lượt giao đã tạo: gia hạn · thu hồi · gia hạn theo sự cố. Cả 3 action đều bắt buộc lý do.",
    },
    {
      key: "elearning:requirement:manage",
      action: "manage",
      description: "Tạo/sửa TrnRequirement và công nhận tương đương.",
    },
    {
      key: "elearning:progress:view-own",
      action: "view-own",
      description: "Xem tiến độ học của chính mình.",
    },
    {
      key: "elearning:progress:view-team",
      action: "view-team",
      description: "Xem tiến độ nhóm dưới quyền / cơ sở mình.",
    },
    {
      key: "elearning:progress:view-all",
      action: "view-all",
      description: "Xem tiến độ toàn hệ thống.",
    },
    {
      key: "elearning:video-analytics:view",
      action: "view",
      description: "Xem báo cáo R2, heatmap đoạn, cờ nghi ngờ.",
    },
    {
      key: "elearning:exam:grade",
      action: "grade",
      description: "Chấm tay bài thi/bài tập theo rubric.",
    },
    {
      key: "elearning:exam:unlock",
      action: "unlock",
      description: "Mở lại lượt thi đã hết (BR-006), ghi TrnExamUnlock.",
    },
    {
      key: "elearning:certificate:issue",
      action: "issue",
      description: "Cấp/cấp lại chứng nhận bằng tay.",
    },
    {
      key: "elearning:certificate:revoke",
      action: "revoke",
      description: "Thu hồi chứng nhận (BR-007, bắt buộc lý do).",
    },
    {
      key: "elearning:report:export",
      action: "export",
      description: "Xuất Excel/PDF báo cáo R1–R7 (watermark + audit).",
    },
  ],
};
