import { notFound } from "next/navigation";
import { mucBaiTapBaiThiDangHien } from "@/lib/portal/muc-tam-an";

// Tạm ẩn 03/11/2026 — hệ thống chưa có bài tập, bài thi. Mục đang ẩn ⇒ MỌI trang con của nhánh này trả 404 (kể cả gõ thẳng đường dẫn).
// Bật lại ở MỘT chỗ: env PORTAL_BAI_TAP_BAI_THI_ENABLED="true" (xem lib/portal/muc-tam-an.ts).
export default function Layout({ children }: { children: React.ReactNode }) {
  if (!mucBaiTapBaiThiDangHien()) notFound();
  return children;
}
