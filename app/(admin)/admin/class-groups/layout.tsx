// app/(admin)/admin/class-groups/layout.tsx — CỔNG CHẶN tính năng "Nhóm lớp" (gỡ 20/08/2026).
//
// Chủ dự án yêu cầu gỡ hẳn nhóm lớp khỏi giao diện. Gỡ theo 2 phase như luật repo:
// phase A — chặn MỌI LỐI VÀO (mục sidebar, ô "Nhóm lớp cố định" trong form lớp, và route
// này); phase B — xoá code khi đã chạy ổn định. Nên toàn bộ trang bên dưới GIỮ NGUYÊN.
//
// Vì sao chặn ở layout chứ không xoá thư mục: bật lại `CLASS_GROUP_ENABLED="true"` là dùng
// được ngay, không phải revert code — và người còn giữ bookmark/link cũ được đá về danh
// sách lớp thay vì đâm vào 404 không hiểu chuyện gì.
//
// Đường dẫn "/classes" (không tiền tố /admin) là quy ước clean-URL của host admin —
// `proxy.ts` rewrite sang /admin/* ; xem `ADMIN_ROUTE_SEGMENTS` trong lib/auth/route-policy.ts
// (bảng segment hợp lệ của host admin — KHÔNG cần gỡ "class-groups" khỏi đó: gỡ đi thì
// route trở nên không hợp lệ ở tầng proxy và bật cờ lại cũng không vào được).
import { redirect } from "next/navigation";
import { isClassGroupEnabled } from "@/lib/flags";

export default function ClassGroupsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isClassGroupEnabled()) redirect("/classes");
  return <>{children}</>;
}
