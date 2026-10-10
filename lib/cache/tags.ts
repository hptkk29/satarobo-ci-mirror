// Tag registry cho next/cache (unstable_cache + revalidateTag) — 1 NGUỒN tên tag.
// Dùng hằng số thay magic string để không drift giữa nơi cache và nơi invalidate.
// Mở rộng dần khi thêm dữ liệu read-mostly được cache cross-request (dashboard, report,
// settings...). REQ-13 foundation.

export const CACHE_TAGS = {
  /** Cây OrgUnit (global, read-mostly). Invalidate khi tạo/sửa/xoá OrgUnit. REQ-02. */
  orgTree: "org-tree",
  /** Cấu hình hệ thống/cơ sở (read-mostly). Invalidate khi set setting. REQ-12. */
  settings: "settings",
  /** Số liệu dashboard theo actor-scope. Invalidate khi dữ liệu nguồn đổi. REQ-04. */
  dashboard: "dashboard",
  /** Số liệu báo cáo theo actor-scope. Invalidate khi dữ liệu nguồn đổi. REQ-05. */
  report: "report",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];
