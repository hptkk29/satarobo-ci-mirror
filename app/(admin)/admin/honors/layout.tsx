import { notFound } from "next/navigation";

// Tạm ẩn khu quản lý Vinh danh (/admin/honors) khỏi admin — song song với việc
// đã ẩn khu public /vinh-danh (app/(public)/vinh-danh/layout.tsx). Layout này
// 404 mọi route con: /honors, /honors/new, /honors/[id]/edit, /honors/settings,
// /honors/timeline. Dữ liệu honors + toàn bộ code (page/actions/components) GIỮ
// NGUYÊN — chỉ ẩn khỏi UI. Bật lại: xoá file này + bỏ comment mục "Vinh danh"
// (và import Trophy) trong components/admin/sidebar.tsx.
export default function HonorsHiddenLayout() {
  notFound();
}
