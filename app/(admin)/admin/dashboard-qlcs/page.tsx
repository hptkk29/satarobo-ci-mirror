import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import type { ScopeFilterSearchParams } from "@/lib/reports/scope-filters";
import { BangDieuKhienQlcs } from "./_components/bang-dieu-khien-qlcs";

export const metadata = { title: "Dashboard QLCS | Admin" };
export const dynamic = "force-dynamic";

const BASE_PATH = "/dashboard-qlcs";

type PageProps = {
  searchParams: Promise<ScopeFilterSearchParams & { tab?: string | string[] }>;
};

/**
 * A-02-UI — dashboard quản lý cơ sở.
 *
 * ┌─ 27/08/2026 — trang này KHÔNG còn là đích chính ─────────────────────────────────┐
 * │ Chủ dự án chốt: gỡ mục "Dashboard QLCS" khỏi menu, và cho Quản lý cơ sở +        │
 * │ Quản trị hệ thống thấy thẳng bốn khối này ngay trong `/dashboard` sau khi đăng   │
 * │ nhập, không phân tab. Nội dung đã dời sang `_components/bang-dieu-khien-qlcs`    │
 * │ để hai trang dùng CHUNG một khối — không chép đôi.                              │
 * │                                                                                  │
 * │ Route giữ lại, KHÔNG xoá: đường dẫn `/dashboard-qlcs` đã gửi đi trong thông báo  │
 * │ và tài liệu, `PAGE_GATES` vẫn gác nó, và `route-policy.test.ts` còn ghim. Nó nằm │
 * │ trong ALLOWLIST của `nav-coverage.test.ts` kèm lý do.                            │
 * │                                                                                  │
 * │ ~~Bốn tab dùng chung một bộ lọc~~ [ĐẢO 27/08] — bốn KHỐI xếp dọc, xem một mạch.  │
 * └──────────────────────────────────────────────────────────────────────────────────┘
 */
export default async function DashboardQlcsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission(PAGE_GATES["/dashboard-qlcs"]))) {
    redirect("/dashboard?error=unauthorized");
  }

  const sp = await searchParams;

  return (
    <div className="space-y-5 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Dashboard quản lý cơ sở</h1>
        <p className="text-sm text-muted-foreground">
          Bốn khối dùng chung một bộ lọc phạm vi. Quản lý cơ sở và Quản trị hệ thống thấy
          đúng nội dung này ngay tại{" "}
          <span className="font-medium text-foreground">Dashboard</span> sau khi đăng nhập.
        </p>
      </div>

      <BangDieuKhienQlcs userId={session.user.id} searchParams={sp} basePath={BASE_PATH} />
    </div>
  );
}
