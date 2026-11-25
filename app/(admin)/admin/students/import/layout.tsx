import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * Cổng của màn Import học viên. Trang bên trong là client component nên TRƯỚC ĐÂY không có
 * cổng nào ở trang — ai gõ đường dẫn cũng thấy form, chỉ lúc bấm nhập `POST /api/admin/import/
 * students` mới từ chối (`students:import`). Nút hiện ra cho người không dùng được là lời hứa
 * suông (luật 12): chặn ở trang, cùng quyền với API.
 */
export default async function ImportHocVienLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("students:import"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return <>{children}</>;
}
