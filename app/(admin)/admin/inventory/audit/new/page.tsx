import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { StartAuditForm } from "../_components/start-audit-form";
import { PageHelp } from "@/components/admin/ui/page-help";

export const dynamic = "force-dynamic";

export default async function NewAuditPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("inventory:audit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // PR-C: kho là tồn vật lý tại cơ sở vận hành → chỉ chọn CENTER (loại HO).
  const actor = await resolveActor(session.user.id);
  const orgUnits = (
    await getSelectableOrgUnits(actor, { types: ["CENTER"] })
  ).map((o) => ({ id: o.orgUnitId, name: o.name }));

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/inventory/audit"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold text-foreground">
          Tạo phiếu kiểm kê
        </h1>
      </div>

      <PageHelp>
        <p>
          Phiếu mới ở trạng thái DRAFT. Sau khi tạo, hệ thống mở form kiểm kê
          bulk cho toàn bộ mặt hàng active của cơ sở.
        </p>
      </PageHelp>

      {orgUnits.length === 0 ? (
        <div className="rounded-xl border border-state-warning-soft bg-state-warning-soft p-4 text-sm text-state-warning-ink">
          Chưa có cơ sở active nào. Tạo / kích hoạt cơ sở trước tại{" "}
          <Link
            href="/centers"
            className="font-semibold underline hover:text-state-warning-ink"
          >
            /admin/centers
          </Link>
          .
        </div>
      ) : (
        <StartAuditForm orgUnits={orgUnits} />
      )}
    </div>
  );
}
