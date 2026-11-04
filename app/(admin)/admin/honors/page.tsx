import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import Link from "next/link";
import { Plus } from "lucide-react";
import { HonorsAdminTable } from "@/components/admin/honors/honors-admin-table";
import { checkPermission } from "@/lib/auth/check-permission";

export const metadata = { title: "Quản lý Hall of Fame | Admin" };

export default async function HonorsAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("honors:settings"))) {
    redirect("/dashboard");
  }

  // Honor là nội dung global (∉ SCOPED_MODELS) → sdb pass-through.
  const actor = await resolveActor(session.user.id);
  const honors = await scopedDb(actor).honor.findMany({
    orderBy: [{ displayOrder: "asc" }, { awardedAt: "desc" }],
    include: { createdBy: { select: { name: true } } },
  });

  const canDelete = await checkPermission("honors:delete");

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vinh danh</h1>
          <p className="mt-1 text-sm text-muted-foreground">{honors.length} nhân sự được vinh danh</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/honors/timeline"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            Timeline
          </Link>
          <Link
            href="/honors/settings"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            Cài đặt trang
          </Link>
          <Link
            href="/honors/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Thêm nhân sự
          </Link>
        </div>
      </div>

      <HonorsAdminTable honors={honors} canDelete={canDelete} />
    </div>
  );
}
