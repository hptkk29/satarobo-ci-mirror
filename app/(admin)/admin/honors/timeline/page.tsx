import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { TimelineAdminClient } from "@/components/admin/honors/timeline-admin-client";
import { checkPermission } from "@/lib/auth/check-permission";

export const metadata = { title: "Timeline | Hall of Fame" };

export default async function TimelineAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("honors:settings"))) {
    redirect("/dashboard");
  }

  // TimelineItem là model global (∉ SCOPED_MODELS) → sdb pass-through.
  const actor = await resolveActor(session.user.id);
  const items = await scopedDb(actor).timelineItem.findMany({
    orderBy: { occurredAt: "asc" },
  });

  const canDelete = await checkPermission("honors:delete");

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Timeline công ty</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Các mốc thời gian quan trọng của Sata Robo — hiển thị ở cuối trang /vinh-danh.
        </p>
      </div>

      <TimelineAdminClient items={items} canDelete={canDelete} />
    </div>
  );
}
