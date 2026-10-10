// lib/dashboard/widget-registry.ts — R6-D3: widget dashboard lọc theo can() (KHÔNG theo
// tên role). Thêm role mới có quyền tương ứng → tự thấy widget, không sửa code (T4).
import { can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/actor";

export type Widget = {
  id: string;
  title: string;
  /** Action quyết định hiển thị (vd "leads:view-all"). Thiếu = ai cũng thấy. */
  requires?: string;
};

/** Lọc widget actor được thấy theo can() (ALLOW-wins). KHÔNG so theo role code. */
export function visibleWidgets(actor: Actor, registry: readonly Widget[]): Widget[] {
  return registry.filter((w) => !w.requires || can(actor, w.requires));
}

/** Đăng ký widget mặc định (id → action). Mở rộng = thêm entry, không sửa logic. */
export const DASHBOARD_WIDGETS: readonly Widget[] = [
  { id: "leads-funnel", title: "Phễu lead", requires: "leads:view-all" },
  { id: "commission-mine", title: "Hoa hồng của tôi" }, // ai cũng thấy
  { id: "revenue", title: "Doanh thu", requires: "payments:manage" },
  { id: "attendance", title: "Điểm danh", requires: "attendance:view" },
  { id: "students", title: "Học viên", requires: "students:view-all" },
];
