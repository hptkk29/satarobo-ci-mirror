// Registry quyền — module Nội dung website: tin tức, blog, tuyển dụng, vinh danh,
// CMS site, email hệ thống. Toàn bộ là nội dung thương hiệu cấp toàn hệ thống
// (không gắn đơn vị) → scopable: false.
// Key GIỮ NGUYÊN format v1 `resource:verb` (TS-01).
import type { ModuleDecl } from "./types";

export const contentModule: ModuleDecl = {
  module: "content",
  permissions: [
    // --- News (tin tức) ---
    { key: "news:view", action: "view", scopable: false },
    { key: "news:create", action: "create", scopable: false },
    { key: "news:edit", action: "edit", scopable: false },
    { key: "news:delete", action: "delete", scopable: false },
    { key: "news:publish", action: "publish", scopable: false },

    // --- Blog ---
    { key: "blog:view", action: "view", scopable: false },
    { key: "blog:create", action: "create", scopable: false },
    { key: "blog:edit", action: "edit", scopable: false },
    { key: "blog:delete", action: "delete", scopable: false },

    // --- Jobs (tuyển dụng) ---
    { key: "jobs:view", action: "view", scopable: false },
    { key: "jobs:create", action: "create", scopable: false },
    { key: "jobs:edit", action: "edit", scopable: false },
    { key: "jobs:delete", action: "delete", scopable: false },

    // --- Honors (vinh danh) ---
    { key: "honors:view", action: "view", scopable: false },
    { key: "honors:create", action: "create", scopable: false },
    { key: "honors:edit", action: "edit", scopable: false },
    { key: "honors:delete", action: "delete", scopable: false },
    {
      key: "honors:settings",
      action: "settings",
      scopable: false,
      description: "Cấu hình trang vinh danh (tiêu chí, hiển thị).",
    },

    // --- Site content / CMS ---
    { key: "site-content:view", action: "view", scopable: false },
    { key: "site-content:edit", action: "edit", scopable: false },

    // --- Emails (template + log hệ thống) ---
    { key: "emails:view", action: "view", scopable: false },
    { key: "emails:manage", action: "manage", scopable: false },
  ],
};
