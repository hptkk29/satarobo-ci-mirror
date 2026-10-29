// lib/auth/hosts.ts — URL tuyệt đối của từng khu vực (host + trang chủ), dùng cho
// điều hướng CROSS-HOST phía client (F3 Q41 — nút chuyển khu vực admin↔teacher↔portal).
//
// ⚠️ Giá trị host TRÙNG với `proxy.ts` (PUBLIC/ADMIN/PORTAL/TEACHER_HOST). Cố ý nhân
// bản để KHÔNG đụng proxy.ts trong tuần flip RBAC (vùng freeze). Sau flip ổn định nên
// hợp nhất: proxy.ts import từ đây (1 nguồn sự thật) — ghi ở Q41/F3.

import type { HostKind } from "@/lib/auth/route-policy";
import { AREA_META, type SwitchableArea } from "@/lib/auth/switchable-areas";

const HOST_DOMAIN: Record<SwitchableArea | "public", string> = {
  public: "satarobo.vn",
  admin: "admin.satarobo.vn",
  portal: "hocvien.satarobo.vn",
  teacher: "giaovien.satarobo.vn",
};

/** URL tuyệt đối tới trang chủ của 1 khu vực (VD area "teacher" → https://giaovien.satarobo.vn/). */
export function areaHomeUrl(area: SwitchableArea): string {
  return `https://${HOST_DOMAIN[area]}${AREA_META[area].home}`;
}

/** Phân loại 1 mã vai trò về khu vực host tương ứng (chỉ TEACHER/PARENT lệch admin). */
export function areaForRole(role: string): SwitchableArea {
  if (role === "TEACHER") return "teacher";
  if (role === "PARENT") return "portal";
  return "admin";
}

/**
 * EL-01 PR3 — URL khu đào tạo nội bộ (host thứ 6).
 *
 * KHÔNG nằm trong `SwitchableArea`: đây không phải một "khu vực chuyển được" theo vai —
 * mọi nhân sự đều vào được (QĐ-7: EMP = mọi vai staff), nên nó là một LỐI VÀO thêm
 * trong menu tài khoản chứ không phải một nhánh của bộ chuyển khu.
 */
export function elearningHomeUrl(): string {
  return "https://e-learning.satarobo.vn/";
}

/** URL admin (dùng cho lối "Về trang quản trị" từ site giáo viên). */
export function adminHomeUrl(): string {
  return areaHomeUrl("admin");
}

export type { HostKind };
