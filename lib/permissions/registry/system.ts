// Registry quyền — module Hệ thống: cấu hình, role, tài khoản, cơ sở, audit log,
// báo cáo. Nhóm quyền quản trị thuần hệ thống (settings/roles/users) → scopable: false.
// Key GIỮ NGUYÊN format v1 `resource:verb` (TS-01).
import type { ModuleDecl } from "./types";

export const systemModule: ModuleDecl = {
  module: "system",
  permissions: [
    // --- Dashboard QLCS 4 tab (A-02) ---
    {
      key: "dashboard:view",
      action: "view",
      // `scopable: false` — đây là cổng VÀO màn hình, không phải quyền trên dữ liệu.
      // Phạm vi cơ sở của số liệu do `resolveScopeFilters()` + `scopedDb` quyết định.
      // Quan trọng hơn: action nằm trong PAGE_GATES phải là GLOBAL ở mọi RoleDef giữ nó
      // (gate cấp trang gọi `checkAnyPermission` KHÔNG target ⇒ scope CENTER trả false
      // trên prod mà local vẫn xanh) — bất biến này có test ở lib/auth/page-gates.test.ts.
      scopable: false,
      description: "Mở màn dashboard QLCS 4 tab (Tài chính · Kinh doanh · Chi phí Marketing · Tương tác KH).",
    },

    // --- Settings (cấu hình toàn cục — không gắn đơn vị) ---
    { key: "settings:view", action: "view", scopable: false },
    { key: "settings:edit", action: "edit", scopable: false },
    // 23/09/2026 — QUYỀN HẸP cho Quản lý cơ sở tự chỉnh tham số CỦA CƠ SỞ MÌNH.
    //
    // Chủ dự án chốt 22/09: "trần số đợt / số ưu đãi thì QLCS chỉnh được ở Cấu hình vận
    // hành". Nhưng KHÔNG nới `settings:view` — màn đó có 100+ khoá gồm OTP, mẫu tin ZNS,
    // khoá VAPID, trần hoa hồng; nới nó là chữa một vấn đề bằng cách mở một vấn đề lớn hơn
    // (đúng bài học `audit-logs:view` trong CLAUDE.md).
    //
    // ⚠️ Việc gỡ `settings:view` khỏi Quản lý cơ sở là QUYẾT ĐỊNH CÓ CHỮ KÝ ngày 03/08/2026
    // (`lib/auth/rbac-intentional.ts`) — quyền mới này KHÔNG đảo quyết định đó, nó mở một
    // cửa hẹp hơn bên cạnh.
    //
    // ⚠️ `scopable: false` là CỐ Ý và không phải lỗ hổng: quyền này chỉ mở CỬA VÀO TRANG.
    // Cách ly cơ sở nằm ở đường GHI — `setCenterSetting` đòi actor có vai quản lý tại ĐÚNG
    // `orgUnitId` đang sửa (`lib/settings/service.ts:144-151`). Khai `scopable: true` ở đây
    // thì `checkPermission` không kèm target sẽ trả false trên prod (v2) và khoá nhầm cửa
    // chính — đúng bẫy đã ghi trong memory "quyền cổng trang PHẢI seed GLOBAL không CENTER".
    {
      key: "settings:view-center",
      // Phai khop phan verb cua key — luoi [TS-01] chong troi hai nguon canh viec do.
      action: "view-center",
      scopable: false,
      description: "Mở Cấu hình vận hành ở chế độ HẸP: chỉ xem/sửa tham số cài riêng theo cơ sở mình.",
    },

    // --- Roles ---
    {
      key: "roles:assign",
      action: "assign",
      // Gán vai theo user × orgUnit → vẫn cần scope.
      description: "Gán vai trò cho tài khoản (UserOrgRole).",
    },
    {
      key: "roles:manage",
      action: "manage",
      // Định nghĩa RoleDef/RolePermission là cấu hình toàn cục.
      scopable: false,
      description: "CRUD RoleDef + gán RolePermission (chỉ SUPER_ADMIN).",
    },

    // --- User groups (US-03 — nhóm người dùng nhận grant ad-hoc) ---
    {
      key: "user-groups:manage",
      action: "manage",
      // Nhóm + grant nhóm là cấu hình quyền toàn cục (như roles:manage).
      scopable: false,
      description: "CRUD UserGroup + thành viên + grant ALLOW/DENY cho nhóm (chỉ SUPER_ADMIN).",
    },

    // --- Users ---
    {
      key: "users:manage",
      action: "manage",
      scopable: false,
      description: "CRUD tài khoản User (khác hồ sơ Employee).",
    },

    // --- Centers (danh mục cơ sở) ---
    { key: "centers:view", action: "view" },
    { key: "centers:edit", action: "edit" },

    // --- Audit logs ---
    { key: "audit-logs:view", action: "view" },
    {
      key: "audit-logs:view-pii",
      action: "view-pii",
      description: "Break-glass xem PII đầy đủ trong audit viewer (reason + log riêng).",
    },
  ],
};
